use std::fs;
use std::path::Path;

use chrono::{DateTime, Local, Timelike};
use serde::{Deserialize, Serialize};

use crate::filter::{FilterSettings, WatchRule};

/// アプリ全体で共有する表示言語。未知の将来値は日本語へ安全にフォールバックする。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum AppLocale {
    #[serde(rename = "en")]
    En,
    #[serde(rename = "zh-Hans")]
    ZhHans,
    #[default]
    #[serde(rename = "ja", other)]
    Ja,
}

impl AppLocale {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ja => "ja",
            Self::En => "en",
            Self::ZhHans => "zh-Hans",
        }
    }
}

/// 毎日繰り返す通知ミュート区間。分値はローカル壁時計の0:00からの分数。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DailyMuteWindow {
    pub enabled: bool,
    /// JSONの負数もAppConfig全体を捨てず、この区間だけfail-openにできる幅で受ける。
    pub start_minute: i64,
    pub end_minute: i64,
}

impl Default for DailyMuteWindow {
    fn default() -> Self {
        Self {
            enabled: false,
            start_minute: 22 * 60,
            end_minute: 7 * 60,
        }
    }
}

impl DailyMuteWindow {
    pub fn is_valid(&self) -> bool {
        (0..24 * 60).contains(&self.start_minute) && (0..24 * 60).contains(&self.end_minute)
    }

    /// 区間は[start,end)。start==end・無効値・enabled=falseは空区間(fail-open)。
    pub fn is_muted_at_minute(&self, minute: u16) -> bool {
        let minute = i64::from(minute);
        if !self.enabled
            || !self.is_valid()
            || minute >= 24 * 60
            || self.start_minute == self.end_minute
        {
            return false;
        }
        if self.start_minute < self.end_minute {
            self.start_minute <= minute && minute < self.end_minute
        } else {
            minute >= self.start_minute || minute < self.end_minute
        }
    }

    pub fn is_muted_at_local(&self, now: DateTime<Local>) -> bool {
        self.is_muted_at_minute((now.hour() * 60 + now.minute()) as u16)
    }
}

/// 亀裂以外の時限コンテンツ(仲裁・エリア等)の監視ルール。ルール内はAND、複数ルールはOR。
/// 合致意味論はcontent_filter.rsが正本。SPEC: CNT-001 / CFG-006
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContentWatchRule {
    /// 通知へ参加するか。欠落した旧JSONはtrue
    pub notify: bool,
    /// 表示用の任意名。合致・projectionには関与しない
    pub name: Option<String>,
    /// 対象card kind(空=全kind)。wire上のTimedContent.kind語彙
    pub kinds: Vec<String>,
    /// ミッション種別キーワード(空=全種別)。正準化して部分一致で照合する
    pub mission_types: Vec<String>,
    /// enemy levelの下限(stageの最小levelがこの値以上)。未指定=レベル条件なし
    pub min_enemy_level: Option<u32>,
}

impl Default for ContentWatchRule {
    fn default() -> Self {
        Self {
            notify: true,
            name: None,
            kinds: vec![],
            mission_types: vec![],
            min_enemy_level: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    /// 監視ルール。enabledのORが一覧表示、notifyのORが通知。空なら通知なし・全件表示
    pub rules: Vec<WatchRule>,
    /// 時限コンテンツの監視ルール。欠落した旧JSONは空リスト。SPEC: CFG-006
    pub content_rules: Vec<ContentWatchRule>,
    pub min_remaining_secs: u64,
    pub poll_interval_secs: u64,
    pub desktop_notification: bool,
    pub discord_webhook_url: Option<String>,
    pub paused: bool,
    pub locale: AppLocale,
    pub notification_mute: DailyMuteWindow,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            rules: vec![WatchRule::default()],
            content_rules: vec![],
            min_remaining_secs: 300,
            poll_interval_secs: 60,
            desktop_notification: true,
            discord_webhook_url: None,
            paused: false,
            locale: AppLocale::Ja,
            notification_mute: DailyMuteWindow::default(),
        }
    }
}

impl AppConfig {
    pub fn filter(&self) -> FilterSettings {
        FilterSettings {
            rules: self.rules.clone(),
            min_remaining_secs: self.min_remaining_secs,
        }
    }

    /// ポーリングマナー: 下限30秒
    pub fn effective_poll_secs(&self) -> u64 {
        self.poll_interval_secs.max(30)
    }

    pub fn notifications_muted_at(&self, now: DateTime<Local>) -> bool {
        self.notification_mute.is_muted_at_local(now)
    }

    /// 読めない・存在しない場合は既定値(起動を止めない)。
    /// 旧スキーマ(単一ANDフィルタ)のファイルはrules欠落として既定ルールに落ちる
    pub fn load(path: &Path) -> Self {
        let mut config: Self = fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        // 壊れた区間で通知を止めず、他の設定は保持する。
        if !config.notification_mute.is_valid() {
            config.notification_mute.enabled = false;
        }
        config
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(
            path,
            serde_json::to_string_pretty(self).expect("serialize config"),
        )
    }
}
