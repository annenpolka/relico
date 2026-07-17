use std::collections::HashMap;
use std::sync::OnceLock;

use crate::config::AppLocale;
use crate::filter::{Mode, StormMode, WatchRule};

type Messages = HashMap<String, String>;
type Catalog = HashMap<String, Messages>;

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/locales.json"))
            .expect("src/locales.json must contain the bundled i18n catalog")
    })
}

/// 指定locale→日本語の順でフォールバックし、欠落は目立つmarkerにする。
pub fn text(locale: AppLocale, key: &str) -> String {
    catalog()
        .get(locale.as_str())
        .and_then(|messages| messages.get(key))
        .or_else(|| catalog().get("ja").and_then(|messages| messages.get(key)))
        .cloned()
        .unwrap_or_else(|| format!("[[{key}]]"))
}

pub fn format(locale: AppLocale, key: &str, args: &[(&str, &str)]) -> String {
    let mut message = text(locale, key);
    for (name, value) in args {
        message = message.replace(&format!("{{{name}}}"), value);
    }
    message
}

/// トレイとfrontendで同じ意味を持つ短いルール要約。
pub fn rule_summary(locale: AppLocale, rule: &WatchRule) -> String {
    let tiers = if rule.tiers.is_empty() {
        text(locale, "rules.all").to_uppercase()
    } else {
        rule.tiers
            .iter()
            .map(|tier| tier.to_uppercase())
            .collect::<Vec<_>>()
            .join("+")
    };
    let mode_key = match rule.mode {
        Mode::SteelPath => "rules.modeSteel",
        Mode::Normal => "rules.modeNormal",
        Mode::Both => "rules.modeBoth",
    };
    let mut summary = format!("{tiers}/{}", text(locale, mode_key));
    if !rule.mission_types.is_empty() {
        summary.push_str(&format!("/M{}", rule.mission_types.len()));
    }
    if !rule.planets.is_empty() {
        summary.push_str(&format!("/P{}", rule.planets.len()));
    }
    match rule.storms {
        StormMode::Exclude => {}
        StormMode::Include => summary.push_str(&format!("/{}", text(locale, "rules.stormInclude"))),
        StormMode::Only => summary.push_str(&format!("/{}", text(locale, "rules.stormOnly"))),
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_catalog_has_the_same_nonempty_keys_for_every_locale() {
        let ja = catalog().get("ja").expect("ja catalog");
        for locale in ["en", "zh-Hans"] {
            let messages = catalog().get(locale).expect("locale catalog");
            assert_eq!(messages.len(), ja.len(), "{locale} key count");
            for key in ja.keys() {
                assert!(
                    messages
                        .get(key)
                        .is_some_and(|value| !value.trim().is_empty()),
                    "{locale} missing or empty: {key}"
                );
            }
        }
    }
}
