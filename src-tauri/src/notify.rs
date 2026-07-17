use chrono::Utc;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::config::AppConfig;
use crate::model::Fissure;

pub fn title_for(fissure: &Fissure) -> String {
    let mut title = format!(
        "{} {} — {}",
        fissure.tier, fissure.mission_type, fissure.node
    );
    if fissure.is_hard {
        title.push_str(" 【鋼】");
    }
    if fissure.is_storm {
        title.push_str(" [STORM]");
    }
    title
}

pub fn desktop(app: &AppHandle, fissure: &Fissure) {
    let remaining_min = fissure
        .expiry
        .signed_duration_since(Utc::now())
        .num_minutes()
        .max(0);
    let _ = app
        .notification()
        .builder()
        .title(title_for(fissure))
        .body(format!("{} / 消滅まで残り{}分", fissure.enemy, remaining_min))
        .show();
}

pub async fn discord(
    client: &reqwest::Client,
    webhook_url: &str,
    fissure: &Fissure,
) -> Result<(), reqwest::Error> {
    // 鋼は赤、通常はアンバー(OPS CONSOLEパレット)
    let color = if fissure.is_hard { 0xFF6B5E } else { 0xFFB454 };
    // <t:unix:R> はDiscordの動的タイムスタンプ。閲覧時点の相対時間で表示される
    let body = serde_json::json!({
        "embeds": [{
            "title": title_for(fissure),
            "description": format!(
                "{} / 消滅 <t:{}:R>",
                fissure.enemy,
                fissure.expiry.timestamp()
            ),
            "color": color
        }]
    });
    client
        .post(webhook_url)
        .json(&body)
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// 設定に応じてデスクトップ+Discordへ送る
pub async fn send(app: &AppHandle, client: &reqwest::Client, cfg: &AppConfig, fissure: &Fissure) {
    if cfg.desktop_notification {
        desktop(app, fissure);
    }
    if let Some(url) = cfg.discord_webhook_url.as_deref() {
        if !url.is_empty() {
            if let Err(e) = discord(client, url, fissure).await {
                eprintln!("discord webhook failed: {e}");
            }
        }
    }
}
