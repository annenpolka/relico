use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Serialize, Serializer};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

use crate::backoff::Backoff;
use crate::config::AppConfig;
use crate::dedup::NotifiedSet;
use crate::filter::{self, FilterSettings};
use crate::model::Fissure;
use crate::notify;

pub const API_URL: &str = "https://api.warframestat.us/pc/fissures";

/// raw APIモデルを変えず、UI表示にだけ既存の惑星抽出結果を付加する。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FissureView<'a> {
    #[serde(flatten)]
    fissure: &'a Fissure,
    planet: Option<String>,
}

fn serialize_fissures<S>(fissures: &[Fissure], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    fissures
        .iter()
        .map(|fissure| FissureView {
            fissure,
            planet: filter::extract_planet(&fissure.node),
        })
        .collect::<Vec<_>>()
        .serialize(serializer)
}

/// フロントエンドとトレイに配る現在状態
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    /// フィルタ合致亀裂のみ(SPEC: VIS-001)。消滅が近い順
    #[serde(serialize_with = "serialize_fissures")]
    pub fissures: Vec<Fissure>,
    pub api_ok: bool,
    pub last_error: Option<String>,
    pub last_poll: Option<DateTime<Utc>>,
    pub next_poll_secs: u64,
    pub notified_today: u32,
    pub paused: bool,
}

pub struct PollerState {
    pub snapshot: StatusSnapshot,
    pub notified: NotifiedSet,
}

impl PollerState {
    pub fn new(notified: NotifiedSet) -> Self {
        Self {
            snapshot: StatusSnapshot::default(),
            notified,
        }
    }
}

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!(
            "relico/",
            env!("CARGO_PKG_VERSION"),
            " (+https://github.com/annenpolka/relico)"
        ))
        .timeout(Duration::from_secs(20))
        .build()
        .expect("http client")
}

/// 一覧に出す亀裂 = いずれかのルールに合致するもののみ。消滅が近い順。SPEC: VIS-001
pub fn visible_fissures(
    settings: &FilterSettings,
    fissures: &[Fissure],
    now: DateTime<Utc>,
) -> Vec<Fissure> {
    let mut visible: Vec<Fissure> = fissures
        .iter()
        .filter(|f| filter::matches(settings, f, now))
        .cloned()
        .collect();
    visible.sort_by_key(|f| f.expiry);
    visible
}

/// 合致亀裂のうち未通知のものを記録し、通知対象を返す。
/// seed_only(起動直後の初回ポーリング)では記録のみ行い、通知対象は常に空。SPEC: POL-002
pub fn select_notifications(
    notified: &mut NotifiedSet,
    matching: Vec<Fissure>,
    seed_only: bool,
) -> Vec<Fissure> {
    let fresh: Vec<Fissure> = matching
        .into_iter()
        .filter(|f| notified.mark(&f.id, f.expiry))
        .collect();
    if seed_only {
        Vec::new()
    } else {
        fresh
    }
}

/// 起動直後または有効な通知scope変更後は、現存分を通知せず既知IDとしてseedする。
/// 無効ルールの編集や通知先だけの変更はscope変更ではない。SPEC: POL-003
pub fn notification_scope_changed(
    previous: Option<&FilterSettings>,
    current: &FilterSettings,
) -> bool {
    let current = filter::enabled_projection(current);
    match previous {
        None => true,
        Some(previous) => filter::enabled_projection(previous) != current,
    }
}

/// 常駐ポーリングループ。設定変更(watch)で即時に再評価する
pub async fn run(
    app: AppHandle,
    mut cfg_rx: watch::Receiver<AppConfig>,
    state: Arc<Mutex<PollerState>>,
    notified_path: PathBuf,
) {
    let client = http_client();
    let mut backoff = Backoff::new(60, 600);
    let mut seeded_scope: Option<FilterSettings> = None;

    loop {
        let cfg = cfg_rx.borrow().clone();
        let sleep_secs = if cfg.paused {
            emit_snapshot(&app, &cfg, &state, |snap| {
                snap.paused = true;
                snap.next_poll_secs = 0;
            });
            3600 // 再開はwatch変更で即起きる
        } else {
            let current_scope = cfg.filter();
            let seed_only = notification_scope_changed(seeded_scope.as_ref(), &current_scope);
            match poll_once(&app, &client, &cfg, &state, &notified_path, seed_only).await {
                Ok(()) => {
                    seeded_scope = Some(filter::enabled_projection(&current_scope));
                    backoff.on_success();
                    cfg.effective_poll_secs()
                }
                Err(err) => {
                    eprintln!("poll failed: {err}");
                    let delay = backoff.on_failure();
                    emit_snapshot(&app, &cfg, &state, |snap| {
                        snap.api_ok = false;
                        snap.last_error = Some(err);
                        snap.paused = false;
                        snap.next_poll_secs = delay;
                    });
                    delay
                }
            }
        };

        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(sleep_secs)) => {}
            changed = cfg_rx.changed() => {
                if changed.is_err() {
                    return; // 送信側が落ちた=アプリ終了
                }
            }
        }
    }
}

async fn poll_once(
    app: &AppHandle,
    client: &reqwest::Client,
    cfg: &AppConfig,
    state: &Arc<Mutex<PollerState>>,
    notified_path: &Path,
    seed_only: bool,
) -> Result<(), String> {
    let fissures: Vec<Fissure> = client
        .get(API_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let now = Utc::now();
    let fcfg = cfg.filter();
    let visible = visible_fissures(&fcfg, &fissures, now);

    let to_notify: Vec<Fissure> = {
        let mut st = state.lock().expect("poller state");
        st.notified.prune(now);

        let to_notify = select_notifications(&mut st.notified, visible.clone(), seed_only);

        if let Err(e) = st.notified.save(notified_path) {
            eprintln!("notified set save failed: {e}");
        }

        st.snapshot.fissures = visible;
        st.snapshot.api_ok = true;
        st.snapshot.last_error = None;
        st.snapshot.last_poll = Some(now);
        st.snapshot.next_poll_secs = cfg.effective_poll_secs();
        st.snapshot.notified_today += to_notify.len() as u32;
        st.snapshot.paused = false;
        to_notify
    };

    emit_snapshot(app, cfg, state, |_| {});

    for f in &to_notify {
        notify::send(client, cfg, f).await;
    }
    Ok(())
}

fn emit_snapshot(
    app: &AppHandle,
    cfg: &AppConfig,
    state: &Arc<Mutex<PollerState>>,
    mutate: impl FnOnce(&mut StatusSnapshot),
) {
    let snap = {
        let mut st = state.lock().expect("poller state");
        mutate(&mut st.snapshot);
        st.snapshot.clone()
    };
    let _ = app.emit("status", &snap);
    crate::update_tray(app, cfg, &snap);
}
