use chrono::{DateTime, Utc};
use serde::{de::Error as _, Deserialize, Deserializer, Serialize};

use crate::model::Fissure;

/// パレット上のProxima名と、Worldstate APIのVOID嵐nodeで使われる基底名。
pub const PROXIMA_PLANET_ALIASES: &[(&str, &str)] = &[
    ("Earth Proxima", "Earth"),
    ("Venus Proxima", "Venus"),
    ("Saturn Proxima", "Saturn"),
    ("Neptune Proxima", "Neptune"),
    ("Pluto Proxima", "Pluto"),
    ("Veil Proxima", "Veil"),
];

/// 鋼の道のりと通常の区別
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mode {
    Normal,
    SteelPath,
    Both,
}

/// VOID嵐をルールへ含める方法。
/// Includeは通常亀裂とVOID嵐の両方、OnlyはVOID嵐だけを対象にする。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub enum StormMode {
    #[default]
    Exclude,
    Include,
    Only,
}

impl<'de> Deserialize<'de> for StormMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Current(String),
            Legacy(bool),
        }

        match Repr::deserialize(deserializer)? {
            Repr::Current(value) => match value.as_str() {
                "Exclude" => Ok(Self::Exclude),
                "Include" => Ok(Self::Include),
                "Only" => Ok(Self::Only),
                _ => Err(D::Error::unknown_variant(
                    &value,
                    &["Exclude", "Include", "Only"],
                )),
            },
            Repr::Legacy(false) => Ok(Self::Exclude),
            Repr::Legacy(true) => Ok(Self::Include),
        }
    }
}

/// 監視ルール1本。各Vecは空なら「その軸は全対象」。ルール内はAND
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WatchRule {
    /// 通知判定へ参加するか。旧設定では欠落するためDefault(true)で移行する。
    pub enabled: bool,
    pub tiers: Vec<String>,
    pub mission_types: Vec<String>,
    pub planets: Vec<String>,
    pub mode: Mode,
    #[serde(alias = "includeStorms", alias = "include_storms")]
    pub storms: StormMode,
}

impl Default for WatchRule {
    fn default() -> Self {
        Self {
            enabled: true,
            tiers: vec![],
            mission_types: vec![],
            planets: vec![],
            mode: Mode::Both,
            storms: StormMode::Exclude,
        }
    }
}

/// フィルタ全体 = ルールのOR + 残り時間しきい値
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FilterSettings {
    pub rules: Vec<WatchRule>,
    pub min_remaining_secs: u64,
}

/// 通知対象を変える設定だけを抜き出す。
/// 無効ルールの編集中の変更は通知scopeを変えない。SPEC: FLT-014
pub fn enabled_projection(settings: &FilterSettings) -> FilterSettings {
    FilterSettings {
        rules: settings
            .rules
            .iter()
            .filter(|rule| rule.enabled)
            .cloned()
            .collect(),
        min_remaining_secs: settings.min_remaining_secs,
    }
}

fn planet_matches(configured: &str, api_planet: &str, is_storm: bool) -> bool {
    configured == api_planet
        || (is_storm
            && PROXIMA_PLANET_ALIASES
                .iter()
                .any(|&(proxima, base)| configured == proxima && api_planet == base))
}

/// 亀裂が1本のルールに合致するか(時間軸は見ない)。SPEC: FLT-001..006
pub fn rule_matches(rule: &WatchRule, fissure: &Fissure) -> bool {
    match rule.mode {
        Mode::Normal if fissure.is_hard => return false,
        Mode::SteelPath if !fissure.is_hard => return false,
        _ => {}
    }
    match rule.storms {
        StormMode::Exclude if fissure.is_storm => return false,
        StormMode::Only if !fissure.is_storm => return false,
        _ => {}
    }
    if !rule.tiers.is_empty() && !rule.tiers.contains(&fissure.tier) {
        return false;
    }
    if !rule.mission_types.is_empty() && !rule.mission_types.contains(&fissure.mission_type) {
        return false;
    }
    if !rule.planets.is_empty() {
        match extract_planet(&fissure.node) {
            Some(planet)
                if rule
                    .planets
                    .iter()
                    .any(|configured| planet_matches(configured, &planet, fissure.is_storm)) => {}
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
    settings
        .rules
        .iter()
        .filter(|rule| rule.enabled)
        .any(|rule| rule_matches(rule, fissure))
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
