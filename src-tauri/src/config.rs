use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::filter::{FilterSettings, WatchRule};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    /// 監視ルール。enabledのORが一覧表示、notifyのORが通知。空なら通知なし・全件表示
    pub rules: Vec<WatchRule>,
    pub min_remaining_secs: u64,
    pub poll_interval_secs: u64,
    pub desktop_notification: bool,
    pub discord_webhook_url: Option<String>,
    pub paused: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            rules: vec![WatchRule::default()],
            min_remaining_secs: 300,
            poll_interval_secs: 60,
            desktop_notification: true,
            discord_webhook_url: None,
            paused: false,
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

    /// 読めない・存在しない場合は既定値(起動を止めない)。
    /// 旧スキーマ(単一ANDフィルタ)のファイルはrules欠落として既定ルールに落ちる
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
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
