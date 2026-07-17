use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 通知済み亀裂idの集合。expiryを保持し、期限切れをpruneできる
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NotifiedSet {
    map: HashMap<String, DateTime<Utc>>,
}

impl NotifiedSet {
    pub fn new() -> Self {
        Self::default()
    }

    /// 未通知なら記録してtrue(=通知すべき)、通知済みならfalse
    pub fn mark(&mut self, _id: &str, _expiry: DateTime<Utc>) -> bool {
        todo!("SPEC: DED-001")
    }

    pub fn contains(&self, id: &str) -> bool {
        self.map.contains_key(id)
    }

    /// expiryがnow以前のエントリを削除する。生存中のエントリは保持
    pub fn prune(&mut self, _now: DateTime<Utc>) {
        todo!("SPEC: DED-002")
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}
