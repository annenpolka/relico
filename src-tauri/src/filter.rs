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
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchRule {
    /// 一覧表示フィルタへ参加するか。通知参加とは独立。旧フィールド名を互換維持する。
    pub enabled: bool,
    /// 通知へ参加するか。enabled=falseでもtrueなら通知候補。SPEC: CFG-004 / NTY-001
    pub notify: bool,
    /// 表示用の任意名。判定・notification projectionには関与しない。SPEC: CFG-003 / FLT-014
    pub name: Option<String>,
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
            notify: true,
            name: None,
            tiers: vec![],
            mission_types: vec![],
            planets: vec![],
            mode: Mode::Both,
            storms: StormMode::Exclude,
        }
    }
}

/// notify導入前のJSONではenabledが表示・通知を兼ねていたため、notify欠落時だけ
/// 旧enabled値を引き継ぐ。明示notifyはenabledと独立に保持する。SPEC: CFG-002 / CFG-004
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct WatchRuleWire {
    enabled: bool,
    notify: Option<bool>,
    name: Option<String>,
    tiers: Vec<String>,
    mission_types: Vec<String>,
    planets: Vec<String>,
    mode: Mode,
    #[serde(alias = "includeStorms", alias = "include_storms")]
    storms: StormMode,
}

impl Default for WatchRuleWire {
    fn default() -> Self {
        let rule = WatchRule::default();
        Self {
            enabled: rule.enabled,
            notify: None,
            name: rule.name,
            tiers: rule.tiers,
            mission_types: rule.mission_types,
            planets: rule.planets,
            mode: rule.mode,
            storms: rule.storms,
        }
    }
}

impl<'de> Deserialize<'de> for WatchRule {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = WatchRuleWire::deserialize(deserializer)?;
        Ok(Self {
            enabled: wire.enabled,
            notify: wire.notify.unwrap_or(wire.enabled),
            name: wire.name,
            tiers: wire.tiers,
            mission_types: wire.mission_types,
            planets: wire.planets,
            mode: wire.mode,
            storms: wire.storms,
        })
    }
}

/// フィルタ全体 = ルールのOR + 残り時間しきい値
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FilterSettings {
    pub rules: Vec<WatchRule>,
    pub min_remaining_secs: u64,
}

/// 通知対象を変える設定だけを抜き出す(通知範囲の射影)。
/// notify=trueをenabledに依らず残し、matches()用にenabled=trueへ正規化する。
/// enabledとnameは表示用なので落とし、notify=false draftの変更もscopeへ含めない。SPEC: FLT-014
pub fn notification_projection(settings: &FilterSettings) -> FilterSettings {
    FilterSettings {
        rules: settings
            .rules
            .iter()
            .filter(|rule| rule.notify)
            .map(|rule| WatchRule {
                enabled: true,
                name: None,
                ..rule.clone()
            })
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
    // num_seconds()は1秒未満の負値を0へ丸め得るため、expiry自体でも生存を判定する。
    // SPEC: FLT-007 / FLT-015
    if fissure.expiry <= now || remaining < settings.min_remaining_secs as i64 {
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
