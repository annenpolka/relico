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

/// 通知判定の条件。各Vecは空なら「その軸は全対象」
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterConfig {
    pub tiers: Vec<String>,
    pub mission_types: Vec<String>,
    pub planets: Vec<String>,
    pub mode: Mode,
    pub include_storms: bool,
    pub min_remaining_secs: u64,
}

/// 亀裂が通知条件に合致するか。純粋関数(nowを外から渡す)
pub fn matches(cfg: &FilterConfig, fissure: &Fissure, now: DateTime<Utc>) -> bool {
    // SPEC: FLT-007(期限切れ・残り時間不足の棄却)
    let remaining = fissure.expiry.signed_duration_since(now).num_seconds();
    if remaining < cfg.min_remaining_secs as i64 {
        return false;
    }
    // SPEC: FLT-001 / FLT-002(鋼と通常の区別)
    match cfg.mode {
        Mode::Normal if fissure.is_hard => return false,
        Mode::SteelPath if !fissure.is_hard => return false,
        _ => {}
    }
    // SPEC: FLT-003(ボイドストーム)
    if fissure.is_storm && !cfg.include_storms {
        return false;
    }
    // SPEC: FLT-004(空=全対象)
    if !cfg.tiers.is_empty() && !cfg.tiers.contains(&fissure.tier) {
        return false;
    }
    // SPEC: FLT-005
    if !cfg.mission_types.is_empty() && !cfg.mission_types.contains(&fissure.mission_type) {
        return false;
    }
    // SPEC: FLT-006
    if !cfg.planets.is_empty() {
        match extract_planet(&fissure.node) {
            Some(planet) if cfg.planets.contains(&planet) => {}
            _ => return false,
        }
    }
    true
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
