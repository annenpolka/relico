use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{Duration, Utc};
use tauri::{AppHandle, State};
use tokio::sync::watch;

use crate::config::AppConfig;
use crate::model::Fissure;
use crate::notify;
use crate::poller::{PollerState, StatusSnapshot};

pub struct AppState {
    pub cfg_tx: watch::Sender<AppConfig>,
    pub poller: Arc<Mutex<PollerState>>,
    pub config_path: PathBuf,
    pub client: reqwest::Client,
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> AppConfig {
    state.cfg_tx.borrow().clone()
}

#[tauri::command]
pub fn set_config(app: AppHandle, state: State<AppState>, config: AppConfig) -> Result<(), String> {
    config.save(&state.config_path).map_err(|e| e.to_string())?;
    let _ = tauri::Emitter::emit(&app, "config", &config);
    state.cfg_tx.send(config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable().map_err(|e| e.to_string())
    } else {
        launcher.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn get_status(state: State<AppState>) -> StatusSnapshot {
    state.poller.lock().expect("poller state").snapshot.clone()
}

/// MAN-001 / MAN-002 の確認手段。ダミー亀裂で通知経路を発火する
#[tauri::command]
pub async fn test_notification(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let cfg = state.cfg_tx.borrow().clone();
    let now = Utc::now();
    let dummy = Fissure {
        id: format!("test-{}", now.timestamp()),
        activation: now,
        expiry: now + Duration::minutes(30),
        node: "Test Node (Void)".to_string(),
        mission_type: "Survival".to_string(),
        enemy: "Orokin".to_string(),
        tier: "Axi".to_string(),
        tier_num: 4,
        is_storm: false,
        is_hard: true,
    };

    let mut sent = vec![];
    if cfg.desktop_notification {
        notify::desktop(&app, &dummy);
        sent.push("desktop");
    }
    if let Some(url) = cfg.discord_webhook_url.as_deref() {
        if !url.is_empty() {
            notify::discord(&state.client, url, &dummy)
                .await
                .map_err(|e| format!("Discord送信失敗: {e}"))?;
            sent.push("discord");
        }
    }
    if sent.is_empty() {
        return Err("通知先が1つも有効になっていない".to_string());
    }
    Ok(format!("送信OK: {}", sent.join(" + ")))
}
