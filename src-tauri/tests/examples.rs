// 手書きのexample-basedテスト(補助)。実APIレスポンス(2026-07-17取得)のフィクスチャで
// パースと判定の具体例を固定する。性質はoracles_generated.rs(生成物)が担う。

use chrono::{TimeZone, Utc};
use warframe_fissure_notifier_lib::filter::{self, FilterConfig, Mode};
use warframe_fissure_notifier_lib::model::Fissure;

fn fixture() -> Vec<Fissure> {
    serde_json::from_str(include_str!("fixtures/fissures.json")).expect("fixture parse")
}

fn base_config() -> FilterConfig {
    FilterConfig {
        tiers: vec![],
        mission_types: vec![],
        planets: vec![],
        mode: Mode::Both,
        include_storms: false,
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
    assert_eq!(kappa.expiry, Utc.with_ymd_and_hms(2026, 7, 17, 5, 24, 43).unwrap() + chrono::Duration::milliseconds(921));
}

#[test]
fn extracts_planets_from_real_nodes() {
    assert_eq!(filter::extract_planet("Kappa (Sedna)").as_deref(), Some("Sedna"));
    assert_eq!(filter::extract_planet("Nsu Grid (Veil Proxima)").as_deref(), Some("Veil Proxima"));
    assert_eq!(filter::extract_planet("Everview Arc (Zariman)").as_deref(), Some("Zariman"));
    assert_eq!(filter::extract_planet("括弧なしノード"), None);
}

#[test]
fn steel_path_meso_matches_exactly_three() {
    let now = Utc.with_ymd_and_hms(2026, 7, 17, 4, 0, 0).unwrap();
    let cfg = FilterConfig {
        tiers: vec!["Meso".to_string()],
        mode: Mode::SteelPath,
        ..base_config()
    };
    let matched: Vec<String> = fixture()
        .iter()
        .filter(|f| filter::matches(&cfg, f, now))
        .map(|f| f.node.clone())
        .collect();
    // 鋼のMesoは Keeler / Pallas / Monolith の3つ
    assert_eq!(matched, vec!["Keeler (Saturn)", "Pallas (Ceres)", "Monolith (Phobos)"]);
}

#[test]
fn normal_axi_matches_exactly_two() {
    let now = Utc.with_ymd_and_hms(2026, 7, 17, 4, 0, 0).unwrap();
    let cfg = FilterConfig {
        tiers: vec!["Axi".to_string()],
        mode: Mode::Normal,
        ..base_config()
    };
    let count = fixture().iter().filter(|f| filter::matches(&cfg, f, now)).count();
    assert_eq!(count, 2); // Taranis + Kappa
}

#[test]
fn min_remaining_excludes_soon_expiring() {
    // 04:45時点: Metis (Jupiter) は04:49消滅なので残り5分未満 → 除外される
    let now = Utc.with_ymd_and_hms(2026, 7, 17, 4, 45, 0).unwrap();
    let cfg = base_config();
    let matched: Vec<String> = fixture()
        .iter()
        .filter(|f| filter::matches(&cfg, f, now))
        .map(|f| f.node.clone())
        .collect();
    assert!(!matched.contains(&"Metis (Jupiter)".to_string()));
    assert!(matched.contains(&"Keeler (Saturn)".to_string()));
}

#[test]
fn planet_filter_matches_ceres_only() {
    let now = Utc.with_ymd_and_hms(2026, 7, 17, 4, 0, 0).unwrap();
    let cfg = FilterConfig {
        planets: vec!["Ceres".to_string()],
        ..base_config()
    };
    let matched: Vec<String> = fixture()
        .iter()
        .filter(|f| filter::matches(&cfg, f, now))
        .map(|f| f.node.clone())
        .collect();
    assert_eq!(matched, vec!["Draco (Ceres)", "Pallas (Ceres)"]);
}
