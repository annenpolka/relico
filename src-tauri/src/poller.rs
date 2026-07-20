use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Local, NaiveDate, Utc};
use serde::{Serialize, Serializer};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

use crate::backoff::Backoff;
use crate::config::AppConfig;
use crate::dedup::NotifiedSet;
use crate::filter::{self, FilterSettings};
use crate::model::Fissure;
use crate::notify;
use crate::timed::TimedContentSnapshot;

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

fn serialize_optional_fissure<S>(
    fissure: &Option<Fissure>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match fissure {
        Some(fissure) => FissureView {
            fissure,
            planet: filter::extract_planet(&fissure.node),
        }
        .serialize(serializer),
        None => serializer.serialize_none(),
    }
}

/// フロントエンドとトレイに配る現在状態
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    /// 二つの独立pollerが後着した古いfull snapshotをUIで破棄するための単調revision。
    pub revision: u64,
    /// フィルタ合致亀裂のみ(SPEC: VIS-001)。消滅が近い順
    #[serde(serialize_with = "serialize_fissures")]
    pub fissures: Vec<Fissure>,
    /// 通知scope側で次に期限を迎える合致亀裂。表示一覧とは独立。SPEC: NTY-001
    #[serde(serialize_with = "serialize_optional_fissure")]
    pub next_notification: Option<Fissure>,
    pub api_ok: bool,
    pub last_error: Option<String>,
    pub last_poll: Option<DateTime<Utc>>,
    pub next_poll_secs: u64,
    pub notified_today: u32,
    /// backendがシステムローカル時刻で評価した現在のquiet-hours状態。
    pub notifications_muted: bool,
    /// quiet-hours中に既知扱いとして破棄した新規通知数。
    pub suppressed_today: u32,
    /// 亀裂NODE表示用のnode表示名→enemy level範囲(ExportRegions由来)。SPEC: TMD-007
    pub node_levels: BTreeMap<String, [u32; 2]>,
    /// 亀裂とは独立した5分周期の時限コンテンツsnapshot。
    pub timed_content: TimedContentSnapshot,
    pub paused: bool,
}

pub struct PollerState {
    pub snapshot: StatusSnapshot,
    pub notified: NotifiedSet,
    /// contentRules用の通知済みcard id集合(亀裂のdedupとは独立)。SPEC: CNT-002
    pub content_notified: NotifiedSet,
    counter_date: NaiveDate,
}

impl PollerState {
    pub fn new(notified: NotifiedSet, content_notified: NotifiedSet, cfg: &AppConfig) -> Self {
        let now = Local::now();
        let snapshot = StatusSnapshot {
            notifications_muted: cfg.notifications_muted_at(now),
            paused: cfg.paused,
            next_poll_secs: if cfg.paused {
                0
            } else {
                cfg.effective_poll_secs()
            },
            ..StatusSnapshot::default()
        };
        Self {
            snapshot,
            notified,
            content_notified,
            counter_date: now.date_naive(),
        }
    }

    pub(crate) fn reset_daily_counters(&mut self, now: DateTime<Local>) {
        let date = now.date_naive();
        if date != self.counter_date {
            self.counter_date = date;
            self.snapshot.notified_today = 0;
            self.snapshot.suppressed_today = 0;
        }
    }

    pub(crate) fn bump_revision(&mut self) {
        self.snapshot.revision = self.snapshot.revision.saturating_add(1);
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

/// 指定された表示選択ルールに合致するもの。消滅が近い順。SPEC: FLT-013 / DED-003
pub fn matching_fissures(
    settings: &FilterSettings,
    fissures: &[Fissure],
    now: DateTime<Utc>,
) -> Vec<Fissure> {
    let mut matching: Vec<Fissure> = fissures
        .iter()
        .filter(|f| filter::matches(settings, f, now))
        .cloned()
        .collect();
    matching.sort_by_key(|f| f.expiry);
    matching
}

/// 一覧に出す生存中の亀裂。表示選択ルールがあれば合致のみ、
/// 無指定(enabled=trueが0本)はexpiry > nowの全件をブラウズ表示する。
/// 通知参加・min_remaining_secsとは独立。SPEC: VIS-001
pub fn visible_fissures(
    settings: &FilterSettings,
    fissures: &[Fissure],
    now: DateTime<Utc>,
) -> Vec<Fissure> {
    if !settings.rules.iter().any(|rule| rule.enabled) {
        let mut all: Vec<Fissure> = fissures
            .iter()
            .filter(|fissure| fissure.expiry > now)
            .cloned()
            .collect();
        all.sort_by_key(|f| f.expiry);
        return all;
    }
    matching_fissures(settings, fissures, now)
}

/// 通知候補 = notification projection(notify=true、enabled非依存)に合致するもののみ。
/// 非表示ルールだけに合致する亀裂も通知する。SPEC: NTY-001
pub fn notify_candidates(
    settings: &FilterSettings,
    fissures: &[Fissure],
    now: DateTime<Utc>,
) -> Vec<Fissure> {
    matching_fissures(&filter::notification_projection(settings), fissures, now)
}

/// 合致亀裂のうち未通知のものを記録し、通知対象を返す。
/// seed_only(起動直後の初回ポーリング)では記録のみ行い、通知対象は常に空。SPEC: POL-002
pub fn select_notifications(
    notified: &mut NotifiedSet,
    matching: Vec<Fissure>,
    seed_only: bool,
    muted: bool,
) -> Vec<Fissure> {
    let fresh: Vec<Fissure> = matching
        .into_iter()
        .filter(|f| notified.mark(&f.id, f.expiry))
        .collect();
    if seed_only || muted {
        Vec::new()
    } else {
        fresh
    }
}

/// 起動直後または通知scope変更後は、現存分を通知せず既知IDとしてseedする。
/// 表示選択、notify=false draft、通知先だけの変更はscope変更ではない。SPEC: POL-003
pub fn notification_scope_changed(
    previous: Option<&FilterSettings>,
    current: &FilterSettings,
) -> bool {
    let current = filter::notification_projection(current);
    match previous {
        None => true,
        Some(previous) => filter::notification_projection(previous) != current,
    }
}

/// 常駐ポーリングループ。設定変更(watch)で即時に再評価する
pub async fn run(
    app: AppHandle,
    mut cfg_rx: watch::Receiver<AppConfig>,
    mut reload_rx: watch::Receiver<u64>,
    state: Arc<Mutex<PollerState>>,
    notified_path: PathBuf,
) {
    let client = http_client();
    let mut backoff = Backoff::new(60, 600);
    let mut seeded_scope: Option<FilterSettings> = None;
    let mut manual = false;

    loop {
        let cfg = cfg_rx.borrow().clone();
        let sleep_secs = if cfg.paused && !manual {
            emit_snapshot(&app, &cfg, &state, |snap| {
                snap.paused = true;
                snap.notifications_muted =
                    cfg.notifications_muted_at(chrono::Utc::now().with_timezone(&chrono::Local));
                snap.next_poll_secs = 0;
            });
            // HTTPは止めたまま、quiet-hours境界と日次counterだけは分単位で更新する。
            60
        } else {
            match poll_once(
                &app,
                &client,
                &cfg_rx,
                &state,
                &notified_path,
                seeded_scope.as_ref(),
                manual,
            )
            .await
            {
                Ok(scope) => {
                    if let Some(scope) = scope {
                        seeded_scope = Some(scope);
                    }
                    backoff.on_success();
                    let latest = cfg_rx.borrow().clone();
                    if latest.paused {
                        60
                    } else {
                        latest.effective_poll_secs()
                    }
                }
                Err(err) => {
                    eprintln!("poll failed: {err}");
                    let latest = cfg_rx.borrow().clone();
                    if latest.paused {
                        emit_snapshot(&app, &latest, &state, |snap| {
                            snap.paused = true;
                            snap.notifications_muted = latest.notifications_muted_at(Local::now());
                            snap.next_poll_secs = 0;
                        });
                        60
                    } else {
                        let delay = backoff.on_failure();
                        emit_snapshot(&app, &latest, &state, |snap| {
                            snap.api_ok = false;
                            snap.last_error = Some(err);
                            snap.notifications_muted = latest.notifications_muted_at(Local::now());
                            snap.paused = false;
                            snap.next_poll_secs = delay;
                        });
                        delay
                    }
                }
            }
        };
        manual = false;

        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(sleep_secs)) => {}
            changed = cfg_rx.changed() => {
                if changed.is_err() {
                    return; // 送信側が落ちた=アプリ終了
                }
            }
            changed = reload_rx.changed() => {
                if changed.is_err() {
                    return;
                }
                manual = true;
            }
        }
    }
}

async fn poll_once(
    app: &AppHandle,
    client: &reqwest::Client,
    cfg_rx: &watch::Receiver<AppConfig>,
    state: &Arc<Mutex<PollerState>>,
    notified_path: &Path,
    seeded_scope: Option<&FilterSettings>,
    manual: bool,
) -> Result<Option<FilterSettings>, String> {
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

    // HTTP待機中に保存されたミュート・Pause・locale・ruleを、dedup/配送より前に採用する。
    let cfg = cfg_rx.borrow().clone();
    if cfg.paused && !manual {
        emit_snapshot(app, &cfg, state, |snap| {
            snap.paused = true;
            snap.notifications_muted = cfg.notifications_muted_at(Local::now());
            snap.next_poll_secs = 0;
        });
        return Ok(None);
    }

    let now = Utc::now();
    let fcfg = cfg.filter();
    let seed_only = notification_scope_changed(seeded_scope, &fcfg);
    // 表示(enabled、無指定なら全件)と通知候補(notify、表示とは独立)を分離する。SPEC: VIS-001 / NTY-001
    let visible = visible_fissures(&fcfg, &fissures, now);
    let candidates = notify_candidates(&fcfg, &fissures, now);
    let next_notification = candidates.first().cloned();

    let muted = cfg.notifications_muted_at(now.with_timezone(&chrono::Local));
    let to_notify: Vec<Fissure> = {
        let mut st = state.lock().expect("poller state");
        st.reset_daily_counters(now.with_timezone(&Local));
        st.notified.prune(now);

        let suppressed = if !cfg.paused && muted && !seed_only {
            let mut unique_ids = HashSet::new();
            candidates
                .iter()
                .filter(|fissure| {
                    !st.notified.contains(&fissure.id) && unique_ids.insert(fissure.id.clone())
                })
                .count() as u32
        } else {
            0
        };
        let to_notify = if cfg.paused {
            vec![]
        } else {
            select_notifications(&mut st.notified, candidates, seed_only, muted)
        };

        if let Err(e) = st.notified.save(notified_path) {
            eprintln!("notified set save failed: {e}");
        }

        st.snapshot.fissures = visible;
        st.snapshot.next_notification = next_notification;
        st.snapshot.api_ok = true;
        st.snapshot.last_error = None;
        st.snapshot.last_poll = Some(now);
        st.snapshot.next_poll_secs = if cfg.paused { 0 } else { cfg.effective_poll_secs() };
        st.snapshot.notified_today += to_notify.len() as u32;
        st.snapshot.notifications_muted = muted;
        st.snapshot.suppressed_today += suppressed;
        st.snapshot.paused = cfg.paused;
        to_notify
    };

    emit_snapshot(app, &cfg, state, |_| {});

    for f in &to_notify {
        notify::send(app, client, &cfg, f).await;
    }
    Ok((!cfg.paused).then(|| filter::notification_projection(&fcfg)))
}

fn emit_snapshot(
    app: &AppHandle,
    cfg: &AppConfig,
    state: &Arc<Mutex<PollerState>>,
    mutate: impl FnOnce(&mut StatusSnapshot),
) {
    let snap = {
        let mut st = state.lock().expect("poller state");
        st.reset_daily_counters(Local::now());
        mutate(&mut st.snapshot);
        st.bump_revision();
        st.snapshot.clone()
    };
    let _ = app.emit("status", &snap);
    crate::update_tray(app, cfg, &snap);
}
