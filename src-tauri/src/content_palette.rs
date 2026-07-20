//! タブ別コンテンツピッカー: 亀裂以外のコンテンツタブでパレットが出す候補カタログと、
//! contentRulesへの適用。純粋関数のみでオラクルの直接対象。
//! SPEC: CPL-001..003

use crate::config::ContentWatchRule;
use crate::content_filter::canonical_keyword;
use crate::palette::{self, Candidate, Facet};

/// コンテンツタブ→対象card kind群。RND-014のタブ別ルール管理と同じ集合
pub const TAB_KIND_GROUPS: &[(&str, &[&str])] = &[
    ("arbitration", &["arbitration"]),
    ("sortie", &["sortie"]),
    ("archon", &["archon"]),
    ("syndicates", &["syndicate"]),
    ("area-missions", &["area-mission", "area-objective", "bounty"]),
    ("circuit", &["circuit"]),
    ("archimedea", &["archimedea"]),
    ("descendia", &["descendia"]),
];

pub fn tab_kind_group(tab: &str) -> Option<&'static [&'static str]> {
    TAB_KIND_GROUPS
        .iter()
        .find(|(candidate, _)| *candidate == tab)
        .map(|(_, group)| *group)
}

/// レベル下限プリセット。任意値はクエリの数字から動的候補になる
pub const LEVEL_PRESETS: &[u32] = &[30, 60, 100, 150, 200];

fn intersects(rule: &ContentWatchRule, group: &[&str]) -> bool {
    rule.kinds.iter().any(|kind| group.contains(&kind.as_str()))
}

/// タブの行に表示されるルール(kinds未指定の「すべて」ルールを含む)のindex列。
/// RND-014のtabAlertEntriesと同じ集合
pub fn tab_visible_indices(rules: &[ContentWatchRule], group: &[&str]) -> Vec<usize> {
    rules
        .iter()
        .enumerate()
        .filter(|(_, rule)| rule.kinds.is_empty() || intersects(rule, group))
        .map(|(index, _)| index)
        .collect()
}

/// 条件編集の編集先: タブ専用(kinds非空かつ交差)ルールの末尾。
/// kinds未指定の全タブ共通ルールは他タブへ波及するため編集先にしない
pub fn content_target(rules: &[ContentWatchRule], group: &[&str]) -> Option<usize> {
    rules
        .iter()
        .enumerate()
        .rev()
        .find(|(_, rule)| !rule.kinds.is_empty() && intersects(rule, group))
        .map(|(index, _)| index)
}

/// NEW ALERT直後の安全な空draft(通知OFF・条件なし)。nameは判定に関与しない
fn is_empty_content_draft(rule: &ContentWatchRule) -> bool {
    !rule.notify && rule.mission_types.is_empty() && rule.min_enemy_level.is_none()
}

/// 行・候補表示用の要約("Survival+防衛 / LV60+"風)
pub fn content_rule_summary(rule: &ContentWatchRule) -> String {
    let mut parts: Vec<String> = vec![];
    if rule.kinds.is_empty() {
        parts.push("ALL TABS".to_string());
    }
    parts.push(if rule.mission_types.is_empty() {
        "ALL".to_string()
    } else {
        rule.mission_types.join("+")
    });
    if let Some(level) = rule.min_enemy_level {
        parts.push(format!("LV{level}+"));
    }
    parts.join(" / ")
}

fn owned(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

/// タブ用の候補カタログ。共有アクション(GO TO/PAUSE)は亀裂カタログから引き継ぎ、
/// クエリから動的なレベル下限・rawキーワード候補を加える。未知タブは空。SPEC: CPL-001
pub fn catalog(tab: &str, rules: &[ContentWatchRule], query: &str) -> Vec<Candidate> {
    let Some(group) = tab_kind_group(tab) else {
        return vec![];
    };
    let mut out = vec![];
    for (mission, aliases) in palette::mission_vocabulary() {
        out.push(Candidate {
            id: format!("ckeyword:{mission}"),
            label: mission.to_string(),
            value: mission.to_string(),
            aliases: owned(aliases),
            facet: Facet::Mission,
        });
    }
    for preset in LEVEL_PRESETS {
        out.push(Candidate {
            id: format!("clevel:{preset}"),
            label: format!("MIN LV {preset}+"),
            value: preset.to_string(),
            aliases: owned(&["レベル", "レベル下限", "lv", "level", "reberu"]),
            facet: Facet::Action,
        });
    }
    out.push(Candidate {
        id: "clevel:off".to_string(),
        label: "NO LV LIMIT".to_string(),
        value: "off".to_string(),
        aliases: owned(&["レベル解除", "レベル下限なし", "lv off", "level off", "reberu kaijo"]),
        facet: Facet::Action,
    });

    // 動的候補: クエリの数字はレベル下限、語彙に解決しない非数字クエリはrawキーワード
    let trimmed = query.trim();
    let digits: String = trimmed.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if let Ok(level) = digits.parse::<u32>() {
        if (1..=9999).contains(&level) && !LEVEL_PRESETS.contains(&level) {
            out.push(Candidate {
                id: format!("clevel:{level}"),
                label: format!("MIN LV {level}+"),
                value: level.to_string(),
                aliases: vec![trimmed.to_string()],
                facet: Facet::Action,
            });
        }
    }
    if !trimmed.is_empty() && digits != trimmed {
        let canonical = canonical_keyword(trimmed);
        let vocabulary_hit = palette::mission_vocabulary().any(|(label, _)| label == canonical);
        if !vocabulary_hit {
            out.push(Candidate {
                id: format!("ckeyword:{trimmed}"),
                label: format!("KEYWORD \"{trimmed}\""),
                value: trimmed.to_string(),
                aliases: vec![trimmed.to_string()],
                facet: Facet::Mission,
            });
        }
    }

    for index in tab_visible_indices(rules, group) {
        let rule = &rules[index];
        let fallback = format!("A{}", index + 1);
        let mut aliases = vec![
            "alert".to_string(),
            "アラート".to_string(),
            content_rule_summary(rule),
        ];
        if rule.name.is_some() {
            aliases.push(fallback.clone());
        }
        out.push(Candidate {
            id: format!("crule:{index}"),
            // 名前未設定でも条件を判別できるよう「A{n}: 要約」を表示する。SPEC: CPL-001
            label: rule
                .name
                .clone()
                .unwrap_or_else(|| format!("{fallback}: {}", content_rule_summary(rule))),
            value: index.to_string(),
            aliases,
            facet: Facet::Rule,
        });
    }
    for (label, value, aliases) in [
        (
            "NEW ALERT",
            "new-content-rule",
            vec!["新規アラート", "通知追加", "alert", "arato", "shinki", ";"],
        ),
        (
            "DELETE ALERT",
            "delete-content-rule",
            vec!["アラート削除", "通知削除", "delalert", "sakujo"],
        ),
    ] {
        out.push(Candidate {
            id: format!("caction:{value}"),
            label: label.to_string(),
            value: value.to_string(),
            aliases: aliases.into_iter().map(String::from).collect(),
            facet: Facet::Action,
        });
    }
    // 共有アクション: タブ切替・PAUSE・RELOADを亀裂カタログから引き継ぐ(SORT・亀裂ルール操作は除外)
    out.extend(palette::catalog().into_iter().filter(|cand| {
        cand.facet == Facet::Action
            && (cand.value == "pause" || cand.value == "reload" || cand.value.starts_with("tab-"))
    }));
    out
}

/// 候補のon状態(編集先ルール基準。crule候補は対象ルールのnotify)
pub fn candidate_on(rules: &[ContentWatchRule], group: &[&str], cand: &Candidate) -> bool {
    let target = content_target(rules, group).map(|index| &rules[index]);
    if let Some(raw) = cand.id.strip_prefix("ckeyword:") {
        let canonical = canonical_keyword(raw);
        return target.is_some_and(|rule| {
            rule.mission_types
                .iter()
                .any(|keyword| canonical_keyword(keyword) == canonical)
        });
    }
    if cand.id == "clevel:off" {
        return target.is_some_and(|rule| rule.min_enemy_level.is_none());
    }
    if let Some(level) = cand
        .id
        .strip_prefix("clevel:")
        .and_then(|value| value.parse::<u32>().ok())
    {
        return target.is_some_and(|rule| rule.min_enemy_level == Some(level));
    }
    if let Some(index) = cand
        .id
        .strip_prefix("crule:")
        .and_then(|value| value.parse::<usize>().ok())
    {
        return rules.get(index).is_some_and(|rule| rule.notify);
    }
    false
}

/// 条件適用の編集先を確定する。タブ専用ルールがなければ通知ONの新ルールを末尾へ作り、
/// NEW ALERT直後の空draftは通知ONへ確定して再利用する。SPEC: CPL-003
fn ensure_target(rules: &mut Vec<ContentWatchRule>, group: &[&str]) -> usize {
    match content_target(rules, group) {
        Some(index) => {
            if is_empty_content_draft(&rules[index]) {
                rules[index].notify = true;
            }
            index
        }
        None => {
            rules.push(ContentWatchRule {
                notify: true,
                name: None,
                kinds: owned(group),
                mission_types: vec![],
                min_enemy_level: None,
            });
            rules.len() - 1
        }
    }
}

/// コンテンツ候補idを適用する。適用できないidはfalse(unknown candidate)。SPEC: CPL-002/003
pub fn apply(rules: &mut Vec<ContentWatchRule>, group: &[&str], id: &str) -> bool {
    if let Some(raw) = id.strip_prefix("ckeyword:") {
        let canonical = canonical_keyword(raw);
        if canonical.is_empty() {
            return false;
        }
        let target = ensure_target(rules, group);
        let keywords = &mut rules[target].mission_types;
        let before = keywords.len();
        keywords.retain(|keyword| canonical_keyword(keyword) != canonical);
        if keywords.len() == before {
            keywords.push(canonical);
        }
        return true;
    }
    if id == "clevel:off" {
        if let Some(index) = content_target(rules, group) {
            rules[index].min_enemy_level = None;
        }
        return true;
    }
    if let Some(level) = id
        .strip_prefix("clevel:")
        .and_then(|value| value.parse::<u32>().ok())
    {
        let target = ensure_target(rules, group);
        let rule = &mut rules[target];
        rule.min_enemy_level = if rule.min_enemy_level == Some(level) {
            None
        } else {
            Some(level)
        };
        return true;
    }
    if let Some(value) = id.strip_prefix("crule:") {
        let Some(rule) = value
            .parse::<usize>()
            .ok()
            .and_then(|index| rules.get_mut(index))
        else {
            return false;
        };
        rule.notify = !rule.notify;
        return true;
    }
    match id {
        "caction:new-content-rule" => {
            rules.push(ContentWatchRule {
                notify: false,
                name: None,
                kinds: owned(group),
                mission_types: vec![],
                min_enemy_level: None,
            });
            true
        }
        "caction:delete-content-rule" => {
            if let Some(index) = content_target(rules, group) {
                rules.remove(index);
            }
            true
        }
        _ => false,
    }
}

/// コンテンツ候補のid(タブ文脈が必要な適用)か
pub fn is_content_candidate_id(id: &str) -> bool {
    ["ckeyword:", "clevel:", "crule:", "caction:"]
        .iter()
        .any(|prefix| id.starts_with(prefix))
}
