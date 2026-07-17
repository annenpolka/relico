use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

use crate::backoff::Backoff;
use crate::config::AppConfig;
use crate::dedup::NotifiedSet;
use crate::filter;
use crate::model::Fissure;
use crate::notify;

pub const API_URL: &str = "https://api.warframestat.us/pc/fissures";

/// フロントエンドとトレイに配る現在状態
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    pub fissures: Vec<Fissure>,
    pub matched_ids: Vec<String>,
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
            "warframe-fissure-notifier/",
            env!("CARGO_PKG_VERSION"),
            " (+https://github.com/annenpolka/warframe-fissure-notifier)"
        ))
        .timeout(Duration::from_secs(20))
        .build()
        .expect("http client")
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

    loop {
        let cfg = cfg_rx.borrow().clone();
        let sleep_secs = if cfg.paused {
            emit_snapshot(&app, &state, |snap| {
                snap.paused = true;
                snap.next_poll_secs = 0;
            });
            3600 // 再開はwatch変更で即起きる
        } else {
            match poll_once(&app, &client, &cfg, &state, &notified_path).await {
                Ok(()) => {
                    backoff.on_success();
                    cfg.effective_poll_secs()
                }
                Err(err) => {
                    eprintln!("poll failed: {err}");
                    let delay = backoff.on_failure();
                    emit_snapshot(&app, &state, |snap| {
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
    notified_path: &PathBuf,
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

    let to_notify: Vec<Fissure> = {
        let mut st = state.lock().expect("poller state");
        st.notified.prune(now);

        let to_notify: Vec<Fissure> = fissures
            .iter()
            .filter(|f| filter::matches(&fcfg, f, now))
            .filter(|f| st.notified.mark(&f.id, f.expiry))
            .cloned()
            .collect();

        if let Err(e) = st.notified.save(notified_path) {
            eprintln!("notified set save failed: {e}");
        }

        let mut sorted = fissures.clone();
        sorted.sort_by_key(|f| f.expiry);
        st.snapshot.matched_ids = fissures
            .iter()
            .filter(|f| filter::matches(&fcfg, f, now))
            .map(|f| f.id.clone())
            .collect();
        st.snapshot.fissures = sorted;
        st.snapshot.api_ok = true;
        st.snapshot.last_error = None;
        st.snapshot.last_poll = Some(now);
        st.snapshot.next_poll_secs = cfg.effective_poll_secs();
        st.snapshot.notified_today += to_notify.len() as u32;
        st.snapshot.paused = false;
        to_notify
    };

    emit_snapshot(app, state, |_| {});

    for f in &to_notify {
        notify::send(app, client, cfg, f).await;
    }
    Ok(())
}

fn emit_snapshot(
    app: &AppHandle,
    state: &Arc<Mutex<PollerState>>,
    mutate: impl FnOnce(&mut StatusSnapshot),
) {
    let snap = {
        let mut st = state.lock().expect("poller state");
        mutate(&mut st.snapshot);
        st.snapshot.clone()
    };
    let _ = app.emit("status", &snap);
}
