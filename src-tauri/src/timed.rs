use std::sync::{Arc, Mutex};
use std::time::Duration as StdDuration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::poller::PollerState;

pub const WFCD_WORLDSTATE_URL: &str = "https://api.warframestat.us/pc";
pub const DE_WORLDSTATE_URL: &str = "https://api.warframe.com/cdn/worldState.php";
pub const TIMED_POLL_SECS: u64 = 300;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TimedAvailability {
    Available,
    Unavailable,
    Synthetic,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimedStage {
    pub order: u32,
    pub title: String,
    pub node: Option<String>,
    pub detail: Option<String>,
    pub modifiers: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enemy_levels: Vec<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub standing_stages: Vec<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_mr: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_bound: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimedContent {
    pub id: String,
    pub kind: String,
    pub variant: Option<String>,
    pub title: String,
    pub subtitle: Option<String>,
    pub activation: Option<DateTime<Utc>>,
    pub expiry: Option<DateTime<Utc>>,
    pub availability: TimedAvailability,
    pub stages: Vec<TimedStage>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimedContentSnapshot {
    pub sortie: Vec<TimedContent>,
    pub archon: Vec<TimedContent>,
    pub syndicates: Vec<TimedContent>,
    pub area_missions: Vec<TimedContent>,
    pub archimedea: Vec<TimedContent>,
    pub descendia: Vec<TimedContent>,
    pub wfcd_ok: bool,
    pub wfcd_error: Option<String>,
    pub descents_ok: bool,
    pub descents_error: Option<String>,
    pub last_poll: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct WfcdTimedContent {
    sortie: Vec<TimedContent>,
    archon: Vec<TimedContent>,
    syndicates: Vec<TimedContent>,
    area_missions: Vec<TimedContent>,
    archimedea: Vec<TimedContent>,
}

impl TimedContentSnapshot {
    fn apply_poll(
        &mut self,
        now: DateTime<Utc>,
        wfcd: Result<WfcdTimedContent, String>,
        descents: Result<Vec<TimedContent>, String>,
    ) {
        match wfcd {
            Ok(content) => {
                self.sortie = content.sortie;
                self.archon = content.archon;
                self.syndicates = content.syndicates;
                self.area_missions = content.area_missions;
                self.archimedea = content.archimedea;
                self.wfcd_ok = true;
                self.wfcd_error = None;
            }
            Err(error) => {
                // Source failure must not erase the last valid cards.
                self.wfcd_ok = false;
                self.wfcd_error = Some(error);
            }
        }

        match descents {
            Ok(content) => {
                self.descendia = content;
                self.descents_ok = true;
                self.descents_error = None;
            }
            Err(error) => {
                // DE source is independent from WFCD; retain its last valid cards.
                self.descents_ok = false;
                self.descents_error = Some(error);
            }
        }

        self.last_poll = Some(now);
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawWfcdWorldstate {
    sortie: Option<RawSortie>,
    archon_hunt: Option<RawSortie>,
    syndicate_missions: Vec<RawSyndicateMission>,
    archimedeas: Vec<RawArchimedea>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct RawSortie {
    id: String,
    activation: String,
    expiry: String,
    reward_pool: String,
    variants: Vec<RawSortieVariant>,
    missions: Vec<RawMission>,
    boss: String,
    faction: String,
    faction_key: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct RawSortieVariant {
    mission_type: String,
    mission_type_key: String,
    modifier: String,
    modifier_description: String,
    node: String,
    node_key: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct RawMission {
    node: String,
    node_key: String,
    r#type: String,
    type_key: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct RawSyndicateMission {
    id: String,
    activation: String,
    expiry: String,
    syndicate: String,
    syndicate_key: String,
    nodes: Vec<String>,
    jobs: Vec<RawSyndicateJob>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct RawSyndicateJob {
    id: String,
    r#type: Option<String>,
    enemy_levels: Vec<u32>,
    standing_stages: Vec<u32>,
    #[serde(rename = "minMR")]
    min_mr: u32,
    location_tag: Option<String>,
    time_bound: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct RawArchimedea {
    id: String,
    activation: String,
    expiry: String,
    r#type: String,
    type_key: String,
    missions: Vec<RawArchimedeaMission>,
    personal_modifiers: Vec<RawCondition>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct RawArchimedeaMission {
    faction: String,
    faction_key: String,
    mission_type: String,
    mission_type_key: String,
    deviation: Option<RawCondition>,
    risks: Vec<RawRisk>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct RawCondition {
    key: String,
    name: String,
    description: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct RawRisk {
    key: String,
    name: String,
    description: String,
}

#[derive(Debug, Deserialize)]
struct RawDeWorldstate {
    #[serde(rename = "Descents")]
    descents: Vec<RawDescent>,
}

#[derive(Debug, Deserialize)]
struct RawDescent {
    #[serde(rename = "Activation")]
    activation: Value,
    #[serde(rename = "Expiry")]
    expiry: Value,
    #[serde(rename = "RandSeed")]
    rand_seed: u64,
    #[serde(rename = "Challenges")]
    challenges: Vec<RawDescentChallenge>,
}

#[derive(Debug, Deserialize)]
struct RawDescentChallenge {
    #[serde(rename = "Index")]
    index: u32,
    #[serde(rename = "Type")]
    challenge_type: String,
    #[serde(rename = "Challenge")]
    challenge: String,
    #[serde(rename = "Level")]
    level: String,
}

fn parse_iso(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.with_timezone(&Utc))
}

fn active_window(
    activation: Option<DateTime<Utc>>,
    expiry: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> bool {
    activation.is_some_and(|start| start <= now) && expiry.is_some_and(|end| now < end)
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

fn sortie_card(raw: RawSortie, now: DateTime<Utc>, archon: bool) -> Option<TimedContent> {
    let activation = parse_iso(&raw.activation);
    let expiry = parse_iso(&raw.expiry);
    if !active_window(activation, expiry, now) {
        return None;
    }

    let stages = if archon {
        raw.missions
            .into_iter()
            .enumerate()
            .map(|(index, mission)| TimedStage {
                order: index as u32 + 1,
                title: display_value(&mission.r#type, &mission.type_key, ""),
                node: Some(display_value(&mission.node, &mission.node_key, "")),
                detail: None,
                modifiers: vec![],
                enemy_levels: vec![],
                standing_stages: vec![],
                min_mr: None,
                time_bound: None,
            })
            .collect()
    } else {
        raw.variants
            .into_iter()
            .enumerate()
            .map(|(index, mission)| TimedStage {
                order: index as u32 + 1,
                title: display_value(&mission.mission_type, &mission.mission_type_key, ""),
                node: Some(display_value(&mission.node, &mission.node_key, "")),
                detail: (!mission.modifier_description.is_empty())
                    .then_some(mission.modifier_description),
                modifiers: (!mission.modifier.is_empty())
                    .then_some(mission.modifier)
                    .into_iter()
                    .collect(),
                enemy_levels: vec![],
                standing_stages: vec![],
                min_mr: None,
                time_bound: None,
            })
            .collect()
    };

    let faction = display_value(&raw.faction, &raw.faction_key, "");
    let subtitle = joined_nonempty([raw.boss, faction, raw.reward_pool]);
    Some(TimedContent {
        id: if raw.id.is_empty() {
            format!(
                "{}:{}",
                if archon { "archon" } else { "sortie" },
                activation
                    .expect("active window has activation")
                    .timestamp()
            )
        } else {
            raw.id
        },
        kind: if archon { "archon" } else { "sortie" }.to_string(),
        variant: None,
        title: if archon {
            "Archon Hunt".to_string()
        } else {
            "Sortie".to_string()
        },
        subtitle,
        activation,
        expiry,
        availability: TimedAvailability::Available,
        stages,
    })
}

fn syndicate_cards(
    missions: Vec<RawSyndicateMission>,
    now: DateTime<Utc>,
) -> (Vec<TimedContent>, Vec<TimedContent>) {
    let mut syndicates = vec![];
    let mut area_missions = vec![];

    for mission in missions {
        let activation = parse_iso(&mission.activation);
        let expiry = parse_iso(&mission.expiry);
        if !active_window(activation, expiry, now) {
            continue;
        }
        let title = display_value(&mission.syndicate, &mission.syndicate_key, "Syndicate");
        let base_id = if mission.id.is_empty() {
            format!(
                "syndicate:{}:{}",
                title.to_lowercase().replace(' ', "-"),
                activation
                    .expect("active window has activation")
                    .timestamp()
            )
        } else {
            mission.id
        };

        if !mission.nodes.is_empty() {
            let stages = mission
                .nodes
                .into_iter()
                .enumerate()
                .map(|(index, node)| TimedStage {
                    order: index as u32 + 1,
                    // The endpoint does not expose a per-node mission type.
                    title: String::new(),
                    node: Some(node),
                    detail: None,
                    modifiers: vec![],
                    enemy_levels: vec![],
                    standing_stages: vec![],
                    min_mr: None,
                    time_bound: None,
                })
                .collect::<Vec<_>>();
            syndicates.push(TimedContent {
                id: format!("{base_id}:syndicate"),
                kind: "syndicate".to_string(),
                variant: None,
                title: title.clone(),
                subtitle: None,
                activation,
                expiry,
                availability: TimedAvailability::Available,
                stages,
            });
        }

        if !mission.jobs.is_empty() {
            let stages = mission
                .jobs
                .into_iter()
                .enumerate()
                .map(|(index, job)| area_stage(index, job))
                .collect::<Vec<_>>();
            area_missions.push(TimedContent {
                id: format!("{base_id}:area"),
                kind: "area-mission".to_string(),
                variant: None,
                title,
                subtitle: None,
                activation,
                expiry,
                availability: TimedAvailability::Available,
                stages,
            });
        }
    }

    syndicates.sort_by(|a, b| a.title.cmp(&b.title));
    area_missions.sort_by(|a, b| a.title.cmp(&b.title));
    (syndicates, area_missions)
}

fn area_stage(index: usize, job: RawSyndicateJob) -> TimedStage {
    // 数値は構造化したまま渡し、Level/Standing等のlabelはfrontend catalogで付ける。
    TimedStage {
        order: index as u32 + 1,
        title: job.r#type.unwrap_or_default(),
        node: job.location_tag.filter(|value| !value.is_empty()),
        detail: None,
        modifiers: vec![],
        enemy_levels: job.enemy_levels,
        standing_stages: job.standing_stages,
        min_mr: (job.min_mr > 0).then_some(job.min_mr),
        time_bound: job.time_bound.filter(|value| !value.is_empty()),
    }
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

fn archimedea_cards(raw: Vec<RawArchimedea>, now: DateTime<Utc>) -> Vec<TimedContent> {
    raw.into_iter()
        .filter_map(|item| {
            let activation = parse_iso(&item.activation);
            let expiry = parse_iso(&item.expiry);
            if !active_window(activation, expiry, now) {
                return None;
            }
            let (variant, title) = archimedea_variant(&item);
            let personal = item
                .personal_modifiers
                .iter()
                .map(condition_name)
                .filter(|name| !name.is_empty())
                .collect::<Vec<_>>();
            let stages = item
                .missions
                .into_iter()
                .enumerate()
                .map(|(index, mission)| {
                    let mut modifiers = vec![];
                    if let Some(deviation) = mission.deviation.as_ref() {
                        let name = condition_name(deviation);
                        if !name.is_empty() {
                            modifiers.push(name);
                        }
                    }
                    modifiers.extend(mission.risks.iter().filter_map(|risk| {
                        let name = if !risk.name.is_empty() {
                            risk.name.clone()
                        } else {
                            risk.key.clone()
                        };
                        (!name.is_empty()).then_some(name)
                    }));
                    TimedStage {
                        order: index as u32 + 1,
                        title: display_value(&mission.mission_type, &mission.mission_type_key, ""),
                        node: None,
                        detail: Some(display_value(&mission.faction, &mission.faction_key, "")),
                        modifiers,
                        enemy_levels: vec![],
                        standing_stages: vec![],
                        min_mr: None,
                        time_bound: None,
                    }
                })
                .collect::<Vec<_>>();
            let subtitle = joined_nonempty(personal);
            let fallback_id = format!(
                "archimedea:{}:{}",
                variant.as_deref().unwrap_or("unknown"),
                activation
                    .expect("active window has activation")
                    .timestamp()
            );
            Some(TimedContent {
                id: if item.id.is_empty() {
                    fallback_id
                } else {
                    item.id
                },
                kind: "archimedea".to_string(),
                variant,
                title,
                subtitle,
                activation,
                expiry,
                availability: TimedAvailability::Available,
                stages,
            })
        })
        .collect()
}

fn condition_name(condition: &RawCondition) -> String {
    if !condition.name.is_empty() {
        condition.name.clone()
    } else if !condition.key.is_empty() {
        condition.key.clone()
    } else {
        condition.description.clone()
    }
}

fn parse_wfcd_json(body: &str, now: DateTime<Utc>) -> Result<WfcdTimedContent, String> {
    let raw: RawWfcdWorldstate =
        serde_json::from_str(body).map_err(|error| format!("WFCD JSON: {error}"))?;
    let (syndicates, area_missions) = syndicate_cards(raw.syndicate_missions, now);
    Ok(WfcdTimedContent {
        sortie: raw
            .sortie
            .and_then(|item| sortie_card(item, now, false))
            .into_iter()
            .collect(),
        archon: raw
            .archon_hunt
            .and_then(|item| sortie_card(item, now, true))
            .into_iter()
            .collect(),
        syndicates,
        area_missions,
        archimedea: archimedea_cards(raw.archimedeas, now),
    })
}

fn mongo_date(value: &Value) -> Option<DateTime<Utc>> {
    let millis = value
        .pointer("/$date/$numberLong")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<i64>().ok())
        .or_else(|| value.get("$date").and_then(Value::as_i64))?;
    DateTime::from_timestamp_millis(millis)
}

fn parse_descents_json(body: &str, now: DateTime<Utc>) -> Result<Vec<TimedContent>, String> {
    let raw: RawDeWorldstate =
        serde_json::from_str(body).map_err(|error| format!("DE worldstate JSON: {error}"))?;
    Ok(raw
        .descents
        .into_iter()
        .filter_map(|mut descent| {
            let activation = mongo_date(&descent.activation);
            let expiry = mongo_date(&descent.expiry);
            if !active_window(activation, expiry, now) {
                return None;
            }
            descent.challenges.sort_by_key(|challenge| challenge.index);
            let stages = descent
                .challenges
                .into_iter()
                .map(|challenge| TimedStage {
                    order: challenge.index,
                    title: humanize_identifier(
                        challenge
                            .challenge_type
                            .strip_prefix("DT_")
                            .unwrap_or(&challenge.challenge_type),
                    ),
                    node: level_name(&challenge.level),
                    detail: (!challenge.challenge.is_empty())
                        .then(|| humanize_identifier(&challenge.challenge)),
                    modifiers: vec![],
                    enemy_levels: vec![],
                    standing_stages: vec![],
                    min_mr: None,
                    time_bound: None,
                })
                .collect::<Vec<_>>();
            Some(TimedContent {
                id: format!(
                    "descendia:{}:{}",
                    activation
                        .expect("active window has activation")
                        .timestamp(),
                    descent.rand_seed
                ),
                kind: "descendia".to_string(),
                variant: None,
                title: "Descendia".to_string(),
                subtitle: None,
                activation,
                expiry,
                availability: TimedAvailability::Available,
                stages,
            })
        })
        .collect())
}

fn level_name(value: &str) -> Option<String> {
    let name = value.rsplit('/').next()?.trim_end_matches(".level");
    (!name.is_empty()).then(|| humanize_identifier(name))
}

fn humanize_identifier(value: &str) -> String {
    let characters: Vec<char> = value.chars().collect();
    let mut words = vec![];
    let mut current = String::new();
    for (index, character) in characters.iter().copied().enumerate() {
        if character == '_' || character == '-' || character.is_whitespace() {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            continue;
        }
        let previous = index
            .checked_sub(1)
            .and_then(|i| characters.get(i))
            .copied();
        let next = characters.get(index + 1).copied();
        let starts_word = character.is_ascii_uppercase()
            && !current.is_empty()
            && (previous.is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
                || (previous.is_some_and(|c| c.is_ascii_uppercase())
                    && next.is_some_and(|c| c.is_ascii_lowercase())));
        if starts_word {
            words.push(std::mem::take(&mut current));
        }
        current.push(character);
    }
    if !current.is_empty() {
        words.push(current);
    }

    words
        .into_iter()
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            if lower == "presure" {
                return "Pressure".to_string();
            }
            let mut chars = lower.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

async fn fetch_body(client: &reqwest::Client, url: &str) -> Result<String, String> {
    client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("{url}: {error}"))?
        .error_for_status()
        .map_err(|error| format!("{url}: {error}"))?
        .text()
        .await
        .map_err(|error| format!("{url}: {error}"))
}

async fn poll_sources(
    client: &reqwest::Client,
) -> (
    DateTime<Utc>,
    Result<WfcdTimedContent, String>,
    Result<Vec<TimedContent>, String>,
) {
    let (wfcd, descents) = tokio::join!(
        fetch_body(client, WFCD_WORLDSTATE_URL),
        fetch_body(client, DE_WORLDSTATE_URL)
    );
    // 通信が日次/週次境界を跨いでも、取得後の同一instantでactive windowを選ぶ。
    let now = Utc::now();
    (
        now,
        wfcd.and_then(|body| parse_wfcd_json(&body, now)),
        descents.and_then(|body| parse_descents_json(&body, now)),
    )
}

/// Timed-content polling is deliberately independent from the fissure loop:
/// one source can fail without changing the other source or fissure freshness.
pub async fn run(app: AppHandle, state: Arc<Mutex<PollerState>>) {
    let client = crate::poller::http_client();
    loop {
        let (now, wfcd, descents) = poll_sources(&client).await;
        let snapshot = {
            let mut state = state.lock().expect("poller state");
            state.reset_daily_counters(now.with_timezone(&chrono::Local));
            state.snapshot.timed_content.apply_poll(now, wfcd, descents);
            state.bump_revision();
            state.snapshot.clone()
        };
        let _ = app.emit("status", &snapshot);
        tokio::time::sleep(StdDuration::from_secs(TIMED_POLL_SECS)).await;
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone, Utc};
    use serde_json::json;

    use super::*;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 7, 17, 16, 30, 0).unwrap()
    }

    fn card(id: &str) -> TimedContent {
        TimedContent {
            id: id.to_string(),
            kind: "sortie".to_string(),
            variant: None,
            title: "Sortie".to_string(),
            subtitle: None,
            activation: Some(now()),
            expiry: Some(now() + Duration::hours(1)),
            availability: TimedAvailability::Available,
            stages: vec![],
        }
    }

    #[test]
    fn timed_snapshot_serializes_stable_camel_case_shape() {
        let snapshot = TimedContentSnapshot {
            area_missions: vec![TimedContent {
                kind: "area-mission".to_string(),
                availability: TimedAvailability::Available,
                stages: vec![TimedStage {
                    order: 1,
                    title: "Bounty".to_string(),
                    node: None,
                    detail: None,
                    modifiers: vec![],
                    enemy_levels: vec![],
                    standing_stages: vec![],
                    min_mr: None,
                    time_bound: None,
                }],
                ..card("area-1")
            }],
            wfcd_ok: true,
            last_poll: Some(now()),
            ..TimedContentSnapshot::default()
        };
        let value = serde_json::to_value(snapshot).unwrap();
        assert!(value.get("areaMissions").is_some());
        assert!(value.get("area_missions").is_none());
        assert!(value.get("arbitration").is_none());
        assert!(value.get("netracells").is_none());
        assert_eq!(value["wfcdOk"], true);
        assert_eq!(value["wfcdError"], Value::Null);
        assert_eq!(value["lastPoll"], "2026-07-17T16:30:00Z");
        assert_eq!(value["areaMissions"][0]["availability"], "available");
        assert_eq!(value["areaMissions"][0]["kind"], "area-mission");
        assert_eq!(value["areaMissions"][0]["stages"][0]["node"], Value::Null);

        let status = serde_json::to_value(crate::poller::StatusSnapshot::default()).unwrap();
        assert!(status.get("timedContent").is_some());
        assert!(status.get("timed_content").is_none());
    }

    #[test]
    fn wfcd_fixture_splits_sources_and_classifies_archimedea() {
        let fixture = json!({
            "sortie": {
                "id": "sortie-1", "activation": "2026-07-17T16:00:00Z",
                "expiry": "2026-07-18T16:00:00Z", "rewardPool": "Sortie Rewards",
                "boss": "Lephantis", "faction": "Infestation", "factionKey": "Infestation",
                "variants": [{"missionType":"Survival", "missionTypeKey":"Survival",
                    "modifier":"Energy Reduction", "modifierDescription":"Low energy",
                    "node":"Nabuk (Kuva Fortress)", "nodeKey":"Nabuk (Kuva Fortress)"}]
            },
            "archonHunt": {
                "id": "archon-1", "activation": "2026-07-13T00:00:00Z",
                "expiry": "2026-07-20T00:00:00Z", "boss": "Archon Nira",
                "faction": "Narmer", "factionKey": "Narmer",
                "missions": [{"node":"Metis (Jupiter)", "nodeKey":"Metis (Jupiter)",
                    "type":"Mobile Defense", "typeKey":"Mobile Defense"}]
            },
            "syndicateMissions": [{
                "id": "synd-1", "activation": "2026-07-17T16:00:00Z",
                "expiry": "2026-07-18T16:00:00Z", "syndicate": "Ostrons",
                "syndicateKey": "Ostrons", "nodes": ["Ares (Mars)"],
                "jobs": [{"id":"job-1", "type":"Capture", "enemyLevels":[5,15],
                    "standingStages":[100,200], "minMR":2, "timeBound":"day"}]
            }],
            "archimedeas": [
                {"id":"deep-1", "activation":"2026-07-13T00:00:00Z",
                    "expiry":"2026-07-20T00:00:00Z", "type":"C T_ L A B",
                    "typeKey":"C T_ L A B", "missions":[], "personalModifiers":[]},
                {"id":"temporal-1", "activation":"2026-07-13T00:00:00Z",
                    "expiry":"2026-07-20T00:00:00Z", "type":"C T_ H E X",
                    "typeKey":"C T_ H E X", "missions":[], "personalModifiers":[]}
            ]
        });
        let parsed = parse_wfcd_json(&fixture.to_string(), now()).unwrap();
        assert_eq!(parsed.sortie[0].stages[0].title, "Survival");
        assert_eq!(
            parsed.archon[0].stages[0].node.as_deref(),
            Some("Metis (Jupiter)")
        );
        assert_eq!(parsed.syndicates.len(), 1);
        assert_eq!(parsed.area_missions.len(), 1);
        assert_eq!(parsed.area_missions[0].kind, "area-mission");
        assert_eq!(parsed.area_missions[0].stages[0].enemy_levels, vec![5, 15]);
        assert_eq!(
            parsed.area_missions[0].stages[0].standing_stages,
            vec![100, 200]
        );
        assert_eq!(parsed.area_missions[0].stages[0].min_mr, Some(2));
        assert_eq!(
            parsed.area_missions[0].stages[0].time_bound.as_deref(),
            Some("day")
        );
        assert_eq!(parsed.archimedea[0].variant.as_deref(), Some("deep"));
        assert_eq!(parsed.archimedea[1].variant.as_deref(), Some("temporal"));
    }

    #[test]
    fn de_fixture_selects_only_active_week_and_keeps_21_readable_challenges() {
        let challenges = (1..=21)
            .map(|index| {
                json!({
                    "Index": index,
                    "Type": if index == 1 { "DT_PRESURE_GAUGE" } else { "DT_EXTERMINATE" },
                    "Challenge": if index == 1 { "RocketsOnly" } else { "JadeGuardian" },
                    "Level": "/Lotus/Levels/DevilTower/ArenaAvocado.level",
                    "Specs": [], "Auras": []
                })
            })
            .collect::<Vec<_>>();
        let fixture = json!({"Descents": [
            {"Activation":{"$date":{"$numberLong":"1783296000000"}},
             "Expiry":{"$date":{"$numberLong":"1783900800000"}},
             "RandSeed":1, "Challenges":[]},
            {"Activation":{"$date":{"$numberLong":"1783900800000"}},
             "Expiry":{"$date":{"$numberLong":"1784505600000"}},
             "RandSeed":2, "Challenges":challenges}
        ]});
        let parsed = parse_descents_json(&fixture.to_string(), now()).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].stages.len(), 21);
        assert_eq!(parsed[0].stages[0].title, "Pressure Gauge");
        assert_eq!(parsed[0].stages[0].detail.as_deref(), Some("Rockets Only"));
        assert_eq!(parsed[0].stages[0].node.as_deref(), Some("Arena Avocado"));
    }

    #[test]
    fn partial_failure_retains_last_valid_source_and_updates_other_source() {
        let mut snapshot = TimedContentSnapshot {
            sortie: vec![card("old-sortie")],
            descendia: vec![card("old-descendia")],
            wfcd_ok: true,
            descents_ok: true,
            ..TimedContentSnapshot::default()
        };
        snapshot.apply_poll(
            now(),
            Err("WFCD down".to_string()),
            Ok(vec![card("new-descendia")]),
        );
        assert_eq!(snapshot.sortie[0].id, "old-sortie");
        assert_eq!(snapshot.descendia[0].id, "new-descendia");
        assert!(!snapshot.wfcd_ok);
        assert_eq!(snapshot.wfcd_error.as_deref(), Some("WFCD down"));
        assert!(snapshot.descents_ok);
    }

    #[test]
    fn missing_source_roots_are_schema_errors_not_empty_successes() {
        assert!(parse_wfcd_json("{}", now()).is_err());
        assert!(parse_descents_json("{}", now()).is_err());
    }
}
