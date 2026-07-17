use std::sync::{Arc, Mutex};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
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
use poller::PollerState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let config_dir = app.path().app_config_dir()?;
            let config_path = config_dir.join("config.json");
            let notified_path = config_dir.join("notified.json");

            let cfg = AppConfig::load(&config_path);
            let (cfg_tx, cfg_rx) = watch::channel(cfg);
            let poller_state = Arc::new(Mutex::new(PollerState::new(NotifiedSet::load(
                &notified_path,
            ))));

            app.manage(AppState {
                cfg_tx,
                poller: poller_state.clone(),
                config_path,
                client: poller::http_client(),
            });

            tauri::async_runtime::spawn(poller::run(
                app.handle().clone(),
                cfg_rx,
                poller_state,
                notified_path,
            ));

            let open = MenuItem::with_id(app, "open", "OPEN CONSOLE", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "QUIT", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
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
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
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
            commands::test_notification
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
