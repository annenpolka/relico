use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, Utc};
use reqwest::header::CACHE_CONTROL;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

use crate::config::{AppConfig, ContentWatchRule};
use crate::content_filter;
use crate::notify;
use crate::poller::PollerState;

mod browse_wf;
mod de;
mod wfcd;

use browse_wf::{
    arbitration_card_from_assets, bounty_cards_from_cycle, location_bounty_cards_from_cycle,
    parse_arbitration_assets, parse_bounty_assets, parse_location_bounty_cycle_json,
    parse_shared_community_assets, ArbitrationAssets, BountyAssets,
};

pub use browse_wf::{
    arbitration_card, arbitration_slot_at, parse_arbitration_schedule, parse_bounty_cards,
    parse_bounty_cycle_json, parse_community_assets, parse_location_bounty_assets,
    parse_location_bounty_cards, ArbitrationSchedule, ArbitrationSlot, CommunityAssets,
    LocationBountyAssets,
};
pub use de::{parse_circuit_json, parse_descents_json};
pub use wfcd::{parse_wfcd_json, WfcdTimedContent};

pub const WFCD_WORLDSTATE_URL: &str = "https://api.warframestat.us/pc";
pub const DE_WORLDSTATE_URL: &str = "https://api.warframe.com/cdn/worldState.php";
pub const BROWSE_WF_BOUNTY_URL: &str = "https://oracle.browse.wf/bounty-cycle";
pub const BROWSE_WF_LOCATION_BOUNTIES_URL: &str = "https://oracle.browse.wf/location-bounties";
pub const BROWSE_WF_ARBITRATION_URL: &str = "https://browse.wf/arbys.txt";
pub const BROWSE_WF_REGIONS_URL: &str =
    "https://browse.wf/warframe-public-export-plus/ExportRegions.json";
pub const BROWSE_WF_CHALLENGES_URL: &str =
    "https://browse.wf/warframe-public-export-plus/ExportChallenges.json";
pub const BROWSE_WF_EXPORT_BOUNTIES_URL: &str =
    "https://browse.wf/warframe-public-export-plus/ExportBounties.json";
pub const BROWSE_WF_DICTIONARY_URL: &str =
    "https://browse.wf/warframe-public-export-plus/dict.en.json";
pub const BROWSE_WF_FACTIONS_URL: &str =
    "https://browse.wf/warframe-public-export-plus/ExportFactions.json";
pub const TIMED_POLL_SECS: u64 = 300;

const WORLDSTATE_BODY_LIMIT: usize = 8 * 1024 * 1024;
const SCHEDULE_BODY_LIMIT: usize = 2 * 1024 * 1024;
const EXPORT_BODY_LIMIT: usize = 8 * 1024 * 1024;
const STATIC_REFRESH_HOURS: i64 = 24;
const STATIC_RETRY_SECS: i64 = 60;
const STATIC_JOIN_RETRY_SCHEDULE_SECS: [u64; 4] = [60, 300, 1_800, 7_200];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TimedTemporalStatus {
    Active,
    Upcoming,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TimedSourceKind {
    OfficialLive,
    CommunityLive,
    CommunitySchedule,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TimedSourceId {
    WfcdWorldstate,
    DeWorldstate,
    BrowseWfArbitrationSchedule,
    BrowseWfBountyCycle,
    BrowseWfLocationBounties,
    BrowseWfExportBounties,
    BrowseWfRegions,
    BrowseWfChallenges,
    BrowseWfDictionaryEn,
    BrowseWfFactions,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TimedFreshness {
    Fresh,
    Stale,
    OutOfRange,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimedProvenance {
    pub kind: TimedSourceKind,
    pub contributors: Vec<TimedSourceId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimedSourceStatus {
    pub source: TimedSourceId,
    pub freshness: TimedFreshness,
    pub last_attempt: Option<DateTime<Utc>>,
    pub last_success: Option<DateTime<Utc>>,
    pub valid_until: Option<DateTime<Utc>>,
    pub error: Option<String>,
}

impl TimedSourceStatus {
    pub fn new(source: TimedSourceId) -> Self {
        Self {
            source,
            freshness: TimedFreshness::Unavailable,
            last_attempt: None,
            last_success: None,
            valid_until: None,
            error: None,
        }
    }

    fn fresh(&mut self, now: DateTime<Utc>, valid_until: Option<DateTime<Utc>>) {
        self.freshness = TimedFreshness::Fresh;
        self.last_attempt = Some(now);
        self.last_success = Some(now);
        self.valid_until = valid_until;
        self.error = None;
    }

    fn failed(&mut self, now: DateTime<Utc>, error: String, has_lkg: bool) {
        self.freshness = if has_lkg {
            TimedFreshness::Stale
        } else {
            TimedFreshness::Unavailable
        };
        self.last_attempt = Some(now);
        self.error = Some(error);
    }

    fn out_of_range(&mut self, now: DateTime<Utc>, error: String) {
        self.freshness = TimedFreshness::OutOfRange;
        self.last_attempt = Some(now);
        self.valid_until = None;
        self.error = Some(error);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimedSourceStatuses {
    pub wfcd: TimedSourceStatus,
    pub de_descendia: TimedSourceStatus,
    pub de_circuit: TimedSourceStatus,
    pub browse_wf_bounties: TimedSourceStatus,
    pub browse_wf_location_bounties: TimedSourceStatus,
    pub browse_wf_arbitration: TimedSourceStatus,
}

impl Default for TimedSourceStatuses {
    fn default() -> Self {
        Self {
            wfcd: TimedSourceStatus::new(TimedSourceId::WfcdWorldstate),
            de_descendia: TimedSourceStatus::new(TimedSourceId::DeWorldstate),
            de_circuit: TimedSourceStatus::new(TimedSourceId::DeWorldstate),
            browse_wf_bounties: TimedSourceStatus::new(TimedSourceId::BrowseWfBountyCycle),
            browse_wf_location_bounties: TimedSourceStatus::new(
                TimedSourceId::BrowseWfLocationBounties,
            ),
            browse_wf_arbitration: TimedSourceStatus::new(
                TimedSourceId::BrowseWfArbitrationSchedule,
            ),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TimedConditionKind {
    Personal,
    Deviation,
    Risk,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimedCondition {
    pub key: String,
    pub name: String,
    pub description: String,
    pub kind: TimedConditionKind,
    pub elite_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimedRewardDrop {
    pub item: String,
    pub rarity: String,
    pub chance_percent: f64,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimedMetadata {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimedStage {
    pub order: u32,
    pub title: String,
    pub node: Option<String>,
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modifiers: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditions: Vec<TimedCondition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enemy_levels: Vec<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub standing_stages: Vec<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_mr: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_bound: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reward_pool: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reward_drops: Vec<TimedRewardDrop>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub specs: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub auras: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub choices: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ally: Option<String>,
}

impl TimedStage {
    pub fn new(order: u32, title: String) -> Self {
        Self {
            order,
            title,
            node: None,
            detail: None,
            modifiers: vec![],
            conditions: vec![],
            enemy_levels: vec![],
            standing_stages: vec![],
            min_mr: None,
            time_bound: None,
            reward_pool: vec![],
            reward_drops: vec![],
            specs: vec![],
            auras: vec![],
            choices: vec![],
            ally: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimedContent {
    pub id: String,
    pub kind: String,
    pub variant: Option<String>,
    pub title: String,
    pub subtitle: Option<String>,
    pub activation: Option<DateTime<Utc>>,
    pub expiry: Option<DateTime<Utc>>,
    pub temporal_status: TimedTemporalStatus,
    pub provenance: TimedProvenance,
    pub source_id: TimedSourceId,
    pub source_name: String,
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub metadata: Vec<TimedMetadata>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub personal_modifiers: Vec<TimedCondition>,
    pub stages: Vec<TimedStage>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimedContentSnapshot {
    pub arbitration: Vec<TimedContent>,
    pub sortie: Vec<TimedContent>,
    pub archon: Vec<TimedContent>,
    pub syndicates: Vec<TimedContent>,
    pub area_environments: Vec<TimedContent>,
    pub area_missions: Vec<TimedContent>,
    pub area_objectives: Vec<TimedContent>,
    pub bounties: Vec<TimedContent>,
    pub area_events: Vec<TimedContent>,
    pub circuit: Vec<TimedContent>,
    pub archimedea: Vec<TimedContent>,
    pub descendia: Vec<TimedContent>,
    pub sources: TimedSourceStatuses,
    pub last_poll: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimedSourceError {
    Failed(String),
    OutOfRange(String),
}

impl TimedSourceError {
    pub fn failed(message: impl Into<String>) -> Self {
        Self::Failed(message.into())
    }

    pub fn out_of_range(message: impl Into<String>) -> Self {
        Self::OutOfRange(message.into())
    }
}

impl std::fmt::Display for TimedSourceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Failed(message) | Self::OutOfRange(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for TimedSourceError {}

pub fn retain_unexpired(cards: &mut Vec<TimedContent>, now: DateTime<Utc>) {
    cards.retain(|card| card.expiry.is_some_and(|expiry| expiry > now));
}

fn max_expiry(cards: &[TimedContent]) -> Option<DateTime<Utc>> {
    cards.iter().filter_map(|card| card.expiry).max()
}

pub fn apply_timed_source_result(
    cards: &mut Vec<TimedContent>,
    status: &mut TimedSourceStatus,
    now: DateTime<Utc>,
    result: Result<Vec<TimedContent>, TimedSourceError>,
) {
    apply_timed_source_result_with_asset_error(cards, status, now, result, None);
}

fn apply_timed_source_result_with_asset_error(
    cards: &mut Vec<TimedContent>,
    status: &mut TimedSourceStatus,
    now: DateTime<Utc>,
    result: Result<Vec<TimedContent>, TimedSourceError>,
    asset_error: Option<String>,
) {
    match result {
        Ok(mut next) => {
            retain_unexpired(&mut next, now);
            let valid_until = max_expiry(&next);
            *cards = next;
            if let Some(error) = asset_error {
                // The current card was derived successfully from a validated
                // cache, but the physical contributor could not be refreshed.
                // Keep the derived value while preserving last_success.
                status.failed(now, error, !cards.is_empty());
                status.valid_until = valid_until;
            } else {
                status.fresh(now, valid_until);
            }
        }
        Err(TimedSourceError::Failed(error)) => {
            retain_unexpired(cards, now);
            let error = match asset_error {
                Some(asset_error) => format!("{error}; static assets: {asset_error}"),
                None => error,
            };
            status.failed(now, error, !cards.is_empty());
            status.valid_until = max_expiry(cards);
        }
        Err(TimedSourceError::OutOfRange(error)) => {
            cards.clear();
            status.out_of_range(now, error);
        }
    }
}

pub struct TimedPollResults {
    pub wfcd: Result<WfcdTimedContent, TimedSourceError>,
    pub descendia: Result<Vec<TimedContent>, TimedSourceError>,
    pub circuit: Result<Vec<TimedContent>, TimedSourceError>,
    pub bounties: Result<Vec<TimedContent>, TimedSourceError>,
    pub area_objectives: Result<Vec<TimedContent>, TimedSourceError>,
    pub arbitration: Result<Vec<TimedContent>, TimedSourceError>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct TimedAssetHealth {
    bounties_error: Option<String>,
    location_bounties_error: Option<String>,
    arbitration_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TimedAssetRefreshHints {
    pub bounties: bool,
    pub location_bounties: bool,
    pub arbitration: bool,
}

pub fn static_asset_refresh_hints(
    bounty_static_join_failed: bool,
    location_static_join_failed: bool,
    bounties: &Result<Vec<TimedContent>, TimedSourceError>,
    area_objectives: &Result<Vec<TimedContent>, TimedSourceError>,
    arbitration: &Result<Vec<TimedContent>, TimedSourceError>,
) -> TimedAssetRefreshHints {
    TimedAssetRefreshHints {
        // HTTP/JSON/expiry/required-field failures say nothing about the
        // static join data. Only a failure after a valid dynamic payload has
        // reached the join may mean that its identifiers are newer than our
        // validated Export cache.
        bounties: bounty_static_join_failed && bounties.is_err(),
        location_bounties: location_static_join_failed && area_objectives.is_err(),
        // Arbitration has no dynamic body: Failed and OutOfRange both warrant
        // an early schedule/Public Export refresh.
        arbitration: arbitration.is_err(),
    }
}

pub fn static_join_retry_delay_secs(consecutive_failures: u32) -> u64 {
    let index = usize::try_from(consecutive_failures.saturating_sub(1))
        .unwrap_or(usize::MAX)
        .min(STATIC_JOIN_RETRY_SCHEDULE_SECS.len() - 1);
    STATIC_JOIN_RETRY_SCHEDULE_SECS[index]
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct TimedAssetDerivationFeedback {
    refresh_hints: TimedAssetRefreshHints,
    bounties_join_succeeded: bool,
    location_bounties_join_succeeded: bool,
    arbitration_succeeded: bool,
}

impl TimedContentSnapshot {
    /// 全sliceのcardを1本のiteratorで返す(contentRulesの合致評価用)。
    pub fn all_cards(&self) -> impl Iterator<Item = &TimedContent> {
        [
            &self.arbitration,
            &self.sortie,
            &self.archon,
            &self.syndicates,
            &self.area_environments,
            &self.area_missions,
            &self.area_objectives,
            &self.bounties,
            &self.area_events,
            &self.circuit,
            &self.archimedea,
            &self.descendia,
        ]
        .into_iter()
        .flat_map(|cards| cards.iter())
    }

    pub fn apply_poll(&mut self, now: DateTime<Utc>, results: TimedPollResults) {
        self.apply_poll_with_asset_health(now, results, TimedAssetHealth::default());
    }

    fn apply_poll_with_asset_health(
        &mut self,
        now: DateTime<Utc>,
        results: TimedPollResults,
        asset_health: TimedAssetHealth,
    ) {
        self.apply_wfcd(now, results.wfcd);
        apply_timed_source_result(
            &mut self.descendia,
            &mut self.sources.de_descendia,
            now,
            results.descendia,
        );
        apply_timed_source_result(
            &mut self.circuit,
            &mut self.sources.de_circuit,
            now,
            results.circuit,
        );
        apply_timed_source_result_with_asset_error(
            &mut self.bounties,
            &mut self.sources.browse_wf_bounties,
            now,
            results.bounties,
            asset_health.bounties_error,
        );
        apply_timed_source_result_with_asset_error(
            &mut self.area_objectives,
            &mut self.sources.browse_wf_location_bounties,
            now,
            results.area_objectives,
            asset_health.location_bounties_error,
        );
        apply_timed_source_result_with_asset_error(
            &mut self.arbitration,
            &mut self.sources.browse_wf_arbitration,
            now,
            results.arbitration,
            asset_health.arbitration_error,
        );
        self.last_poll = Some(now);
    }

    fn apply_wfcd(
        &mut self,
        now: DateTime<Utc>,
        result: Result<WfcdTimedContent, TimedSourceError>,
    ) {
        match result {
            Ok(mut next) => {
                for cards in [
                    &mut next.sortie,
                    &mut next.archon,
                    &mut next.syndicates,
                    &mut next.area_environments,
                    &mut next.area_missions,
                    &mut next.area_events,
                    &mut next.archimedea,
                ] {
                    retain_unexpired(cards, now);
                }
                let valid_until = next.all_cards().filter_map(|card| card.expiry).max();
                self.sortie = next.sortie;
                self.archon = next.archon;
                self.syndicates = next.syndicates;
                self.area_environments = next.area_environments;
                self.area_missions = next.area_missions;
                self.area_events = next.area_events;
                self.archimedea = next.archimedea;
                self.sources.wfcd.fresh(now, valid_until);
            }
            Err(TimedSourceError::Failed(error)) => {
                for cards in [
                    &mut self.sortie,
                    &mut self.archon,
                    &mut self.syndicates,
                    &mut self.area_environments,
                    &mut self.area_missions,
                    &mut self.area_events,
                    &mut self.archimedea,
                ] {
                    retain_unexpired(cards, now);
                }
                let valid_until = [
                    &self.sortie,
                    &self.archon,
                    &self.syndicates,
                    &self.area_environments,
                    &self.area_missions,
                    &self.area_events,
                    &self.archimedea,
                ]
                .into_iter()
                .flat_map(|cards| cards.iter())
                .filter_map(|card| card.expiry)
                .max();
                self.sources.wfcd.failed(now, error, valid_until.is_some());
                self.sources.wfcd.valid_until = valid_until;
            }
            Err(TimedSourceError::OutOfRange(error)) => {
                self.sortie.clear();
                self.archon.clear();
                self.syndicates.clear();
                self.area_environments.clear();
                self.area_missions.clear();
                self.area_events.clear();
                self.archimedea.clear();
                self.sources.wfcd.out_of_range(now, error);
            }
        }
    }
}

struct CachedAsset<T> {
    value: Option<T>,
    last_attempt: Option<DateTime<Utc>>,
    error: Option<String>,
    join_refresh_at: Option<DateTime<Utc>>,
    join_failure_count: u32,
}

impl<T> Default for CachedAsset<T> {
    fn default() -> Self {
        Self {
            value: None,
            last_attempt: None,
            error: None,
            join_refresh_at: None,
            join_failure_count: 0,
        }
    }
}

impl<T> CachedAsset<T> {
    fn refresh_due(&self, now: DateTime<Utc>) -> bool {
        if self.join_refresh_at.is_some_and(|due| now >= due) {
            return true;
        }
        self.last_attempt.is_none_or(|attempt| {
            let interval = if self.error.is_some() {
                Duration::seconds(STATIC_RETRY_SECS)
            } else {
                Duration::hours(STATIC_REFRESH_HOURS)
            };
            now - attempt >= interval
        })
    }

    fn apply_refresh(&mut self, now: DateTime<Utc>, result: Result<T, TimedSourceError>) {
        // A scheduled join-recovery request has now been attempted. Preserve
        // its failure count until a later derivation actually succeeds.
        self.join_refresh_at = None;
        self.last_attempt = Some(now);
        match result {
            Ok(value) => {
                self.value = Some(value);
                self.error = None;
            }
            Err(error) => {
                // Retain only the previous validated value. The error remains
                // visible to the logical source until a refresh succeeds.
                self.error = Some(error.to_string());
            }
        }
    }

    fn record_join_failure(&mut self, now: DateTime<Utc>) {
        // A physical asset fetch failure already has its own 60-second retry.
        // Do not consume logical join-backoff steps while that endpoint is
        // unavailable; resume join recovery after a successful fetch.
        if self.error.is_some() {
            return;
        }
        // Multiple dynamic polls before the scheduled retry represent one
        // unresolved incident, not additional backoff steps.
        if self.join_refresh_at.is_some() {
            return;
        }
        self.join_failure_count = self.join_failure_count.saturating_add(1);
        let delay = static_join_retry_delay_secs(self.join_failure_count);
        self.join_refresh_at = now.checked_add_signed(Duration::seconds(delay as i64));
    }

    fn record_join_success(&mut self) {
        self.join_refresh_at = None;
        self.join_failure_count = 0;
    }

    fn short_retry_delay_secs(&self, now: DateTime<Utc>) -> Option<i64> {
        let join_retry = self
            .join_refresh_at
            .map(|due| (due - now).num_seconds().max(1));
        let fetch_retry = self.error.as_ref().and(self.last_attempt).map(|attempt| {
            (attempt + Duration::seconds(STATIC_RETRY_SECS) - now)
                .num_seconds()
                .max(1)
        });
        join_retry.into_iter().chain(fetch_retry).min()
    }
}

#[derive(Default)]
struct StaticAssetsCache {
    arbitration: CachedAsset<ArbitrationAssets>,
    bounties: CachedAsset<BountyAssets>,
    location_bounties: CachedAsset<LocationBountyAssets>,
}

impl StaticAssetsCache {
    fn refresh_targets(&self, now: DateTime<Utc>) -> TimedAssetRefreshHints {
        TimedAssetRefreshHints {
            arbitration: self.arbitration.refresh_due(now),
            bounties: self.bounties.refresh_due(now),
            location_bounties: self.location_bounties.refresh_due(now),
        }
    }

    fn apply_refresh(&mut self, now: DateTime<Utc>, refresh: StaticAssetRefresh) {
        if let Some(result) = refresh.arbitration {
            self.arbitration.apply_refresh(now, result);
        }
        if let Some(result) = refresh.bounties {
            self.bounties.apply_refresh(now, result);
        }
        if let Some(result) = refresh.location_bounties {
            self.location_bounties.apply_refresh(now, result);
        }
    }

    fn record_derivation(&mut self, now: DateTime<Utc>, feedback: TimedAssetDerivationFeedback) {
        if feedback.refresh_hints.arbitration {
            self.arbitration.record_join_failure(now);
        } else if feedback.arbitration_succeeded {
            self.arbitration.record_join_success();
        }
        if feedback.refresh_hints.bounties {
            self.bounties.record_join_failure(now);
        } else if feedback.bounties_join_succeeded {
            self.bounties.record_join_success();
        }
        if feedback.refresh_hints.location_bounties {
            self.location_bounties.record_join_failure(now);
        } else if feedback.location_bounties_join_succeeded {
            self.location_bounties.record_join_success();
        }
    }

    fn health(&self) -> TimedAssetHealth {
        TimedAssetHealth {
            bounties_error: self.bounties.error.clone(),
            location_bounties_error: self.location_bounties.error.clone(),
            arbitration_error: self.arbitration.error.clone(),
        }
    }

    fn short_retry_delay_secs(&self, now: DateTime<Utc>) -> Option<i64> {
        self.arbitration
            .short_retry_delay_secs(now)
            .into_iter()
            .chain(self.bounties.short_retry_delay_secs(now))
            .chain(self.location_bounties.short_retry_delay_secs(now))
            .min()
    }
}

struct StaticAssetRefresh {
    arbitration: Option<Result<ArbitrationAssets, TimedSourceError>>,
    bounties: Option<Result<BountyAssets, TimedSourceError>>,
    location_bounties: Option<Result<LocationBountyAssets, TimedSourceError>>,
}

async fn fetch_body(
    client: &reqwest::Client,
    url: &str,
    limit: usize,
    no_cache: bool,
) -> Result<String, TimedSourceError> {
    let mut request = client.get(url);
    if no_cache {
        request = request.header(CACHE_CONTROL, "no-cache");
    }
    let mut response = request
        .send()
        .await
        .map_err(|error| TimedSourceError::failed(format!("{url}: {error}")))?
        .error_for_status()
        .map_err(|error| TimedSourceError::failed(format!("{url}: {error}")))?;
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(TimedSourceError::failed(format!(
            "{url}: body exceeds {limit} bytes"
        )));
    }
    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .and_then(|length| usize::try_from(length).ok())
            .unwrap_or_default()
            .min(limit),
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| TimedSourceError::failed(format!("{url}: {error}")))?
    {
        if bytes
            .len()
            .checked_add(chunk.len())
            .is_none_or(|length| length > limit)
        {
            return Err(TimedSourceError::failed(format!(
                "{url}: body exceeds {limit} bytes"
            )));
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|error| TimedSourceError::failed(format!("{url}: {error}")))
}

fn fetched_body(result: &Result<String, TimedSourceError>) -> Result<&str, TimedSourceError> {
    result.as_deref().map_err(Clone::clone)
}

#[cfg(test)]
fn parse_static_asset_bodies(
    schedule: Result<String, TimedSourceError>,
    regions: Result<String, TimedSourceError>,
    challenges: Result<String, TimedSourceError>,
    export_bounties: Result<String, TimedSourceError>,
    dictionary: Result<String, TimedSourceError>,
    factions: Result<String, TimedSourceError>,
) -> StaticAssetRefresh {
    let shared = (|| {
        parse_shared_community_assets(
            fetched_body(&regions)?,
            fetched_body(&dictionary)?,
            fetched_body(&factions)?,
        )
        .map(Arc::new)
    })();

    let arbitration = match &shared {
        Ok(shared) => fetched_body(&schedule)
            .and_then(|body| parse_arbitration_assets(body, Arc::clone(shared))),
        Err(error) => Err(error.clone()),
    };
    let bounties = match &shared {
        Ok(shared) => {
            fetched_body(&challenges).and_then(|body| parse_bounty_assets(body, Arc::clone(shared)))
        }
        Err(error) => Err(error.clone()),
    };
    let location_bounties = fetched_body(&export_bounties)
        .and_then(|body| parse_location_bounty_assets(body, fetched_body(&dictionary)?));
    StaticAssetRefresh {
        arbitration: Some(arbitration),
        bounties: Some(bounties),
        location_bounties: Some(location_bounties),
    }
}

async fn fetch_optional_body(
    client: &reqwest::Client,
    enabled: bool,
    url: &str,
    limit: usize,
) -> Option<Result<String, TimedSourceError>> {
    if enabled {
        Some(fetch_body(client, url, limit, false).await)
    } else {
        None
    }
}

async fn fetch_static_assets(
    client: &reqwest::Client,
    targets: TimedAssetRefreshHints,
) -> StaticAssetRefresh {
    let (schedule, regions, challenges, export_bounties, dictionary, factions) = tokio::join!(
        fetch_optional_body(
            client,
            targets.arbitration,
            BROWSE_WF_ARBITRATION_URL,
            SCHEDULE_BODY_LIMIT
        ),
        fetch_body(client, BROWSE_WF_REGIONS_URL, EXPORT_BODY_LIMIT, false),
        fetch_optional_body(
            client,
            targets.bounties,
            BROWSE_WF_CHALLENGES_URL,
            EXPORT_BODY_LIMIT
        ),
        fetch_optional_body(
            client,
            targets.location_bounties,
            BROWSE_WF_EXPORT_BOUNTIES_URL,
            EXPORT_BODY_LIMIT
        ),
        fetch_body(client, BROWSE_WF_DICTIONARY_URL, EXPORT_BODY_LIMIT, false),
        fetch_body(client, BROWSE_WF_FACTIONS_URL, EXPORT_BODY_LIMIT, false),
    );
    let shared = (|| {
        parse_shared_community_assets(
            fetched_body(&regions)?,
            fetched_body(&dictionary)?,
            fetched_body(&factions)?,
        )
        .map(Arc::new)
    })();
    let arbitration = schedule.map(|schedule| match &shared {
        Ok(shared) => fetched_body(&schedule)
            .and_then(|body| parse_arbitration_assets(body, Arc::clone(shared))),
        Err(error) => Err(error.clone()),
    });
    let bounties = challenges.map(|challenges| match &shared {
        Ok(shared) => {
            fetched_body(&challenges).and_then(|body| parse_bounty_assets(body, Arc::clone(shared)))
        }
        Err(error) => Err(error.clone()),
    });
    let location_bounties = export_bounties.map(|export_bounties| {
        fetched_body(&export_bounties)
            .and_then(|body| parse_location_bounty_assets(body, fetched_body(&dictionary)?))
    });
    StaticAssetRefresh {
        arbitration,
        bounties,
        location_bounties,
    }
}

async fn poll_sources(
    client: &reqwest::Client,
    arbitration_assets: Option<&ArbitrationAssets>,
    bounty_assets: Option<&BountyAssets>,
    location_bounty_assets: Option<&LocationBountyAssets>,
) -> (
    DateTime<Utc>,
    TimedPollResults,
    TimedAssetDerivationFeedback,
) {
    let bounty_url = format!("{BROWSE_WF_BOUNTY_URL}?relico={}", Utc::now().timestamp());
    let location_bounties_url = format!(
        "{BROWSE_WF_LOCATION_BOUNTIES_URL}?relico={}",
        Utc::now().timestamp()
    );
    let (wfcd, de, bounty, location_bounties) = tokio::join!(
        fetch_body(client, WFCD_WORLDSTATE_URL, WORLDSTATE_BODY_LIMIT, false),
        fetch_body(client, DE_WORLDSTATE_URL, WORLDSTATE_BODY_LIMIT, false),
        fetch_body(client, &bounty_url, WORLDSTATE_BODY_LIMIT, true),
        fetch_body(client, &location_bounties_url, WORLDSTATE_BODY_LIMIT, true),
    );
    let now = Utc::now();
    let wfcd = wfcd.and_then(|body| parse_wfcd_json(&body, now));
    let descendia = match &de {
        Ok(body) => parse_descents_json(body, now),
        Err(error) => Err(error.clone()),
    };
    let circuit = match &de {
        Ok(body) => parse_circuit_json(body, now),
        Err(error) => Err(error.clone()),
    };
    let missing_assets = || TimedSourceError::failed("browse.wf static assets unavailable");
    let (bounties, bounty_static_join_failed, bounties_join_succeeded) = match bounty {
        Ok(body) => match parse_bounty_cycle_json(&body, now) {
            Ok(cycle) => match bounty_assets {
                Some(assets) => {
                    let result = bounty_cards_from_cycle(cycle, assets);
                    let join_failed = result.is_err();
                    (result, join_failed, !join_failed)
                }
                None => (Err(missing_assets()), true, false),
            },
            Err(error) => (Err(error), false, false),
        },
        Err(error) => (Err(error), false, false),
    };
    let (area_objectives, location_static_join_failed, location_bounties_join_succeeded) =
        match location_bounties {
            Ok(body) => match parse_location_bounty_cycle_json(&body, now) {
                Ok(cycle) => match location_bounty_assets {
                    Some(assets) => {
                        let result = location_bounty_cards_from_cycle(cycle, assets);
                        let join_failed = result.is_err();
                        (result, join_failed, !join_failed)
                    }
                    None => (Err(missing_assets()), true, false),
                },
                Err(error) => (Err(error), false, false),
            },
            Err(error) => (Err(error), false, false),
        };
    let arbitration = match arbitration_assets {
        Some(assets) => arbitration_card_from_assets(assets, now).map(|card| vec![card]),
        None => Err(missing_assets()),
    };
    let asset_refresh_hints = static_asset_refresh_hints(
        bounty_static_join_failed,
        location_static_join_failed,
        &bounties,
        &area_objectives,
        &arbitration,
    );
    let asset_feedback = TimedAssetDerivationFeedback {
        refresh_hints: asset_refresh_hints,
        bounties_join_succeeded,
        location_bounties_join_succeeded,
        arbitration_succeeded: arbitration.is_ok(),
    };
    (
        now,
        TimedPollResults {
            wfcd,
            descendia,
            circuit,
            bounties,
            area_objectives,
            arbitration,
        },
        asset_feedback,
    )
}

fn next_poll_delay(
    snapshot: &TimedContentSnapshot,
    now: DateTime<Utc>,
    static_retry_delay_secs: Option<i64>,
) -> StdDuration {
    let mut seconds = TIMED_POLL_SECS as i64;
    for card in [
        &snapshot.arbitration,
        &snapshot.sortie,
        &snapshot.archon,
        &snapshot.syndicates,
        &snapshot.area_environments,
        &snapshot.area_missions,
        &snapshot.area_objectives,
        &snapshot.bounties,
        &snapshot.area_events,
        &snapshot.circuit,
        &snapshot.archimedea,
        &snapshot.descendia,
    ]
    .into_iter()
    .flat_map(|cards| cards.iter())
    {
        for boundary in [card.activation, card.expiry].into_iter().flatten() {
            if boundary > now {
                seconds = seconds.min((boundary - now).num_seconds().max(1));
            }
        }
    }
    if snapshot.sources.browse_wf_bounties.last_attempt.is_some()
        && snapshot.sources.browse_wf_bounties.freshness == TimedFreshness::Unavailable
    {
        seconds = seconds.min(STATIC_RETRY_SECS);
    }
    if snapshot
        .sources
        .browse_wf_location_bounties
        .last_attempt
        .is_some()
        && snapshot.sources.browse_wf_location_bounties.freshness == TimedFreshness::Unavailable
    {
        seconds = seconds.min(STATIC_RETRY_SECS);
    }
    if let Some(delay) = static_retry_delay_secs {
        seconds = seconds.min(delay.max(1));
    }
    StdDuration::from_secs(seconds.max(1) as u64)
}

/// 時限content pollerは亀裂pollerと独立し、source単位でLKGとfreshnessを更新する。
/// contentRulesの通知評価もこのpoll周期で行う(silent seed・dedup・muteは亀裂と同じ意味論)。
pub async fn run(
    app: AppHandle,
    cfg_rx: watch::Receiver<AppConfig>,
    mut reload_rx: watch::Receiver<u64>,
    state: Arc<Mutex<PollerState>>,
    content_notified_path: PathBuf,
) {
    let client = crate::poller::http_client();
    let mut cache = StaticAssetsCache::default();
    // contentRulesのseed済みprojection。SPEC: CNT-003
    let mut seeded_scope: Option<Vec<ContentWatchRule>> = None;
    loop {
        let before_fetch = Utc::now();
        let refresh_targets = cache.refresh_targets(before_fetch);
        if refresh_targets.arbitration
            || refresh_targets.bounties
            || refresh_targets.location_bounties
        {
            let refresh = fetch_static_assets(&client, refresh_targets).await;
            if let Some(Err(error)) = &refresh.arbitration {
                let cache_note = if cache.arbitration.value.is_some() {
                    "; using validated cache"
                } else {
                    ""
                };
                eprintln!("browse.wf arbitration asset refresh failed{cache_note}: {error}");
            }
            if let Some(Err(error)) = &refresh.bounties {
                let cache_note = if cache.bounties.value.is_some() {
                    "; using validated cache"
                } else {
                    ""
                };
                eprintln!("browse.wf bounty asset refresh failed{cache_note}: {error}");
            }
            if let Some(Err(error)) = &refresh.location_bounties {
                let cache_note = if cache.location_bounties.value.is_some() {
                    "; using validated cache"
                } else {
                    ""
                };
                eprintln!("browse.wf location bounty asset refresh failed{cache_note}: {error}");
            }
            cache.apply_refresh(before_fetch, refresh);
        }

        let asset_health = cache.health();
        let (now, results, asset_feedback) = poll_sources(
            &client,
            cache.arbitration.value.as_ref(),
            cache.bounties.value.as_ref(),
            cache.location_bounties.value.as_ref(),
        )
        .await;
        cache.record_derivation(now, asset_feedback);
        // HTTP待機中に保存された最新のcontentRules・ミュート・Pauseで通知を評価する。
        let cfg = cfg_rx.borrow().clone();
        let mut to_notify: Vec<TimedContent> = vec![];
        let snapshot = {
            let mut state = state.lock().expect("poller state");
            state.reset_daily_counters(now.with_timezone(&chrono::Local));
            state
                .snapshot
                .timed_content
                .apply_poll_with_asset_health(now, results, asset_health);
            // PAUSE中は評価もmarkもしない(亀裂pollerのHTTP停止と同じ姿勢)
            if !cfg.paused {
                let seed_only =
                    content_filter::content_scope_changed(seeded_scope.as_ref(), &cfg.content_rules);
                let muted = cfg.notifications_muted_at(now.with_timezone(&chrono::Local));
                let matching: Vec<TimedContent> = content_filter::matching_cards(
                    &cfg.content_rules,
                    state.snapshot.timed_content.all_cards(),
                )
                .into_iter()
                .cloned()
                .collect();
                state.content_notified.prune(now);
                let suppressed = if muted && !seed_only {
                    matching
                        .iter()
                        .filter(|card| !state.content_notified.contains(&card.id))
                        .count() as u32
                } else {
                    0
                };
                to_notify = content_filter::select_content_notifications(
                    &mut state.content_notified,
                    matching,
                    seed_only,
                    muted,
                );
                if let Err(error) = state.content_notified.save(&content_notified_path) {
                    eprintln!("content notified set save failed: {error}");
                }
                state.snapshot.notified_today += to_notify.len() as u32;
                state.snapshot.suppressed_today += suppressed;
                seeded_scope = Some(content_filter::content_projection(&cfg.content_rules));
            }
            state.bump_revision();
            state.snapshot.clone()
        };
        let _ = app.emit("status", &snapshot);
        for card in &to_notify {
            notify::send_content(&app, &client, &cfg, card).await;
        }
        tokio::select! {
            _ = tokio::time::sleep(next_poll_delay(
                &snapshot.timed_content,
                now,
                cache.short_retry_delay_secs(now),
            )) => {}
            changed = reload_rx.changed() => {
                if changed.is_err() {
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::*;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 7, 18, 0, 0, 0).unwrap()
    }

    fn static_asset_bodies() -> (String, String, String, String, String, String) {
        let base = now().timestamp();
        (
            format!("{base},ClanNode7\n{},ClanNode7\n", base + 3600),
            r#"{"ClanNode7":{"name":"/node/Cholistan","systemName":"/system/Europa","missionName":"/mission/Excavation","faction":"FC_INFESTATION","minEnemyLevel":23,"maxEnemyLevel":33}}"#.to_string(),
            r#"{"/challenge/kill":{"name":"/challenge/name","description":"/challenge/description","requiredCount":10}}"#.to_string(),
            r#"{"/Lotus/Types/Gameplay/Eidolon/Jobs/Known":{"name":"/challenge/name"}}"#.to_string(),
            r#"{"/node/Cholistan":"Cholistan","/challenge/name":"Known Bounty"}"#.to_string(),
            r#"{"FC_INFESTATION":{"name":"/faction/infested"}}"#.to_string(),
        )
    }

    fn card(id: &str, expiry: DateTime<Utc>) -> TimedContent {
        TimedContent {
            id: id.to_string(),
            kind: "test".to_string(),
            variant: None,
            title: id.to_string(),
            subtitle: None,
            activation: Some(now()),
            expiry: Some(expiry),
            temporal_status: TimedTemporalStatus::Active,
            provenance: TimedProvenance {
                kind: TimedSourceKind::CommunitySchedule,
                contributors: vec![TimedSourceId::BrowseWfArbitrationSchedule],
            },
            source_id: TimedSourceId::BrowseWfArbitrationSchedule,
            source_name: "browse.wf".to_string(),
            source_url: None,
            metadata: vec![],
            personal_modifiers: vec![],
            stages: vec![],
        }
    }

    #[test]
    fn schedule_and_challenges_fail_independently_while_shared_failures_affect_both() {
        let (_, regions, challenges, export_bounties, dictionary, factions) = static_asset_bodies();
        let schedule_failed = parse_static_asset_bodies(
            Err(TimedSourceError::failed("schedule down")),
            Ok(regions),
            Ok(challenges),
            Ok(export_bounties),
            Ok(dictionary),
            Ok(factions),
        );
        assert!(schedule_failed.arbitration.as_ref().unwrap().is_err());
        assert!(schedule_failed.bounties.as_ref().unwrap().is_ok());
        assert!(schedule_failed.location_bounties.as_ref().unwrap().is_ok());

        let (schedule, regions, _, export_bounties, dictionary, factions) = static_asset_bodies();
        let challenges_failed = parse_static_asset_bodies(
            Ok(schedule),
            Ok(regions),
            Err(TimedSourceError::failed("challenges down")),
            Ok(export_bounties),
            Ok(dictionary),
            Ok(factions),
        );
        assert!(challenges_failed.arbitration.as_ref().unwrap().is_ok());
        assert!(challenges_failed.bounties.as_ref().unwrap().is_err());
        assert!(challenges_failed
            .location_bounties
            .as_ref()
            .unwrap()
            .is_ok());

        let (schedule, regions, challenges, _, dictionary, factions) = static_asset_bodies();
        let export_bounties_failed = parse_static_asset_bodies(
            Ok(schedule),
            Ok(regions),
            Ok(challenges),
            Err(TimedSourceError::failed("ExportBounties down")),
            Ok(dictionary),
            Ok(factions),
        );
        assert!(export_bounties_failed.arbitration.as_ref().unwrap().is_ok());
        assert!(export_bounties_failed.bounties.as_ref().unwrap().is_ok());
        assert!(export_bounties_failed
            .location_bounties
            .as_ref()
            .unwrap()
            .is_err());

        let (schedule, _, challenges, export_bounties, dictionary, factions) =
            static_asset_bodies();
        let shared_failed = parse_static_asset_bodies(
            Ok(schedule),
            Err(TimedSourceError::failed("regions down")),
            Ok(challenges),
            Ok(export_bounties),
            Ok(dictionary),
            Ok(factions),
        );
        assert!(shared_failed.arbitration.as_ref().unwrap().is_err());
        assert!(shared_failed.bounties.as_ref().unwrap().is_err());
        assert!(shared_failed.location_bounties.as_ref().unwrap().is_ok());
    }

    #[test]
    fn failed_refresh_retains_validated_cache_and_retries_after_one_minute() {
        let mut cache = CachedAsset::default();
        cache.apply_refresh(now(), Ok(7_u32));
        let failed_at = now() + Duration::hours(STATIC_REFRESH_HOURS);
        cache.apply_refresh(failed_at, Err(TimedSourceError::failed("schedule down")));

        assert_eq!(cache.value, Some(7));
        assert_eq!(cache.error.as_deref(), Some("schedule down"));
        assert!(!cache.refresh_due(failed_at + Duration::seconds(STATIC_RETRY_SECS - 1)));
        assert!(cache.refresh_due(failed_at + Duration::seconds(STATIC_RETRY_SECS)));
    }

    #[test]
    fn join_refresh_retains_cache_backs_off_and_resets_after_success() {
        let mut cache = CachedAsset::default();
        cache.apply_refresh(now(), Ok(7_u32));
        assert!(!cache.refresh_due(now()));

        cache.record_join_failure(now());

        assert_eq!(cache.value, Some(7));
        assert_eq!(cache.error, None);
        assert_eq!(cache.join_failure_count, 1);
        assert!(!cache.refresh_due(now() + Duration::seconds(59)));
        assert!(cache.refresh_due(now() + Duration::seconds(60)));

        let first_retry = now() + Duration::seconds(60);
        cache.apply_refresh(first_retry, Ok(8_u32));
        cache.record_join_failure(first_retry);
        assert_eq!(cache.join_failure_count, 2);
        assert!(!cache.refresh_due(first_retry + Duration::seconds(299)));
        assert!(cache.refresh_due(first_retry + Duration::seconds(300)));

        cache.record_join_success();
        assert_eq!(cache.join_failure_count, 0);
        assert_eq!(cache.join_refresh_at, None);
    }

    #[test]
    fn fetch_failures_do_not_consume_join_backoff_steps() {
        let mut cache = CachedAsset::default();
        cache.apply_refresh(now(), Ok(7_u32));
        cache.record_join_failure(now());
        assert_eq!(cache.join_failure_count, 1);

        let forced_retry = now() + Duration::seconds(60);
        cache.apply_refresh(
            forced_retry,
            Err(TimedSourceError::failed("static endpoint down")),
        );
        cache.record_join_failure(forced_retry);
        assert_eq!(cache.join_failure_count, 1);
        assert_eq!(cache.join_refresh_at, None);
        assert_eq!(
            cache.short_retry_delay_secs(forced_retry),
            Some(STATIC_RETRY_SECS)
        );

        let recovered = forced_retry + Duration::seconds(STATIC_RETRY_SECS);
        cache.apply_refresh(recovered, Ok(8_u32));
        cache.record_join_failure(recovered);
        assert_eq!(cache.join_failure_count, 2);
        assert_eq!(
            cache.join_refresh_at,
            Some(recovered + Duration::seconds(300))
        );
    }

    #[test]
    fn selective_static_refresh_does_not_touch_the_other_cache() {
        let mut cache = StaticAssetsCache::default();
        cache.arbitration.last_attempt = Some(now());
        cache.location_bounties.last_attempt = Some(now());
        cache.bounties.last_attempt = None;

        let targets = cache.refresh_targets(now());
        assert!(!targets.arbitration);
        assert!(targets.bounties);
        assert!(!targets.location_bounties);

        cache.apply_refresh(
            now() + Duration::minutes(1),
            StaticAssetRefresh {
                arbitration: None,
                bounties: Some(Err(TimedSourceError::failed("challenges down"))),
                location_bounties: None,
            },
        );

        assert_eq!(cache.arbitration.last_attempt, Some(now()));
        assert_eq!(cache.arbitration.error, None);
        assert_eq!(cache.location_bounties.last_attempt, Some(now()));
        assert_eq!(cache.location_bounties.error, None);
        assert_eq!(cache.bounties.error.as_deref(), Some("challenges down"));
    }

    #[test]
    fn cached_derivation_replaces_card_but_keeps_source_stale() {
        let mut cards = vec![card("old", now() + Duration::hours(1))];
        let mut status = TimedSourceStatus::new(TimedSourceId::BrowseWfArbitrationSchedule);
        let previous_success = now() - Duration::minutes(5);
        status.fresh(previous_success, Some(now() + Duration::hours(1)));

        apply_timed_source_result_with_asset_error(
            &mut cards,
            &mut status,
            now(),
            Ok(vec![card("derived", now() + Duration::hours(2))]),
            Some("schedule refresh failed".to_string()),
        );

        assert_eq!(cards[0].id, "derived");
        assert_eq!(status.freshness, TimedFreshness::Stale);
        assert_eq!(status.error.as_deref(), Some("schedule refresh failed"));
        assert_eq!(status.last_success, Some(previous_success));
        assert_eq!(status.valid_until, Some(now() + Duration::hours(2)));
    }

    #[test]
    fn no_cache_is_unavailable_and_out_of_range_takes_precedence() {
        let mut cards = vec![];
        let mut status = TimedSourceStatus::new(TimedSourceId::BrowseWfArbitrationSchedule);
        apply_timed_source_result_with_asset_error(
            &mut cards,
            &mut status,
            now(),
            Err(TimedSourceError::failed("static assets unavailable")),
            Some("schedule down".to_string()),
        );
        assert_eq!(status.freshness, TimedFreshness::Unavailable);

        cards.push(card("cached", now() + Duration::hours(1)));
        apply_timed_source_result_with_asset_error(
            &mut cards,
            &mut status,
            now(),
            Err(TimedSourceError::out_of_range("schedule ended")),
            Some("schedule refresh failed".to_string()),
        );
        assert!(cards.is_empty());
        assert_eq!(status.freshness, TimedFreshness::OutOfRange);
        assert_eq!(status.error.as_deref(), Some("schedule ended"));
    }
}
