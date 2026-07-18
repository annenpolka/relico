use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;

use super::{
    TimedContent, TimedProvenance, TimedSourceError, TimedSourceId, TimedSourceKind, TimedStage,
    TimedTemporalStatus,
};

const DE_SOURCE_URL: &str = "https://api.warframe.com/cdn/worldState.php";

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
    #[serde(rename = "Specs")]
    specs: Vec<String>,
    #[serde(rename = "Auras")]
    auras: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct RawCircuitSchedule {
    #[serde(rename = "Activation")]
    activation: Value,
    #[serde(rename = "Expiry")]
    expiry: Value,
    #[serde(rename = "CategoryChoices")]
    category_choices: Vec<RawCircuitCategory>,
}

#[derive(Debug, Deserialize)]
struct RawCircuitCategory {
    #[serde(rename = "Category")]
    category: String,
    #[serde(rename = "Choices")]
    choices: Vec<String>,
}

fn mongo_date(value: &Value) -> Option<DateTime<Utc>> {
    let millis = value
        .pointer("/$date/$numberLong")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<i64>().ok())
        .or_else(|| value.get("$date").and_then(Value::as_i64))?;
    DateTime::from_timestamp_millis(millis)
}

fn root_array<T: for<'de> Deserialize<'de>>(
    body: &str,
    field: &str,
) -> Result<Vec<T>, TimedSourceError> {
    let value: Value = serde_json::from_str(body)
        .map_err(|error| TimedSourceError::failed(format!("DE worldstate JSON: {error}")))?;
    let raw = value
        .get(field)
        .cloned()
        .ok_or_else(|| TimedSourceError::failed(format!("DE worldstate missing {field}")))?;
    serde_json::from_value(raw)
        .map_err(|error| TimedSourceError::failed(format!("DE {field} JSON: {error}")))
}

fn provenance() -> TimedProvenance {
    TimedProvenance {
        kind: TimedSourceKind::OfficialLive,
        contributors: vec![TimedSourceId::DeWorldstate],
    }
}

fn validate_window(
    activation: DateTime<Utc>,
    expiry: DateTime<Utc>,
    field: &str,
) -> Result<(), TimedSourceError> {
    if activation >= expiry {
        return Err(TimedSourceError::failed(format!(
            "DE {field} activation must precede expiry"
        )));
    }
    Ok(())
}

fn require_text(value: &str, field: &str) -> Result<(), TimedSourceError> {
    if value.trim().is_empty() {
        return Err(TimedSourceError::failed(format!("DE {field} is empty")));
    }
    Ok(())
}

fn source_card(
    id: String,
    kind: &str,
    title: &str,
    activation: DateTime<Utc>,
    expiry: DateTime<Utc>,
    temporal_status: TimedTemporalStatus,
    stages: Vec<TimedStage>,
) -> TimedContent {
    TimedContent {
        id,
        kind: kind.to_string(),
        variant: None,
        title: title.to_string(),
        subtitle: None,
        activation: Some(activation),
        expiry: Some(expiry),
        temporal_status,
        provenance: provenance(),
        source_id: TimedSourceId::DeWorldstate,
        source_name: "Digital Extremes World State".to_string(),
        source_url: Some(DE_SOURCE_URL.to_string()),
        metadata: vec![],
        personal_modifiers: vec![],
        stages,
    }
}

pub fn parse_descents_json(
    body: &str,
    now: DateTime<Utc>,
) -> Result<Vec<TimedContent>, TimedSourceError> {
    let mut cards = vec![];
    for mut descent in root_array::<RawDescent>(body, "Descents")? {
        let activation = mongo_date(&descent.activation)
            .ok_or_else(|| TimedSourceError::failed("Descents activation is invalid"))?;
        let expiry = mongo_date(&descent.expiry)
            .ok_or_else(|| TimedSourceError::failed("Descents expiry is invalid"))?;
        validate_window(activation, expiry, "Descents[]")?;
        if expiry <= now {
            continue;
        }
        if descent.challenges.is_empty() {
            return Err(TimedSourceError::failed(
                "DE Descents[] contains no Challenges",
            ));
        }
        let mut indexes = BTreeSet::new();
        for challenge in &descent.challenges {
            if !indexes.insert(challenge.index) {
                return Err(TimedSourceError::failed(format!(
                    "DE Descents[] contains duplicate Challenge Index {}",
                    challenge.index
                )));
            }
            require_text(&challenge.challenge_type, "Descents[].Challenges[].Type")?;
            require_text(&challenge.challenge, "Descents[].Challenges[].Challenge")?;
            require_text(&challenge.level, "Descents[].Challenges[].Level")?;
            if challenge.specs.iter().any(|value| value.trim().is_empty())
                || challenge.auras.iter().any(|value| value.trim().is_empty())
            {
                return Err(TimedSourceError::failed(
                    "DE Descents[] contains an empty Specs/Auras identifier",
                ));
            }
        }
        descent.challenges.sort_by_key(|challenge| challenge.index);
        let stages = descent
            .challenges
            .into_iter()
            .map(|challenge| {
                let mut stage = TimedStage::new(
                    challenge.index,
                    humanize_identifier(
                        challenge
                            .challenge_type
                            .strip_prefix("DT_")
                            .unwrap_or(&challenge.challenge_type),
                    ),
                );
                stage.node = level_name(&challenge.level);
                stage.detail = (!challenge.challenge.is_empty())
                    .then(|| humanize_identifier(&challenge.challenge));
                stage.specs = challenge.specs;
                stage.auras = challenge.auras;
                stage
            })
            .collect();
        let temporal_status = if activation <= now {
            TimedTemporalStatus::Active
        } else {
            TimedTemporalStatus::Upcoming
        };
        cards.push(source_card(
            format!("descendia:{}:{}", activation.timestamp(), descent.rand_seed),
            "descendia",
            "Descendia",
            activation,
            expiry,
            temporal_status,
            stages,
        ));
    }
    cards.sort_by_key(|card| card.activation);
    if cards.is_empty() {
        return Err(TimedSourceError::failed(
            "DE Descents contains no unexpired schedules",
        ));
    }
    Ok(cards)
}

pub fn parse_circuit_json(
    body: &str,
    now: DateTime<Utc>,
) -> Result<Vec<TimedContent>, TimedSourceError> {
    let schedules = root_array::<RawCircuitSchedule>(body, "EndlessXpSchedule")?;
    let mut cards = vec![];
    for schedule in schedules {
        let activation = mongo_date(&schedule.activation)
            .ok_or_else(|| TimedSourceError::failed("Circuit activation is invalid"))?;
        let expiry = mongo_date(&schedule.expiry)
            .ok_or_else(|| TimedSourceError::failed("Circuit expiry is invalid"))?;
        validate_window(activation, expiry, "EndlessXpSchedule[]")?;
        if activation > now || expiry <= now {
            continue;
        }
        let mut normal = None;
        let mut hard = None;
        for category in schedule.category_choices {
            match category.category.as_str() {
                "EXC_NORMAL" if normal.is_none() => normal = Some(category.choices),
                "EXC_HARD" if hard.is_none() => hard = Some(category.choices),
                "EXC_NORMAL" | "EXC_HARD" => {
                    return Err(TimedSourceError::failed(format!(
                        "duplicate Circuit category {}",
                        category.category
                    )));
                }
                _ => {}
            }
        }
        let normal = normal
            .filter(|choices| choices.len() == 3)
            .ok_or_else(|| TimedSourceError::failed("Circuit missing EXC_NORMAL choices"))?;
        let hard = hard
            .filter(|choices| choices.len() == 5)
            .ok_or_else(|| TimedSourceError::failed("Circuit missing EXC_HARD choices"))?;
        for (category, choices) in [("EXC_NORMAL", &normal), ("EXC_HARD", &hard)] {
            if choices.iter().any(|choice| choice.trim().is_empty())
                || choices.iter().collect::<BTreeSet<_>>().len() != choices.len()
            {
                return Err(TimedSourceError::failed(format!(
                    "Circuit {category} choices are empty or duplicated"
                )));
            }
        }
        let mut normal_stage = TimedStage::new(1, "Normal Circuit".to_string());
        normal_stage.choices = normal;
        let mut hard_stage = TimedStage::new(2, "Steel Path Circuit".to_string());
        hard_stage.choices = hard;
        cards.push(source_card(
            format!("circuit:{}", activation.timestamp()),
            "circuit",
            "Circuit",
            activation,
            expiry,
            TimedTemporalStatus::Active,
            vec![normal_stage, hard_stage],
        ));
    }
    cards.sort_by_key(|card| card.activation);
    if cards.len() != 1 {
        return Err(TimedSourceError::failed(format!(
            "DE EndlessXpSchedule must contain exactly one active schedule, found {}",
            cards.len()
        )));
    }
    Ok(cards)
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

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone};
    use serde_json::{json, Value};

    use super::*;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 7, 18, 0, 0, 0).unwrap()
    }

    fn mongo(value: DateTime<Utc>) -> Value {
        json!({"$date":{"$numberLong":value.timestamp_millis().to_string()}})
    }

    fn descent(activation: DateTime<Utc>, expiry: DateTime<Utc>) -> Value {
        json!({
            "Activation": mongo(activation),
            "Expiry": mongo(expiry),
            "RandSeed": 1,
            "Challenges": [{
                "Index": 1,
                "Type": "DT_EXTERMINATE",
                "Challenge": "JadeGuardian",
                "Level": "/Lotus/Levels/DevilTower/ArenaAvocado.level",
                "Specs": [],
                "Auras": []
            }]
        })
    }

    fn circuit(activation: DateTime<Utc>, expiry: DateTime<Utc>) -> Value {
        json!({
            "Activation": mongo(activation),
            "Expiry": mongo(expiry),
            "CategoryChoices": [
                {"Category":"EXC_NORMAL", "Choices":["FrameA", "FrameB", "FrameC"]},
                {"Category":"EXC_HARD", "Choices":["WeaponA", "WeaponB", "WeaponC", "WeaponD", "WeaponE"]}
            ]
        })
    }

    #[test]
    fn identifiers_are_humanized_without_losing_words() {
        assert_eq!(humanize_identifier("DT_SABOTAGE_HIVE"), "Dt Sabotage Hive");
        assert_eq!(
            humanize_identifier("FieryTrailRollers"),
            "Fiery Trail Rollers"
        );
        assert_eq!(humanize_identifier("PRESURE_GAUGE"), "Pressure Gauge");
    }

    #[test]
    fn descents_rejects_an_empty_or_fully_expired_schedule() {
        let empty = json!({"Descents": []});
        assert!(parse_descents_json(&empty.to_string(), now()).is_err());

        let expired = json!({
            "Descents": [descent(now() - Duration::days(2), now() - Duration::days(1))]
        });
        assert!(parse_descents_json(&expired.to_string(), now()).is_err());
    }

    #[test]
    fn circuit_requires_exactly_one_active_schedule() {
        let empty = json!({"EndlessXpSchedule": []});
        assert!(parse_circuit_json(&empty.to_string(), now()).is_err());

        let active = circuit(now() - Duration::hours(1), now() + Duration::hours(1));
        let overlapping = json!({"EndlessXpSchedule": [active.clone(), active]});
        assert!(parse_circuit_json(&overlapping.to_string(), now()).is_err());
    }
}
