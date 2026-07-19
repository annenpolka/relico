//! ファジーパレット: 候補カタログ、fzf風スコアラ、ルールの充足可能性と上書き解決。
//! SPEC: FZY-001..004 / SAT-001 / EDT-001..002 / CLR-001

use serde::{Deserialize, Serialize};

use crate::filter::{Mode, StormMode, WatchRule, PROXIMA_PLANET_ALIASES};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Facet {
    Tier,
    Mission,
    Planet,
    Mode,
    Storm,
    Action,
    Rule,
}

#[derive(Debug, Clone)]
pub struct Candidate {
    pub id: String,
    pub label: String,
    /// 設定に保存される正規値(missionType文字列等)
    pub value: String,
    pub aliases: Vec<String>,
    pub facet: Facet,
}

pub const TIERS: &[&str] = &["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"];

// 日本語aliasは暫定(日本語クライアントの正式訳の確認が要る)。ローマ字・略語併記
const MISSIONS: &[(&str, &[&str])] = &[
    (
        "Survival",
        &["耐久", "生存", "taikyu", "taikyuu", "seizon", "surv"],
    ),
    ("Defense", &["防衛", "boei", "def"]),
    ("Mobile Defense", &["モバイル防衛", "md"]),
    ("Capture", &["確保", "kakuho", "cap"]),
    ("Extermination", &["掃滅", "soumetsu", "ext"]),
    ("Rescue", &["救出", "kyushutsu"]),
    ("Sabotage", &["妨害", "bougai", "sab"]),
    ("Spy", &["潜入", "sennyu"]),
    (
        "Disruption",
        &["分裂", "ディスラプション", "bunretsu", "kakuran", "dis"],
    ),
    ("Excavation", &["発掘", "hakkutsu", "exc"]),
    ("Interception", &["傍受", "boju", "int"]),
    ("Hijack", &["ハイジャック"]),
    ("Assault", &["アサルト"]),
    ("Defection", &["離反"]),
    ("Infested Salvage", &["感染回収"]),
    ("Hive", &["ハイブ"]),
    ("Alchemy", &["アルケミー", "alc"]),
    ("Void Flood", &["ボイドフラッド", "vf"]),
    ("Void Cascade", &["ボイドカスケード", "vc"]),
    ("Void Armageddon", &["ボイドアルマゲドン", "va"]),
    ("Volatile", &["ボラタイル", "vol"]),
    ("Skirmish", &["スカーミッシュ"]),
    ("Orphix", &["オルフィクス"]),
];

const PLANETS: &[(&str, &[&str])] = &[
    ("Mercury", &["水星", "suisei"]),
    ("Venus", &["金星", "kinsei"]),
    ("Earth", &["地球", "chikyu"]),
    ("Lua", &["ルア"]),
    ("Mars", &["火星", "kasei"]),
    ("Phobos", &["フォボス"]),
    ("Deimos", &["ダイモス"]),
    ("Ceres", &["ケレス", "seresu"]),
    ("Jupiter", &["木星", "mokusei"]),
    ("Europa", &["エウロパ"]),
    ("Saturn", &["土星", "dosei"]),
    ("Uranus", &["天王星", "tennousei"]),
    ("Neptune", &["海王星", "kaiousei"]),
    ("Pluto", &["冥王星", "meiousei"]),
    ("Sedna", &["セドナ", "sedona"]),
    ("Eris", &["エリス"]),
    ("Void", &["ボイド"]),
    ("Kuva Fortress", &["クバ要塞", "kuva"]),
    ("Zariman", &["ザリマン"]),
    ("Earth Proxima", &["地球プロキシマ"]),
    ("Venus Proxima", &["金星プロキシマ"]),
    ("Saturn Proxima", &["土星プロキシマ"]),
    ("Neptune Proxima", &["海王星プロキシマ"]),
    ("Pluto Proxima", &["冥王星プロキシマ"]),
    ("Veil Proxima", &["ヴェール", "veil"]),
];

/// content_filterのキーワード正準化が参照するミッション語彙(label + aliases)。
pub fn mission_vocabulary() -> impl Iterator<Item = (&'static str, &'static [&'static str])> {
    MISSIONS.iter().copied()
}

const RAILJACK_MISSIONS: &[&str] = &["Volatile", "Skirmish", "Orphix"];
const ZARIMAN_MISSIONS: &[&str] = &["Void Flood", "Void Cascade", "Void Armageddon"];

/// 全候補(パレットに出るもの)
pub fn catalog() -> Vec<Candidate> {
    let mut out = vec![];
    for t in TIERS {
        out.push(Candidate {
            id: format!("tier:{t}"),
            label: t.to_string(),
            value: t.to_string(),
            aliases: vec![],
            facet: Facet::Tier,
        });
    }
    for (label, value, aliases) in [
        (
            "NORMAL ONLY",
            "Normal",
            vec!["通常のみ", "tsujou", "normal"],
        ),
        (
            "HARD ONLY",
            "SteelPath",
            vec!["鋼のみ", "hagane", "kou", "sp", "steel path"],
        ),
        ("BOTH", "Both", vec!["両方", "ryoho"]),
    ] {
        out.push(Candidate {
            id: format!("mode:{value}"),
            label: label.to_string(),
            value: value.to_string(),
            aliases: aliases.into_iter().map(String::from).collect(),
            facet: Facet::Mode,
        });
    }
    for (label, value, aliases) in [
        (
            "EXCL. VOID STORMS",
            "Exclude",
            vec!["VOID嵐除外", "嵐除外", "storm exclude", "no storm"],
        ),
        (
            "INCL. VOID STORMS",
            "Include",
            vec!["VOID嵐含む", "嵐含む", "storm", "void storm"],
        ),
        (
            "VOID STORMS ONLY",
            "Only",
            vec!["VOID嵐のみ", "嵐のみ", "storm only", "void storm only"],
        ),
    ] {
        out.push(Candidate {
            id: format!("storm:{value}"),
            label: label.to_string(),
            value: value.to_string(),
            aliases: aliases.into_iter().map(String::from).collect(),
            facet: Facet::Storm,
        });
    }
    for (m, aliases) in MISSIONS {
        out.push(Candidate {
            id: format!("mission:{m}"),
            label: m.to_string(),
            value: m.to_string(),
            aliases: aliases.iter().map(|s| s.to_string()).collect(),
            facet: Facet::Mission,
        });
    }
    for (p, aliases) in PLANETS {
        out.push(Candidate {
            id: format!("planet:{p}"),
            label: p.to_string(),
            value: p.to_string(),
            aliases: aliases.iter().map(|s| s.to_string()).collect(),
            facet: Facet::Planet,
        });
    }
    for (label, value, aliases) in [
        ("NEW RULE", "new-rule", vec!["新ルール", "rule", ";"]),
        ("DELETE RULE", "delete-rule", vec!["ルール削除", "delrule"]),
        (
            "RENAME RULE",
            "rename-rule",
            vec!["改名", "名前変更", "rename", "name"],
        ),
        (
            "TOGGLE VIEW",
            "toggle-rule",
            vec!["表示切替", "表示トグル", "toggle view", "onoff"],
        ),
        (
            "TOGGLE NOTIFY",
            "notify-rule",
            vec!["ミュート", "通知切替", "mute", "notify"],
        ),
        (
            "DESELECT ALL RULES",
            "deselect-all-rules",
            vec!["全ルール解除", "全表示解除", "表示ルール全解除", "show all"],
        ),
        ("CLEAR", "clear", vec!["クリア", "リセット", "reset"]),
        ("PAUSE / RESUME", "pause", vec!["一時停止", "teishi"]),
        // 亀裂表の項目別ソート(表示のみ。適用はフロント側でRND-007の結線を通る)
        ("SORT BY TIER", "sort-tier", vec!["ソート", "並べ替え", "ティア順"]),
        ("SORT BY NODE", "sort-node", vec!["ソート", "並べ替え", "ノード順"]),
        (
            "SORT BY MISSION",
            "sort-mission",
            vec!["ソート", "並べ替え", "ミッション順"],
        ),
        (
            "SORT BY FACTION",
            "sort-faction",
            vec!["ソート", "並べ替え", "勢力順", "ファクション順"],
        ),
        (
            "SORT BY T-REMAIN",
            "sort-timer",
            vec!["ソート", "並べ替え", "残り時間順", "時間順"],
        ),
        (
            "SORT BY MODE",
            "sort-mode",
            vec!["ソート", "並べ替え", "モード順", "難易度順"],
        ),
        (
            "SORT BY STORM",
            "sort-storm",
            vec!["ソート", "並べ替え", "嵐順", "ストーム順"],
        ),
        // コンテンツタブ切替(表示のみ。適用はフロント側でRND-010の結線を通る)
        ("GO TO FISSURES", "tab-fissures", vec!["タブ", "tab", "亀裂"]),
        (
            "GO TO ARBITRATION",
            "tab-arbitration",
            vec!["タブ", "tab", "仲裁", "アービトレーション"],
        ),
        ("GO TO SORTIE", "tab-sortie", vec!["タブ", "tab", "ソーティー"]),
        (
            "GO TO ARCHON HUNT",
            "tab-archon",
            vec!["タブ", "tab", "アルコン", "討伐戦"],
        ),
        (
            "GO TO SYNDICATES",
            "tab-syndicates",
            vec!["タブ", "tab", "シンジケート"],
        ),
        (
            "GO TO AREA MISSIONS",
            "tab-area-missions",
            vec!["タブ", "tab", "地位ミッション", "エリア", "依頼"],
        ),
        (
            "GO TO CIRCUIT",
            "tab-circuit",
            vec!["タブ", "tab", "サーキット", "回廊"],
        ),
        (
            "GO TO ARCHIMEDEA",
            "tab-archimedea",
            vec!["タブ", "tab", "アルキメデア"],
        ),
        (
            "GO TO DESCENDIA",
            "tab-descendia",
            vec!["タブ", "tab", "ディセンディア"],
        ),
    ] {
        out.push(Candidate {
            id: format!("action:{value}"),
            label: label.to_string(),
            value: value.to_string(),
            aliases: aliases.into_iter().map(String::from).collect(),
            facet: Facet::Action,
        });
    }
    out
}

/// 実行時カタログ: 静的語彙 + 現在ルールのenabledトグル候補。
/// labelはルール名(未設定ならR{n})。SPEC: EDT-003
pub fn catalog_with_rules(rules: &[WatchRule]) -> Vec<Candidate> {
    let mut out = catalog();
    for (i, rule) in rules.iter().enumerate() {
        let fallback = format!("R{}", i + 1);
        let mut aliases = vec!["rule".to_string(), rule_summary(rule)];
        if rule.name.is_some() {
            aliases.push(fallback.clone());
        }
        out.push(Candidate {
            id: format!("rule:{i}"),
            label: rule.name.clone().unwrap_or(fallback),
            value: i.to_string(),
            aliases,
            facet: Facet::Rule,
        });
    }
    out
}

/// フロント側だけで完結する表示系アクション(ソート・タブ切替・改名モード・pause)。
/// ルール構成を変更しないため、SAT-001の操作空間から除外する。
fn is_view_only_action(cand: &Candidate) -> bool {
    cand.facet == Facet::Action
        && (cand.value == "pause"
            || cand.value == "rename-rule"
            || cand.value.starts_with("sort-")
            || cand.value.starts_with("tab-"))
}

/// SAT-001の操作空間: ルール構成に影響する候補のみ
pub fn filter_catalog() -> Vec<Candidate> {
    catalog()
        .into_iter()
        .filter(|c| !is_view_only_action(c))
        .collect()
}

// ---- fzf風スコアラ ----

fn char_eq_fold(a: char, b: char) -> bool {
    a == b || a.to_lowercase().eq(b.to_lowercase())
}

/// 部分列マッチ+ボーナス。マッチ時は(スコア, textの文字index列)。SPEC: FZY-001
pub fn fuzzy_score(query: &str, text: &str) -> Option<(i64, Vec<usize>)> {
    let q: Vec<char> = query.chars().collect();
    let t: Vec<char> = text.chars().collect();
    if q.is_empty() {
        return Some((0, vec![]));
    }
    let mut idx = Vec::with_capacity(q.len());
    let mut ti = 0usize;
    for &qc in &q {
        let mut found = None;
        while ti < t.len() {
            if char_eq_fold(t[ti], qc) {
                found = Some(ti);
                ti += 1;
                break;
            }
            ti += 1;
        }
        idx.push(found?);
    }
    let mut score: i64 = 0;
    for (k, &i) in idx.iter().enumerate() {
        if i == 0 {
            score += 12;
        } else if matches!(t[i - 1], ' ' | '-' | '_' | '/' | '(' | '.') {
            score += 9;
        }
        if k > 0 && idx[k] == idx[k - 1] + 1 {
            score += 8;
        }
    }
    score -= (idx[idx.len() - 1] - idx[0] - (idx.len() - 1)) as i64;
    score -= t.len() as i64 / 8;
    let eq_full = t.len() == q.len() && t.iter().zip(&q).all(|(&a, &b)| char_eq_fold(a, b));
    let eq_prefix = t.len() >= q.len()
        && t[..q.len()]
            .iter()
            .zip(&q)
            .all(|(&a, &b)| char_eq_fold(a, b));
    if eq_full {
        score += 100;
    } else if eq_prefix {
        score += 20;
    }
    Some((score, idx))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Ranked {
    /// catalogスライス内のindex
    pub idx: usize,
    pub score: i64,
    pub indices: Vec<usize>,
    /// aliasでマッチした場合、そのalias index
    pub via: Option<usize>,
}

/// カタログをクエリで順位付け。スコア降順、同点はカタログ順(決定的)。SPEC: FZY-002..004
pub fn query_catalog(catalog: &[Candidate], query: &str) -> Vec<Ranked> {
    let mut out: Vec<Ranked> = catalog
        .iter()
        .enumerate()
        .filter_map(|(i, c)| {
            let mut best = fuzzy_score(query, &c.label).map(|(score, indices)| Ranked {
                idx: i,
                score,
                indices,
                via: None,
            });
            for (ai, alias) in c.aliases.iter().enumerate() {
                if let Some((score, indices)) = fuzzy_score(query, alias) {
                    let score = score - 2; // label側を僅かに優先
                    if best.as_ref().is_none_or(|b| score > b.score) {
                        best = Some(Ranked {
                            idx: i,
                            score,
                            indices,
                            via: Some(ai),
                        });
                    }
                }
            }
            best
        })
        .collect();
    out.sort_by(|a, b| b.score.cmp(&a.score).then(a.idx.cmp(&b.idx)));
    out
}

// ---- ドメイン互換表と充足可能性 ----

/// ゲーム上あり得る(tier, mission, planet, 鋼, storm)の組か。
/// 確信のある制約のみ符号化し、未知の値は互換とみなす(過剰な上書きを防ぐ)
fn domain_possible(tier: &str, mission: &str, planet: &str, hard: bool, storm: bool) -> bool {
    let proxima_label = PROXIMA_PLANET_ALIASES
        .iter()
        .any(|&(configured, _)| planet == configured);
    let proxima_api_name = PROXIMA_PLANET_ALIASES
        .iter()
        .any(|&(_, api_planet)| planet == api_planet);
    if (storm && !(proxima_label || proxima_api_name)) || (!storm && proxima_label) {
        return false; // VOID嵐はProxima星系のみ。APIのnodeは基底惑星名を返す
    }
    if storm && hard {
        return false; // 鋼のボイドストームは存在しない
    }
    if storm && !matches!(tier, "Lith" | "Meso" | "Neo" | "Axi") {
        return false;
    }
    if (tier == "Requiem") != (planet == "Kuva Fortress") {
        return false;
    }
    if (tier == "Omnia") != (planet == "Zariman") {
        return false;
    }
    if RAILJACK_MISSIONS.contains(&mission) && !storm {
        return false;
    }
    if ZARIMAN_MISSIONS.contains(&mission) && planet != "Zariman" {
        return false;
    }
    true
}

fn pool<'a>(selected: &'a [String], all: impl Iterator<Item = &'a str>) -> Vec<&'a str> {
    if selected.is_empty() {
        all.collect()
    } else {
        selected.iter().map(String::as_str).collect()
    }
}

/// ルールに合致し得る亀裂が(ドメイン互換表上)存在するか。SPEC: SAT-001
pub fn satisfiable(rule: &WatchRule) -> bool {
    let tiers = pool(&rule.tiers, TIERS.iter().copied());
    let missions = pool(&rule.mission_types, MISSIONS.iter().map(|(m, _)| *m));
    let planets = pool(&rule.planets, PLANETS.iter().map(|(p, _)| *p));
    let hards: &[bool] = match rule.mode {
        Mode::Normal => &[false],
        Mode::SteelPath => &[true],
        Mode::Both => &[false, true],
    };
    let storms: &[bool] = match rule.storms {
        StormMode::Exclude => &[false],
        StormMode::Include => &[false, true],
        StormMode::Only => &[true],
    };
    for t in &tiers {
        for m in &missions {
            for p in &planets {
                for &h in hards {
                    for &s in storms {
                        if domain_possible(t, m, p, h, s) {
                            return true;
                        }
                    }
                }
            }
        }
    }
    false
}

// ---- ルールエディタ(パレット操作の適用) ----

#[derive(Debug, Clone, PartialEq)]
pub struct EditorState {
    pub rules: Vec<WatchRule>,
    pub active: usize,
}

impl Default for EditorState {
    fn default() -> Self {
        Self {
            rules: vec![WatchRule::default()],
            active: 0,
        }
    }
}

/// 一発クリア: ルール構成を既定(全対象1本)へ。SPEC: CLR-001
pub fn clear(state: &mut EditorState) {
    state.rules = vec![WatchRule::default()];
    state.active = 0;
}

/// 表示への参加状態だけを変更する。編集対象や条件本体は変えない。SPEC: EDT-001
pub fn set_rule_enabled(state: &mut EditorState, index: usize, enabled: bool) -> bool {
    let Some(rule) = state.rules.get_mut(index) else {
        return false;
    };
    rule.enabled = enabled;
    true
}

/// 通知への参加状態(表示は残す)だけを変更する。編集対象や条件本体は変えない。SPEC: EDT-001
pub fn set_rule_notify(state: &mut EditorState, index: usize, notify: bool) -> bool {
    let Some(rule) = state.rules.get_mut(index) else {
        return false;
    };
    rule.notify = notify;
    true
}

/// 全ルールの一覧表示選択だけを解除する。通知・条件・順序・edit focusは保持。SPEC: EDT-003
pub fn deselect_all_rules(state: &mut EditorState) {
    for rule in &mut state.rules {
        rule.enabled = false;
    }
}

fn draft_rule() -> WatchRule {
    WatchRule {
        enabled: false,
        notify: false,
        ..WatchRule::default()
    }
}

fn is_empty_draft(rule: &WatchRule) -> bool {
    !rule.enabled
        && !rule.notify
        && rule.tiers.is_empty()
        && rule.mission_types.is_empty()
        && rule.planets.is_empty()
        && rule.mode == Mode::Both
        && rule.storms == StormMode::Exclude
}

/// VIEW選択0本からfilter候補を適用するときの編集先を確定する。
/// NEW RULE直後の安全な空draftは再利用し、それ以外は既存ルールを触らず末尾へ追加する。
fn prepare_filter_target(state: &mut EditorState) {
    if state.rules.iter().any(|rule| rule.enabled) {
        state.active = state.active.min(state.rules.len().saturating_sub(1));
        return;
    }

    let active = state.active.min(state.rules.len().saturating_sub(1));
    let reuse_active_draft = state.rules.get(active).is_some_and(is_empty_draft);
    if reuse_active_draft {
        state.active = active;
    } else {
        state.rules.push(draft_rule());
        state.active = state.rules.len() - 1;
    }

    // 暗黙作成は一覧を絞るVIEWルールとして確定するが、通知には暗黙参加させない。
    state.rules[state.active].enabled = true;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Axis {
    Tiers,
    Missions,
    Planets,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Changed {
    Axis(Axis),
    Mode,
    Storms,
}

fn axis_members(rule: &WatchRule, axis: Axis) -> &Vec<String> {
    match axis {
        Axis::Tiers => &rule.tiers,
        Axis::Missions => &rule.mission_types,
        Axis::Planets => &rule.planets,
    }
}

fn set_axis(rule: &mut WatchRule, axis: Axis, members: Vec<String>) {
    match axis {
        Axis::Tiers => rule.tiers = members,
        Axis::Missions => rule.mission_types = members,
        Axis::Planets => rule.planets = members,
    }
}

fn toggle_member(rule: &mut WatchRule, axis: Axis, value: &str) {
    let members = match axis {
        Axis::Tiers => &mut rule.tiers,
        Axis::Missions => &mut rule.mission_types,
        Axis::Planets => &mut rule.planets,
    };
    if let Some(pos) = members.iter().position(|m| m == value) {
        members.remove(pos);
    } else {
        members.push(value.to_string());
    }
}

/// パレット候補をエディタ状態に適用する。SPEC: SAT-001
pub fn apply(state: &mut EditorState, cand: &Candidate) {
    if cand.facet == Facet::Rule {
        // 対象ルールのenabledだけを反転する。edit indexは動かさない。SPEC: EDT-003
        if let Ok(index) = cand.value.parse::<usize>() {
            if let Some(enabled) = state.rules.get(index).map(|rule| !rule.enabled) {
                set_rule_enabled(state, index, enabled);
            }
        }
        return;
    }
    if cand.facet == Facet::Action {
        match cand.value.as_str() {
            "new-rule" => {
                state.rules.push(draft_rule());
                state.active = state.rules.len() - 1;
            }
            "delete-rule" => {
                if !state.rules.is_empty() {
                    let i = state.active.min(state.rules.len() - 1);
                    state.rules.remove(i);
                    state.active = state.active.min(state.rules.len().saturating_sub(1));
                }
            }
            "clear" => clear(state),
            "toggle-rule" => {
                // 編集中(active)ルールのenabledだけを反転する。SPEC: EDT-003
                let index = state.active.min(state.rules.len().saturating_sub(1));
                if let Some(enabled) = state.rules.get(index).map(|rule| !rule.enabled) {
                    set_rule_enabled(state, index, enabled);
                }
            }
            "notify-rule" => {
                // 編集中(active)ルールのnotifyだけを反転する。SPEC: EDT-003
                let index = state.active.min(state.rules.len().saturating_sub(1));
                if let Some(notify) = state.rules.get(index).map(|rule| !rule.notify) {
                    set_rule_notify(state, index, notify);
                }
            }
            "deselect-all-rules" => deselect_all_rules(state),
            _ => {}
        }
        return;
    }

    // VIEW選択0本では既存ルールを編集せず、安全な新VIEWルールへ適用する。
    // 明示的なNEW RULE直後の空draftだけは再利用する。SPEC: EDT-001 / EDT-002 / EDT-004
    prepare_filter_target(state);
    let rule = &mut state.rules[state.active];

    let changed = match cand.facet {
        Facet::Tier => {
            toggle_member(rule, Axis::Tiers, &cand.value);
            Changed::Axis(Axis::Tiers)
        }
        Facet::Mission => {
            toggle_member(rule, Axis::Missions, &cand.value);
            Changed::Axis(Axis::Missions)
        }
        Facet::Planet => {
            toggle_member(rule, Axis::Planets, &cand.value);
            Changed::Axis(Axis::Planets)
        }
        Facet::Mode => {
            rule.mode = match cand.value.as_str() {
                "Normal" => Mode::Normal,
                "SteelPath" => Mode::SteelPath,
                _ => Mode::Both,
            };
            Changed::Mode
        }
        Facet::Storm => {
            rule.storms = match cand.value.as_str() {
                "Include" => StormMode::Include,
                "Only" => StormMode::Only,
                _ => StormMode::Exclude,
            };
            Changed::Storms
        }
        Facet::Action | Facet::Rule => unreachable!(),
    };
    resolve(rule, changed);
}

/// 両立しない選択の上書き解決: 直近の変更を固定し、他を緩める。SPEC: SAT-001
fn resolve(rule: &mut WatchRule, changed: Changed) {
    if satisfiable(rule) {
        return;
    }
    // 1) storms緩和(Includeは通常/VOID嵐の両方を許す)
    if changed != Changed::Storms && rule.storms != StormMode::Include {
        let mut t = rule.clone();
        t.storms = StormMode::Include;
        if satisfiable(&t) {
            *rule = t;
            return;
        }
    }
    // 2) mode緩和
    if changed != Changed::Mode && rule.mode != Mode::Both {
        let mut t = rule.clone();
        t.mode = Mode::Both;
        if satisfiable(&t) {
            *rule = t;
            return;
        }
        if changed != Changed::Storms && t.storms != StormMode::Include {
            t.storms = StormMode::Include;
            if satisfiable(&t) {
                *rule = t;
                return;
            }
        }
    }
    // 3) 変更していない軸から、変更内容と共存できないメンバーを落とす(空=全対象)
    let mut t = rule.clone();
    if changed != Changed::Storms {
        t.storms = StormMode::Include;
    }
    if changed != Changed::Mode {
        t.mode = Mode::Both;
    }
    for axis in [Axis::Tiers, Axis::Missions, Axis::Planets] {
        if changed == Changed::Axis(axis) {
            continue;
        }
        let keep: Vec<String> = axis_members(&t, axis)
            .iter()
            .filter(|m| {
                let mut probe = WatchRule {
                    mode: t.mode,
                    storms: t.storms,
                    ..WatchRule::default()
                };
                set_axis(&mut probe, axis, vec![(*m).clone()]);
                if let Changed::Axis(ca) = changed {
                    set_axis(&mut probe, ca, axis_members(&t, ca).clone());
                }
                satisfiable(&probe)
            })
            .cloned()
            .collect();
        set_axis(&mut t, axis, keep);
    }
    if !satisfiable(&t) {
        // 最終手段: 変更した内容だけ残して他は全対象
        let mut u = WatchRule {
            enabled: t.enabled,
            notify: t.notify,
            name: t.name.clone(),
            mode: t.mode,
            storms: t.storms,
            ..WatchRule::default()
        };
        if let Changed::Axis(ca) = changed {
            set_axis(&mut u, ca, axis_members(&t, ca).clone());
        }
        t = u;
    }
    *rule = t;
}

/// トレイ・UI向けのルール要約("AXI+NEO/鋼"風)
pub fn rule_summary(rule: &WatchRule) -> String {
    let tiers = if rule.tiers.is_empty() {
        "ALL".to_string()
    } else {
        rule.tiers
            .iter()
            .map(|t| t.to_uppercase())
            .collect::<Vec<_>>()
            .join("+")
    };
    let mode = match rule.mode {
        Mode::SteelPath => "鋼",
        Mode::Normal => "通常",
        Mode::Both => "両方",
    };
    let mut s = format!("{tiers}/{mode}");
    if !rule.mission_types.is_empty() {
        s.push_str(&format!("/M{}", rule.mission_types.len()));
    }
    if !rule.planets.is_empty() {
        s.push_str(&format!("/P{}", rule.planets.len()));
    }
    match rule.storms {
        StormMode::Exclude => {}
        StormMode::Include => s.push_str("/+STORM"),
        StormMode::Only => s.push_str("/STORM ONLY"),
    }
    s
}
