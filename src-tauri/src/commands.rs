use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{Duration, Utc};
use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::sync::watch;

use crate::config::{AppConfig, AppLocale};
use crate::filter::{Mode, StormMode};
use crate::i18n;
use crate::model::Fissure;
use crate::notify;
use crate::content_palette;
use crate::palette::{self, Facet};
use crate::poller::{PollerState, StatusSnapshot};

pub struct AppState {
    pub cfg_tx: watch::Sender<AppConfig>,
    pub poller: Arc<Mutex<PollerState>>,
    pub config_path: PathBuf,
    pub client: reqwest::Client,
}

fn localized_error(locale: AppLocale, key: &str, field: &str, value: &str) -> String {
    i18n::format(locale, key, &[(field, value)])
}

fn persist(app: &AppHandle, state: &State<AppState>, mut cfg: AppConfig) -> Result<(), String> {
    let locale = cfg.locale;
    // 壊れたquiet-hoursで通知を止めない。UIにも正規化後のOFFを返す。
    if !cfg.notification_mute.is_valid() {
        cfg.notification_mute.enabled = false;
    }
    cfg.save(&state.config_path).map_err(|error| {
        localized_error(locale, "error.configSave", "error", &error.to_string())
    })?;
    crate::sync_window_title(app, &cfg);
    let _ = tauri::Emitter::emit(app, "config", &cfg);
    state.cfg_tx.send(cfg.clone()).map_err(|error| {
        localized_error(locale, "error.configBroadcast", "error", &error.to_string())
    })?;
    // locale/Pause変更を次のnetwork poll待ちにせずtrayへ反映する。
    let snapshot = state.poller.lock().expect("poller state").snapshot.clone();
    crate::update_tray(app, &cfg, &snapshot);
    Ok(())
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> AppConfig {
    state.cfg_tx.borrow().clone()
}

#[tauri::command]
pub fn set_config(app: AppHandle, state: State<AppState>, config: AppConfig) -> Result<(), String> {
    persist(&app, &state, config)
}

/// パレット候補のビュー(on状態は編集中ルール基準。表示選択・通知参加とは独立)
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
pub fn query_candidates(
    state: State<AppState>,
    q: String,
    active: usize,
    tab: Option<String>,
) -> Vec<CandView> {
    let cfg = state.cfg_tx.borrow().clone();
    // 亀裂以外のコンテンツタブは、そのタブのcontentRules編集候補を出す。SPEC: CPL-001
    if let Some(group) = tab.as_deref().and_then(content_palette::tab_kind_group) {
        let catalog = content_palette::catalog(tab.as_deref().unwrap_or_default(), &cfg.content_rules, &q);
        return palette::query_catalog(&catalog, &q)
            .into_iter()
            .map(|r| {
                let c = &catalog[r.idx];
                let on = if c.id == "action:pause" {
                    cfg.paused
                } else {
                    content_palette::candidate_on(&cfg.content_rules, group, c)
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
            .collect();
    }
    let rule = cfg.rules.get(active.min(cfg.rules.len().saturating_sub(1)));
    let catalog = palette::catalog_with_rules(&cfg.rules);
    palette::query_catalog(&catalog, &q)
        .into_iter()
        .map(|r| {
            let c = &catalog[r.idx];
            let on = match c.facet {
                Facet::Tier => rule.is_some_and(|ru| ru.tiers.contains(&c.value)),
                Facet::Mission => rule.is_some_and(|ru| ru.mission_types.contains(&c.value)),
                Facet::Planet => rule.is_some_and(|ru| ru.planets.contains(&c.value)),
                Facet::Faction => rule.is_some_and(|ru| ru.factions.contains(&c.value)),
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
                // RULE候補のonは対象ルールの一覧表示選択(編集中ルール基準ではない)
                Facet::Rule => c
                    .value
                    .parse::<usize>()
                    .ok()
                    .and_then(|i| cfg.rules.get(i))
                    .is_some_and(|r| r.enabled),
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
/// コンテンツ候補(ckeyword/clevel/crule/caction)はタブ文脈のcontentRulesへ適用する。SPEC: CPL-002/003
#[tauri::command]
pub fn apply_candidate(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    active: usize,
    tab: Option<String>,
) -> Result<ApplyResult, String> {
    let mut cfg = state.cfg_tx.borrow().clone();
    if content_palette::is_content_candidate_id(&id) {
        let applied = tab
            .as_deref()
            .and_then(content_palette::tab_kind_group)
            .is_some_and(|group| content_palette::apply(&mut cfg.content_rules, group, &id));
        if !applied {
            return Err(localized_error(cfg.locale, "error.unknownCandidate", "id", &id));
        }
        persist(&app, &state, cfg.clone())?;
        return Ok(ApplyResult {
            config: cfg,
            active,
        });
    }
    let catalog = palette::catalog_with_rules(&cfg.rules);
    let cand = catalog
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| localized_error(cfg.locale, "error.unknownCandidate", "id", &id))?;

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

/// ルールの一覧表示選択を保存する。通知参加・編集フォーカスとは独立。SPEC: EDT-001
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
        return Err(localized_error(
            cfg.locale,
            "error.unknownRuleIndex",
            "index",
            &index.to_string(),
        ));
    }
    cfg.rules = editor.rules;
    persist(&app, &state, cfg.clone())?;
    Ok(cfg)
}

/// ルールの通知参加状態を保存する。一覧表示選択・編集フォーカスとは独立。SPEC: EDT-001 / NTY-001
#[tauri::command]
pub fn set_rule_notify(
    app: AppHandle,
    state: State<AppState>,
    index: usize,
    notify: bool,
) -> Result<AppConfig, String> {
    let mut cfg = state.cfg_tx.borrow().clone();
    let mut editor = palette::EditorState {
        rules: cfg.rules.clone(),
        active: index.min(cfg.rules.len().saturating_sub(1)),
    };
    if !palette::set_rule_notify(&mut editor, index, notify) {
        return Err(localized_error(
            cfg.locale,
            "error.unknownRuleIndex",
            "index",
            &index.to_string(),
        ));
    }
    cfg.rules = editor.rules;
    persist(&app, &state, cfg.clone())?;
    Ok(cfg)
}

#[tauri::command]
pub fn get_autostart(app: AppHandle, state: State<AppState>) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let locale = state.cfg_tx.borrow().locale;
    app.autolaunch().is_enabled().map_err(|error| {
        localized_error(locale, "error.autostartRead", "error", &error.to_string())
    })
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, state: State<AppState>, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let locale = state.cfg_tx.borrow().locale;
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|error| {
        localized_error(locale, "error.autostartUpdate", "error", &error.to_string())
    })
}

#[tauri::command]
pub fn get_status(state: State<AppState>) -> StatusSnapshot {
    let cfg = state.cfg_tx.borrow().clone();
    let now = chrono::Local::now();
    let mut poller = state.poller.lock().expect("poller state");
    poller.reset_daily_counters(now);
    let muted = cfg.notifications_muted_at(now);
    if poller.snapshot.notifications_muted != muted {
        poller.snapshot.notifications_muted = muted;
        poller.bump_revision();
    }
    poller.snapshot.clone()
}

/// MAN-001 / MAN-002 の確認手段。ダミー亀裂で通知経路を発火する
#[tauri::command]
pub async fn test_notification(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
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
        match notify::desktop_for_locale_with_app(&app, &dummy, now, true, cfg.locale).await {
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
            match notify::discord_for_locale(&state.client, url, &dummy, cfg.locale).await {
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
    let mut summary = notify::summarize_test_outcomes_for_locale(&outcomes, cfg.locale)?;
    if !notes.is_empty() {
        summary = crate::i18n::format(
            cfg.locale,
            "notify.withNotes",
            &[("summary", &summary), ("notes", &notes.join(" / "))],
        );
    }
    Ok(summary)
}
