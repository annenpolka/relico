use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{Duration, Utc};
use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::sync::watch;

use crate::config::AppConfig;
use crate::filter::{Mode, StormMode};
use crate::model::Fissure;
use crate::notify;
use crate::palette::{self, Facet};
use crate::poller::{PollerState, StatusSnapshot};

pub struct AppState {
    pub cfg_tx: watch::Sender<AppConfig>,
    pub poller: Arc<Mutex<PollerState>>,
    pub config_path: PathBuf,
    pub client: reqwest::Client,
}

fn persist(app: &AppHandle, state: &State<AppState>, cfg: AppConfig) -> Result<(), String> {
    cfg.save(&state.config_path).map_err(|e| e.to_string())?;
    let _ = tauri::Emitter::emit(app, "config", &cfg);
    state.cfg_tx.send(cfg).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> AppConfig {
    state.cfg_tx.borrow().clone()
}

#[tauri::command]
pub fn set_config(app: AppHandle, state: State<AppState>, config: AppConfig) -> Result<(), String> {
    persist(&app, &state, config)
}

/// パレット候補のビュー(on状態は編集中ルール基準。runtime enabledとは独立)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandView {
    pub id: String,
    pub label: String,
    pub facet: Facet,
    pub on: bool,
    pub indices: Vec<usize>,
    pub via: Option<String>,
}

#[tauri::command]
pub fn query_candidates(state: State<AppState>, q: String, active: usize) -> Vec<CandView> {
    let cfg = state.cfg_tx.borrow().clone();
    let rule = cfg.rules.get(active.min(cfg.rules.len().saturating_sub(1)));
    let catalog = palette::catalog();
    palette::query_catalog(&catalog, &q)
        .into_iter()
        .map(|r| {
            let c = &catalog[r.idx];
            let on = match c.facet {
                Facet::Tier => rule.is_some_and(|ru| ru.tiers.contains(&c.value)),
                Facet::Mission => rule.is_some_and(|ru| ru.mission_types.contains(&c.value)),
                Facet::Planet => rule.is_some_and(|ru| ru.planets.contains(&c.value)),
                Facet::Mode => rule.is_some_and(|ru| {
                    matches!(
                        (&ru.mode, c.value.as_str()),
                        (Mode::Normal, "Normal")
                            | (Mode::SteelPath, "SteelPath")
                            | (Mode::Both, "Both")
                    )
                }),
                Facet::Storm => rule.is_some_and(|ru| {
                    matches!(
                        (ru.storms, c.value.as_str()),
                        (StormMode::Exclude, "Exclude")
                            | (StormMode::Include, "Include")
                            | (StormMode::Only, "Only")
                    )
                }),
                Facet::Action => c.value == "pause" && cfg.paused,
            };
            CandView {
                id: c.id.clone(),
                label: c.label.clone(),
                facet: c.facet,
                on,
                indices: r.indices,
                via: r.via.map(|ai| c.aliases[ai].clone()),
            }
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub config: AppConfig,
    pub active: usize,
}

/// パレット候補を適用(アクティブルールの編集/アクション実行)。SPEC: SAT-001
#[tauri::command]
pub fn apply_candidate(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    active: usize,
) -> Result<ApplyResult, String> {
    let mut cfg = state.cfg_tx.borrow().clone();
    let catalog = palette::catalog();
    let cand = catalog
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("未知の候補id: {id}"))?;

    let new_active = if cand.id == "action:pause" {
        cfg.paused = !cfg.paused;
        active
    } else {
        let mut editor = palette::EditorState {
            active: active.min(cfg.rules.len().saturating_sub(1)),
            rules: cfg.rules.clone(),
        };
        palette::apply(&mut editor, cand);
        cfg.rules = editor.rules;
        editor.active
    };
    persist(&app, &state, cfg.clone())?;
    Ok(ApplyResult {
        config: cfg,
        active: new_active,
    })
}

/// フィルタの一発クリア。SPEC: CLR-001
#[tauri::command]
pub fn clear_filter(app: AppHandle, state: State<AppState>) -> Result<AppConfig, String> {
    let mut cfg = state.cfg_tx.borrow().clone();
    let mut editor = palette::EditorState {
        rules: cfg.rules.clone(),
        active: 0,
    };
    palette::clear(&mut editor);
    cfg.rules = editor.rules;
    persist(&app, &state, cfg.clone())?;
    Ok(cfg)
}

/// ルールの通知参加状態を保存する。編集フォーカスとは独立。SPEC: EDT-001
#[tauri::command]
pub fn set_rule_enabled(
    app: AppHandle,
    state: State<AppState>,
    index: usize,
    enabled: bool,
) -> Result<AppConfig, String> {
    let mut cfg = state.cfg_tx.borrow().clone();
    let mut editor = palette::EditorState {
        rules: cfg.rules.clone(),
        active: index.min(cfg.rules.len().saturating_sub(1)),
    };
    if !palette::set_rule_enabled(&mut editor, index, enabled) {
        return Err(format!("未知のルールindex: {index}"));
    }
    cfg.rules = editor.rules;
    persist(&app, &state, cfg.clone())?;
    Ok(cfg)
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
pub async fn test_notification(state: State<'_, AppState>) -> Result<String, String> {
    let cfg = state.cfg_tx.borrow().clone();
    let now = Utc::now();
    let dummy = Fissure {
        id: format!("test-{}", now.timestamp_millis()),
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

    let mut outcomes = vec![];
    let mut notes = vec![];
    if cfg.desktop_notification {
        match notify::desktop(&dummy, now, true).await {
            Ok(receipt) => {
                outcomes.push(notify::NotificationOutcome::Requested {
                    destination: "desktop",
                });
                if let Some(warning) = receipt.warning {
                    notes.push(warning);
                }
            }
            Err(reason) => outcomes.push(notify::NotificationOutcome::Failed {
                destination: "desktop",
                reason,
            }),
        }
    }
    if let Some(url) = cfg.discord_webhook_url.as_deref() {
        if !url.is_empty() {
            match notify::discord(&state.client, url, &dummy).await {
                Ok(_) => outcomes.push(notify::NotificationOutcome::Requested {
                    destination: "discord",
                }),
                Err(reason) => outcomes.push(notify::NotificationOutcome::Failed {
                    destination: "discord",
                    reason,
                }),
            }
        }
    }
    let mut summary = notify::summarize_test_outcomes(&outcomes)?;
    if !notes.is_empty() {
        summary.push_str(&format!("（{}）", notes.join(" / ")));
    }
    Ok(summary)
}
