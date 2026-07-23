use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;

use super::{
    TimedContent, TimedMetadata, TimedProvenance, TimedSourceError, TimedSourceId, TimedSourceKind,
    TimedStage, TimedTemporalStatus, BROWSE_WF_ARBITRATION_URL, BROWSE_WF_BOUNTY_URL,
    BROWSE_WF_LOCATION_BOUNTIES_URL,
};

const REQUIRED_BOUNTY_TAGS: [(&str, &str, &str); 3] = [
    ("ZarimanSyndicate", "holdfasts", "The Holdfasts"),
    ("EntratiLabSyndicate", "cavia", "Cavia"),
    ("HexSyndicate", "hex", "The Hex"),
];

const REQUIRED_LOCATION_BOUNTY_TAGS: [(&str, &str, &str); 3] = [
    ("CetusSyndicate", "ostrons", "Ostrons"),
    ("SolarisSyndicate", "solaris-united", "Solaris United"),
    ("EntratiSyndicate", "entrati", "Entrati"),
];

const LOCATION_BOUNTY_PATH_PREFIX: &str = "/Lotus/Types/Gameplay/";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArbitrationSlot {
    pub activation: DateTime<Utc>,
    pub expiry: DateTime<Utc>,
    pub node_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArbitrationSchedule {
    pub slots: Vec<ArbitrationSlot>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct CommunityRegion {
    name: String,
    system_name: String,
    mission_name: String,
    faction: String,
    #[serde(default)]
    min_enemy_level: Option<u32>,
    #[serde(default)]
    max_enemy_level: Option<u32>,
    #[serde(default)]
    dark_sector_data: Option<DarkSectorData>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct DarkSectorData {
    resource_bonus: Option<f64>,
    xp_bonus: Option<f64>,
    weapon_xp_bonus_for: Option<String>,
    weapon_xp_bonus_val: Option<f64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct CommunityChallenge {
    name: String,
    description: String,
    required_count: Option<u32>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct CommunityFaction {
    name: String,
}

#[derive(Debug, Clone)]
pub(crate) struct SharedCommunityAssets {
    regions: BTreeMap<String, CommunityRegion>,
    dictionary: BTreeMap<String, String>,
    factions: BTreeMap<String, CommunityFaction>,
}

#[derive(Debug, Clone)]
pub(crate) struct ArbitrationAssets {
    schedule: ArbitrationSchedule,
    shared: Arc<SharedCommunityAssets>,
}

#[derive(Debug, Clone)]
pub(crate) struct BountyAssets {
    challenges: BTreeMap<String, CommunityChallenge>,
    shared: Arc<SharedCommunityAssets>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct CommunityBounty {
    name: String,
}

#[derive(Debug, Clone)]
pub struct LocationBountyAssets {
    bounties: BTreeMap<String, CommunityBounty>,
    dictionary: BTreeMap<String, String>,
}

/// Compatibility wrapper used by the public fixture API. Runtime polling keeps
/// these two validated asset groups in independent caches.
#[derive(Debug, Clone)]
pub struct CommunityAssets {
    arbitration: ArbitrationAssets,
    bounties: BountyAssets,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct BountyEntry {
    pub node: String,
    pub challenge: String,
    #[serde(default)]
    pub ally: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawBountyCycle {
    expiry: i64,
    rot: String,
    vault_rot: String,
    zariman_faction: String,
    bounties: BTreeMap<String, Vec<BountyEntry>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BountyCycle {
    pub expiry: DateTime<Utc>,
    pub rot: String,
    pub vault_rot: String,
    pub zariman_faction: String,
    pub bounties: BTreeMap<String, Vec<BountyEntry>>,
}

#[derive(Debug, Deserialize)]
struct RawLocationBountyCycle {
    expiry: i64,
    #[serde(rename = "CetusSyndicate")]
    cetus: BTreeMap<String, Vec<String>>,
    #[serde(rename = "SolarisSyndicate")]
    solaris: BTreeMap<String, Vec<String>>,
    #[serde(rename = "EntratiSyndicate")]
    entrati: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LocationBountyCycle {
    pub(crate) expiry: DateTime<Utc>,
    locations: BTreeMap<String, BTreeMap<String, Vec<String>>>,
}

pub fn parse_arbitration_schedule(body: &str) -> Result<ArbitrationSchedule, TimedSourceError> {
    let mut slots: Vec<ArbitrationSlot> = Vec::new();

    for (line_index, raw_line) in body.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        let mut fields = line.split(',');
        let epoch_text = fields.next().unwrap_or_default().trim();
        let node_key = fields.next().unwrap_or_default().trim();
        if epoch_text.is_empty() || node_key.is_empty() || fields.next().is_some() {
            return Err(TimedSourceError::failed(format!(
                "arbys.txt line {} must contain exactly epoch,nodeKey",
                line_index + 1
            )));
        }

        let epoch = epoch_text.parse::<i64>().map_err(|error| {
            TimedSourceError::failed(format!(
                "arbys.txt line {} has invalid epoch: {error}",
                line_index + 1
            ))
        })?;
        if epoch.rem_euclid(3600) != 0 {
            return Err(TimedSourceError::failed(format!(
                "arbys.txt line {} epoch is not aligned to an UTC hour",
                line_index + 1
            )));
        }
        let activation = DateTime::from_timestamp(epoch, 0).ok_or_else(|| {
            TimedSourceError::failed(format!(
                "arbys.txt line {} epoch is outside DateTime range",
                line_index + 1
            ))
        })?;
        let expiry = activation
            .checked_add_signed(Duration::hours(1))
            .ok_or_else(|| {
                TimedSourceError::failed(format!(
                    "arbys.txt line {} expiry is outside DateTime range",
                    line_index + 1
                ))
            })?;

        if let Some(previous) = slots.last() {
            if activation != previous.expiry {
                return Err(TimedSourceError::failed(format!(
                    "arbys.txt line {} is not exactly one hour after the previous slot",
                    line_index + 1
                )));
            }
        }

        slots.push(ArbitrationSlot {
            activation,
            expiry,
            node_key: node_key.to_string(),
        });
    }

    if slots.len() < 2 {
        return Err(TimedSourceError::failed(
            "arbys.txt must contain at least two arbitration slots",
        ));
    }

    Ok(ArbitrationSchedule { slots })
}

pub fn arbitration_slot_at(
    schedule: &ArbitrationSchedule,
    now: DateTime<Utc>,
) -> Result<ArbitrationSlot, TimedSourceError> {
    let first = schedule
        .slots
        .first()
        .ok_or_else(|| TimedSourceError::failed("arbitration schedule is empty"))?;
    let last = schedule
        .slots
        .last()
        .ok_or_else(|| TimedSourceError::failed("arbitration schedule is empty"))?;

    if now < first.activation || now >= last.expiry {
        return Err(TimedSourceError::out_of_range(format!(
            "arbitration schedule covers [{} .. {})",
            first.activation, last.expiry
        )));
    }

    let current_hour = now.timestamp().div_euclid(3600) * 3600;
    let offset = current_hour
        .checked_sub(first.activation.timestamp())
        .ok_or_else(|| TimedSourceError::out_of_range("arbitration time precedes schedule"))?;
    let index = usize::try_from(offset / 3600)
        .map_err(|_| TimedSourceError::out_of_range("arbitration slot index overflow"))?;
    let slot = schedule.slots.get(index).ok_or_else(|| {
        TimedSourceError::out_of_range("arbitration time is outside the schedule")
    })?;
    if slot.activation.timestamp() != current_hour {
        return Err(TimedSourceError::failed(
            "arbitration schedule failed its continuity invariant",
        ));
    }
    Ok(slot.clone())
}

pub fn parse_community_assets(
    schedule_body: &str,
    regions_body: &str,
    challenges_body: &str,
    dictionary_body: &str,
    factions_body: &str,
) -> Result<CommunityAssets, TimedSourceError> {
    let shared = Arc::new(parse_shared_community_assets(
        regions_body,
        dictionary_body,
        factions_body,
    )?);
    let arbitration = parse_arbitration_assets(schedule_body, Arc::clone(&shared))?;
    let bounties = parse_bounty_assets(challenges_body, shared)?;
    Ok(CommunityAssets {
        arbitration,
        bounties,
    })
}

pub(crate) fn parse_shared_community_assets(
    regions_body: &str,
    dictionary_body: &str,
    factions_body: &str,
) -> Result<SharedCommunityAssets, TimedSourceError> {
    let regions: BTreeMap<String, CommunityRegion> = serde_json::from_str(regions_body)
        .map_err(|error| TimedSourceError::failed(format!("ExportRegions JSON: {error}")))?;
    let dictionary: BTreeMap<String, String> = serde_json::from_str(dictionary_body)
        .map_err(|error| TimedSourceError::failed(format!("dict.en JSON: {error}")))?;
    let factions: BTreeMap<String, CommunityFaction> = serde_json::from_str(factions_body)
        .map_err(|error| TimedSourceError::failed(format!("ExportFactions JSON: {error}")))?;

    if regions.is_empty() || dictionary.is_empty() || factions.is_empty() {
        return Err(TimedSourceError::failed(
            "browse.wf shared community asset contains an empty root object",
        ));
    }

    Ok(SharedCommunityAssets {
        regions,
        dictionary,
        factions,
    })
}

pub(crate) fn parse_arbitration_assets(
    schedule_body: &str,
    shared: Arc<SharedCommunityAssets>,
) -> Result<ArbitrationAssets, TimedSourceError> {
    let schedule = parse_arbitration_schedule(schedule_body)?;

    let mut unresolved = BTreeSet::new();
    for slot in &schedule.slots {
        let Some(region) = shared.regions.get(&slot.node_key) else {
            unresolved.insert(slot.node_key.clone());
            continue;
        };
        if region.name.trim().is_empty()
            || region.system_name.trim().is_empty()
            || region.mission_name.trim().is_empty()
            || region.faction.trim().is_empty()
        {
            return Err(TimedSourceError::failed(format!(
                "ExportRegions entry {} lacks arbitration display fields",
                slot.node_key
            )));
        }
        let (Some(minimum), Some(maximum)) = (region.min_enemy_level, region.max_enemy_level)
        else {
            return Err(TimedSourceError::failed(format!(
                "ExportRegions entry {} lacks arbitration enemy levels",
                slot.node_key
            )));
        };
        if minimum > maximum {
            return Err(TimedSourceError::failed(format!(
                "ExportRegions entry {} has inverted enemy levels",
                slot.node_key
            )));
        }
    }
    if !unresolved.is_empty() {
        let examples = unresolved
            .into_iter()
            .take(5)
            .collect::<Vec<_>>()
            .join(", ");
        return Err(TimedSourceError::failed(format!(
            "ExportRegions cannot resolve arbitration nodes: {examples}"
        )));
    }

    Ok(ArbitrationAssets { schedule, shared })
}

pub(crate) fn parse_bounty_assets(
    challenges_body: &str,
    shared: Arc<SharedCommunityAssets>,
) -> Result<BountyAssets, TimedSourceError> {
    let challenges: BTreeMap<String, CommunityChallenge> = serde_json::from_str(challenges_body)
        .map_err(|error| TimedSourceError::failed(format!("ExportChallenges JSON: {error}")))?;
    if challenges.is_empty() {
        return Err(TimedSourceError::failed(
            "ExportChallenges contains an empty root object",
        ));
    }
    Ok(BountyAssets { challenges, shared })
}

pub fn parse_location_bounty_assets(
    export_body: &str,
    dictionary_body: &str,
) -> Result<LocationBountyAssets, TimedSourceError> {
    let bounties: BTreeMap<String, CommunityBounty> = serde_json::from_str(export_body)
        .map_err(|error| TimedSourceError::failed(format!("ExportBounties JSON: {error}")))?;
    let dictionary: BTreeMap<String, String> = serde_json::from_str(dictionary_body)
        .map_err(|error| TimedSourceError::failed(format!("dict.en JSON: {error}")))?;

    if bounties.is_empty() || dictionary.is_empty() {
        return Err(TimedSourceError::failed(
            "browse.wf location bounty asset contains an empty root object",
        ));
    }

    Ok(LocationBountyAssets {
        bounties,
        dictionary,
    })
}

pub fn parse_bounty_cycle_json(
    body: &str,
    now: DateTime<Utc>,
) -> Result<BountyCycle, TimedSourceError> {
    let raw: RawBountyCycle = serde_json::from_str(body)
        .map_err(|error| TimedSourceError::failed(format!("bounty-cycle JSON: {error}")))?;
    let expiry = DateTime::from_timestamp_millis(raw.expiry)
        .ok_or_else(|| TimedSourceError::failed("bounty-cycle expiry is outside DateTime range"))?;
    if expiry <= now {
        return Err(TimedSourceError::failed(format!(
            "bounty-cycle payload expired at {expiry}"
        )));
    }
    for (field, value) in [
        ("rot", raw.rot.as_str()),
        ("vaultRot", raw.vault_rot.as_str()),
        ("zarimanFaction", raw.zariman_faction.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(TimedSourceError::failed(format!(
                "bounty-cycle {field} is empty"
            )));
        }
    }

    for (tag, _, _) in REQUIRED_BOUNTY_TAGS {
        let entries = raw
            .bounties
            .get(tag)
            .ok_or_else(|| TimedSourceError::failed(format!("bounty-cycle is missing {tag}")))?;
        if entries.is_empty() {
            return Err(TimedSourceError::failed(format!(
                "bounty-cycle {tag} is empty"
            )));
        }
        for (index, entry) in entries.iter().enumerate() {
            if entry.node.trim().is_empty() || entry.challenge.trim().is_empty() {
                return Err(TimedSourceError::failed(format!(
                    "bounty-cycle {tag}[{index}] lacks node or challenge"
                )));
            }
        }
    }

    Ok(BountyCycle {
        expiry,
        rot: raw.rot,
        vault_rot: raw.vault_rot,
        zariman_faction: raw.zariman_faction,
        bounties: raw.bounties,
    })
}

pub(crate) fn parse_location_bounty_cycle_json(
    body: &str,
    now: DateTime<Utc>,
) -> Result<LocationBountyCycle, TimedSourceError> {
    let raw: RawLocationBountyCycle = serde_json::from_str(body)
        .map_err(|error| TimedSourceError::failed(format!("location-bounties JSON: {error}")))?;
    let expiry = DateTime::from_timestamp_millis(raw.expiry).ok_or_else(|| {
        TimedSourceError::failed("location-bounties expiry is outside DateTime range")
    })?;
    if expiry <= now {
        return Err(TimedSourceError::failed(format!(
            "location-bounties payload expired at {expiry}"
        )));
    }

    let mut locations = BTreeMap::new();
    for (tag, entries) in [
        ("CetusSyndicate", raw.cetus),
        ("SolarisSyndicate", raw.solaris),
        ("EntratiSyndicate", raw.entrati),
    ] {
        if entries.is_empty() {
            return Err(TimedSourceError::failed(format!(
                "location-bounties {tag} is empty"
            )));
        }
        for (location, paths) in &entries {
            if location.trim().is_empty() || location.trim() != location {
                return Err(TimedSourceError::failed(format!(
                    "location-bounties {tag} contains an invalid location tag"
                )));
            }
            if paths.is_empty() {
                return Err(TimedSourceError::failed(format!(
                    "location-bounties {tag}.{location} is empty"
                )));
            }

            let mut seen = BTreeSet::new();
            for (index, path) in paths.iter().enumerate() {
                if path.trim() != path
                    || !path.starts_with(LOCATION_BOUNTY_PATH_PREFIX)
                    || path.ends_with('/')
                    || path.contains(char::is_whitespace)
                    || raw_leaf(path).is_empty()
                {
                    return Err(TimedSourceError::failed(format!(
                        "location-bounties {tag}.{location}[{index}] has an invalid path"
                    )));
                }
                if !seen.insert(path) {
                    return Err(TimedSourceError::failed(format!(
                        "location-bounties {tag}.{location} contains duplicate path {path}"
                    )));
                }
            }
        }
        locations.insert(tag.to_string(), entries);
    }

    Ok(LocationBountyCycle { expiry, locations })
}

pub fn arbitration_card(
    assets: &CommunityAssets,
    now: DateTime<Utc>,
) -> Result<TimedContent, TimedSourceError> {
    arbitration_card_from_assets(&assets.arbitration, now)
}

pub(crate) fn arbitration_card_from_assets(
    assets: &ArbitrationAssets,
    now: DateTime<Utc>,
) -> Result<TimedContent, TimedSourceError> {
    let slot = arbitration_slot_at(&assets.schedule, now)?;
    let region = assets.shared.regions.get(&slot.node_key).ok_or_else(|| {
        TimedSourceError::failed(format!(
            "ExportRegions cannot resolve arbitration node {}",
            slot.node_key
        ))
    })?;
    let faction = resolve_faction(&assets.shared, &region.faction);
    let mut stage = TimedStage::new(1, resolve_text(&assets.shared, &region.mission_name));
    let node = resolve_text(&assets.shared, &region.name);
    let system = resolve_text(&assets.shared, &region.system_name);
    stage.node = Some(if system.is_empty() {
        node
    } else {
        format!("{node} ({system})")
    });
    stage.detail = (!faction.is_empty()).then(|| faction.clone());
    if let (Some(minimum), Some(maximum)) = (region.min_enemy_level, region.max_enemy_level) {
        stage.enemy_levels = vec![minimum, maximum];
    }

    let mut metadata = vec![
        TimedMetadata {
            key: "nodeKey".to_string(),
            value: slot.node_key.clone(),
        },
        TimedMetadata {
            key: "faction".to_string(),
            value: faction,
        },
    ];
    if let Some(dark_sector) = &region.dark_sector_data {
        push_percent_metadata(
            &mut metadata,
            "resourceBonusPercent",
            dark_sector.resource_bonus,
        );
        push_percent_metadata(&mut metadata, "xpBonusPercent", dark_sector.xp_bonus);
        push_percent_metadata(
            &mut metadata,
            "weaponXpBonusPercent",
            dark_sector.weapon_xp_bonus_val,
        );
        if let Some(weapon) = dark_sector
            .weapon_xp_bonus_for
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            metadata.push(TimedMetadata {
                key: "weaponXpBonusFor".to_string(),
                value: weapon.to_string(),
            });
        }
    }

    Ok(TimedContent {
        id: format!(
            "arbitration:{}:{}",
            slot.activation.timestamp(),
            slot.node_key
        ),
        kind: "arbitration".to_string(),
        variant: None,
        title: "Arbitration".to_string(),
        subtitle: None,
        activation: Some(slot.activation),
        expiry: Some(slot.expiry),
        temporal_status: TimedTemporalStatus::Active,
        provenance: TimedProvenance {
            kind: TimedSourceKind::CommunitySchedule,
            contributors: vec![
                TimedSourceId::BrowseWfArbitrationSchedule,
                TimedSourceId::BrowseWfRegions,
                TimedSourceId::BrowseWfDictionaryEn,
                TimedSourceId::BrowseWfFactions,
            ],
        },
        source_id: TimedSourceId::BrowseWfArbitrationSchedule,
        source_name: "browse.wf".to_string(),
        source_url: Some(BROWSE_WF_ARBITRATION_URL.to_string()),
        metadata,
        personal_modifiers: vec![],
        stages: vec![stage],
    })
}

pub fn parse_bounty_cards(
    body: &str,
    now: DateTime<Utc>,
    assets: &CommunityAssets,
) -> Result<Vec<TimedContent>, TimedSourceError> {
    parse_bounty_cards_from_assets(body, now, &assets.bounties)
}

pub fn parse_location_bounty_cards(
    body: &str,
    now: DateTime<Utc>,
    assets: &LocationBountyAssets,
) -> Result<Vec<TimedContent>, TimedSourceError> {
    let cycle = parse_location_bounty_cycle_json(body, now)?;
    location_bounty_cards_from_cycle(cycle, assets)
}

pub(crate) fn parse_bounty_cards_from_assets(
    body: &str,
    now: DateTime<Utc>,
    assets: &BountyAssets,
) -> Result<Vec<TimedContent>, TimedSourceError> {
    let cycle = parse_bounty_cycle_json(body, now)?;
    bounty_cards_from_cycle(cycle, assets)
}

pub(crate) fn bounty_cards_from_cycle(
    cycle: BountyCycle,
    assets: &BountyAssets,
) -> Result<Vec<TimedContent>, TimedSourceError> {
    let mut cards = Vec::with_capacity(REQUIRED_BOUNTY_TAGS.len());
    let zariman_faction = resolve_faction(&assets.shared, &cycle.zariman_faction);

    for (tag, variant, title) in REQUIRED_BOUNTY_TAGS {
        let entries = cycle
            .bounties
            .get(tag)
            .ok_or_else(|| TimedSourceError::failed(format!("bounty-cycle is missing {tag}")))?;
        let mut stages = Vec::with_capacity(entries.len());
        for (index, entry) in entries.iter().enumerate() {
            let region = assets.shared.regions.get(&entry.node).ok_or_else(|| {
                TimedSourceError::failed(format!(
                    "ExportRegions cannot resolve bounty node {}",
                    entry.node
                ))
            })?;
            let challenge = assets.challenges.get(&entry.challenge).ok_or_else(|| {
                TimedSourceError::failed(format!(
                    "ExportChallenges cannot resolve bounty challenge {}",
                    entry.challenge
                ))
            })?;

            let title = resolve_text(&assets.shared, &region.name);
            let title = if title.trim().is_empty() {
                entry.node.clone()
            } else {
                title
            };
            let mut stage = TimedStage::new(
                u32::try_from(index + 1)
                    .map_err(|_| TimedSourceError::failed("bounty stage count exceeds u32"))?,
                title,
            );
            let mission = resolve_text(&assets.shared, &region.mission_name);
            let system = resolve_text(&assets.shared, &region.system_name);
            stage.node = Some(match (mission.is_empty(), system.is_empty()) {
                (false, false) => format!("{mission} · {system}"),
                (false, true) => mission,
                (true, false) => system,
                (true, true) => entry.node.clone(),
            });
            stage.detail = Some(resolve_challenge(
                &assets.shared,
                challenge,
                &entry.challenge,
            ));
            let faction = resolve_faction(&assets.shared, &region.faction);
            if !faction.is_empty() {
                stage.modifiers.push(faction);
            }
            stage.ally = entry
                .ally
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string);
            stages.push(stage);
        }

        cards.push(TimedContent {
            id: format!("bounty:{variant}:{}", cycle.expiry.timestamp_millis()),
            kind: "bounty".to_string(),
            variant: Some(variant.to_string()),
            title: title.to_string(),
            subtitle: None,
            activation: None,
            expiry: Some(cycle.expiry),
            temporal_status: TimedTemporalStatus::Active,
            provenance: TimedProvenance {
                kind: TimedSourceKind::CommunityLive,
                contributors: vec![
                    TimedSourceId::BrowseWfBountyCycle,
                    TimedSourceId::BrowseWfRegions,
                    TimedSourceId::BrowseWfChallenges,
                    TimedSourceId::BrowseWfDictionaryEn,
                    TimedSourceId::BrowseWfFactions,
                ],
            },
            source_id: TimedSourceId::BrowseWfBountyCycle,
            source_name: "browse.wf".to_string(),
            source_url: Some(BROWSE_WF_BOUNTY_URL.to_string()),
            metadata: vec![
                TimedMetadata {
                    key: "rotation".to_string(),
                    value: cycle.rot.clone(),
                },
                TimedMetadata {
                    key: "vaultRotation".to_string(),
                    value: cycle.vault_rot.clone(),
                },
                TimedMetadata {
                    key: "zarimanFaction".to_string(),
                    value: zariman_faction.clone(),
                },
            ],
            personal_modifiers: vec![],
            stages,
        });
    }

    Ok(cards)
}

pub(crate) fn location_bounty_cards_from_cycle(
    cycle: LocationBountyCycle,
    assets: &LocationBountyAssets,
) -> Result<Vec<TimedContent>, TimedSourceError> {
    let mut cards = Vec::with_capacity(REQUIRED_LOCATION_BOUNTY_TAGS.len());

    for (tag, variant, title) in REQUIRED_LOCATION_BOUNTY_TAGS {
        let locations = cycle.locations.get(tag).ok_or_else(|| {
            TimedSourceError::failed(format!("location-bounties is missing {tag}"))
        })?;
        let mut stages = Vec::with_capacity(locations.len());
        for (index, (location, paths)) in locations.iter().enumerate() {
            let order = u32::try_from(index + 1).map_err(|_| {
                TimedSourceError::failed("location-bounties location count exceeds u32")
            })?;
            let mut stage = TimedStage::new(order, location.clone());
            stage.choices = paths
                .iter()
                .map(|path| resolve_location_bounty_name(assets, path))
                .collect();
            stages.push(stage);
        }

        cards.push(TimedContent {
            id: format!(
                "area-objective:{variant}:{}",
                cycle.expiry.timestamp_millis()
            ),
            kind: "area-objective".to_string(),
            variant: Some(variant.to_string()),
            title: title.to_string(),
            subtitle: None,
            activation: None,
            expiry: Some(cycle.expiry),
            temporal_status: TimedTemporalStatus::Active,
            provenance: TimedProvenance {
                kind: TimedSourceKind::CommunityLive,
                contributors: vec![
                    TimedSourceId::BrowseWfLocationBounties,
                    TimedSourceId::BrowseWfExportBounties,
                    TimedSourceId::BrowseWfDictionaryEn,
                ],
            },
            source_id: TimedSourceId::BrowseWfLocationBounties,
            source_name: "browse.wf".to_string(),
            source_url: Some(BROWSE_WF_LOCATION_BOUNTIES_URL.to_string()),
            metadata: vec![],
            personal_modifiers: vec![],
            stages,
        });
    }

    Ok(cards)
}

fn resolve_location_bounty_name(assets: &LocationBountyAssets, path: &str) -> String {
    let Some(bounty) = assets.bounties.get(path) else {
        return raw_leaf(path);
    };
    let name_key = bounty.name.trim();
    if name_key.is_empty() {
        return raw_leaf(path);
    }
    assets
        .dictionary
        .get(name_key)
        .filter(|value| !value.trim().is_empty())
        .map(|value| normalize_display_text(value))
        .unwrap_or_else(|| raw_leaf(name_key))
}

fn raw_leaf(value: &str) -> String {
    value
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string()
}

fn resolve_text(assets: &SharedCommunityAssets, key: &str) -> String {
    assets
        .dictionary
        .get(key)
        .filter(|value| !value.trim().is_empty())
        .map(|value| normalize_display_text(value))
        .unwrap_or_else(|| key.to_string())
}

fn resolve_faction(assets: &SharedCommunityAssets, key: &str) -> String {
    assets
        .factions
        .get(key)
        .map(|faction| resolve_text(assets, &faction.name))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| key.to_string())
}

fn resolve_challenge(
    assets: &SharedCommunityAssets,
    challenge: &CommunityChallenge,
    raw_key: &str,
) -> String {
    let name = if challenge.name.trim().is_empty() {
        raw_key.to_string()
    } else {
        resolve_text(assets, &challenge.name)
    };
    let mut description = if challenge.description.trim().is_empty() {
        name.clone()
    } else {
        resolve_text(assets, &challenge.description)
    };
    if let Some(count) = challenge.required_count {
        description = description.replace("|COUNT|", &count.to_string());
    }
    let description = description
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(str::trim)
        .unwrap_or(&description)
        .to_string();
    if description == name {
        name
    } else {
        format!("{name} — {description}")
    }
}

fn push_percent_metadata(metadata: &mut Vec<TimedMetadata>, key: &str, fraction: Option<f64>) {
    let Some(value) = fraction.filter(|value| value.is_finite() && *value >= 0.0) else {
        return;
    };
    metadata.push(TimedMetadata {
        key: key.to_string(),
        value: compact_number(value * 100.0),
    });
}

fn compact_number(value: f64) -> String {
    let text = format!("{value:.2}");
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

fn normalize_display_text(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed
        .chars()
        .filter(|character| character.is_alphabetic())
        .all(|character| character.is_uppercase())
    {
        return trimmed
            .split_whitespace()
            .map(|word| {
                let mut characters = word.chars();
                characters
                    .next()
                    .map(|first| {
                        first.to_uppercase().collect::<String>()
                            + &characters.as_str().to_lowercase()
                    })
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join(" ");
    }
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};
    use serde_json::json;

    use super::*;

    const FIRST_EPOCH: i64 = 1_727_884_800;

    fn at(seconds: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(seconds, 0).single().unwrap()
    }

    fn asset_fixture(dictionary: serde_json::Value) -> CommunityAssets {
        let schedule = format!(
            "{FIRST_EPOCH},ClanNode7\n{},ClanNode7\n",
            FIRST_EPOCH + 3600
        );
        let regions = json!({
            "ClanNode7": {
                "name": "/node/Cholistan",
                "systemName": "/system/Europa",
                "missionName": "/mission/Excavation",
                "faction": "FC_INFESTATION",
                "minEnemyLevel": 23,
                "maxEnemyLevel": 33,
                "darkSectorData": {
                    "resourceBonus": 0.25,
                    "xpBonus": 0.18,
                    "weaponXpBonusFor": "Melee",
                    "weaponXpBonusVal": 0.12
                }
            }
        });
        let challenges = json!({
            "/challenge/kill": {
                "name": "/challenge/name",
                "description": "/challenge/description",
                "requiredCount": 10
            }
        });
        let factions = json!({
            "FC_INFESTATION": { "index": 2, "name": "/faction/infested" },
            "FC_GRINEER": { "index": 0, "name": "/faction/grineer" }
        });
        parse_community_assets(
            &schedule,
            &regions.to_string(),
            &challenges.to_string(),
            &dictionary.to_string(),
            &factions.to_string(),
        )
        .unwrap()
    }

    fn bounty_fixture(expiry_millis: i64) -> String {
        json!({
            "expiry": expiry_millis,
            "rot": "B",
            "vaultRot": "C",
            "zarimanFaction": "FC_GRINEER",
            "bounties": {
                "ZarimanSyndicate": [{"node":"ClanNode7","challenge":"/challenge/kill"}],
                "EntratiLabSyndicate": [{"node":"ClanNode7","challenge":"/challenge/kill"}],
                "HexSyndicate": [{
                    "node":"ClanNode7",
                    "challenge":"/challenge/kill",
                    "ally":"/Lotus/Types/ArthurAllyAgent"
                }]
            }
        })
        .to_string()
    }

    fn location_bounty_asset_fixture() -> LocationBountyAssets {
        parse_location_bounty_assets(
            &json!({
                "/Lotus/Types/Gameplay/Eidolon/Jobs/KnownCetus": {
                    "name": "/Lotus/Language/Jobs/KnownTitle"
                },
                "/Lotus/Types/Gameplay/InfestedMicroplanet/Jobs/MissingDictionary": {
                    "name": "/Lotus/Language/Jobs/MissingTitle"
                }
            })
            .to_string(),
            &json!({
                "/Lotus/Language/Jobs/KnownTitle": "KNOWN BOUNTY"
            })
            .to_string(),
        )
        .unwrap()
    }

    fn location_bounty_fixture(expiry_millis: i64) -> serde_json::Value {
        json!({
            "expiry": expiry_millis,
            "CetusSyndicate": {
                "TentA": [
                    "/Lotus/Types/Gameplay/Eidolon/Jobs/KnownCetus",
                    "/Lotus/Types/Gameplay/Eidolon/Jobs/UnknownCetus"
                ]
            },
            "SolarisSyndicate": {
                "BountyNefsHead": [
                    "/Lotus/Types/Gameplay/Venus/Jobs/KnownSolaris"
                ]
            },
            "EntratiSyndicate": {
                "ChamberA": [
                    "/Lotus/Types/Gameplay/InfestedMicroplanet/Jobs/MissingDictionary"
                ]
            }
        })
    }

    #[test]
    fn schedule_is_strictly_hourly_and_uses_half_open_range() {
        let body = format!("{FIRST_EPOCH},ClanNode7\n{},SolNode1\n", FIRST_EPOCH + 3600);
        let schedule = parse_arbitration_schedule(&body).unwrap();
        assert_eq!(schedule.slots.len(), 2);
        assert_eq!(
            arbitration_slot_at(&schedule, at(FIRST_EPOCH + 3599))
                .unwrap()
                .node_key,
            "ClanNode7"
        );
        assert_eq!(
            arbitration_slot_at(&schedule, at(FIRST_EPOCH + 3600))
                .unwrap()
                .node_key,
            "SolNode1"
        );
        assert!(matches!(
            arbitration_slot_at(&schedule, at(FIRST_EPOCH - 1)),
            Err(TimedSourceError::OutOfRange(_))
        ));
        assert!(matches!(
            arbitration_slot_at(&schedule, at(FIRST_EPOCH + 7200)),
            Err(TimedSourceError::OutOfRange(_))
        ));
    }

    #[test]
    fn schedule_rejects_gap_and_malformed_row() {
        assert!(parse_arbitration_schedule(&format!("{FIRST_EPOCH},ClanNode7")).is_err());
        assert!(parse_arbitration_schedule(&format!(
            "{FIRST_EPOCH},ClanNode7\n{},SolNode1",
            FIRST_EPOCH + 7200
        ))
        .is_err());
        assert!(parse_arbitration_schedule(&format!("{FIRST_EPOCH},ClanNode7,extra")).is_err());
        assert!(parse_arbitration_schedule("not-an-epoch,ClanNode7").is_err());
    }

    #[test]
    fn arbitration_assets_require_both_enemy_level_bounds() {
        let schedule = format!(
            "{FIRST_EPOCH},ClanNode7\n{},ClanNode7\n",
            FIRST_EPOCH + 3600
        );
        for region in [
            json!({
                "ClanNode7": {
                    "name": "/node/Cholistan",
                    "systemName": "/system/Europa",
                    "missionName": "/mission/Excavation",
                    "faction": "FC_INFESTATION"
                }
            }),
            json!({
                "ClanNode7": {
                    "name": "/node/Cholistan",
                    "systemName": "/system/Europa",
                    "missionName": "/mission/Excavation",
                    "faction": "FC_INFESTATION",
                    "minEnemyLevel": 23
                }
            }),
        ] {
            let shared = Arc::new(
                parse_shared_community_assets(
                    &region.to_string(),
                    r#"{"key":"value"}"#,
                    r#"{"FC_INFESTATION":{"name":"Infested"}}"#,
                )
                .unwrap(),
            );
            let error = parse_arbitration_assets(&schedule, shared).unwrap_err();
            assert!(error.to_string().contains("enemy levels"));
        }
    }

    #[test]
    fn arbitration_card_has_multi_source_provenance_and_raw_fallback() {
        let assets = asset_fixture(json!({"unrelated":"value"}));
        let card = arbitration_card(&assets, at(FIRST_EPOCH + 1)).unwrap();
        assert_eq!(card.temporal_status, TimedTemporalStatus::Active);
        assert_eq!(card.provenance.kind, TimedSourceKind::CommunitySchedule);
        assert_eq!(card.provenance.contributors.len(), 4);
        assert_eq!(card.stages[0].title, "/mission/Excavation");
        assert_eq!(
            card.stages[0].node.as_deref(),
            Some("/node/Cholistan (/system/Europa)")
        );
        assert_eq!(card.stages[0].enemy_levels, vec![23, 33]);
        assert!(card
            .metadata
            .iter()
            .any(|item| item.key == "resourceBonusPercent" && item.value == "25"));
    }

    #[test]
    fn stale_or_incomplete_bounty_cycle_is_rejected() {
        let now = at(FIRST_EPOCH);
        assert!(parse_bounty_cycle_json(&bounty_fixture(now.timestamp_millis()), now).is_err());
        let incomplete = json!({
            "expiry": (now + Duration::hours(1)).timestamp_millis(),
            "rot":"A", "vaultRot":"B", "zarimanFaction":"FC_GRINEER",
            "bounties": {"ZarimanSyndicate": []}
        });
        assert!(parse_bounty_cycle_json(&incomplete.to_string(), now).is_err());
    }

    #[test]
    fn bounty_cards_join_regions_challenges_dictionary_and_ally() {
        let assets = asset_fixture(json!({
            "/node/Cholistan":"Cholistan",
            "/system/Europa":"Europa",
            "/mission/Excavation":"EXCAVATION",
            "/faction/infested":"INFESTED",
            "/faction/grineer":"GRINEER",
            "/challenge/name":"Operator",
            "/challenge/description":"Kill |COUNT| enemies as Operator"
        }));
        let now = at(FIRST_EPOCH);
        let body = bounty_fixture((now + Duration::hours(1)).timestamp_millis());
        let cards = parse_bounty_cards(&body, now, &assets).unwrap();
        assert_eq!(
            cards
                .iter()
                .map(|card| card.variant.as_deref().unwrap())
                .collect::<Vec<_>>(),
            ["holdfasts", "cavia", "hex"]
        );
        assert!(cards.iter().all(|card| {
            card.provenance.kind == TimedSourceKind::CommunityLive
                && card.provenance.contributors.len() == 5
        }));
        assert_eq!(
            cards[0].stages[0].detail.as_deref(),
            Some("Operator — Kill 10 enemies as Operator")
        );
        assert_eq!(
            cards[2].stages[0].ally.as_deref(),
            Some("/Lotus/Types/ArthurAllyAgent")
        );
        assert!(cards
            .iter()
            .flat_map(|card| &card.stages)
            .all(|stage| stage.enemy_levels.is_empty() && stage.standing_stages.is_empty()));
    }

    #[test]
    fn unresolved_join_does_not_create_partial_bounty_cards() {
        let assets = asset_fixture(json!({"unrelated":"value"}));
        let now = at(FIRST_EPOCH);
        let mut fixture: serde_json::Value = serde_json::from_str(&bounty_fixture(
            (now + Duration::hours(1)).timestamp_millis(),
        ))
        .unwrap();
        fixture["bounties"]["HexSyndicate"][0]["node"] = json!("UnknownNode");
        assert!(parse_bounty_cards(&fixture.to_string(), now, &assets).is_err());
    }

    #[test]
    fn bounty_stage_title_falls_back_to_the_raw_node_identifier() {
        let regions = json!({
            "ClanNode7": {
                "name": "",
                "systemName": "",
                "missionName": "",
                "faction": "FC_INFESTATION"
            }
        });
        let shared = Arc::new(
            parse_shared_community_assets(
                &regions.to_string(),
                r#"{"unrelated":"value"}"#,
                r#"{"FC_INFESTATION":{"name":"Infested"},"FC_GRINEER":{"name":"Grineer"}}"#,
            )
            .unwrap(),
        );
        let assets = parse_bounty_assets(
            r#"{"/challenge/kill":{"name":"","description":""}}"#,
            shared,
        )
        .unwrap();
        let now = at(FIRST_EPOCH);
        let cards = parse_bounty_cards_from_assets(
            &bounty_fixture((now + Duration::hours(1)).timestamp_millis()),
            now,
            &assets,
        )
        .unwrap();

        assert!(cards
            .iter()
            .flat_map(|card| &card.stages)
            .all(|stage| stage.title == "ClanNode7"));
    }

    #[test]
    fn location_bounties_create_three_cards_with_location_choices_and_raw_fallbacks() {
        let now = at(FIRST_EPOCH);
        let assets = location_bounty_asset_fixture();
        let fixture = location_bounty_fixture((now + Duration::hours(1)).timestamp_millis());
        let cards = parse_location_bounty_cards(&fixture.to_string(), now, &assets).unwrap();

        assert_eq!(
            cards
                .iter()
                .map(|card| card.variant.as_deref().unwrap())
                .collect::<Vec<_>>(),
            ["ostrons", "solaris-united", "entrati"]
        );
        assert!(cards.iter().all(|card| {
            card.kind == "area-objective"
                && card.provenance.kind == TimedSourceKind::CommunityLive
                && card.provenance.contributors
                    == [
                        TimedSourceId::BrowseWfLocationBounties,
                        TimedSourceId::BrowseWfExportBounties,
                        TimedSourceId::BrowseWfDictionaryEn,
                    ]
        }));
        assert_eq!(cards[0].stages[0].title, "TentA");
        assert_eq!(cards[0].stages[0].choices, ["Known Bounty", "UnknownCetus"]);
        assert_eq!(cards[1].stages[0].choices, ["KnownSolaris"]);
        assert_eq!(cards[2].stages[0].choices, ["MissingTitle"]);
    }

    #[test]
    fn location_bounties_reject_stale_missing_empty_duplicate_and_invalid_paths() {
        let now = at(FIRST_EPOCH);
        let valid_expiry = (now + Duration::hours(1)).timestamp_millis();

        assert!(parse_location_bounty_cycle_json(
            &location_bounty_fixture(now.timestamp_millis()).to_string(),
            now
        )
        .is_err());

        let mut missing = location_bounty_fixture(valid_expiry);
        missing.as_object_mut().unwrap().remove("SolarisSyndicate");
        assert!(parse_location_bounty_cycle_json(&missing.to_string(), now).is_err());

        let mut empty = location_bounty_fixture(valid_expiry);
        empty["CetusSyndicate"]["TentA"] = json!([]);
        assert!(parse_location_bounty_cycle_json(&empty.to_string(), now).is_err());

        let mut duplicate = location_bounty_fixture(valid_expiry);
        duplicate["CetusSyndicate"]["TentA"] = json!([
            "/Lotus/Types/Gameplay/Eidolon/Jobs/KnownCetus",
            "/Lotus/Types/Gameplay/Eidolon/Jobs/KnownCetus"
        ]);
        assert!(parse_location_bounty_cycle_json(&duplicate.to_string(), now).is_err());

        let mut invalid = location_bounty_fixture(valid_expiry);
        invalid["EntratiSyndicate"]["ChamberA"] = json!(["not-a-resource-path"]);
        assert!(parse_location_bounty_cycle_json(&invalid.to_string(), now).is_err());
    }

    #[test]
    fn location_bounty_assets_reject_empty_roots() {
        assert!(parse_location_bounty_assets("{}", r#"{"key":"value"}"#).is_err());
        assert!(parse_location_bounty_assets(
            r#"{"/Lotus/Types/Gameplay/Eidolon/Jobs/Test":{"name":"/name"}}"#,
            "{}"
        )
        .is_err());
    }
}
