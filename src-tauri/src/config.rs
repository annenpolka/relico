use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::filter::{FilterConfig, Mode};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub tiers: Vec<String>,
    pub mission_types: Vec<String>,
    pub planets: Vec<String>,
    pub mode: Mode,
    pub include_storms: bool,
    pub min_remaining_secs: u64,
    pub poll_interval_secs: u64,
    pub desktop_notification: bool,
    pub discord_webhook_url: Option<String>,
    pub paused: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            tiers: vec![],
            mission_types: vec![],
            planets: vec![],
            mode: Mode::Both,
            include_storms: false,
            min_remaining_secs: 300,
            poll_interval_secs: 60,
            desktop_notification: true,
            discord_webhook_url: None,
            paused: false,
        }
    }
}

impl AppConfig {
    pub fn filter(&self) -> FilterConfig {
        FilterConfig {
            tiers: self.tiers.clone(),
            mission_types: self.mission_types.clone(),
            planets: self.planets.clone(),
            mode: self.mode,
            include_storms: self.include_storms,
            min_remaining_secs: self.min_remaining_secs,
        }
    }

    /// ポーリングマナー: 下限30秒
    pub fn effective_poll_secs(&self) -> u64 {
        self.poll_interval_secs.max(30)
    }

    /// 読めない・存在しない場合は既定値(起動を止めない)
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
        fs::write(path, serde_json::to_string_pretty(self).expect("serialize config"))
    }
}
