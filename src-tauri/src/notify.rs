use chrono::{DateTime, Utc};

use crate::config::{AppConfig, AppLocale};
use crate::i18n;
use crate::model::Fissure;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopPayload {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopReceipt {
    pub request_id: String,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotificationOutcome {
    Requested {
        destination: &'static str,
    },
    Failed {
        destination: &'static str,
        reason: String,
    },
}

pub fn title_for(fissure: &Fissure) -> String {
    title_for_locale(fissure, AppLocale::Ja)
}

pub fn title_for_locale(fissure: &Fissure, locale: AppLocale) -> String {
    let mut title = format!(
        "{} {} — {}",
        fissure.tier, fissure.mission_type, fissure.node
    );
    if fissure.is_hard {
        title.push_str(&format!(" 【{}】", i18n::text(locale, "notify.hard")));
    }
    if fissure.is_storm {
        title.push_str(" [STORM]");
    }
    title
}

/// 現在時刻を呼出側から受け取り、同じinstantで残り時間を組み立てる。
pub fn desktop_payload(fissure: &Fissure, now: DateTime<Utc>) -> DesktopPayload {
    desktop_payload_for_locale(fissure, now, AppLocale::Ja)
}

pub fn desktop_payload_for_locale(
    fissure: &Fissure,
    now: DateTime<Utc>,
    locale: AppLocale,
) -> DesktopPayload {
    let remaining_min = fissure
        .expiry
        .signed_duration_since(now)
        .num_minutes()
        .max(0);
    DesktopPayload {
        title: title_for_locale(fissure, locale),
        body: i18n::format(
            locale,
            "notify.remaining",
            &[
                ("faction", &fissure.enemy),
                ("minutes", &remaining_min.to_string()),
            ],
        ),
    }
}

pub fn desktop_unavailable_message(detail: &str) -> String {
    desktop_unavailable_message_for_locale(detail, AppLocale::Ja)
}

pub fn desktop_unavailable_message_for_locale(detail: &str, locale: AppLocale) -> String {
    i18n::format(locale, "notify.desktopUnavailable", &[("detail", detail)])
}

/// TESTの結果は「OS/HTTPが要求を受け付けた」範囲だけを報告する。
/// 一部成功があっても、選択先に1件でも失敗があればコマンド全体は失敗とする。
pub fn summarize_test_outcomes(outcomes: &[NotificationOutcome]) -> Result<String, String> {
    summarize_test_outcomes_for_locale(outcomes, AppLocale::Ja)
}

pub fn summarize_test_outcomes_for_locale(
    outcomes: &[NotificationOutcome],
    locale: AppLocale,
) -> Result<String, String> {
    if outcomes.is_empty() {
        return Err(i18n::text(locale, "notify.noDestination"));
    }

    let mut requested = Vec::new();
    let mut failed = Vec::new();
    for outcome in outcomes {
        match outcome {
            NotificationOutcome::Requested { destination } => requested.push(*destination),
            NotificationOutcome::Failed {
                destination,
                reason,
            } => failed.push(format!("{destination} ({reason})")),
        }
    }

    if failed.is_empty() {
        Ok(i18n::format(
            locale,
            "notify.requested",
            &[("destinations", &requested.join(" + "))],
        ))
    } else {
        let mut message = i18n::format(
            locale,
            "notify.failed",
            &[("failures", &failed.join(" / "))],
        );
        if !requested.is_empty() {
            message.push_str("; ");
            message.push_str(&i18n::format(
                locale,
                "notify.partial",
                &[("destinations", &requested.join(" + "))],
            ));
        }
        Err(message)
    }
}

pub async fn desktop(
    fissure: &Fissure,
    now: DateTime<Utc>,
    interactive: bool,
) -> Result<DesktopReceipt, String> {
    desktop_for_locale(fissure, now, interactive, AppLocale::Ja).await
}

#[cfg(target_os = "macos")]
pub async fn desktop_for_locale(
    fissure: &Fissure,
    now: DateTime<Utc>,
    interactive: bool,
    locale: AppLocale,
) -> Result<DesktopReceipt, String> {
    use mac_usernotifications::{
        check_bundle, get_notification_settings, request_auth, AuthorizationStatus, Notification,
        NotificationSettingStatus,
    };

    check_bundle()
        .map_err(|error| desktop_unavailable_message_for_locale(&error.to_string(), locale))?;

    let mut settings = get_notification_settings().await.map_err(|error| {
        i18n::format(
            locale,
            "notify.settingsReadFailed",
            &[("error", &error.to_string())],
        )
    })?;

    if settings.authorization_status == AuthorizationStatus::NotDetermined {
        if !interactive {
            return Err(i18n::text(locale, "notify.permissionNotDetermined"));
        }
        let granted = request_auth().await.map_err(|error| {
            i18n::format(
                locale,
                "notify.permissionRequestFailed",
                &[("error", &error.to_string())],
            )
        })?;
        if !granted {
            return Err(i18n::text(locale, "notify.permissionNotGranted"));
        }
        settings = get_notification_settings().await.map_err(|error| {
            i18n::format(
                locale,
                "notify.settingsRereadFailed",
                &[("error", &error.to_string())],
            )
        })?;
    }

    match settings.authorization_status {
        AuthorizationStatus::Denied => {
            return Err(i18n::text(locale, "notify.permissionDenied"));
        }
        AuthorizationStatus::NotDetermined => {
            return Err(i18n::text(locale, "notify.permissionUndetermined"));
        }
        AuthorizationStatus::Unknown => {
            return Err(i18n::text(locale, "notify.permissionUnknown"));
        }
        AuthorizationStatus::Authorized
        | AuthorizationStatus::Provisional
        | AuthorizationStatus::Ephemeral => {}
    }

    if settings.alert_enabled == NotificationSettingStatus::Disabled
        && settings.notification_center_enabled == NotificationSettingStatus::Disabled
    {
        return Err(i18n::text(locale, "notify.alertsDisabled"));
    }

    let warning = if settings.authorization_status == AuthorizationStatus::Provisional {
        Some(i18n::text(locale, "notify.provisionalWarning"))
    } else if settings.alert_enabled == NotificationSettingStatus::Disabled {
        Some(i18n::text(locale, "notify.bannerDisabledWarning"))
    } else {
        None
    };

    let payload = desktop_payload_for_locale(fissure, now, locale);
    let handle = Notification::new()
        .id(&format!("relico-{}", fissure.id))
        .title(payload.title)
        .message(payload.body)
        .default_sound()
        .send()
        .await
        .map_err(|error| {
            i18n::format(
                locale,
                "notify.requestRejected",
                &[("error", &error.to_string())],
            )
        })?;

    Ok(DesktopReceipt {
        request_id: handle.notification_id().to_string(),
        warning,
    })
}

#[cfg(not(target_os = "macos"))]
pub async fn desktop_for_locale(
    _fissure: &Fissure,
    _now: DateTime<Utc>,
    _interactive: bool,
    locale: AppLocale,
) -> Result<DesktopReceipt, String> {
    Err(i18n::text(locale, "notify.desktopUnsupported"))
}

pub fn discord_request_url(webhook_url: &str) -> Result<reqwest::Url, String> {
    discord_request_url_for_locale(webhook_url, AppLocale::Ja)
}

pub fn discord_request_url_for_locale(
    webhook_url: &str,
    locale: AppLocale,
) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(webhook_url).map_err(|error| {
        i18n::format(
            locale,
            "notify.webhookInvalid",
            &[("error", &error.to_string())],
        )
    })?;
    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| key != "wait")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    url.set_query(None);
    {
        let mut query = url.query_pairs_mut();
        query.extend_pairs(pairs);
        query.append_pair("wait", "true");
    }
    Ok(url)
}

fn sanitize_reqwest_error(error: reqwest::Error) -> String {
    error.without_url().to_string()
}

#[derive(serde::Deserialize)]
struct DiscordMessageReceipt {
    id: String,
}

pub fn discord_message_id(response_body: &str) -> Result<String, String> {
    discord_message_id_for_locale(response_body, AppLocale::Ja)
}

pub fn discord_message_id_for_locale(
    response_body: &str,
    locale: AppLocale,
) -> Result<String, String> {
    let receipt: DiscordMessageReceipt = serde_json::from_str(response_body)
        .map_err(|_| i18n::text(locale, "notify.discordMissingId"))?;
    if receipt.id.trim().is_empty() {
        return Err(i18n::text(locale, "notify.discordEmptyId"));
    }
    Ok(receipt.id)
}

pub async fn discord(
    client: &reqwest::Client,
    webhook_url: &str,
    fissure: &Fissure,
) -> Result<String, String> {
    discord_for_locale(client, webhook_url, fissure, AppLocale::Ja).await
}

pub async fn discord_for_locale(
    client: &reqwest::Client,
    webhook_url: &str,
    fissure: &Fissure,
    locale: AppLocale,
) -> Result<String, String> {
    // 鋼は赤、通常はアンバー(OPS CONSOLEパレット)
    let color = if fissure.is_hard { 0xFF6B5E } else { 0xFFB454 };
    // <t:unix:R> はDiscordの動的タイムスタンプ。閲覧時点の相対時間で表示される
    let body = serde_json::json!({
        "embeds": [{
            "title": title_for_locale(fissure, locale),
            "description": i18n::format(
                locale,
                "notify.discordExpiry",
                &[
                    ("faction", &fissure.enemy),
                    ("timestamp", &format!("<t:{}:R>", fissure.expiry.timestamp())),
                ],
            ),
            "color": color
        }]
    });
    let response = client
        .post(discord_request_url_for_locale(webhook_url, locale)?)
        .json(&body)
        .send()
        .await
        .map_err(sanitize_reqwest_error)?
        .error_for_status()
        .map_err(sanitize_reqwest_error)?;
    let response_body = response.text().await.map_err(sanitize_reqwest_error)?;
    discord_message_id_for_locale(&response_body, locale)
}

/// 設定に応じてデスクトップ+Discordへ通知要求を出す。
/// dedupの再試行意味論は変えず、即時エラーは必ずログへ残す。
pub async fn send(client: &reqwest::Client, cfg: &AppConfig, fissure: &Fissure) {
    let now = Utc::now();
    if cfg.desktop_notification {
        match desktop_for_locale(fissure, now, false, cfg.locale).await {
            Ok(receipt) => {
                if let Some(warning) = receipt.warning {
                    eprintln!("desktop notification warning: {warning}");
                }
            }
            Err(error) => eprintln!("desktop notification failed: {error}"),
        }
    }
    if let Some(url) = cfg.discord_webhook_url.as_deref() {
        if !url.is_empty() {
            if let Err(error) = discord_for_locale(client, url, fissure, cfg.locale).await {
                eprintln!("discord webhook failed: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;
    use std::time::{Duration as StdDuration, Instant};

    use chrono::{Duration, TimeZone, Utc};

    #[cfg(target_os = "macos")]
    use super::desktop;
    use super::{discord, discord_request_url};
    use crate::model::Fissure;

    const WEBHOOK_TOKEN: &str = "do-not-log-this-token";
    const MAX_REQUEST_BYTES: usize = 64 * 1024;

    #[derive(Debug)]
    struct CapturedRequest {
        method: String,
        thread_ids: Vec<String>,
        waits: Vec<String>,
        has_embed: bool,
    }

    fn fixed_now() -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 7, 17, 12, 0, 0)
            .single()
            .expect("fixed UTC instant")
    }

    fn dummy_fissure() -> Fissure {
        let now = fixed_now();
        Fissure {
            id: "notification-test".to_string(),
            activation: now - Duration::minutes(5),
            expiry: now + Duration::minutes(30),
            node: "Test Node (Void)".to_string(),
            mission_type: "Survival".to_string(),
            enemy: "Orokin".to_string(),
            tier: "Axi".to_string(),
            tier_num: 4,
            is_storm: false,
            is_hard: true,
        }
    }

    fn header_end(bytes: &[u8]) -> Option<usize> {
        bytes
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|index| index + 4)
    }

    fn read_request(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
        stream
            .set_read_timeout(Some(StdDuration::from_secs(2)))
            .map_err(|_| "stub failed to set read timeout".to_string())?;

        let mut request = Vec::new();
        let mut expected_len = None;
        loop {
            let mut chunk = [0_u8; 4096];
            let read = stream
                .read(&mut chunk)
                .map_err(|_| "stub timed out while reading request".to_string())?;
            if read == 0 {
                return Err("stub connection closed before request completed".to_string());
            }
            request.extend_from_slice(&chunk[..read]);
            if request.len() > MAX_REQUEST_BYTES {
                return Err("stub request exceeded bounded size".to_string());
            }

            if expected_len.is_none() {
                if let Some(end) = header_end(&request) {
                    let headers = std::str::from_utf8(&request[..end])
                        .map_err(|_| "stub received non-UTF-8 headers".to_string())?;
                    let content_len = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().ok())
                                .flatten()
                        })
                        .ok_or_else(|| "stub request omitted Content-Length".to_string())?;
                    if end + content_len > MAX_REQUEST_BYTES {
                        return Err("stub request body exceeded bounded size".to_string());
                    }
                    expected_len = Some(end + content_len);
                }
            }

            if expected_len.is_some_and(|len| request.len() >= len) {
                return Ok(request);
            }
        }
    }

    fn capture_request(request: &[u8]) -> Result<CapturedRequest, String> {
        let end = header_end(request).ok_or_else(|| "stub request lacked headers".to_string())?;
        let headers = std::str::from_utf8(&request[..end])
            .map_err(|_| "stub received non-UTF-8 headers".to_string())?;
        let mut request_line = headers
            .lines()
            .next()
            .ok_or_else(|| "stub request line was missing".to_string())?
            .split_whitespace();
        let method = request_line
            .next()
            .ok_or_else(|| "stub request method was missing".to_string())?
            .to_string();
        let target = request_line
            .next()
            .ok_or_else(|| "stub request target was missing".to_string())?;
        let url = reqwest::Url::parse(&format!("http://localhost{target}"))
            .map_err(|_| "stub request target was invalid".to_string())?;
        let pairs: Vec<(String, String)> = url
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        let body: serde_json::Value = serde_json::from_slice(&request[end..])
            .map_err(|_| "stub request body was not JSON".to_string())?;

        Ok(CapturedRequest {
            method,
            thread_ids: pairs
                .iter()
                .filter(|(key, _)| key == "thread_id")
                .map(|(_, value)| value.clone())
                .collect(),
            waits: pairs
                .iter()
                .filter(|(key, _)| key == "wait")
                .map(|(_, value)| value.clone())
                .collect(),
            has_embed: body
                .get("embeds")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|embeds| !embeds.is_empty()),
        })
    }

    fn spawn_stub(
        status: &'static str,
        response_body: &'static str,
    ) -> (String, thread::JoinHandle<Result<CapturedRequest, String>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind localhost stub");
        listener
            .set_nonblocking(true)
            .expect("set localhost stub nonblocking");
        let address = listener.local_addr().expect("localhost stub address");

        let handle = thread::spawn(move || {
            let deadline = Instant::now() + StdDuration::from_secs(3);
            let (mut stream, _) = loop {
                match listener.accept() {
                    Ok(connection) => break connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if Instant::now() >= deadline {
                            return Err("stub timed out waiting for a request".to_string());
                        }
                        thread::sleep(StdDuration::from_millis(5));
                    }
                    Err(_) => return Err("stub failed to accept request".to_string()),
                }
            };
            let request = read_request(&mut stream)?;
            let captured = capture_request(&request)?;
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
                response_body.len()
            );
            stream
                .write_all(response.as_bytes())
                .map_err(|_| "stub failed to write response".to_string())?;
            Ok(captured)
        });

        (
            format!("http://{address}/api/webhooks/123/{WEBHOOK_TOKEN}"),
            handle,
        )
    }

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .timeout(StdDuration::from_secs(2))
            .build()
            .expect("build localhost test client")
    }

    #[test]
    fn discord_url_forces_wait_true_without_exposing_token() {
        let url = discord_request_url(
            "https://discord.com/api/webhooks/123/secret-token?thread_id=456&wait=false",
        )
        .expect("valid webhook URL");
        let pairs: Vec<_> = url.query_pairs().collect();
        assert!(pairs
            .iter()
            .any(|(key, value)| key == "thread_id" && value == "456"));
        assert_eq!(
            pairs
                .iter()
                .filter(|(key, _)| key == "wait")
                .map(|(_, value)| value.as_ref())
                .collect::<Vec<_>>(),
            vec!["true"]
        );
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn unbundled_desktop_test_fails_before_requesting_permission() {
        let error = desktop(&dummy_fissure(), fixed_now(), true)
            .await
            .expect_err("cargo test executable must not send a macOS notification");

        assert!(
            error.contains("just notification-test"),
            "error must point developers to the bundled notification test"
        );
        assert!(
            error.contains(".app"),
            "error must explain that a bundled app is required"
        );
    }

    #[tokio::test]
    async fn discord_preserves_thread_waits_for_receipt_and_returns_message_id() {
        let (base_url, server) = spawn_stub("200 OK", r#"{"id":"message-1"}"#);
        let webhook_url = format!("{base_url}?thread_id=456&wait=false");

        let message_id = discord(&test_client(), &webhook_url, &dummy_fissure())
            .await
            .expect("localhost Discord stub must accept the request");
        let captured = server
            .join()
            .expect("localhost stub thread panicked")
            .expect("localhost stub failed");

        assert_eq!(message_id, "message-1");
        assert_eq!(captured.method, "POST");
        assert_eq!(captured.thread_ids, vec!["456"]);
        assert_eq!(captured.waits, vec!["true"]);
        assert!(
            !captured.waits.iter().any(|value| value == "false"),
            "request target must not retain wait=false"
        );
        assert!(captured.has_embed, "request body must contain an embed");
    }

    #[tokio::test]
    async fn discord_rejects_no_content_or_missing_message_id() {
        for (status, response_body) in [("204 No Content", ""), ("200 OK", r#"{}"#)] {
            let (base_url, server) = spawn_stub(status, response_body);
            let webhook_url = format!("{base_url}?thread_id=456");

            let error = discord(&test_client(), &webhook_url, &dummy_fissure())
                .await
                .expect_err("Discord success without a Message ID must be rejected");
            server
                .join()
                .expect("localhost stub thread panicked")
                .expect("localhost stub failed");

            assert!(
                !error.contains(WEBHOOK_TOKEN),
                "Discord errors must not expose webhook tokens"
            );
        }
    }
}
