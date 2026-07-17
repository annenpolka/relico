// 手書きのexample-basedテスト(補助)。実APIレスポンス(2026-07-17取得)のフィクスチャで
// パースと判定の具体例を固定する。性質はoracles_generated.rs(生成物)が担う。

use chrono::{TimeZone, Utc};
use relico_lib::filter::{self, FilterSettings, Mode, StormMode, WatchRule};
use relico_lib::model::Fissure;
use relico_lib::palette;

fn fixture() -> Vec<Fissure> {
    serde_json::from_str(include_str!("fixtures/fissures.json")).expect("fixture parse")
}

fn rule() -> WatchRule {
    WatchRule::default()
}

fn settings(rules: Vec<WatchRule>) -> FilterSettings {
    FilterSettings {
        rules,
        min_remaining_secs: 300,
    }
}

#[test]
fn parses_real_api_response() {
    let fissures = fixture();
    assert_eq!(fissures.len(), 9);
    let kappa = &fissures[1];
    assert_eq!(kappa.node, "Kappa (Sedna)");
    assert_eq!(kappa.tier, "Axi");
    assert_eq!(kappa.tier_num, 4);
    assert!(!kappa.is_hard);
}

#[test]
fn extracts_planets_from_real_nodes() {
    assert_eq!(
        filter::extract_planet("Kappa (Sedna)").as_deref(),
        Some("Sedna")
    );
    assert_eq!(
        filter::extract_planet("Nsu Grid (Veil Proxima)").as_deref(),
        Some("Veil Proxima")
    );
    assert_eq!(
        filter::extract_planet("Everview Arc (Zariman)").as_deref(),
        Some("Zariman")
    );
    assert_eq!(filter::extract_planet("括弧なしノード"), None);
}

#[test]
fn steel_path_meso_rule_matches_exactly_three() {
    let now = Utc.with_ymd_and_hms(2026, 7, 17, 4, 0, 0).unwrap();
    let s = settings(vec![WatchRule {
        tiers: vec!["Meso".to_string()],
        mode: Mode::SteelPath,
        ..rule()
    }]);
    let matched: Vec<String> = fixture()
        .iter()
        .filter(|f| filter::matches(&s, f, now))
        .map(|f| f.node.clone())
        .collect();
    // 鋼のMesoは Keeler / Pallas / Monolith の3つ
    assert_eq!(
        matched,
        vec!["Keeler (Saturn)", "Pallas (Ceres)", "Monolith (Phobos)"]
    );
}

#[test]
fn two_rules_union_matches_five() {
    // ルールOR: 「Axi通常」OR「Meso鋼」で計5件(FLT-008/009の具体例)
    let now = Utc.with_ymd_and_hms(2026, 7, 17, 4, 0, 0).unwrap();
    let s = settings(vec![
        WatchRule {
            tiers: vec!["Axi".to_string()],
            mode: Mode::Normal,
            ..rule()
        },
        WatchRule {
            tiers: vec!["Meso".to_string()],
            mode: Mode::SteelPath,
            ..rule()
        },
    ]);
    let count = fixture()
        .iter()
        .filter(|f| filter::matches(&s, f, now))
        .count();
    assert_eq!(count, 5); // Taranis + Kappa + Keeler + Pallas + Monolith
}

#[test]
fn min_remaining_excludes_soon_expiring() {
    // 04:45時点: Metis (Jupiter) は04:49消滅なので残り5分未満 → 除外される
    let now = Utc.with_ymd_and_hms(2026, 7, 17, 4, 45, 0).unwrap();
    let s = settings(vec![rule()]);
    let matched: Vec<String> = fixture()
        .iter()
        .filter(|f| filter::matches(&s, f, now))
        .map(|f| f.node.clone())
        .collect();
    assert!(!matched.contains(&"Metis (Jupiter)".to_string()));
    assert!(matched.contains(&"Keeler (Saturn)".to_string()));
}

#[test]
fn planet_rule_matches_ceres_only() {
    let now = Utc.with_ymd_and_hms(2026, 7, 17, 4, 0, 0).unwrap();
    let s = settings(vec![WatchRule {
        planets: vec!["Ceres".to_string()],
        ..rule()
    }]);
    let matched: Vec<String> = fixture()
        .iter()
        .filter(|f| filter::matches(&s, f, now))
        .map(|f| f.node.clone())
        .collect();
    assert_eq!(matched, vec!["Draco (Ceres)", "Pallas (Ceres)"]);
}

// ---- パレットのalias具体例(FZY条項の実データ版) ----

fn top_label(query: &str) -> String {
    let catalog = palette::catalog();
    let ranked = palette::query_catalog(&catalog, query);
    catalog[ranked[0].idx].label.clone()
}

#[test]
fn alias_hagane_hits_hard_only() {
    assert_eq!(top_label("hagane"), "HARD ONLY");
    assert_eq!(top_label("鋼のみ"), "HARD ONLY");
}

#[test]
fn alias_md_hits_mobile_defense() {
    assert_eq!(top_label("md"), "Mobile Defense");
}

#[test]
fn alias_sedona_hits_sedna() {
    assert_eq!(top_label("sedona"), "Sedna");
    assert_eq!(top_label("生存"), "Survival");
}

#[test]
fn mission_aliases_cover_japanese_and_romaji_variants() {
    for query in ["耐久", "taikyu", "taikyuu"] {
        assert_eq!(top_label(query), "Survival");
    }
    for query in ["分裂", "bunretsu"] {
        assert_eq!(top_label(query), "Disruption");
    }
}

#[test]
fn storm_candidates_select_each_mode() {
    let catalog = palette::catalog();
    for (id, expected) in [
        ("storm:Exclude", StormMode::Exclude),
        ("storm:Include", StormMode::Include),
        ("storm:Only", StormMode::Only),
    ] {
        let mut state = palette::EditorState::default();
        let candidate = catalog.iter().find(|c| c.id == id).unwrap();
        palette::apply(&mut state, candidate);
        assert_eq!(state.rules[0].storms, expected);
        assert!(palette::satisfiable(&state.rules[0]));
    }
}

#[test]
fn storm_only_preserves_base_and_proxima_planet_choices() {
    let catalog = palette::catalog();
    let storm_only = catalog.iter().find(|c| c.id == "storm:Only").unwrap();
    for planet in ["Earth", "Earth Proxima", "Veil Proxima"] {
        let mut state = palette::EditorState::default();
        let planet_candidate = catalog
            .iter()
            .find(|c| c.id == format!("planet:{planet}"))
            .unwrap();
        palette::apply(&mut state, planet_candidate);
        palette::apply(&mut state, storm_only);
        assert_eq!(state.rules[0].planets, vec![planet.to_string()]);
        assert_eq!(state.rules[0].storms, StormMode::Only);
        assert!(palette::satisfiable(&state.rules[0]));
    }
}

#[test]
fn conflict_overwrite_requiem_drops_sedna() {
    // SAT-001の具体例: Sedna選択中のルールにRequiemを足すと、
    // Requiem×Sednaは両立しないのでSednaが落ちる(新しい方が残る)
    let mut state = palette::EditorState::default();
    let catalog = palette::catalog();
    let sedna = catalog.iter().find(|c| c.id == "planet:Sedna").unwrap();
    let requiem = catalog.iter().find(|c| c.id == "tier:Requiem").unwrap();
    palette::apply(&mut state, sedna);
    palette::apply(&mut state, requiem);
    let r = &state.rules[0];
    assert_eq!(r.tiers, vec!["Requiem".to_string()]);
    assert!(!r.planets.contains(&"Sedna".to_string()));
    assert!(palette::satisfiable(r));
}
