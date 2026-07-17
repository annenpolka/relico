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
pub fn matches(_cfg: &FilterConfig, _fissure: &Fissure, _now: DateTime<Utc>) -> bool {
    todo!("SPEC: FLT-001..007")
}

/// node "Kappa (Sedna)" から惑星名 "Sedna" を抽出する。
/// 括弧がない・空などの不正形式では None(パニックしない)
pub fn extract_planet(_node: &str) -> Option<String> {
    todo!("SPEC: PRS-001")
}
