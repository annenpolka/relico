use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;

use super::{
    TimedCondition, TimedConditionKind, TimedContent, TimedMetadata, TimedProvenance,
    TimedRewardDrop, TimedSourceError, TimedSourceId, TimedSourceKind, TimedStage,
    TimedTemporalStatus,
};

const WFCD_SOURCE_URL: &str = "https://api.warframestat.us/pc";

#[derive(Debug, Default, PartialEq)]
pub struct WfcdTimedContent {
    pub sortie: Vec<TimedContent>,
    pub archon: Vec<TimedContent>,
    pub syndicates: Vec<TimedContent>,
    pub area_missions: Vec<TimedContent>,
    pub area_environments: Vec<TimedContent>,
    pub area_events: Vec<TimedContent>,
    pub archimedea: Vec<TimedContent>,
}

impl WfcdTimedContent {
    pub(crate) fn all_cards(&self) -> impl Iterator<Item = &TimedContent> {
        self.sortie
            .iter()
            .chain(self.archon.iter())
            .chain(self.syndicates.iter())
            .chain(self.area_missions.iter())
            .chain(self.area_environments.iter())
            .chain(self.area_events.iter())
            .chain(self.archimedea.iter())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawWfcdWorldstate {
    sortie: Option<RawSortie>,
    archon_hunt: Option<RawSortie>,
    syndicate_missions: Vec<RawSyndicateMission>,
    cetus_cycle: RawAreaCycle,
    vallis_cycle: RawAreaCycle,
    cambion_cycle: RawAreaCycle,
    zariman_cycle: RawAreaCycle,
    duviri_cycle: RawAreaCycle,
    events: Vec<Value>,
    archimedeas: Vec<RawArchimedea>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAreaCycle {
    #[serde(default)]
    id: String,
    activation: String,
    expiry: String,
    state: String,
    is_day: Option<bool>,
    is_warm: Option<bool>,
    is_corpus: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAreaEvent {
    #[serde(default)]
    id: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    tooltip: Option<String>,
    #[serde(default)]
    jobs: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawEventJob {
    #[serde(default)]
    expiry: Option<String>,
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    enemy_levels: Vec<u32>,
    #[serde(default)]
    standing_stages: Vec<u32>,
    #[serde(default, rename = "minMR")]
    min_mr: u32,
    #[serde(default)]
    location_tag: Option<String>,
    #[serde(default)]
    time_bound: Option<String>,
    #[serde(default)]
    reward_pool: Vec<String>,
    #[serde(default)]
    reward_pool_drops: Vec<RawRewardDrop>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSortie {
    id: String,
    activation: String,
    expiry: String,
    #[serde(default)]
    reward_pool: String,
    #[serde(default)]
    variants: Vec<RawSortieVariant>,
    #[serde(default)]
    missions: Vec<RawMission>,
    boss: String,
    faction: String,
    faction_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSortieVariant {
    mission_type: String,
    mission_type_key: String,
    modifier: String,
    modifier_description: String,
    node: String,
    node_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawMission {
    node: String,
    node_key: String,
    r#type: String,
    type_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSyndicateMission {
    id: String,
    activation: String,
    expiry: String,
    syndicate: String,
    syndicate_key: String,
    nodes: Vec<String>,
    jobs: Vec<RawSyndicateJob>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSyndicateJob {
    #[serde(rename = "id")]
    _id: String,
    expiry: String,
    r#type: String,
    enemy_levels: Vec<u32>,
    standing_stages: Vec<u32>,
    #[serde(rename = "minMR")]
    min_mr: u32,
    location_tag: Option<String>,
    time_bound: Option<String>,
    reward_pool: Vec<String>,
    reward_pool_drops: Vec<RawRewardDrop>,
    #[serde(rename = "uniqueName")]
    _unique_name: String,
    is_vault: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRewardDrop {
    item: String,
    rarity: String,
    chance: f64,
    count: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawArchimedea {
    id: String,
    activation: String,
    expiry: String,
    r#type: String,
    type_key: String,
    missions: Vec<RawArchimedeaMission>,
    personal_modifiers: Vec<RawCondition>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawArchimedeaMission {
    faction: String,
    faction_key: String,
    mission_type: String,
    mission_type_key: String,
    deviation: Option<RawCondition>,
    risks: Vec<RawRisk>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCondition {
    key: String,
    name: String,
    description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRisk {
    key: String,
    name: String,
    description: String,
    is_hard: bool,
}

fn parse_iso(value: &str, field: &str) -> Result<DateTime<Utc>, TimedSourceError> {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.with_timezone(&Utc))
        .map_err(|error| TimedSourceError::failed(format!("WFCD {field} is invalid: {error}")))
}

fn validate_window(
    activation: DateTime<Utc>,
    expiry: DateTime<Utc>,
    field: &str,
) -> Result<(), TimedSourceError> {
    if activation >= expiry {
        return Err(TimedSourceError::failed(format!(
            "WFCD {field} activation must precede expiry"
        )));
    }
    Ok(())
}

fn active_window(activation: DateTime<Utc>, expiry: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    activation <= now && now < expiry
}

fn require_text(value: &str, field: &str) -> Result<(), TimedSourceError> {
    if value.trim().is_empty() {
        return Err(TimedSourceError::failed(format!("WFCD {field} is empty")));
    }
    Ok(())
}

fn display_value(value: &str, key: &str, fallback: &str) -> String {
    if !value.trim().is_empty() {
        value.to_string()
    } else if !key.trim().is_empty() {
        key.to_string()
    } else {
        fallback.to_string()
    }
}

fn joined_nonempty(values: impl IntoIterator<Item = String>) -> Option<String> {
    let values: Vec<_> = values
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect();
    (!values.is_empty()).then(|| values.join(" · "))
}

fn provenance() -> TimedProvenance {
    TimedProvenance {
        kind: TimedSourceKind::CommunityLive,
        contributors: vec![TimedSourceId::WfcdWorldstate],
    }
}

fn card(
    id: String,
    kind: &str,
    title: String,
    subtitle: Option<String>,
    activation: DateTime<Utc>,
    expiry: DateTime<Utc>,
    stages: Vec<TimedStage>,
) -> TimedContent {
    TimedContent {
        id,
        kind: kind.to_string(),
        variant: None,
        title,
        subtitle,
        activation: Some(activation),
        expiry: Some(expiry),
        temporal_status: TimedTemporalStatus::Active,
        provenance: provenance(),
        source_id: TimedSourceId::WfcdWorldstate,
        source_name: "WFCD".to_string(),
        source_url: Some(WFCD_SOURCE_URL.to_string()),
        metadata: vec![],
        personal_modifiers: vec![],
        stages,
    }
}

fn area_environment_card(
    raw: RawAreaCycle,
    now: DateTime<Utc>,
    variant: &str,
    title: &str,
    allowed_states: &[&str],
) -> Result<TimedContent, TimedSourceError> {
    let field = format!("{variant}Cycle");
    let activation = parse_iso(&raw.activation, &format!("{field}.activation"))?;
    let expiry = parse_iso(&raw.expiry, &format!("{field}.expiry"))?;
    validate_window(activation, expiry, &field)?;
    if expiry <= now {
        return Err(TimedSourceError::failed(format!(
            "WFCD {field} expired at {expiry}"
        )));
    }
    require_text(&raw.state, &format!("{field}.state"))?;
    if !allowed_states.contains(&raw.state.as_str()) {
        return Err(TimedSourceError::failed(format!(
            "WFCD {field}.state {} is not supported",
            raw.state
        )));
    }

    let cross_check = match variant {
        "cetus" => raw
            .is_day
            .map(|actual| ("isDay", actual, raw.state == "day")),
        "vallis" => raw
            .is_warm
            .map(|actual| ("isWarm", actual, raw.state == "warm")),
        "zariman" => raw
            .is_corpus
            .map(|actual| ("isCorpus", actual, raw.state == "corpus")),
        _ => None,
    };
    if let Some((boolean_field, actual, expected)) = cross_check {
        if actual != expected {
            return Err(TimedSourceError::failed(format!(
                "WFCD {field}.{boolean_field} contradicts state {}",
                raw.state
            )));
        }
    }

    let id = if raw.id.trim().is_empty() {
        format!(
            "area-environment:{variant}:{}",
            activation.timestamp_millis()
        )
    } else {
        raw.id
    };
    let mut result = card(
        id,
        "area-environment",
        title.to_string(),
        None,
        activation,
        expiry,
        vec![],
    );
    result.variant = Some(variant.to_string());
    result.temporal_status = if activation <= now {
        TimedTemporalStatus::Active
    } else {
        TimedTemporalStatus::Upcoming
    };
    result.metadata = vec![TimedMetadata {
        key: "state".to_string(),
        value: raw.state,
    }];
    Ok(result)
}

fn area_environment_cards(
    cetus: RawAreaCycle,
    vallis: RawAreaCycle,
    cambion: RawAreaCycle,
    zariman: RawAreaCycle,
    duviri: RawAreaCycle,
    now: DateTime<Utc>,
) -> Result<Vec<TimedContent>, TimedSourceError> {
    Ok(vec![
        area_environment_card(cetus, now, "cetus", "Cetus", &["day", "night"])?,
        area_environment_card(vallis, now, "vallis", "Orb Vallis", &["warm", "cold"])?,
        area_environment_card(cambion, now, "cambion", "Cambion Drift", &["fass", "vome"])?,
        area_environment_card(zariman, now, "zariman", "Zariman", &["corpus", "grineer"])?,
        area_environment_card(
            duviri,
            now,
            "duviri",
            "Duviri",
            &["sorrow", "fear", "joy", "anger", "envy"],
        )?,
    ])
}

fn validate_reward_drops(drops: &[RawRewardDrop], field: &str) -> Result<(), TimedSourceError> {
    for drop in drops {
        if drop.item.trim().is_empty()
            || drop.rarity.trim().is_empty()
            || !drop.chance.is_finite()
            || !(0.0..=100.0).contains(&drop.chance)
            || drop.count == 0
        {
            return Err(TimedSourceError::failed(format!(
                "WFCD {field} contains a malformed reward drop"
            )));
        }
    }
    Ok(())
}

fn event_stage(
    index: usize,
    job: RawEventJob,
    event_activation: DateTime<Utc>,
    event_expiry: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<Option<TimedStage>, TimedSourceError> {
    let raw_expiry = job
        .expiry
        .as_deref()
        .ok_or_else(|| TimedSourceError::failed("WFCD active area event job is missing expiry"))?;
    let expiry = parse_iso(raw_expiry, "events[].jobs[].expiry")?;
    validate_window(event_activation, expiry, "events[].jobs[]")?;
    if expiry > event_expiry {
        return Err(TimedSourceError::failed(
            "WFCD area event job expiry exceeds its parent event expiry",
        ));
    }
    if expiry <= now {
        return Ok(None);
    }

    require_text(&job.r#type, "events[].jobs[].type")?;
    if job.enemy_levels.len() != 2 || job.enemy_levels[0] > job.enemy_levels[1] {
        return Err(TimedSourceError::failed(
            "WFCD area event job enemyLevels must be an ordered pair",
        ));
    }
    if job.standing_stages.is_empty() {
        return Err(TimedSourceError::failed(
            "WFCD area event job standingStages is empty",
        ));
    }
    if job.reward_pool.is_empty() || job.reward_pool.iter().any(|item| item.trim().is_empty()) {
        return Err(TimedSourceError::failed(
            "WFCD area event job rewardPool is empty or malformed",
        ));
    }
    validate_reward_drops(&job.reward_pool_drops, "area event job")?;

    let order = u32::try_from(index + 1)
        .map_err(|_| TimedSourceError::failed("WFCD area event job count exceeds u32"))?;
    let mut stage = TimedStage::new(order, job.r#type);
    stage.node = job.location_tag.filter(|value| !value.trim().is_empty());
    stage.enemy_levels = job.enemy_levels;
    stage.standing_stages = job.standing_stages;
    stage.min_mr = (job.min_mr > 0).then_some(job.min_mr);
    stage.time_bound = job.time_bound.filter(|value| !value.trim().is_empty());
    stage.reward_pool = job.reward_pool;
    stage.reward_drops = job
        .reward_pool_drops
        .into_iter()
        .map(|drop| TimedRewardDrop {
            item: drop.item,
            rarity: drop.rarity,
            chance_percent: drop.chance,
            count: drop.count,
        })
        .collect();
    Ok(Some(stage))
}

fn area_event_identity(tag: &str) -> Option<(&'static str, &'static str, u8)> {
    match tag {
        "HeatFissure" => Some(("heat-fissure", "Thermia Fractures", 0)),
        "GhoulEmergence" => Some(("ghoul-emergence", "Ghoul Purge", 1)),
        "InfestedPlains" => Some(("infested-plains", "Plague Star", 2)),
        _ => None,
    }
}

fn area_event_cards(
    events: Vec<Value>,
    now: DateTime<Utc>,
) -> Result<Vec<TimedContent>, TimedSourceError> {
    let mut cards = vec![];
    for raw_event in events {
        let Some(tag) = raw_event
            .get("tag")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        let Some((variant, fallback_title, rank)) = area_event_identity(&tag) else {
            continue;
        };
        let raw_expiry = raw_event
            .get("expiry")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                TimedSourceError::failed(format!("WFCD active area event {tag} is missing expiry"))
            })?;
        let expiry = parse_iso(raw_expiry, "events[].expiry")?;
        if expiry <= now {
            continue;
        }
        let raw_activation = raw_event
            .get("activation")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                TimedSourceError::failed(format!(
                    "WFCD active area event {tag} is missing activation"
                ))
            })?;
        let activation = parse_iso(raw_activation, "events[].activation")?;
        validate_window(activation, expiry, "events[]")?;
        if activation > now {
            continue;
        }

        let event: RawAreaEvent = serde_json::from_value(raw_event).map_err(|error| {
            TimedSourceError::failed(format!("WFCD active area event {tag} is invalid: {error}"))
        })?;

        let mut stages = vec![];
        for raw_job in event.jobs {
            let job: RawEventJob = serde_json::from_value(raw_job).map_err(|error| {
                TimedSourceError::failed(format!(
                    "WFCD active area event {tag} job is invalid: {error}"
                ))
            })?;
            if let Some(stage) = event_stage(stages.len(), job, activation, expiry, now)? {
                stages.push(stage);
            }
        }
        let title = if event.description.trim().is_empty() {
            fallback_title.to_string()
        } else {
            event.description
        };
        let subtitle = event.tooltip.filter(|value| !value.trim().is_empty());
        let id = if event.id.trim().is_empty() {
            format!("area-event:{tag}:{}", activation.timestamp_millis())
        } else {
            event.id
        };
        let mut result = card(
            id,
            "area-event",
            title,
            subtitle,
            activation,
            expiry,
            stages,
        );
        result.variant = Some(variant.to_string());
        cards.push((rank, result));
    }
    cards.sort_by_key(|(rank, _)| *rank);
    Ok(cards.into_iter().map(|(_, card)| card).collect())
}

fn slug(value: &str) -> String {
    let mut result = String::new();
    let mut separator_pending = false;
    for character in value.trim().chars() {
        if character.is_alphanumeric() {
            if separator_pending && !result.is_empty() {
                result.push('-');
            }
            result.extend(character.to_lowercase());
            separator_pending = false;
        } else if !result.is_empty() {
            separator_pending = true;
        }
    }
    result
}

fn area_mission_variant(syndicate: &str, syndicate_key: &str) -> String {
    for value in [syndicate_key, syndicate] {
        match slug(value).as_str() {
            "ostrons" | "cetussyndicate" => return "ostrons".to_string(),
            "solaris-united" | "solarissyndicate" => {
                return "solaris-united".to_string();
            }
            "entrati" | "entratisyndicate" => return "entrati".to_string(),
            _ => {}
        }
    }
    let raw = if syndicate_key.trim().is_empty() {
        syndicate
    } else {
        syndicate_key
    };
    let raw_slug = slug(raw);
    if raw_slug.is_empty() {
        "syndicate".to_string()
    } else {
        raw_slug
    }
}

fn sortie_card(
    raw: RawSortie,
    now: DateTime<Utc>,
    archon: bool,
) -> Result<Option<TimedContent>, TimedSourceError> {
    let source = if archon { "archonHunt" } else { "sortie" };
    let activation = parse_iso(&raw.activation, &format!("{source}.activation"))?;
    let expiry = parse_iso(&raw.expiry, &format!("{source}.expiry"))?;
    validate_window(activation, expiry, source)?;
    if !active_window(activation, expiry, now) {
        return Ok(None);
    }
    if !archon {
        require_text(&raw.reward_pool, "sortie.rewardPool")?;
    }

    let stages: Vec<TimedStage> = if archon {
        raw.missions
            .into_iter()
            .enumerate()
            .map(|(index, mission)| -> Result<_, TimedSourceError> {
                let title = display_value(&mission.r#type, &mission.type_key, "");
                let node = display_value(&mission.node, &mission.node_key, "");
                require_text(&title, "archonHunt.missions[].type")?;
                require_text(&node, "archonHunt.missions[].node")?;
                let mut stage = TimedStage::new(index as u32 + 1, title);
                stage.node = Some(node);
                Ok(stage)
            })
            .collect::<Result<_, _>>()?
    } else {
        raw.variants
            .into_iter()
            .enumerate()
            .map(|(index, mission)| -> Result<_, TimedSourceError> {
                let title = display_value(&mission.mission_type, &mission.mission_type_key, "");
                let node = display_value(&mission.node, &mission.node_key, "");
                require_text(&title, "sortie.variants[].missionType")?;
                require_text(&node, "sortie.variants[].node")?;
                let mut stage = TimedStage::new(index as u32 + 1, title);
                stage.node = Some(node);
                stage.detail = (!mission.modifier_description.is_empty())
                    .then_some(mission.modifier_description);
                if !mission.modifier.is_empty() {
                    stage.modifiers.push(mission.modifier);
                }
                Ok(stage)
            })
            .collect::<Result<_, _>>()?
    };
    if stages.is_empty() {
        return Err(TimedSourceError::failed(format!(
            "WFCD {source} contains no stages"
        )));
    }
    let id = if raw.id.is_empty() {
        format!(
            "{}:{}",
            if archon { "archon" } else { "sortie" },
            activation.timestamp()
        )
    } else {
        raw.id
    };
    let faction = display_value(&raw.faction, &raw.faction_key, "");
    Ok(Some(card(
        id,
        if archon { "archon" } else { "sortie" },
        if archon { "Archon Hunt" } else { "Sortie" }.to_string(),
        joined_nonempty([raw.boss, faction, raw.reward_pool]),
        activation,
        expiry,
        stages,
    )))
}

fn area_stage(index: usize, job: RawSyndicateJob) -> Result<TimedStage, TimedSourceError> {
    require_text(&job.r#type, "syndicateMissions[].jobs[].type")?;
    if job.enemy_levels.len() != 2 || job.enemy_levels[0] > job.enemy_levels[1] {
        return Err(TimedSourceError::failed(
            "WFCD syndicate job enemyLevels must be an ordered pair",
        ));
    }
    if job.standing_stages.is_empty() {
        return Err(TimedSourceError::failed(
            "WFCD syndicate job standingStages is empty",
        ));
    }
    if job.reward_pool.is_empty() || job.reward_pool.iter().any(|item| item.trim().is_empty()) {
        return Err(TimedSourceError::failed(
            "WFCD syndicate job rewardPool is empty or malformed",
        ));
    }
    if job.reward_pool_drops.is_empty() {
        return Err(TimedSourceError::failed(
            "WFCD syndicate job rewardPoolDrops is empty",
        ));
    }
    for drop in &job.reward_pool_drops {
        if drop.item.trim().is_empty()
            || drop.rarity.trim().is_empty()
            || !drop.chance.is_finite()
            || !(0.0..=100.0).contains(&drop.chance)
            || drop.count == 0
        {
            return Err(TimedSourceError::failed(
                "WFCD syndicate job contains a malformed reward drop",
            ));
        }
    }

    let order = u32::try_from(index + 1)
        .map_err(|_| TimedSourceError::failed("WFCD syndicate job count exceeds u32"))?;
    let mut stage = TimedStage::new(order, job.r#type);
    stage.node = job.location_tag.filter(|value| !value.is_empty());
    stage.enemy_levels = job.enemy_levels;
    stage.standing_stages = job.standing_stages;
    stage.min_mr = (job.min_mr > 0).then_some(job.min_mr);
    stage.time_bound = job.time_bound.filter(|value| !value.is_empty());
    stage.reward_pool = job.reward_pool;
    stage.reward_drops = job
        .reward_pool_drops
        .into_iter()
        .map(|drop| TimedRewardDrop {
            item: drop.item,
            rarity: drop.rarity,
            chance_percent: drop.chance,
            count: drop.count,
        })
        .collect();
    if job.is_vault == Some(true) {
        stage.modifiers.push("Vault".to_string());
    }
    Ok(stage)
}

fn syndicate_cards(
    missions: Vec<RawSyndicateMission>,
    now: DateTime<Utc>,
) -> Result<(Vec<TimedContent>, Vec<TimedContent>), TimedSourceError> {
    let mut syndicates = vec![];
    let mut area_missions = vec![];
    for mission in missions {
        let activation = parse_iso(&mission.activation, "syndicateMissions[].activation")?;
        let expiry = parse_iso(&mission.expiry, "syndicateMissions[].expiry")?;
        validate_window(activation, expiry, "syndicateMissions[]")?;
        if !active_window(activation, expiry, now) {
            continue;
        }
        let title = display_value(&mission.syndicate, &mission.syndicate_key, "Syndicate");
        let area_variant = area_mission_variant(&mission.syndicate, &mission.syndicate_key);
        let base_id = if mission.id.is_empty() {
            format!(
                "syndicate:{}:{}",
                title.to_lowercase().replace(' ', "-"),
                activation.timestamp()
            )
        } else {
            mission.id
        };
        if !mission.nodes.is_empty() {
            let stages = mission
                .nodes
                .into_iter()
                .enumerate()
                .map(|(index, node)| -> Result<_, TimedSourceError> {
                    require_text(&node, "syndicateMissions[].nodes[]")?;
                    let order = u32::try_from(index + 1).map_err(|_| {
                        TimedSourceError::failed("WFCD syndicate node count exceeds u32")
                    })?;
                    let mut stage = TimedStage::new(order, String::new());
                    stage.node = Some(node);
                    Ok(stage)
                })
                .collect::<Result<_, _>>()?;
            syndicates.push(card(
                format!("{base_id}:syndicate"),
                "syndicate",
                title.clone(),
                None,
                activation,
                expiry,
                stages,
            ));
        }
        if !mission.jobs.is_empty() {
            let mut groups: BTreeMap<DateTime<Utc>, Vec<RawSyndicateJob>> = BTreeMap::new();
            for job in mission.jobs {
                let job_expiry = parse_iso(&job.expiry, "syndicateMissions[].jobs[].expiry")?;
                validate_window(activation, job_expiry, "syndicateMissions[].jobs[]")?;
                if job_expiry > expiry {
                    return Err(TimedSourceError::failed(
                        "WFCD syndicate job expiry exceeds its parent mission expiry",
                    ));
                }
                if job_expiry > now {
                    groups.entry(job_expiry).or_default().push(job);
                }
            }
            for (job_expiry, jobs) in groups {
                let stages = jobs
                    .into_iter()
                    .enumerate()
                    .map(|(index, job)| area_stage(index, job))
                    .collect::<Result<_, _>>()?;
                let mut area_card = card(
                    format!("{base_id}:area:{}", job_expiry.timestamp_millis()),
                    "area-mission",
                    title.clone(),
                    None,
                    activation,
                    job_expiry,
                    stages,
                );
                area_card.variant = Some(area_variant.clone());
                area_missions.push(area_card);
            }
        }
    }
    syndicates.sort_by(|left, right| left.title.cmp(&right.title));
    area_missions.sort_by(|left, right| {
        left.title
            .cmp(&right.title)
            .then_with(|| left.expiry.cmp(&right.expiry))
    });
    Ok((syndicates, area_missions))
}

fn condition(
    raw: RawCondition,
    kind: TimedConditionKind,
    elite_only: bool,
) -> Result<TimedCondition, TimedSourceError> {
    require_text(&raw.key, "archimedeas condition key")?;
    require_text(&raw.description, "archimedeas condition description")?;
    let name = display_value(&raw.name, &raw.key, &raw.description);
    Ok(TimedCondition {
        key: raw.key,
        name,
        description: raw.description,
        kind,
        elite_only,
    })
}

fn archimedea_variant(raw: &RawArchimedea) -> (Option<String>, String) {
    let source = if raw.type_key.is_empty() {
        &raw.r#type
    } else {
        &raw.type_key
    };
    let compact: String = source
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect();
    match compact.as_str() {
        "CTLAB" => (Some("deep".to_string()), "Deep Archimedea".to_string()),
        "CTHEX" => (
            Some("temporal".to_string()),
            "Temporal Archimedea".to_string(),
        ),
        _ => (
            (!compact.is_empty()).then(|| compact.to_lowercase()),
            display_value(&raw.r#type, &raw.type_key, "Archimedea"),
        ),
    }
}

fn archimedea_cards(
    raw: Vec<RawArchimedea>,
    now: DateTime<Utc>,
) -> Result<Vec<TimedContent>, TimedSourceError> {
    let mut cards = vec![];
    for item in raw {
        let activation = parse_iso(&item.activation, "archimedeas[].activation")?;
        let expiry = parse_iso(&item.expiry, "archimedeas[].expiry")?;
        validate_window(activation, expiry, "archimedeas[]")?;
        if !active_window(activation, expiry, now) {
            continue;
        }
        if item.missions.is_empty() {
            return Err(TimedSourceError::failed(
                "WFCD active archimedea contains no missions",
            ));
        }
        let (variant, title) = archimedea_variant(&item);
        let personal_modifiers = item
            .personal_modifiers
            .into_iter()
            .map(|item| condition(item, TimedConditionKind::Personal, false))
            .collect::<Result<_, _>>()?;
        let stages = item
            .missions
            .into_iter()
            .enumerate()
            .map(|(index, mission)| -> Result<_, TimedSourceError> {
                let title = display_value(&mission.mission_type, &mission.mission_type_key, "");
                let faction = display_value(&mission.faction, &mission.faction_key, "");
                require_text(&title, "archimedeas[].missions[].missionType")?;
                require_text(&faction, "archimedeas[].missions[].faction")?;
                let order = u32::try_from(index + 1).map_err(|_| {
                    TimedSourceError::failed("WFCD archimedea mission count exceeds u32")
                })?;
                let mut stage = TimedStage::new(order, title);
                stage.detail = Some(faction);
                if let Some(deviation) = mission.deviation {
                    stage.conditions.push(condition(
                        deviation,
                        TimedConditionKind::Deviation,
                        false,
                    )?);
                }
                for risk in mission.risks {
                    stage.conditions.push(condition(
                        RawCondition {
                            key: risk.key,
                            name: risk.name,
                            description: risk.description,
                        },
                        TimedConditionKind::Risk,
                        risk.is_hard,
                    )?);
                }
                Ok(stage)
            })
            .collect::<Result<_, _>>()?;
        let id = if item.id.is_empty() {
            format!(
                "archimedea:{}:{}",
                variant.as_deref().unwrap_or("unknown"),
                activation.timestamp()
            )
        } else {
            item.id
        };
        let mut card = card(id, "archimedea", title, None, activation, expiry, stages);
        card.variant = variant;
        card.personal_modifiers = personal_modifiers;
        cards.push(card);
    }
    Ok(cards)
}

pub fn parse_wfcd_json(
    body: &str,
    now: DateTime<Utc>,
) -> Result<WfcdTimedContent, TimedSourceError> {
    let value: Value = serde_json::from_str(body)
        .map_err(|error| TimedSourceError::failed(format!("WFCD JSON: {error}")))?;
    for field in [
        "sortie",
        "archonHunt",
        "syndicateMissions",
        "cetusCycle",
        "vallisCycle",
        "cambionCycle",
        "zarimanCycle",
        "duviriCycle",
        "events",
        "archimedeas",
    ] {
        if value.get(field).is_none() {
            return Err(TimedSourceError::failed(format!(
                "WFCD JSON is missing {field}"
            )));
        }
    }
    let raw: RawWfcdWorldstate = serde_json::from_value(value)
        .map_err(|error| TimedSourceError::failed(format!("WFCD JSON: {error}")))?;
    let area_environments = area_environment_cards(
        raw.cetus_cycle,
        raw.vallis_cycle,
        raw.cambion_cycle,
        raw.zariman_cycle,
        raw.duviri_cycle,
        now,
    )?;
    let area_events = area_event_cards(raw.events, now)?;
    let (syndicates, area_missions) = syndicate_cards(raw.syndicate_missions, now)?;
    let sortie = raw
        .sortie
        .map(|item| sortie_card(item, now, false))
        .transpose()?
        .flatten()
        .into_iter()
        .collect();
    let archon = raw
        .archon_hunt
        .map(|item| sortie_card(item, now, true))
        .transpose()?
        .flatten()
        .into_iter()
        .collect();
    Ok(WfcdTimedContent {
        sortie,
        archon,
        syndicates,
        area_missions,
        area_environments,
        area_events,
        archimedea: archimedea_cards(raw.archimedeas, now)?,
    })
}
