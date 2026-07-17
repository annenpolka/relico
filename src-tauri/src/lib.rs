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
pub mod palette;
pub mod poller;

use commands::AppState;
use config::AppConfig;
use dedup::NotifiedSet;
use poller::{PollerState, StatusSnapshot};

/// トレイメニューの動的項目。poller側から更新する
pub struct TrayHandles {
    pub watch: MenuItem<Wry>,
    pub next: MenuItem<Wry>,
    pub pause: MenuItem<Wry>,
}

pub fn watch_line(cfg: &AppConfig) -> String {
    let enabled: Vec<_> = cfg.rules.iter().filter(|rule| rule.enabled).collect();
    match enabled.len() {
        0 => "WATCH: NO ENABLED RULES".to_string(),
        1 if cfg.rules.len() == 1 => {
            format!("WATCH: {}", palette::rule_summary(enabled[0]))
        }
        n if n == cfg.rules.len() => format!("WATCH: {n} RULES"),
        n => format!("WATCH: {n}/{} RULES", cfg.rules.len()),
    }
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
            let _ = tray.set_tooltip(Some(format!("RELICO — {state} — {watch}")));
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

#[cfg(target_os = "macos")]
fn set_console_activation_policy(app: &AppHandle, visible: bool) {
    let policy = if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };
    if let Err(error) = app.set_activation_policy(policy) {
        eprintln!("activation policy update failed: {error}");
    }
}

#[cfg(not(target_os = "macos"))]
fn set_console_activation_policy(_app: &AppHandle, _visible: bool) {}

fn show_console(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("main console window not found");
        return;
    };

    set_console_activation_policy(app, true);
    #[cfg(target_os = "macos")]
    if let Err(error) = app.show() {
        eprintln!("application show failed: {error}");
    }
    if let Err(error) = window.show() {
        eprintln!("console show failed: {error}");
        set_console_activation_policy(app, false);
        return;
    }
    if let Err(error) = window.unminimize() {
        eprintln!("console unminimize failed: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("console focus failed: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));

    // WDIO E2E専用ビルドだけWebDriverサーバを埋め込む(just e2e。配布・通常debugには入れない)
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .setup(|app| {
            set_console_activation_policy(app.handle(), true);

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

            #[cfg(target_os = "macos")]
            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
            #[cfg(not(target_os = "macos"))]
            let tray_icon = app.default_window_icon().unwrap().clone();

            TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("RELICO")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_console(app),
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
                match window.hide() {
                    Ok(()) => set_console_activation_policy(window.app_handle(), false),
                    Err(error) => eprintln!("console hide failed: {error}"),
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::get_status,
            commands::test_notification,
            commands::get_autostart,
            commands::set_autostart,
            commands::query_candidates,
            commands::apply_candidate,
            commands::clear_filter,
            commands::set_rule_enabled
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                show_console(app);
            }
        });
}
