use std::sync::{Arc, Mutex};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WindowEvent, Wry,
};
use tokio::sync::watch;

pub mod backoff;
pub mod commands;
pub mod config;
pub mod dedup;
pub mod filter;
pub mod model;
pub mod notify;
pub mod poller;

use commands::AppState;
use config::AppConfig;
use dedup::NotifiedSet;
use filter::Mode;
use poller::{PollerState, StatusSnapshot};

/// トレイメニューの動的項目。poller側から更新する
pub struct TrayHandles {
    pub watch: MenuItem<Wry>,
    pub next: MenuItem<Wry>,
    pub pause: MenuItem<Wry>,
}

pub fn watch_line(cfg: &AppConfig) -> String {
    let tiers = if cfg.tiers.is_empty() {
        "ALL TIERS".to_string()
    } else {
        cfg.tiers.join("+").to_uppercase()
    };
    let mode = match cfg.mode {
        Mode::SteelPath => "HARD",
        Mode::Normal => "NORMAL",
        Mode::Both => "BOTH",
    };
    format!("WATCH: {tiers} / {mode}")
}

fn next_line(snap: &StatusSnapshot) -> String {
    // snapshot.fissuresは合致のみ・消滅が近い順(VIS-001)なので先頭が次の対象
    snap.fissures
        .first()
        .map(|f| format!("NEXT: {} {}", f.tier.to_uppercase(), f.node))
        .unwrap_or_else(|| "NEXT: --".to_string())
}

/// メニュー操作はmacOSではメインスレッド限定のため、run_on_main_thread経由で更新する
pub fn update_tray(app: &AppHandle, cfg: &AppConfig, snap: &StatusSnapshot) {
    let watch = watch_line(cfg);
    let next = next_line(snap);
    let paused = cfg.paused;
    let api_ok = snap.api_ok;
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(h) = app2.try_state::<TrayHandles>() {
            let _ = h.watch.set_text(&watch);
            let _ = h.next.set_text(&next);
            let _ = h.pause.set_text(if paused { "RESUME" } else { "PAUSE" });
        }
        if let Some(tray) = app2.tray_by_id("main") {
            let state = if paused {
                "PAUSED"
            } else if api_ok {
                "API OK"
            } else {
                "API ERR"
            };
            let _ = tray.set_tooltip(Some(format!("FISSURE OPS — {state} — {watch}")));
        }
    });
}

fn toggle_pause(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut cfg = state.cfg_tx.borrow().clone();
    cfg.paused = !cfg.paused;
    if let Err(e) = cfg.save(&state.config_path) {
        eprintln!("config save failed: {e}");
    }
    let _ = app.emit("config", &cfg);
    let _ = state.cfg_tx.send(cfg);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let config_dir = app.path().app_config_dir()?;
            let config_path = config_dir.join("config.json");
            let notified_path = config_dir.join("notified.json");

            let cfg = AppConfig::load(&config_path);
            let (cfg_tx, cfg_rx) = watch::channel(cfg.clone());
            let poller_state = Arc::new(Mutex::new(PollerState::new(NotifiedSet::load(
                &notified_path,
            ))));

            app.manage(AppState {
                cfg_tx,
                poller: poller_state.clone(),
                config_path,
                client: poller::http_client(),
            });

            let watch_item =
                MenuItem::with_id(app, "watch", watch_line(&cfg), false, None::<&str>)?;
            let next_item = MenuItem::with_id(app, "next", "NEXT: --", false, None::<&str>)?;
            let pause_item = MenuItem::with_id(
                app,
                "pause",
                if cfg.paused { "RESUME" } else { "PAUSE" },
                true,
                None::<&str>,
            )?;
            let open = MenuItem::with_id(app, "open", "OPEN CONSOLE", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "QUIT", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &watch_item,
                    &next_item,
                    &PredefinedMenuItem::separator(app)?,
                    &pause_item,
                    &open,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?;
            app.manage(TrayHandles {
                watch: watch_item,
                next: next_item,
                pause: pause_item,
            });

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("FISSURE OPS")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "pause" => toggle_pause(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            tauri::async_runtime::spawn(poller::run(
                app.handle().clone(),
                cfg_rx,
                poller_state,
                notified_path,
            ));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::get_status,
            commands::test_notification,
            commands::get_autostart,
            commands::set_autostart
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
