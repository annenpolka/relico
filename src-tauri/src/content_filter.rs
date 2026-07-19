//! 時限コンテンツ(仲裁・エリア等)監視ルールの純粋な合致・通知選択ロジック。
//! 副作用(時刻取得・HTTP・通知発火)を持ち込まない。オラクルの直接対象。
//! SPEC: CNT-001..004

use crate::config::ContentWatchRule;
use crate::dedup::NotifiedSet;
use crate::palette;
use crate::timed::TimedContent;

/// キーワードをパレットのミッション語彙(label/alias、大文字小文字無視)で正準化する。
/// 一致しない未知キーワードはtrimしたrawのまま使う。SPEC: CNT-004
pub fn canonical_keyword(keyword: &str) -> String {
    let trimmed = keyword.trim();
    let lowered = trimmed.to_lowercase();
    for (label, aliases) in palette::mission_vocabulary() {
        if label.to_lowercase() == lowered
            || aliases.iter().any(|alias| alias.to_lowercase() == lowered)
        {
            return label.to_string();
        }
    }
    trimmed.to_string()
}

fn keyword_hits_stage(stage: &crate::timed::TimedStage, keyword: &str) -> bool {
    let canonical = canonical_keyword(keyword).to_lowercase();
    if canonical.is_empty() {
        return true;
    }
    stage.title.to_lowercase().contains(&canonical)
        || stage
            .choices
            .iter()
            .any(|choice| choice.to_lowercase().contains(&canonical))
}

fn level_hits_stage(stage: &crate::timed::TimedStage, min_enemy_level: Option<u32>) -> bool {
    match min_enemy_level {
        None => true,
        // enemy levelを持たないstageへレベル条件は合致しない(レベルを捏造しない)
        Some(threshold) => stage
            .enemy_levels
            .iter()
            .min()
            .is_some_and(|minimum| *minimum >= threshold),
    }
}

/// ルール単体の合致。kindsが空なら全kind。missionTypes/minEnemyLevelのどちらかを
/// 指定したら「両条件を同時に満たすstageが1つ以上ある」ことを要求する。SPEC: CNT-001
pub fn rule_matches(rule: &ContentWatchRule, card: &TimedContent) -> bool {
    if !rule.kinds.is_empty() && !rule.kinds.iter().any(|kind| kind == &card.kind) {
        return false;
    }
    let stage_conditions = !rule.mission_types.is_empty() || rule.min_enemy_level.is_some();
    if !stage_conditions {
        return true;
    }
    card.stages.iter().any(|stage| {
        (rule.mission_types.is_empty()
            || rule
                .mission_types
                .iter()
                .any(|keyword| keyword_hits_stage(stage, keyword)))
            && level_hits_stage(stage, rule.min_enemy_level)
    })
}

/// notify=trueのルールのORに合致するcardをcard id単位で1件に重複排除して返す。
pub fn matching_cards<'a>(
    rules: &[ContentWatchRule],
    cards: impl Iterator<Item = &'a TimedContent>,
) -> Vec<&'a TimedContent> {
    let mut seen = std::collections::HashSet::new();
    cards
        .filter(|card| {
            rules
                .iter()
                .any(|rule| rule.notify && rule_matches(rule, card))
        })
        .filter(|card| seen.insert(card.id.clone()))
        .collect()
}

/// 合致card(expiry必須)を通知済みへmarkし、通常評価では新規idだけを配送対象へ返す。
/// seed評価・ミュート評価はmarkのみで配送しない。SPEC: CNT-002
pub fn select_content_notifications(
    notified: &mut NotifiedSet,
    matching: Vec<TimedContent>,
    seed_only: bool,
    muted: bool,
) -> Vec<TimedContent> {
    let fresh: Vec<TimedContent> = matching
        .into_iter()
        .filter(|card| {
            let Some(expiry) = card.expiry else {
                return false;
            };
            notified.mark(&card.id, expiry)
        })
        .collect();
    if seed_only || muted {
        Vec::new()
    } else {
        fresh
    }
}

/// 通知範囲のprojection: notify=trueルールを元の順序で保持し、名前を落とし
/// キーワードを正準化する。SPEC: CNT-003
pub fn content_projection(rules: &[ContentWatchRule]) -> Vec<ContentWatchRule> {
    rules
        .iter()
        .filter(|rule| rule.notify)
        .map(|rule| ContentWatchRule {
            notify: true,
            name: None,
            kinds: rule.kinds.clone(),
            mission_types: rule
                .mission_types
                .iter()
                .map(|keyword| canonical_keyword(keyword))
                .collect(),
            min_enemy_level: rule.min_enemy_level,
        })
        .collect()
}

/// 初回評価またはprojection変更後はsilent seedの対象。SPEC: CNT-003
pub fn content_scope_changed(
    previous: Option<&Vec<ContentWatchRule>>,
    current: &[ContentWatchRule],
) -> bool {
    match previous {
        None => true,
        Some(previous) => *previous != content_projection(current),
    }
}
