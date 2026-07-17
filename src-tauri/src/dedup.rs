use std::collections::HashMap;
use std::fs;
use std::path::Path;

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

    /// 未通知なら記録してtrue(=通知すべき)、通知済みならfalse。SPEC: DED-001
    pub fn mark(&mut self, id: &str, expiry: DateTime<Utc>) -> bool {
        use std::collections::hash_map::Entry;
        match self.map.entry(id.to_string()) {
            Entry::Occupied(_) => false,
            Entry::Vacant(v) => {
                v.insert(expiry);
                true
            }
        }
    }

    pub fn contains(&self, id: &str) -> bool {
        self.map.contains_key(id)
    }

    /// expiryがnow以前のエントリを削除する。生存中のエントリは保持。SPEC: DED-002
    pub fn prune(&mut self, now: DateTime<Utc>) {
        self.map.retain(|_, expiry| *expiry > now);
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    /// 再起動時の再通知防止用の永続化。読めなければ空(起動を止めない)
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
        fs::write(path, serde_json::to_string(self).expect("serialize notified set"))
    }
}
