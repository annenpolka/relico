use std::sync::{Arc, Mutex};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WindowEvent, Wry,
};
use tokio::sync::watch;

pub mod autostart;
pub mod backoff;
pub mod commands;
pub mod config;
pub mod content_filter;
pub mod dedup;
pub mod filter;
pub mod i18n;
pub mod model;
pub mod notify;
pub mod palette;
pub mod poller;
pub mod timed;

use commands::AppState;
use config::AppConfig;
use dedup::NotifiedSet;
use poller::{PollerState, StatusSnapshot};

/// トレイメニューの動的項目。poller側から更新する
pub struct TrayHandles {
    pub watch: MenuItem<Wry>,
    pub next: MenuItem<Wry>,
    pub pause: MenuItem<Wry>,
    pub open: MenuItem<Wry>,
    pub quit: MenuItem<Wry>,
}

pub fn watch_line(cfg: &AppConfig) -> String {
    let notifying: Vec<_> = cfg.rules.iter().filter(|rule| rule.notify).collect();
    match notifying.len() {
        0 => i18n::text(cfg.locale, "tray.watchNone"),
        1 if cfg.rules.len() == 1 => i18n::format(
            cfg.locale,
            "tray.watchRule",
            &[("rule", &i18n::rule_summary(cfg.locale, notifying[0]))],
        ),
        n if n == cfg.rules.len() => {
            let count = n.to_string();
            i18n::format(cfg.locale, "tray.watchCount", &[("count", &count)])
        }
        n => {
            let current = n.to_string();
            let total = cfg.rules.len().to_string();
            i18n::format(
                cfg.locale,
                "tray.watchPartial",
                &[("current", &current), ("total", &total)],
            )
        }
    }
}

fn next_line(cfg: &AppConfig, snap: &StatusSnapshot) -> String {
    if !cfg.rules.iter().any(|rule| rule.notify) {
        return i18n::text(cfg.locale, "tray.nextNone");
    }
    // 表示一覧とは別に保持した通知scope側の先頭を使う。SPEC: NTY-001
    snap.next_notification
        .as_ref()
        .map(|f| {
            i18n::format(
                cfg.locale,
                "tray.next",
                &[("tier", &f.tier.to_uppercase()), ("node", &f.node)],
            )
        })
        .unwrap_or_else(|| i18n::text(cfg.locale, "tray.nextNone"))
}

/// メニュー操作はmacOSではメインスレッド限定のため、run_on_main_thread経由で更新する
pub fn update_tray(app: &AppHandle, cfg: &AppConfig, snap: &StatusSnapshot) {
    let watch = watch_line(cfg);
    let next = next_line(cfg, snap);
    let paused = cfg.paused;
    let api_ok = snap.api_ok;
    let locale = cfg.locale;
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(h) = app2.try_state::<TrayHandles>() {
            let _ = h.watch.set_text(&watch);
            let _ = h.next.set_text(&next);
            let _ = h.pause.set_text(i18n::text(
                locale,
                if paused { "tray.resume" } else { "tray.pause" },
            ));
            let _ = h.open.set_text(i18n::text(locale, "tray.open"));
            let _ = h.quit.set_text(i18n::text(locale, "tray.quit"));
        }
        if let Some(tray) = app2.tray_by_id("main") {
            let state = if paused {
                i18n::text(locale, "tray.paused")
            } else if api_ok {
                i18n::text(locale, "tray.apiOk")
            } else {
                i18n::text(locale, "tray.apiError")
            };
            let _ = tray.set_tooltip(Some(format!("RELICO — {state} — {watch}")));
        }
    });
}

/// WebView側がlocaleから設定するdocument.titleへ、WDIOが参照するnative titleを揃える。
/// title更新失敗は常駐・設定保存を止めず、次の設定更新または再起動で再試行する。
pub(crate) fn sync_window_title(app: &AppHandle, cfg: &AppConfig) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("main console window not found while synchronizing title");
        return;
    };
    if let Err(error) = window.set_title(&i18n::text(cfg.locale, "app.title")) {
        eprintln!("window title synchronization failed: {error}");
    }
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
            // Login Itemsへ内部Unix実行ファイルではなく.app bundleを登録し、
            // System Settingsでも配布アイコンを表示させる。SPEC: STA-003
            tauri_plugin_autostart::MacosLauncher::AppleScript,
            None,
        ));

    // WDIO E2E専用ビルドだけWebDriverサーバを埋め込む(just e2e。配布・通常debugには入れない)
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            match autostart::migrate_legacy_launch_agent(app.handle()) {
                Ok(true) => eprintln!("migrated legacy RELICO LaunchAgent to app Login Item"),
                Ok(false) => {}
                Err(error) => eprintln!("legacy autostart migration failed: {error}"),
            }

            set_console_activation_policy(app.handle(), true);

            let config_dir = app.path().app_config_dir()?;
            let config_path = config_dir.join("config.json");
            let notified_path = config_dir.join("notified.json");
            let content_notified_path = config_dir.join("content_notified.json");

            let cfg = AppConfig::load(&config_path);
            sync_window_title(app.handle(), &cfg);
            let (cfg_tx, cfg_rx) = watch::channel(cfg.clone());
            let poller_state = Arc::new(Mutex::new(PollerState::new(
                NotifiedSet::load(&notified_path),
                NotifiedSet::load(&content_notified_path),
                &cfg,
            )));

            app.manage(AppState {
                cfg_tx,
                poller: poller_state.clone(),
                config_path,
                client: poller::http_client(),
            });

            let watch_item =
                MenuItem::with_id(app, "watch", watch_line(&cfg), false, None::<&str>)?;
            let next_item = MenuItem::with_id(
                app,
                "next",
                i18n::text(cfg.locale, "tray.nextNone"),
                false,
                None::<&str>,
            )?;
            let pause_item = MenuItem::with_id(
                app,
                "pause",
                i18n::text(
                    cfg.locale,
                    if cfg.paused {
                        "tray.resume"
                    } else {
                        "tray.pause"
                    },
                ),
                true,
                None::<&str>,
            )?;
            let open = MenuItem::with_id(
                app,
                "open",
                i18n::text(cfg.locale, "tray.open"),
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(
                app,
                "quit",
                i18n::text(cfg.locale, "tray.quit"),
                true,
                None::<&str>,
            )?;
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
                open,
                quit,
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

            tauri::async_runtime::spawn(timed::run(
                app.handle().clone(),
                cfg_rx.clone(),
                poller_state.clone(),
                content_notified_path,
            ));
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
            commands::set_rule_enabled,
            commands::set_rule_notify
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
