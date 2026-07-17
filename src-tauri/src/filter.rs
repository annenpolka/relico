use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::model::Fissure;

/// 鋼の道のりと通常の区別
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mode {
    Normal,
    SteelPath,
    Both,
}

/// 監視ルール1本。各Vecは空なら「その軸は全対象」。ルール内はAND
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WatchRule {
    pub tiers: Vec<String>,
    pub mission_types: Vec<String>,
    pub planets: Vec<String>,
    pub mode: Mode,
    pub include_storms: bool,
}

impl Default for WatchRule {
    fn default() -> Self {
        Self {
            tiers: vec![],
            mission_types: vec![],
            planets: vec![],
            mode: Mode::Both,
            include_storms: false,
        }
    }
}

/// フィルタ全体 = ルールのOR + 残り時間しきい値
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterSettings {
    pub rules: Vec<WatchRule>,
    pub min_remaining_secs: u64,
}

/// 亀裂が1本のルールに合致するか(時間軸は見ない)。SPEC: FLT-001..006
pub fn rule_matches(rule: &WatchRule, fissure: &Fissure) -> bool {
    match rule.mode {
        Mode::Normal if fissure.is_hard => return false,
        Mode::SteelPath if !fissure.is_hard => return false,
        _ => {}
    }
    if fissure.is_storm && !rule.include_storms {
        return false;
    }
    if !rule.tiers.is_empty() && !rule.tiers.contains(&fissure.tier) {
        return false;
    }
    if !rule.mission_types.is_empty() && !rule.mission_types.contains(&fissure.mission_type) {
        return false;
    }
    if !rule.planets.is_empty() {
        match extract_planet(&fissure.node) {
            Some(planet) if rule.planets.contains(&planet) => {}
            _ => return false,
        }
    }
    true
}

/// 全体判定: 残り時間OK ∧ いずれかのルールに合致。SPEC: FLT-007..009
pub fn matches(settings: &FilterSettings, fissure: &Fissure, now: DateTime<Utc>) -> bool {
    let remaining = fissure.expiry.signed_duration_since(now).num_seconds();
    if remaining < settings.min_remaining_secs as i64 {
        return false;
    }
    settings.rules.iter().any(|rule| rule_matches(rule, fissure))
}

/// node "Kappa (Sedna)" から惑星名 "Sedna" を抽出する。
/// 括弧がない・空などの不正形式では None(パニックしない)。SPEC: PRS-001
pub fn extract_planet(node: &str) -> Option<String> {
    let open = node.rfind('(')?;
    let rest = &node[open + 1..];
    let close = rest.find(')')?;
    let planet = rest[..close].trim();
    if planet.is_empty() {
        None
    } else {
        Some(planet.to_string())
    }
}
