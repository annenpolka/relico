use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// api.warframestat.us /pc/fissures の1要素
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fissure {
    pub id: String,
    pub activation: DateTime<Utc>,
    pub expiry: DateTime<Utc>,
    pub node: String,
    pub mission_type: String,
    pub enemy: String,
    pub tier: String,
    pub tier_num: u8,
    #[serde(default)]
    pub is_storm: bool,
    #[serde(default)]
    pub is_hard: bool,
}
