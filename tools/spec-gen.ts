// specs/*.pkl(正本) から以下を生成する:
//   - src-tauri/tests/oracles_generated.rs       (proptest/exampleオラクル。手編集禁止)
//   - tests/unit/oracles_generated.test.ts       (bun testオラクル。手編集禁止)
//   - tests/renderer/oracles_generated.spec.ts   (Playwright rendererオラクル。手編集禁止)
//   - tests/e2e/oracles_generated.e2e.ts          (WDIO Tauri E2Eオラクル。手編集禁止)
//   - docs/SPEC.md                               (可読ドキュメント。手編集禁止)
// 実行: bun tools/spec-gen.ts

import { spawnSync } from "bun";

type Clause = {
  id: string;
  pattern: string;
  desc: string;
  label: string;
  ruleOverride?: string;
  fissureOverride?: string;
  axisField?: string;
  matchExpr?: string;
  minSecs?: number;
  maxSecs?: number;
  scenario?:
    | "outcomes"
    | "desktop_payload"
    | "desktop_unavailable"
    | "discord_receipt"
    | "localized_backend"
    | "bundle_identity"
    | "tray_template_icon"
    | "autostart_bundle_icon"
    | "dependency_free_i18n"
    | "validation"
    | "lookup"
    | "wire_shape"
    | "arbitration_join"
    | "oracle_bounties"
    | "circuit"
    | "rich_details"
    | "area_sources"
    | "glyph_known_values"
    | "planet_proxima_view"
    | "e2e_targeted_cleanup"
    | "palette_keyboard"
    | "delivery_flush"
    | "rule_row_controls"
    | "sidebar_fit"
    | "compact_table"
    | "expiry_cleanup"
    | "rule_naming"
    | "table_sort"
    | "unselected_picker_create"
    | "content_tabs"
    | "mute_window"
    | "locale_display"
    | "palette_apply_ipc"
    | "delivery_error_surface"
    | "locale_config_roundtrip";
  path?: string;
  sha256?: string;
  cadence?: "per-release" | "one-time";
  procedure?: string;
};

// ---- 語彙プール(Rustオラクルの生成器とTSグリフ検査で共有する既知値) ----
const TIER_POOL = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"];
const MISSION_POOL = [
  "Defense", "Survival", "Capture", "Extermination", "Rescue",
  "Disruption", "Mobile Defense", "Void Flood", "Void Cascade", "Volatile",
];
const PLANET_POOL = [
  "Mars", "Ceres", "Sedna", "Void", "Saturn", "Phobos",
  "Zariman", "Veil Proxima", "Kuva Fortress", "Lua",
];
const FACTION_POOL = ["Grineer", "Corpus", "Infested", "Orokin", "Corrupted", "Murmur", "The Murmur"];
const DIFFICULTY_POOL = ["Normal", "SteelPath", "Both"];
const STORM_POOL = ["Exclude", "Include", "Only"];
const ACTION_POOL = [
  "new-rule",
  "delete-rule",
  "rename-rule",
  "toggle-rule",
  "notify-rule",
  "deselect-all-rules",
  "clear",
  "pause",
];
const PROXIMA_PLANETS = ["Earth", "Venus", "Saturn", "Neptune", "Pluto", "Veil"];

const rustStrArray = (pool: string[]) => pool.map((s) => `"${s}"`).join(", ");
const tsStrArray = (pool: string[]) => JSON.stringify(pool);

const root = new URL("..", import.meta.url).pathname;

const pkl = spawnSync(["pkl", "eval", "-f", "json", `${root}specs/notifier.pkl`]);
if (pkl.exitCode !== 0) {
  console.error(pkl.stderr.toString());
  process.exit(1);
}
const spec = JSON.parse(pkl.stdout.toString()) as { title: string; clauses: Clause[] };

// ---- 検証 ----
const ids = new Set<string>();
for (const c of spec.clauses) {
  if (ids.has(c.id)) throw new Error(`条項idが重複: ${c.id}`);
  ids.add(c.id);
}

const fnName = (id: string, suffix = "") =>
  id.toLowerCase().replace(/-/g, "_") + (suffix ? `_${suffix}` : "");

const indent = (code: string, n: number) =>
  code
    .split("\n")
    .map((l) => (l.trim() ? " ".repeat(n) + l : l))
    .join("\n");

function genClause(c: Clause): string {
  const name = fnName(c.id);
  const msg = `SPEC ${c.id} 違反: ${c.desc.replace(/"/g, '\\"').replace(/{/g, "{{").replace(/}/g, "}}")}`;
  switch (c.pattern) {
    case "rule_reject_when":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(mut rule in arb_rule(), mut f in arb_fissure()) {
${indent(c.ruleOverride ?? "", 8)}
${indent(c.fissureOverride ?? "", 8)}
        prop_assert!(!filter::rule_matches(&rule, &f), "${msg}");
    }`;
    case "storm_truth_table":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(mut f in arb_fissure()) {
        let mut rule = WatchRule {
            mode: Mode::Both,
            ..WatchRule::default()
        };
        for (storms, normal_matches, storm_matches) in [
            (StormMode::Exclude, true, false),
            (StormMode::Include, true, true),
            (StormMode::Only, false, true),
        ] {
            rule.storms = storms;
            f.is_storm = false;
            prop_assert_eq!(
                filter::rule_matches(&rule, &f),
                normal_matches,
                "${msg} (mode={:?}, isStorm=false)",
                storms,
            );
            f.is_storm = true;
            prop_assert_eq!(
                filter::rule_matches(&rule, &f),
                storm_matches,
                "${msg} (mode={:?}, isStorm=true)",
                storms,
            );
        }
    }`;
    case "proxima_node_aliases":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(mut f in arb_fissure(), pick in any::<prop::sample::Index>()) {
        let aliases = [
            ("Earth Proxima", "Earth"),
            ("Venus Proxima", "Venus"),
            ("Saturn Proxima", "Saturn"),
            ("Neptune Proxima", "Neptune"),
            ("Pluto Proxima", "Pluto"),
            ("Veil Proxima", "Veil"),
        ];
        let (configured, api_planet) = aliases[pick.index(aliases.len())];
        let mut rule = WatchRule {
            planets: vec![configured.to_string()],
            mode: Mode::Both,
            storms: StormMode::Only,
            ..WatchRule::default()
        };
        f.is_storm = true;
        f.node = format!("Node ({api_planet})");
        prop_assert!(filter::rule_matches(&rule, &f), "${msg} (VOID嵐が不一致)");

        rule.storms = StormMode::Include;
        f.is_storm = false;
        prop_assert!(!filter::rule_matches(&rule, &f), "${msg} (通常亀裂へ別名を誤適用)");
    }`;
    case "rule_pass_when_empty":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(rule in arb_rule(), f in arb_fissure()) {
        let mut empty_rule = rule.clone();
        empty_rule.${c.axisField} = vec![];
        let mut pinned_rule = rule;
        pinned_rule.${c.axisField} = ${c.matchExpr};
        prop_assert_eq!(
            filter::rule_matches(&empty_rule, &f),
            filter::rule_matches(&pinned_rule, &f),
            "${msg}"
        );
    }`;
    case "settings_reject_when":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(${/\bs\.[A-Za-z_]+\s*=/.test(c.fissureOverride ?? "") ? "mut " : ""}s in arb_settings(), mut f in arb_fissure()) {
        let now = base_now();
${indent(c.fissureOverride ?? "", 8)}
        prop_assert!(!filter::matches(&s, &f, now), "${msg}");
    }`;
    case "single_rule_embedding":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(rule in arb_rule(), f in arb_fissure(), min in 0u64..1800) {
        let now = base_now();
        let s = FilterSettings { rules: vec![rule.clone()], min_remaining_secs: min };
        let remaining_ok = f.expiry > now
            && f.expiry.signed_duration_since(now).num_seconds() >= min as i64;
        prop_assert_eq!(
            filter::matches(&s, &f, now),
            remaining_ok && rule.enabled && filter::rule_matches(&rule, &f),
            "${msg}"
        );
    }`;
    case "rule_additivity":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(s in arb_settings(), mut extra in arb_rule(), f in arb_fissure()) {
        let now = base_now();
        if filter::matches(&s, &f, now) {
            extra.enabled = true;
            let mut bigger = s.clone();
            bigger.rules.push(extra);
            prop_assert!(filter::matches(&bigger, &f, now), "${msg}");
        }
    }`;
    case "enabled_rules_or":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(s in arb_settings(), f in arb_fissure()) {
        let now = base_now();
        let remaining_ok = f.expiry > now
            && f.expiry.signed_duration_since(now).num_seconds()
                >= s.min_remaining_secs as i64;
        let enabled_or = s.rules.iter().any(|rule|
            rule.enabled && filter::rule_matches(rule, &f)
        );
        prop_assert_eq!(
            filter::matches(&s, &f, now),
            remaining_ok && enabled_or,
            "${msg} (VIEWルールORの完全な等式)"
        );

        let mut all_disabled = s.clone();
        for rule in &mut all_disabled.rules {
            rule.enabled = false;
        }
        let mut valid_fissure = f.clone();
        valid_fissure.expiry = now + Duration::seconds(s.min_remaining_secs as i64 + 1);
        prop_assert!(
            !filter::matches(&all_disabled, &valid_fissure, now),
            "${msg} (全ルールVIEW OFFなのに表示合致した)"
        );

        let empty = FilterSettings {
            rules: vec![],
            min_remaining_secs: s.min_remaining_secs,
        };
        prop_assert!(
            !filter::matches(&empty, &valid_fissure, now),
            "${msg} (ルールなしなのに合致した)"
        );
    }`;
    case "notification_projection":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(
        s in arb_settings(),
        mut muted in arb_rule(),
        mut edited_muted in arb_rule(),
        mut notifying in arb_rule(),
    ) {
        let normalize = |rule: &WatchRule| WatchRule {
            enabled: true,
            name: None,
            ..rule.clone()
        };
        let base = filter::notification_projection(&s);
        let expected: Vec<WatchRule> = s.rules.iter()
            .filter(|rule| rule.notify)
            .map(normalize)
            .collect();
        prop_assert_eq!(base.rules.as_slice(), expected.as_slice(), "${msg} (notify=trueルールと一致しない)");
        prop_assert!(base.rules.iter().all(|rule| rule.enabled && rule.notify), "${msg} (照合用にenabled=trueへ正規化しない)");
        prop_assert_eq!(base.min_remaining_secs, s.min_remaining_secs, "${msg} (min_remaining_secsを保持しない)");

        // notify=false draftは表示選択や条件にかかわらず通知射影へ現れない
        muted.notify = false;
        let mut with_muted = s.clone();
        with_muted.rules.push(muted);
        let added = filter::notification_projection(&with_muted);
        prop_assert_eq!(added.rules.as_slice(), base.rules.as_slice(), "${msg} (notify=false追加で射影が変化した)");

        edited_muted.notify = false;
        *with_muted.rules.last_mut().expect("notify=false ruleを追加済み") = edited_muted;
        let edited = filter::notification_projection(&with_muted);
        prop_assert_eq!(edited.rules.as_slice(), base.rules.as_slice(), "${msg} (notify=false条件編集で射影が変化した)");
        with_muted.rules.pop();
        let removed = filter::notification_projection(&with_muted);
        prop_assert_eq!(removed.rules.as_slice(), base.rules.as_slice(), "${msg} (notify=false削除で射影が変化した)");

        // enabledは一覧表示だけ: 全ルールの表示選択を反転しても通知射影・scopeは不変
        let mut display_toggled = s.clone();
        for rule in &mut display_toggled.rules {
            rule.enabled = !rule.enabled;
        }
        prop_assert_eq!(
            filter::notification_projection(&display_toggled),
            base.clone(),
            "${msg} (enabled変更で通知射影が変化した)"
        );
        prop_assert!(
            !poller::notification_scope_changed(Some(&s), &display_toggled),
            "${msg} (enabled変更を通知範囲変更と誤判定した)"
        );

        // 非表示(enabled=false)でもnotify=trueなら射影へ入り、enabled=trueへ正規化される
        notifying.enabled = false;
        notifying.notify = true;
        let mut with_notifying = s.clone();
        with_notifying.rules.push(notifying.clone());
        let notifying_added = filter::notification_projection(&with_notifying);
        prop_assert_eq!(notifying_added.rules.len(), base.rules.len() + 1, "${msg} (非表示通知ルール追加が射影へ反映されない)");
        let normalized = normalize(&notifying);
        prop_assert_eq!(notifying_added.rules.last(), Some(&normalized), "${msg} (非表示通知ルールの条件を保持しない)");

        // 名前は表示用メタデータ: 変更しても射影も通知範囲判定も変わらない
        let mut renamed = s.clone();
        for rule in &mut renamed.rules {
            rule.name = Some("renamed".to_string());
        }
        prop_assert_eq!(filter::notification_projection(&renamed), base, "${msg} (名前変更で射影が変化した)");
        prop_assert!(
            !poller::notification_scope_changed(Some(&s), &renamed),
            "${msg} (名前変更を通知範囲変更と誤判定した)"
        );

        let mut toggled = FilterSettings {
            rules: vec![WatchRule { enabled: false, notify: true, ..WatchRule::default() }],
            min_remaining_secs: s.min_remaining_secs,
        };
        let hidden_projection = filter::notification_projection(&toggled);
        prop_assert_eq!(hidden_projection.rules.len(), 1, "${msg} (非表示通知ルールを射影から落とした)");
        toggled.rules[0].enabled = true;
        prop_assert_eq!(filter::notification_projection(&toggled), hidden_projection, "${msg} (enabled切替が射影へ影響した)");
        toggled.rules[0].notify = false;
        prop_assert!(filter::notification_projection(&toggled).rules.is_empty(), "${msg} (notify=falseを射影へ含めた)");
        toggled.rules[0].notify = true;

        let mut changed_condition = toggled.clone();
        changed_condition.rules[0].tiers = vec!["__projection_changed__".to_string()];
        prop_assert_ne!(
            filter::notification_projection(&toggled).rules,
            filter::notification_projection(&changed_condition).rules,
            "${msg} (通知参加ルール条件の変更が射影へ反映されない)"
        );

        let changed_min = FilterSettings {
            rules: s.rules.clone(),
            min_remaining_secs: s.min_remaining_secs + 1,
        };
        prop_assert_ne!(
            filter::notification_projection(&s).min_remaining_secs,
            filter::notification_projection(&changed_min).min_remaining_secs,
            "${msg} (min_remaining_secs変更が射影へ反映されない)"
        );
    }`;
    case "at_most_once":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(ids in proptest::collection::vec("[a-c][0-9]", 0..60)) {
        let far = base_now() + Duration::hours(2);
        let mut set = NotifiedSet::new();
        let mut times_notified: HashMap<String, usize> = HashMap::new();
        for id in &ids {
            if set.mark(id, far) {
                *times_notified.entry(id.clone()).or_default() += 1;
            }
        }
        prop_assert!(times_notified.values().all(|&c| c <= 1), "${msg}");
    }`;
    case "prune_preserves_live":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(n_live in 0usize..20, n_dead in 0usize..20) {
        let now = base_now();
        let mut set = NotifiedSet::new();
        for i in 0..n_live { set.mark(&format!("L{i}"), now + Duration::hours(1)); }
        for i in 0..n_dead { set.mark(&format!("D{i}"), now - Duration::hours(1)); }
        set.prune(now);
        for i in 0..n_live {
            prop_assert!(set.contains(&format!("L{i}")), "${msg} (生存idが消えた)");
        }
        for i in 0..n_dead {
            prop_assert!(!set.contains(&format!("D{i}")), "${msg} (期限切れidが残った)");
        }
    }`;
    case "overlapping_rules_at_most_once":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(mut f in arb_fissure()) {
        let now = base_now();
        f.expiry = now + Duration::hours(1);
        f.is_storm = false;
        let rule = WatchRule::default();
        let settings = FilterSettings {
            rules: vec![rule.clone(), rule],
            min_remaining_secs: 0,
        };
        let visible = poller::notify_candidates(&settings, &[f.clone()], now);
        prop_assert_eq!(visible.len(), 1, "${msg} (複数ルール合致で一覧が重複した)");

        let mut notified = NotifiedSet::new();
        let first = poller::select_notifications(&mut notified, visible.clone(), false, false);
        prop_assert_eq!(first.len(), 1, "${msg} (最初の通知候補が1件でない)");
        prop_assert_eq!(first[0].id.as_str(), f.id.as_str(), "${msg} (別idを通知した)");
        let second = poller::select_notifications(&mut notified, visible, false, false);
        prop_assert!(second.is_empty(), "${msg} (同じidを再通知した)");
    }`;
    case "parse_total":
      return `
    /// ${c.id}: ${c.desc} (全入力でパニックしない)
    #[test]
    fn ${fnName(c.id, "total")}(s in ".*") {
        let _ = filter::extract_planet(&s);
    }

    /// ${c.id}: ${c.desc} (整形式で括弧内を返す)
    #[test]
    fn ${fnName(c.id, "wellformed")}(name in "[A-Za-z][A-Za-z ]{0,14}", planet in "[A-Za-z][A-Za-z ]{0,14}") {
        let planet = planet.trim().to_string();
        prop_assume!(!planet.is_empty());
        let node = format!("{} ({})", name.trim(), planet);
        prop_assert_eq!(filter::extract_planet(&node), Some(planet), "${msg}");
    }`;
    case "bounded":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(ops in proptest::collection::vec(any::<bool>(), 0..100)) {
        let mut b = Backoff::new(${c.minSecs}, ${c.maxSecs});
        for fail in ops {
            let v = if fail { b.on_failure() } else { b.on_success() };
            prop_assert!((${c.minSecs}..=${c.maxSecs}).contains(&v), "${msg} (v={})", v);
        }
    }`;
    case "seed_silent":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(fs in proptest::collection::vec(arb_fissure(), 0..30)) {
        let mut set = NotifiedSet::new();
        let out = poller::select_notifications(&mut set, fs.clone(), true, false);
        prop_assert!(out.is_empty(), "${msg} (通知が発火した)");
        for f in &fs {
            prop_assert!(set.contains(&f.id), "${msg} (シードされていないidがある)");
        }
    }`;
    case "notification_scope_change":
      return `
    /// ${c.id}: ${c.desc} (射影による変更判定)
    #[test]
    fn ${fnName(c.id, "projection")}(
        previous in arb_settings(),
        current in arb_settings(),
        mut muted in arb_rule(),
    ) {
        let previous_projection = filter::notification_projection(&previous);
        let current_projection = filter::notification_projection(&current);
        let expected = previous_projection.min_remaining_secs != current_projection.min_remaining_secs
            || previous_projection.rules != current_projection.rules;
        prop_assert_eq!(
            poller::notification_scope_changed(Some(&previous), &current),
            expected,
            "${msg} (notification projectionとの差分と一致しない)"
        );
        prop_assert!(
            poller::notification_scope_changed(None, &current),
            "${msg} (初回評価をscope changeと判定しない)"
        );

        // notify=false draftの追加・編集はscope changeではない
        muted.notify = false;
        let mut muted_only_change = previous.clone();
        muted_only_change.rules.push(muted);
        prop_assert!(
            !poller::notification_scope_changed(Some(&previous), &muted_only_change),
            "${msg} (notify=false draft追加をscope changeと誤判定した)"
        );

        // enabledは表示選択だけなので任意に変えてもscope changeではない
        let mut display_only_change = previous.clone();
        for rule in &mut display_only_change.rules {
            rule.enabled = !rule.enabled;
        }
        prop_assert!(
            !poller::notification_scope_changed(Some(&previous), &display_only_change),
            "${msg} (enabled変更をscope changeと誤判定した)"
        );
    }

    /// ${c.id}: ${c.desc} (scope change時のsilent seed)
    #[test]
    fn ${fnName(c.id, "silent_seed")}(mut f in arb_fissure()) {
        let now = base_now();
        f.expiry = now + Duration::hours(1);
        f.is_storm = false;

        let mut hidden_notify_rule = WatchRule::default();
        hidden_notify_rule.enabled = false;
        hidden_notify_rule.notify = true;
        let mut muted_rule = hidden_notify_rule.clone();
        muted_rule.notify = false;
        let previous = FilterSettings {
            rules: vec![muted_rule],
            min_remaining_secs: 0,
        };
        let current = FilterSettings {
            rules: vec![hidden_notify_rule],
            min_remaining_secs: 0,
        };
        prop_assert!(
            poller::notification_scope_changed(Some(&previous), &current),
            "${msg} (notify有効化をscope changeと判定しない)"
        );

        let existing = poller::notify_candidates(&current, &[f.clone()], now);
        prop_assert_eq!(existing.len(), 1, "${msg} (現存合致亀裂を取得できない)");
        let mut notified = NotifiedSet::new();
        let seeded = poller::select_notifications(&mut notified, existing.clone(), true, false);
        prop_assert!(seeded.is_empty(), "${msg} (scope change直後の現存亀裂を一括通知した)");
        prop_assert!(notified.contains(&f.id), "${msg} (現存亀裂をsilent seedしていない)");
        let repeated = poller::select_notifications(&mut notified, existing, false, false);
        prop_assert!(repeated.is_empty(), "${msg} (seed済み現存亀裂を次回通知した)");

        let mut new_fissure = f.clone();
        new_fissure.id = format!("{}-new", f.id);
        let newly_visible = poller::notify_candidates(&current, &[new_fissure.clone()], now);
        let fresh = poller::select_notifications(&mut notified, newly_visible.clone(), false, false);
        prop_assert_eq!(fresh.len(), 1, "${msg} (scope change後の新規idを通知候補にしない)");
        prop_assert_eq!(fresh[0].id.as_str(), new_fissure.id.as_str(), "${msg} (新規idを保持しない)");
        let duplicate = poller::select_notifications(&mut notified, newly_visible, false, false);
        prop_assert!(duplicate.is_empty(), "${msg} (scope change後の新規idを再通知した)");
    }`;
    case "daily_mute_window":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(start_minute in 0u16..1440, end_minute in 0u16..1440) {
        let window = DailyMuteWindow {
            enabled: true,
            start_minute: i64::from(start_minute),
            end_minute: i64::from(end_minute),
        };
        prop_assert!(window.is_valid(), "${msg} (0..1439の値を無効扱いした)");

        // 任意のstart/endについて1日の全1440分を検査する。
        for minute in 0u16..1440 {
            let expected = if start_minute == end_minute {
                false
            } else if start_minute < end_minute {
                start_minute <= minute && minute < end_minute
            } else {
                minute >= start_minute || minute < end_minute
            };
            prop_assert_eq!(
                window.is_muted_at_minute(minute),
                expected,
                "${msg} (start={}, end={}, minute={})",
                start_minute,
                end_minute,
                minute,
            );
        }

        let disabled = DailyMuteWindow { enabled: false, ..window.clone() };
        prop_assert!(
            (0u16..1440).all(|minute| !disabled.is_muted_at_minute(minute)),
            "${msg} (enabled=falseなのにミュートした)"
        );
        if start_minute != end_minute {
            prop_assert!(window.is_muted_at_minute(start_minute), "${msg} (startを含まない)");
            prop_assert!(!window.is_muted_at_minute(end_minute), "${msg} (endを含んだ)");
        }
    }`;
    case "muted_delivery":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(fs in proptest::collection::vec(arb_fissure(), 0..30), mut fresh in arb_fissure()) {
        let mut muted_set = NotifiedSet::new();
        let muted = poller::select_notifications(&mut muted_set, fs.clone(), false, true);
        prop_assert!(muted.is_empty(), "${msg} (ミュート中に配送対象を返した)");
        for f in &fs {
            prop_assert!(muted_set.contains(&f.id), "${msg} (ミュート中のidをmarkしない)");
        }

        let backlog = poller::select_notifications(&mut muted_set, fs, false, false);
        prop_assert!(backlog.is_empty(), "${msg} (解除後に滞留idを配送した)");

        fresh.id = "post-mute-fresh-id".to_string();
        fresh.expiry = base_now() + Duration::hours(1);
        let delivered = poller::select_notifications(
            &mut muted_set,
            vec![fresh.clone()],
            false,
            false,
        );
        prop_assert_eq!(delivered.len(), 1, "${msg} (解除後の新規idを配送しない)");
        prop_assert_eq!(delivered[0].id.as_str(), fresh.id.as_str(), "${msg} (別idを配送した)");
        prop_assert!(
            poller::select_notifications(&mut muted_set, vec![fresh], false, false).is_empty(),
            "${msg} (解除後の新規idを再配送した)"
        );

        let mut seeded_set = NotifiedSet::new();
        let seeded = poller::select_notifications(
            &mut seeded_set,
            delivered,
            true,
            false,
        );
        prop_assert!(seeded.is_empty(), "${msg} (seed中に配送対象を返した)");
    }`;
    case "arbitration_schedule":
      switch (c.scenario) {
        case "validation":
          return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(slot_count in 2usize..32) {
        let base = base_now().timestamp();
        let valid = (0..slot_count)
            .map(|index| format!("{},Node{index}", base + index as i64 * 3600))
            .collect::<Vec<_>>()
            .join("\\n");
        let parsed = timed::parse_arbitration_schedule(&valid)
            .expect("整形式の仲裁scheduleを受理すること");
        prop_assert_eq!(parsed.slots.len(), slot_count, "${msg} (正常行を欠落・追加した)");

        for invalid in [
            format!("{base},Node0"),
            String::new(),
            format!("{base},Node0\\n{},", base + 3600),
            format!("{base},Node0\\n{base},Node1"),
            format!("{base},Node0\\n{},Node1", base - 3600),
            format!("{base},Node0\\n{},Node1", base + 3601),
            "not-a-number,Node0\\n3600,Node1".to_string(),
            format!("{},Node0\\n{},Node1", base + 1, base + 3601),
        ] {
            prop_assert!(
                timed::parse_arbitration_schedule(&invalid).is_err(),
                "${msg} (不正scheduleを部分受理した: {})",
                invalid,
            );
        }
    }`;
        case "lookup":
          return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(
        slot_count in 2usize..32,
        pick in any::<prop::sample::Index>(),
        second in 0i64..3600,
    ) {
        let base = base_now();
        let body = (0..slot_count)
            .map(|index| format!("{},Node{index}", base.timestamp() + index as i64 * 3600))
            .collect::<Vec<_>>()
            .join("\\n");
        let schedule = timed::parse_arbitration_schedule(&body)
            .expect("整形式の仲裁scheduleを受理すること");
        let index = pick.index(slot_count);
        let now = base + Duration::seconds(index as i64 * 3600 + second);
        let selected = timed::arbitration_slot_at(&schedule, now)
            .expect("schedule定義域内のslotを選べること");
        prop_assert_eq!(selected.node_key, format!("Node{index}"), "${msg} (別slotを選んだ)");
        prop_assert_eq!(selected.activation, base + Duration::hours(index as i64), "${msg} (activation境界)");
        prop_assert_eq!(selected.expiry, selected.activation + Duration::hours(1), "${msg} (1時間slotでない)");

        for outside in [
            base - Duration::seconds(1),
            base + Duration::hours(slot_count as i64),
            base + Duration::hours(slot_count as i64 + 10_000),
        ] {
            prop_assert!(
                matches!(
                    timed::arbitration_slot_at(&schedule, outside),
                    Err(timed::TimedSourceError::OutOfRange(_))
                ),
                "${msg} (範囲外を循環・補間した: {})",
                outside,
            );
        }
    }`;
        default:
          throw new Error(`未知の仲裁scheduleシナリオ: ${c.scenario} (${c.id})`);
      }
    case "timed_source_isolation":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(future_secs in 1i64..86_400, expired_secs in -86_400i64..1) {
        let now = base_now();
        let future = mk_timed_card("future", Some(now + Duration::seconds(future_secs)));
        let expired = mk_timed_card("expired", Some(now + Duration::seconds(expired_secs)));
        let missing_expiry = mk_timed_card("missing-expiry", None);

        let mut failed_cards = vec![future.clone(), expired.clone(), missing_expiry.clone()];
        let mut failed_status = mk_timed_status(timed::TimedSourceId::BrowseWfBountyCycle);
        timed::apply_timed_source_result(
            &mut failed_cards,
            &mut failed_status,
            now,
            Err(timed::TimedSourceError::failed("oracle down")),
        );
        prop_assert_eq!(failed_cards, vec![future.clone()], "${msg} (失敗時のLKG期限処理)");
        prop_assert_eq!(failed_status.freshness, timed::TimedFreshness::Stale, "${msg} (生存LKGをstaleにしない)");
        prop_assert_eq!(failed_status.error.as_deref(), Some("oracle down"), "${msg} (source errorを保持しない)");

        let mut unavailable_cards = vec![expired.clone(), missing_expiry];
        let mut unavailable_status = mk_timed_status(timed::TimedSourceId::BrowseWfBountyCycle);
        timed::apply_timed_source_result(
            &mut unavailable_cards,
            &mut unavailable_status,
            now,
            Err(timed::TimedSourceError::failed("still down")),
        );
        prop_assert!(unavailable_cards.is_empty(), "${msg} (期限切れLKGを保持した)");
        prop_assert_eq!(unavailable_status.freshness, timed::TimedFreshness::Unavailable, "${msg} (LKGなしをunavailableにしない)");

        let mut replaced_cards = vec![future.clone()];
        let mut replaced_status = mk_timed_status(timed::TimedSourceId::BrowseWfBountyCycle);
        let replacement = mk_timed_card("replacement", Some(now + Duration::hours(2)));
        timed::apply_timed_source_result(
            &mut replaced_cards,
            &mut replaced_status,
            now,
            Ok(vec![replacement.clone(), expired]),
        );
        prop_assert_eq!(
            replaced_cards.as_slice(),
            std::slice::from_ref(&replacement),
            "${msg} (成功sliceを原子的に置換・期限処理しない)",
        );
        prop_assert_eq!(replaced_status.freshness, timed::TimedFreshness::Fresh, "${msg} (成功sourceをfreshにしない)");
        prop_assert!(replaced_status.error.is_none(), "${msg} (成功後もerrorを残した)");

        timed::apply_timed_source_result(
            &mut replaced_cards,
            &mut replaced_status,
            now,
            Err(timed::TimedSourceError::out_of_range("schedule ended")),
        );
        prop_assert!(replaced_cards.is_empty(), "${msg} (範囲外でcardを残した)");
        prop_assert_eq!(replaced_status.freshness, timed::TimedFreshness::OutOfRange, "${msg} (範囲外health)");

        // 実snapshot結線は、全source成功と各sourceだけが失敗するmatrixで検査する。
        // これによりsuccess/failureのどちらの分岐でもslice・healthのcross-wireを捕捉する。
        for failed_source in [
            None,
            Some("wfcd"),
            Some("descendia"),
            Some("circuit"),
            Some("bounties"),
            Some("location"),
            Some("arbitration"),
        ] {
            let lkg_expiry = now + Duration::hours(1);
            let replacement_expiry = now + Duration::hours(2);
            let mut snapshot = timed::TimedContentSnapshot::default();
            snapshot.sortie = vec![mk_timed_card("wfcd-sortie-lkg", Some(lkg_expiry))];
            snapshot.archon = vec![mk_timed_card("wfcd-archon-lkg", Some(lkg_expiry))];
            snapshot.syndicates = vec![mk_timed_card("wfcd-syndicates-lkg", Some(lkg_expiry))];
            snapshot.area_missions = vec![mk_timed_card("wfcd-area-lkg", Some(lkg_expiry))];
            snapshot.area_environments = vec![mk_timed_card("wfcd-environment-lkg", Some(lkg_expiry))];
            snapshot.area_events = vec![mk_timed_card("wfcd-event-lkg", Some(lkg_expiry))];
            snapshot.archimedea = vec![mk_timed_card("wfcd-archimedea-lkg", Some(lkg_expiry))];
            snapshot.descendia = vec![mk_timed_card("descendia-lkg", Some(lkg_expiry))];
            snapshot.circuit = vec![mk_timed_card("circuit-lkg", Some(lkg_expiry))];
            snapshot.bounties = vec![mk_timed_card("bounties-lkg", Some(lkg_expiry))];
            snapshot.area_objectives = vec![mk_timed_card("location-lkg", Some(lkg_expiry))];
            snapshot.arbitration = vec![mk_timed_card("arbitration-lkg", Some(lkg_expiry))];
            snapshot.sources.wfcd = mk_timed_status(timed::TimedSourceId::WfcdWorldstate);
            snapshot.sources.de_descendia = mk_timed_status(timed::TimedSourceId::DeWorldstate);
            snapshot.sources.de_circuit = mk_timed_status(timed::TimedSourceId::DeWorldstate);
            snapshot.sources.browse_wf_bounties =
                mk_timed_status(timed::TimedSourceId::BrowseWfBountyCycle);
            snapshot.sources.browse_wf_location_bounties =
                mk_timed_status(timed::TimedSourceId::BrowseWfLocationBounties);
            snapshot.sources.browse_wf_arbitration =
                mk_timed_status(timed::TimedSourceId::BrowseWfArbitrationSchedule);

            snapshot.apply_poll(
                now,
                timed::TimedPollResults {
                    wfcd: if failed_source == Some("wfcd") {
                        Err(timed::TimedSourceError::failed("wfcd down"))
                    } else {
                        Ok(timed::WfcdTimedContent {
                            sortie: vec![mk_timed_card("wfcd-sortie-replacement", Some(replacement_expiry))],
                            archon: vec![mk_timed_card("wfcd-archon-replacement", Some(replacement_expiry))],
                            syndicates: vec![mk_timed_card("wfcd-syndicates-replacement", Some(replacement_expiry))],
                            area_missions: vec![mk_timed_card("wfcd-area-replacement", Some(replacement_expiry))],
                            area_environments: vec![mk_timed_card("wfcd-environment-replacement", Some(replacement_expiry))],
                            area_events: vec![mk_timed_card("wfcd-event-replacement", Some(replacement_expiry))],
                            archimedea: vec![mk_timed_card("wfcd-archimedea-replacement", Some(replacement_expiry))],
                        })
                    },
                    descendia: if failed_source == Some("descendia") {
                        Err(timed::TimedSourceError::failed("descendia down"))
                    } else {
                        Ok(vec![mk_timed_card("descendia-replacement", Some(replacement_expiry))])
                    },
                    circuit: if failed_source == Some("circuit") {
                        Err(timed::TimedSourceError::failed("circuit down"))
                    } else {
                        Ok(vec![mk_timed_card("circuit-replacement", Some(replacement_expiry))])
                    },
                    bounties: if failed_source == Some("bounties") {
                        Err(timed::TimedSourceError::failed("bounties down"))
                    } else {
                        Ok(vec![mk_timed_card("bounties-replacement", Some(replacement_expiry))])
                    },
                    area_objectives: if failed_source == Some("location") {
                        Err(timed::TimedSourceError::failed("location down"))
                    } else {
                        Ok(vec![mk_timed_card("location-replacement", Some(replacement_expiry))])
                    },
                    arbitration: if failed_source == Some("arbitration") {
                        Err(timed::TimedSourceError::failed("arbitration down"))
                    } else {
                        Ok(vec![mk_timed_card("arbitration-replacement", Some(replacement_expiry))])
                    },
                },
            );

            for (source, cards, lkg_id, replacement_id) in [
                ("wfcd", &snapshot.sortie, "wfcd-sortie-lkg", "wfcd-sortie-replacement"),
                ("wfcd", &snapshot.archon, "wfcd-archon-lkg", "wfcd-archon-replacement"),
                ("wfcd", &snapshot.syndicates, "wfcd-syndicates-lkg", "wfcd-syndicates-replacement"),
                ("wfcd", &snapshot.area_missions, "wfcd-area-lkg", "wfcd-area-replacement"),
                ("wfcd", &snapshot.area_environments, "wfcd-environment-lkg", "wfcd-environment-replacement"),
                ("wfcd", &snapshot.area_events, "wfcd-event-lkg", "wfcd-event-replacement"),
                ("wfcd", &snapshot.archimedea, "wfcd-archimedea-lkg", "wfcd-archimedea-replacement"),
                ("descendia", &snapshot.descendia, "descendia-lkg", "descendia-replacement"),
                ("circuit", &snapshot.circuit, "circuit-lkg", "circuit-replacement"),
                ("bounties", &snapshot.bounties, "bounties-lkg", "bounties-replacement"),
                ("location", &snapshot.area_objectives, "location-lkg", "location-replacement"),
                ("arbitration", &snapshot.arbitration, "arbitration-lkg", "arbitration-replacement"),
            ] {
                prop_assert_eq!(cards.len(), 1, "${msg} ({} slice件数; failed={:?})", source, failed_source);
                let expected_id = if failed_source == Some(source) { lkg_id } else { replacement_id };
                prop_assert_eq!(cards[0].id.as_str(), expected_id, "${msg} ({} slice誤配線; failed={:?})", source, failed_source);
            }

            for (source, status, expected_source) in [
                ("wfcd", &snapshot.sources.wfcd, timed::TimedSourceId::WfcdWorldstate),
                ("descendia", &snapshot.sources.de_descendia, timed::TimedSourceId::DeWorldstate),
                ("circuit", &snapshot.sources.de_circuit, timed::TimedSourceId::DeWorldstate),
                ("bounties", &snapshot.sources.browse_wf_bounties, timed::TimedSourceId::BrowseWfBountyCycle),
                ("location", &snapshot.sources.browse_wf_location_bounties, timed::TimedSourceId::BrowseWfLocationBounties),
                ("arbitration", &snapshot.sources.browse_wf_arbitration, timed::TimedSourceId::BrowseWfArbitrationSchedule),
            ] {
                let failed_here = failed_source == Some(source);
                let expected_error = failed_here.then(|| format!("{source} down"));
                prop_assert_eq!(status.source, expected_source, "${msg} ({} source ID; failed={:?})", source, failed_source);
                prop_assert_eq!(
                    status.freshness,
                    if failed_here { timed::TimedFreshness::Stale } else { timed::TimedFreshness::Fresh },
                    "${msg} ({} freshness; failed={:?})",
                    source,
                    failed_source,
                );
                prop_assert_eq!(status.error.as_deref(), expected_error.as_deref(), "${msg} ({} error; failed={:?})", source, failed_source);
                prop_assert_eq!(status.last_attempt, Some(now), "${msg} ({} last_attempt; failed={:?})", source, failed_source);
                prop_assert_eq!(
                    status.last_success,
                    Some(if failed_here { now - Duration::minutes(5) } else { now }),
                    "${msg} ({} last_success; failed={:?})",
                    source,
                    failed_source,
                );
                prop_assert_eq!(
                    status.valid_until,
                    Some(if failed_here { lkg_expiry } else { replacement_expiry }),
                    "${msg} ({} valid_until; failed={:?})",
                    source,
                    failed_source,
                );
            }
            prop_assert_eq!(snapshot.last_poll, Some(now), "${msg} (snapshot poll時刻; failed={:?})", failed_source);
        }

        // validなdynamic payloadのstatic join失敗と、dynamic payload自体の失敗を分離する。
        let bounty_static_join_error: Result<Vec<timed::TimedContent>, timed::TimedSourceError> =
            Err(timed::TimedSourceError::failed("bounty join failed"));
        let location_static_join_error: Result<Vec<timed::TimedContent>, timed::TimedSourceError> =
            Err(timed::TimedSourceError::failed("location join failed"));
        let location_ok: Result<Vec<timed::TimedContent>, timed::TimedSourceError> = Ok(vec![]);
        let arbitration_ok: Result<Vec<timed::TimedContent>, timed::TimedSourceError> = Ok(vec![]);
        let hints = timed::static_asset_refresh_hints(
            true,
            false,
            &bounty_static_join_error,
            &location_ok,
            &arbitration_ok,
        );
        prop_assert!(hints.bounties, "${msg} (valid Bounty payloadのstatic join失敗でBounty asset refreshを要求しない)");
        prop_assert!(!hints.location_bounties, "${msg} (Bounty join失敗がlocation asset refreshへ伝播した)");
        prop_assert!(!hints.arbitration, "${msg} (Bounty join失敗がArbitration asset refreshへ伝播した)");

        let bounty_ok: Result<Vec<timed::TimedContent>, timed::TimedSourceError> = Ok(vec![]);
        let hints = timed::static_asset_refresh_hints(
            false,
            true,
            &bounty_ok,
            &location_static_join_error,
            &arbitration_ok,
        );
        prop_assert!(!hints.bounties, "${msg} (location join失敗がBounty asset refreshへ伝播した)");
        prop_assert!(hints.location_bounties, "${msg} (valid location payloadのjoin失敗でlocation asset refreshを要求しない)");
        prop_assert!(!hints.arbitration, "${msg} (location join失敗がArbitration asset refreshへ伝播した)");

        let bounty_dynamic_payload_error: Result<Vec<timed::TimedContent>, timed::TimedSourceError> =
            Err(timed::TimedSourceError::failed("malformed bounty payload"));
        let hints = timed::static_asset_refresh_hints(
            false,
            false,
            &bounty_dynamic_payload_error,
            &location_ok,
            &arbitration_ok,
        );
        prop_assert!(!hints.bounties, "${msg} (Bounty dynamic payload失敗でstatic cacheをinvalidateした)");
        prop_assert!(!hints.location_bounties, "${msg} (Bounty dynamic payload失敗がlocation cacheへ伝播した)");
        prop_assert!(!hints.arbitration, "${msg} (Bounty dynamic payload失敗がArbitration asset refreshへ伝播した)");

        let arbitration_out_of_range: Result<Vec<timed::TimedContent>, timed::TimedSourceError> =
            Err(timed::TimedSourceError::out_of_range("schedule ended"));
        let hints = timed::static_asset_refresh_hints(
            false,
            false,
            &bounty_ok,
            &location_ok,
            &arbitration_out_of_range,
        );
        prop_assert!(!hints.bounties, "${msg} (Arbitration範囲外がBounty asset refreshへ伝播した)");
        prop_assert!(!hints.location_bounties, "${msg} (Arbitration範囲外がlocation asset refreshへ伝播した)");
        prop_assert!(hints.arbitration, "${msg} (Arbitration範囲外でArbitration asset refreshを要求しない)");

        let join_retry_delays = (1..=5)
            .map(timed::static_join_retry_delay_secs)
            .collect::<Vec<_>>();
        prop_assert_eq!(
            join_retry_delays,
            vec![60, 300, 1_800, 7_200, 7_200],
            "${msg} (join不整合の再取得backoffが1分/5分/30分/2時間上限でない)",
        );
    }`;
    case "bounty_freshness":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(expiry_delta_ms in -86_400_000i64..86_400_001) {
        let now = base_now();
        let expiry_ms = now.timestamp_millis() + expiry_delta_ms;
        let body = format!(
            r#"{{"expiry":{expiry_ms},"rot":"A","vaultRot":"B","zarimanFaction":"FC_GRINEER","bounties":{{"ZarimanSyndicate":[{{"node":"Node","challenge":"Challenge"}}],"EntratiLabSyndicate":[{{"node":"Node","challenge":"Challenge"}}],"HexSyndicate":[{{"node":"Node","challenge":"Challenge"}}]}}}}"#,
        );
        let parsed = timed::parse_bounty_cycle_json(&body, now);
        prop_assert_eq!(parsed.is_ok(), expiry_delta_ms > 0, "${msg} (expiry境界)");

        for invalid in vec![
            r#"{"rot":"A","vaultRot":"B","zarimanFaction":"FC_GRINEER","bounties":{}}"#.to_string(),
            r#"{"expiry":"not-ms","rot":"A","vaultRot":"B","zarimanFaction":"FC_GRINEER","bounties":{}}"#.to_string(),
            format!(r#"{{"expiry":{},"rot":"A","vaultRot":"B","zarimanFaction":"FC_GRINEER","bounties":{{}}}}"#, now.timestamp_millis()),
        ] {
            prop_assert!(timed::parse_bounty_cycle_json(&invalid, now).is_err(), "${msg} (不正/期限切れexpiryを受理した)");
        }

        let mut cards = vec![mk_timed_card("lkg", Some(now + Duration::hours(1)))];
        let mut status = mk_timed_status(timed::TimedSourceId::BrowseWfBountyCycle);
        let update = parsed.map(|_| vec![mk_timed_card("new", Some(now + Duration::hours(2)))]);
        timed::apply_timed_source_result(&mut cards, &mut status, now, update);
        if expiry_delta_ms > 0 {
            prop_assert_eq!(cards[0].id.as_str(), "new", "${msg} (fresh payloadで更新しない)");
        } else {
            prop_assert_eq!(cards[0].id.as_str(), "lkg", "${msg} (stale payloadがLKGを上書きした)");
            prop_assert_eq!(status.freshness, timed::TimedFreshness::Stale, "${msg} (stale payloadのhealth)");
        }
    }`;
    case "filtered_view":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(s in arb_settings(), fs in proptest::collection::vec(arb_fissure(), 0..30)) {
        let now = base_now();
        let visible = poller::visible_fissures(&s, &fs, now);
        // notifyは表示判定へ影響しない
        let mut notify_toggled = s.clone();
        for rule in &mut notify_toggled.rules {
            rule.notify = !rule.notify;
        }
        prop_assert_eq!(
            poller::visible_fissures(&notify_toggled, &fs, now),
            visible.clone(),
            "${msg} (notify変更で一覧表示が変化した)"
        );
        if s.rules.iter().any(|rule| rule.enabled) {
            for f in &visible {
                prop_assert!(filter::matches(&s, f, now), "${msg} (対象外が表示された)");
            }
            for f in fs.iter().filter(|f| filter::matches(&s, f, now)) {
                prop_assert!(visible.iter().any(|v| v.id == f.id), "${msg} (合致亀裂が欠落した)");
            }
        } else {
            // 無指定(表示選択なし): 通知参加・min_remainingとは独立に生存中だけ全件表示する
            let live: Vec<&Fissure> = fs.iter().filter(|f| f.expiry > now).collect();
            prop_assert_eq!(visible.len(), live.len(), "${msg} (無指定の生存中全件と一致しない)");
            for f in live {
                prop_assert!(visible.iter().any(|v| v.id == f.id), "${msg} (無指定で生存中亀裂が欠落した)");
            }
            for f in fs.iter().filter(|f| f.expiry <= now) {
                prop_assert!(!visible.iter().any(|v| v.id == f.id), "${msg} (無指定で期限切れを表示した)");
            }
        }
    }`;
    case "fuzzy_subsequence":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(q in ".{0,12}", text in ".{0,24}") {
        if let Some((_score, idx)) = palette::fuzzy_score(&q, &text) {
            let tc: Vec<char> = text.chars().collect();
            let qc: Vec<char> = q.chars().collect();
            prop_assert_eq!(idx.len(), qc.len(), "${msg}");
            for w in idx.windows(2) {
                prop_assert!(w[0] < w[1], "${msg} (順序が保存されていない)");
            }
            for (k, &i) in idx.iter().enumerate() {
                let a = tc[i];
                let b = qc[k];
                prop_assert!(a == b || a.to_lowercase().eq(b.to_lowercase()), "${msg} (文字不一致)");
            }
        }
    }`;
    case "fuzzy_empty_query":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(labels in proptest::collection::vec("[A-Za-z ]{1,12}", 0..20)) {
        let catalog = mk_catalog(labels);
        prop_assert_eq!(palette::query_catalog(&catalog, "").len(), catalog.len(), "${msg}");
    }`;
    case "fuzzy_exact_first":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(labels in proptest::collection::vec("[a-z]{1,8}", 1..15), pick in any::<prop::sample::Index>()) {
        let q = labels[pick.index(labels.len())].clone();
        let catalog = mk_catalog(labels);
        let res = palette::query_catalog(&catalog, &q);
        prop_assert!(!res.is_empty(), "${msg} (結果が空)");
        let top = &catalog[res[0].idx];
        let exact = top.label.eq_ignore_ascii_case(&q)
            || top.aliases.iter().any(|a| a.eq_ignore_ascii_case(&q));
        prop_assert!(exact, "${msg} (先頭が完全一致でない: {})", top.label);
    }`;
    case "fuzzy_deterministic":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(labels in proptest::collection::vec("[A-Za-z ]{1,10}", 0..15), q in "[a-z]{0,6}") {
        let catalog = mk_catalog(labels);
        let a: Vec<usize> = palette::query_catalog(&catalog, &q).into_iter().map(|r| r.idx).collect();
        let b: Vec<usize> = palette::query_catalog(&catalog, &q).into_iter().map(|r| r.idx).collect();
        prop_assert_eq!(a, b, "${msg}");
    }`;
    case "satisfiable_after_ops":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(ops in proptest::collection::vec(any::<prop::sample::Index>(), 0..40)) {
        let catalog = palette::filter_catalog();
        let mut state = palette::EditorState::default();
        for op in ops {
            let cand = &catalog[op.index(catalog.len())];
            palette::apply(&mut state, cand);
            for rule in &state.rules {
                prop_assert!(
                    palette::satisfiable(rule),
                    "${msg} ({} 適用後に充足不能: {:?})", cand.id, rule
                );
            }
        }
    }`;
    case "editor_activation_independent":
      return `
    /// ${c.id}: ${c.desc} (enabled切替)
    #[test]
    fn ${fnName(c.id, "set_enabled")}(
        rules in proptest::collection::vec(arb_rule(), 1..5),
        edit_pick in any::<prop::sample::Index>(),
        target_pick in any::<prop::sample::Index>(),
        enabled in any::<bool>(),
    ) {
        let active = edit_pick.index(rules.len());
        let target = target_pick.index(rules.len());
        let mut expected_rules = rules.clone();
        expected_rules[target].enabled = enabled;
        let mut state = palette::EditorState { rules, active };
        let before_active = state.active;
        prop_assert!(
            palette::set_rule_enabled(&mut state, target, enabled),
            "${msg} (有効なindexの切替に失敗した)"
        );
        prop_assert_eq!(state.active, before_active, "${msg} (enabled切替でedit indexが変化した)");
        prop_assert_eq!(state.rules.as_slice(), expected_rules.as_slice(), "${msg} (enabled以外の条件が変化した)");

        let before_invalid = state.clone();
        let invalid_index = state.rules.len();
        prop_assert!(
            !palette::set_rule_enabled(&mut state, invalid_index, enabled),
            "${msg} (範囲外indexを成功扱いした)"
        );
        prop_assert_eq!(state, before_invalid, "${msg} (範囲外indexでstateを変更した)");
    }

    /// ${c.id}: ${c.desc} (notify切替)
    #[test]
    fn ${fnName(c.id, "set_notify")}(
        rules in proptest::collection::vec(arb_rule(), 1..5),
        edit_pick in any::<prop::sample::Index>(),
        target_pick in any::<prop::sample::Index>(),
        notify in any::<bool>(),
    ) {
        let active = edit_pick.index(rules.len());
        let target = target_pick.index(rules.len());
        let mut expected_rules = rules.clone();
        expected_rules[target].notify = notify;
        let mut state = palette::EditorState { rules, active };
        let before_active = state.active;
        prop_assert!(
            palette::set_rule_notify(&mut state, target, notify),
            "${msg} (有効なindexのnotify切替に失敗した)"
        );
        prop_assert_eq!(state.active, before_active, "${msg} (notify切替でedit indexが変化した)");
        prop_assert_eq!(state.rules.as_slice(), expected_rules.as_slice(), "${msg} (notify以外が変化した)");

        let before_invalid = state.clone();
        let invalid_index = state.rules.len();
        prop_assert!(
            !palette::set_rule_notify(&mut state, invalid_index, notify),
            "${msg} (範囲外indexのnotify切替を成功扱いした)"
        );
        prop_assert_eq!(state, before_invalid, "${msg} (範囲外indexでstateを変更した)");
    }

    /// ${c.id}: ${c.desc} (edit focus変更)
    #[test]
    fn ${fnName(c.id, "edit_focus")}(
        rules in proptest::collection::vec(arb_rule(), 1..5),
        pick in any::<prop::sample::Index>(),
    ) {
        let before = rules.clone();
        let mut state = palette::EditorState { rules, active: 0 };
        state.active = pick.index(state.rules.len());
        prop_assert_eq!(state.rules.as_slice(), before.as_slice(), "${msg} (edit index変更でrulesが変化した)");
    }

    /// ${c.id}: ${c.desc} (非表示・通知OFF draftの条件編集)
    #[test]
    fn ${fnName(c.id, "disabled_edit")}(
        mut rule in arb_rule(),
        mut guard in arb_rule(),
        ops in proptest::collection::vec(any::<prop::sample::Index>(), 0..40),
    ) {
        rule.enabled = false;
        rule.notify = false;
        guard.enabled = true;
        guard.notify = true;
        let expected_projection = vec![WatchRule { name: None, ..guard.clone() }];
        let mut state = palette::EditorState { rules: vec![rule, guard], active: 0 };
        let candidates: Vec<Candidate> = palette::catalog()
            .into_iter()
            .filter(|candidate| candidate.facet != Facet::Action)
            .collect();
        for op in ops {
            let candidate = &candidates[op.index(candidates.len())];
            palette::apply(&mut state, candidate);
            prop_assert_eq!(state.rules.len(), 2, "${msg} ({} 適用でルール数が変わった)", candidate.id);
            prop_assert!(!state.rules[0].enabled, "${msg} ({} 適用で非表示ruleを表示選択した)", candidate.id);
            prop_assert!(!state.rules[0].notify, "${msg} ({} 適用でdraftを通知参加させた)", candidate.id);
            let settings = FilterSettings {
                rules: state.rules.clone(),
                min_remaining_secs: 0,
            };
            let projection = filter::notification_projection(&settings);
            prop_assert_eq!(
                projection.rules.as_slice(),
                expected_projection.as_slice(),
                "${msg} (notify=false draft編集がnotification projectionへ現れた)"
            );
        }
    }`;
    case "unselected_apply_creates_rule":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(
        mut rules in proptest::collection::vec(arb_rule(), 1..5),
        pick in any::<prop::sample::Index>(),
        first_pick in any::<prop::sample::Index>(),
        second_pick in any::<prop::sample::Index>(),
    ) {
        for rule in rules.iter_mut() {
            rule.enabled = false;
            // 既存ルールを安全な空draftと区別し、必ず新規作成経路を検査する
            rule.notify = true;
        }
        let active = pick.index(rules.len());
        let candidates: Vec<Candidate> = palette::catalog()
            .into_iter()
            .filter(|candidate| !matches!(candidate.facet, Facet::Action | Facet::Rule))
            .collect();
        let first = &candidates[first_pick.index(candidates.len())];
        let second = &candidates[second_pick.index(candidates.len())];

        // VIEW選択0本では既存ルールを保持し、VIEW ON・NOTIFY OFFの新ルールへ適用する
        let mut state = palette::EditorState { rules: rules.clone(), active };
        palette::apply(&mut state, first);
        prop_assert_eq!(state.rules.len(), rules.len() + 1, "${msg} (新しいVIEWルールを1本追加しない)");
        prop_assert_eq!(&state.rules[..rules.len()], rules.as_slice(), "${msg} (既存ルールを変更した)");
        prop_assert_eq!(state.active, rules.len(), "${msg} (新しいルールをedit対象にしない)");

        let mut expected = palette::EditorState {
            rules: vec![WatchRule { enabled: true, notify: false, ..WatchRule::default() }],
            active: 0,
        };
        palette::apply(&mut expected, first);
        prop_assert_eq!(state.rules.last(), expected.rules.first(), "${msg} (最初の候補を新ルールへ正しく適用しない)");
        let expected_after_first = expected.rules[0].clone();
        prop_assert!(state.rules.last().expect("新ルール追加済み").enabled, "${msg} (新ルールがVIEW OFF)");
        prop_assert!(!state.rules.last().expect("新ルール追加済み").notify, "${msg} (新ルールを暗黙に通知参加させた)");

        // 2候補目は同じ新ルールへ連続適用し、さらにルールを増やさない
        palette::apply(&mut state, second);
        palette::apply(&mut expected, second);
        prop_assert_eq!(state.rules.len(), rules.len() + 1, "${msg} (後続候補でルールが増殖した)");
        prop_assert_eq!(&state.rules[..rules.len()], rules.as_slice(), "${msg} (後続候補で既存ルールを変更した)");
        prop_assert_eq!(state.active, rules.len(), "${msg} (後続候補でedit対象が移動した)");
        prop_assert_eq!(state.rules.last(), expected.rules.first(), "${msg} (後続候補を同じ新ルールへ適用しない)");

        // ルール自体が0本でも同じVIEW ON・NOTIFY OFFルールを1本だけ作る
        let mut empty = palette::EditorState { rules: vec![], active: 0 };
        palette::apply(&mut empty, first);
        prop_assert_eq!(empty.rules, vec![expected_after_first], "${msg} (ルール0本から正しい新VIEWルールを作らない)");
        prop_assert_eq!(empty.active, 0, "${msg} (ルール0本から作成したルールをedit対象にしない)");
    }`;
    case "new_rule_disabled":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(
        rules in proptest::collection::vec(arb_rule(), 0..5),
        pick in any::<prop::sample::Index>(),
        cand_pick in any::<prop::sample::Index>(),
    ) {
        let active = if rules.is_empty() { 0 } else { pick.index(rules.len()) };
        let mut state = palette::EditorState { rules, active };
        let before = state.rules.clone();
        let catalog = palette::catalog();
        let new_rule = catalog.iter()
            .find(|candidate| candidate.id == "action:new-rule")
            .expect("NEW RULE candidateが存在すること");
        palette::apply(&mut state, new_rule);
        prop_assert_eq!(state.rules.len(), before.len() + 1, "${msg} (draftが1本追加されない)");
        prop_assert_eq!(&state.rules[..before.len()], before.as_slice(), "${msg} (既存ルールを変更した)");
        prop_assert!(!state.rules.last().expect("draft追加済み").enabled, "${msg} (NEW RULEがenabledで作成された)");
        prop_assert!(!state.rules.last().expect("draft追加済み").notify, "${msg} (NEW RULEがnotify=trueで作成された)");
        prop_assert_eq!(state.active, state.rules.len() - 1, "${msg} (新しいdraftがedit対象でない)");

        // VIEW選択0本の明示draftへ最初のfilter候補を適用すると、draftを再利用してVIEWルールへ確定する
        let mut no_view = before.clone();
        for rule in &mut no_view {
            rule.enabled = false;
            rule.notify = true;
        }
        let prefix = no_view.clone();
        let active = if no_view.is_empty() { 0 } else { pick.index(no_view.len()) };
        let mut draft_state = palette::EditorState { rules: no_view, active };
        palette::apply(&mut draft_state, new_rule);
        let draft_index = draft_state.active;
        // nameは判定条件ではないため、名前付きの空draftも同じルールとして再利用する
        draft_state.rules[draft_index].name = Some("NAMED DRAFT".to_string());
        let filter_candidates: Vec<Candidate> = palette::catalog()
            .into_iter()
            .filter(|candidate| !matches!(candidate.facet, Facet::Action | Facet::Rule))
            .collect();
        let filter_candidate = &filter_candidates[cand_pick.index(filter_candidates.len())];
        palette::apply(&mut draft_state, filter_candidate);
        prop_assert_eq!(draft_state.rules.len(), prefix.len() + 1, "${msg} (空draft適用時に別ルールを追加した)");
        prop_assert_eq!(&draft_state.rules[..prefix.len()], prefix.as_slice(), "${msg} (空draft確定時に既存ルールを変更した)");
        prop_assert_eq!(draft_state.active, draft_index, "${msg} (空draft確定時にedit対象を移動した)");
        prop_assert!(draft_state.rules[draft_index].enabled, "${msg} (空draftをVIEWルールへ確定しない)");
        prop_assert!(!draft_state.rules[draft_index].notify, "${msg} (空draftを暗黙に通知参加させた)");
        prop_assert_eq!(draft_state.rules[draft_index].name.as_deref(), Some("NAMED DRAFT"), "${msg} (空draft確定時に名前を失った)");
    }`;
    case "rule_toggle_candidates":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(
        rules in proptest::collection::vec(arb_rule(), 1..5),
        edit_pick in any::<prop::sample::Index>(),
        target_pick in any::<prop::sample::Index>(),
    ) {
        let active = edit_pick.index(rules.len());
        let target = target_pick.index(rules.len());
        let catalog = palette::catalog_with_rules(&rules);
        // 静的カタログの語彙は据え置きで、各ルールのrule:{index}候補が追加される
        for (i, rule) in rules.iter().enumerate() {
            let cand = catalog.iter()
                .find(|c| c.id == format!("rule:{i}"))
                .expect("rule候補が存在すること");
            let expected_label = rule.name.clone().unwrap_or_else(|| format!("R{}", i + 1));
            prop_assert_eq!(&cand.label, &expected_label, "${msg} (labelが名前/R{{n}}でない)");
            prop_assert_eq!(cand.facet, Facet::Rule, "${msg} (facetがRULEでない)");
        }
        // 適用は対象ルールのenabledだけを反転し、条件・順序・edit indexを変えない
        let cand = catalog.iter()
            .find(|c| c.id == format!("rule:{target}"))
            .expect("rule候補が存在すること");
        let mut state = palette::EditorState { rules: rules.clone(), active };
        palette::apply(&mut state, cand);
        prop_assert_eq!(state.active, active, "${msg} (edit indexが変化した)");
        let mut expected = rules.clone();
        expected[target].enabled = !rules[target].enabled;
        prop_assert_eq!(state.rules.as_slice(), expected.as_slice(), "${msg} (enabled反転以外が変化した)");
        // 再適用で元に戻る(トグル)
        palette::apply(&mut state, cand);
        prop_assert_eq!(state.rules.as_slice(), rules.as_slice(), "${msg} (再適用で往復しない)");

        // action:toggle-rule は編集中(active)ルールのenabledだけを同様に反転する
        let toggle_cand = catalog.iter()
            .find(|c| c.id == "action:toggle-rule")
            .expect("TOGGLE RULE候補が存在すること");
        let mut state = palette::EditorState { rules: rules.clone(), active };
        palette::apply(&mut state, toggle_cand);
        prop_assert_eq!(state.active, active, "${msg} (toggle-ruleでedit indexが変化した)");
        let mut expected = rules.clone();
        expected[active].enabled = !rules[active].enabled;
        prop_assert_eq!(state.rules.as_slice(), expected.as_slice(), "${msg} (toggle-ruleがactive以外を変更した)");
        palette::apply(&mut state, toggle_cand);
        prop_assert_eq!(state.rules.as_slice(), rules.as_slice(), "${msg} (toggle-rule再適用で往復しない)");

        // action:notify-rule は編集中(active)ルールのnotifyだけを同様に反転する
        let notify_cand = catalog.iter()
            .find(|c| c.id == "action:notify-rule")
            .expect("TOGGLE NOTIFY候補が存在すること");
        let mut state = palette::EditorState { rules: rules.clone(), active };
        palette::apply(&mut state, notify_cand);
        prop_assert_eq!(state.active, active, "${msg} (notify-ruleでedit indexが変化した)");
        let mut expected = rules.clone();
        expected[active].notify = !rules[active].notify;
        prop_assert_eq!(state.rules.as_slice(), expected.as_slice(), "${msg} (notify-ruleがnotify以外を変更した)");
        palette::apply(&mut state, notify_cand);
        prop_assert_eq!(state.rules.as_slice(), rules.as_slice(), "${msg} (notify-rule再適用で往復しない)");

        // action:deselect-all-rules は全enabledだけをfalseにし、通知射影・条件・順序・edit indexを保持する
        let deselect_cand = catalog.iter()
            .find(|c| c.id == "action:deselect-all-rules")
            .expect("DESELECT ALL RULES候補が存在すること");
        let before_projection = filter::notification_projection(&FilterSettings {
            rules: rules.clone(),
            min_remaining_secs: 123,
        });
        let mut state = palette::EditorState { rules: rules.clone(), active };
        palette::apply(&mut state, deselect_cand);
        prop_assert_eq!(state.active, active, "${msg} (全ルール解除でedit indexが変化した)");
        let mut expected = rules.clone();
        for rule in &mut expected {
            rule.enabled = false;
        }
        prop_assert_eq!(state.rules.as_slice(), expected.as_slice(), "${msg} (全ルール解除がenabled以外を変更した)");
        let after_projection = filter::notification_projection(&FilterSettings {
            rules: state.rules.clone(),
            min_remaining_secs: 123,
        });
        prop_assert_eq!(after_projection, before_projection, "${msg} (全ルール解除で通知射影が変化した)");
        palette::apply(&mut state, deselect_cand);
        prop_assert_eq!(state.rules.as_slice(), expected.as_slice(), "${msg} (全ルール解除が冪等でない)");
    }`;
    case "notify_candidates":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(
        s in arb_settings(),
        fs in proptest::collection::vec(arb_fissure(), 0..30),
        mut hidden_fissure in arb_fissure(),
    ) {
        let now = base_now();
        let candidates = poller::notify_candidates(&s, &fs, now);
        let scope = filter::notification_projection(&s);
        // 健全性: 候補はnotify=trueルールのORに合致する
        for f in &candidates {
            prop_assert!(filter::matches(&scope, f, now), "${msg} (通知対象外が候補になった)");
        }
        // 完全性: 通知参加ルールに合致する亀裂は1件も取りこぼさない
        for f in fs.iter().filter(|f| filter::matches(&scope, f, now)) {
            prop_assert!(candidates.iter().any(|c| c.id == f.id), "${msg} (通知候補の取りこぼし)");
        }
        // 明示反例: 非表示(enabled=false)通知ルールだけに合致する亀裂も通知し、一覧には出さない
        hidden_fissure.expiry = now + Duration::hours(1);
        let hidden_notify = WatchRule {
            enabled: false,
            notify: true,
            mode: Mode::Both,
            storms: StormMode::Include,
            ..WatchRule::default()
        };
        let displayed_nonmatch = WatchRule {
            enabled: true,
            notify: false,
            tiers: vec!["__never_matches__".to_string()],
            mode: Mode::Both,
            storms: StormMode::Include,
            ..WatchRule::default()
        };
        let separated = FilterSettings {
            rules: vec![displayed_nonmatch, hidden_notify],
            min_remaining_secs: 0,
        };
        let hidden_candidates = poller::notify_candidates(&separated, &[hidden_fissure.clone()], now);
        let visible = poller::visible_fissures(&separated, &[hidden_fissure.clone()], now);
        prop_assert_eq!(hidden_candidates.len(), 1, "${msg} (非表示通知ルールの合致を候補にしない)");
        prop_assert_eq!(hidden_candidates[0].id.as_str(), hidden_fissure.id.as_str(), "${msg} (非表示通知ルールで別idを選んだ)");
        prop_assert!(visible.is_empty(), "${msg} (通知ルールを一覧表示へ混入した)");
    }`;
    case "clear_resets":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(rules in proptest::collection::vec(arb_rule(), 0..4), pick in any::<prop::sample::Index>()) {
        let active = if rules.is_empty() { 0 } else { pick.index(rules.len()) };
        let mut state = palette::EditorState { rules, active };
        palette::clear(&mut state);
        prop_assert_eq!(state.rules.len(), 1, "${msg}");
        prop_assert_eq!(state.active, 0, "${msg}");
        let r = &state.rules[0];
        prop_assert!(
            r.tiers.is_empty() && r.mission_types.is_empty() && r.planets.is_empty(),
            "${msg} (軸が既定でない)"
        );
        prop_assert!(matches!(r.mode, Mode::Both), "${msg} (modeが既定でない)");
        prop_assert!(matches!(r.storms, StormMode::Exclude), "${msg} (stormsが既定でない)");
        prop_assert!(r.enabled, "${msg} (既定ルールがdisabled)");
        prop_assert!(palette::satisfiable(r), "${msg} (既定ルールが充足不能)");
    }`;
    case "legacy_storm_config":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(include in any::<bool>()) {
        let raw = format!(r#"{{"includeStorms":{include}}}"#);
        let rule: WatchRule = serde_json::from_str(&raw)
            .expect("旧WatchRule JSONを読み込めること");
        let expected = if include { StormMode::Include } else { StormMode::Exclude };
        prop_assert_eq!(rule.storms, expected, "${msg}");
    }`;
    case "manual":
      return ""; // 機械検証なし。SPEC.mdのみ
    default:
      throw new Error(`未知のパターン: ${c.pattern} (${c.id})`);
  }
}

function genExampleClause(c: Clause): string {
  const name = fnName(c.id);
  const msg = `SPEC ${c.id} 違反: ${c.desc.replace(/"/g, '\\"').replace(/{/g, "{{").replace(/}/g, "}}")}`;
  if (c.pattern === "legacy_rule_enabled") {
    return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let legacy: WatchRule = serde_json::from_str(
        r#"{"tiers":["Axi"],"includeStorms":false}"#,
    )
    .expect("enabled欠落の旧WatchRule JSONを読み込めること");
    assert!(legacy.enabled, "${msg} (enabled欠落をfalseへ移行した)");

    let explicit_disabled: WatchRule = serde_json::from_str(r#"{"enabled":false}"#)
        .expect("enabled=falseを読み込めること");
    assert!(!explicit_disabled.enabled, "${msg} (明示falseをtrueへ変更した)");
    let encoded = serde_json::to_string(&explicit_disabled)
        .expect("enabled=falseをserializeできること");
    let round_trip: WatchRule = serde_json::from_str(&encoded)
        .expect("serialize済みWatchRuleを再読込できること");
    assert!(!round_trip.enabled, "${msg} (round-tripで明示falseを失った)");
}`;
  }
  if (c.pattern === "rule_name_config") {
    return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let legacy: WatchRule = serde_json::from_str(
        r#"{"tiers":["Axi"],"includeStorms":false}"#,
    )
    .expect("name欠落の旧WatchRule JSONを読み込めること");
    assert!(legacy.name.is_none(), "${msg} (name欠落を名前ありへ移行した)");

    let named = WatchRule {
        name: Some("MY FARM".to_string()),
        tiers: vec!["Axi".to_string()],
        enabled: false,
        ..WatchRule::default()
    };
    let encoded = serde_json::to_string(&named).expect("name付きWatchRuleをserializeできること");
    let round_trip: WatchRule = serde_json::from_str(&encoded)
        .expect("serialize済みWatchRuleを再読込できること");
    assert_eq!(round_trip, named, "${msg} (nameまたは他フィールドがround-tripで変わった)");
}`;
  }
  if (c.pattern === "rule_notify_config") {
    return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let legacy_enabled: WatchRule = serde_json::from_str(
        r#"{"tiers":["Axi"],"includeStorms":false}"#,
    )
    .expect("notify欠落の旧WatchRule JSONを読み込めること");
    assert!(legacy_enabled.enabled && legacy_enabled.notify, "${msg} (enabled欠落時の既定trueをnotifyへ引き継がない)");

    let legacy_disabled: WatchRule = serde_json::from_str(
        r#"{"enabled":false,"tiers":["Axi"]}"#,
    )
    .expect("notify欠落・enabled=falseの旧WatchRule JSONを読み込めること");
    assert!(!legacy_disabled.notify, "${msg} (旧disabled draftを通知ONへ移行した)");

    let hidden_notify: WatchRule = serde_json::from_str(
        r#"{"enabled":false,"notify":true,"tiers":["Axi"]}"#,
    )
    .expect("明示notify=trueの非表示WatchRule JSONを読み込めること");
    assert!(!hidden_notify.enabled && hidden_notify.notify, "${msg} (明示notify=trueをenabledへ結合した)");

    let display_only = WatchRule {
        notify: false,
        enabled: true,
        tiers: vec!["Axi".to_string()],
        ..WatchRule::default()
    };
    let encoded =
        serde_json::to_string(&display_only).expect("notify=falseのWatchRuleをserializeできること");
    let round_trip: WatchRule = serde_json::from_str(&encoded)
        .expect("serialize済みWatchRuleを再読込できること");
    assert_eq!(round_trip, display_only, "${msg} (notifyまたは他フィールドがround-tripで変わった)");

    let encoded = serde_json::to_string(&hidden_notify)
        .expect("enabled=false, notify=trueのWatchRuleをserializeできること");
    let round_trip: WatchRule = serde_json::from_str(&encoded)
        .expect("非表示通知WatchRuleを再読込できること");
    assert_eq!(round_trip, hidden_notify, "${msg} (enabledとnotifyの独立状態をround-tripで失った)");
}`;
  }
  if (c.pattern === "app_config_compat") {
    return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let legacy: AppConfig = serde_json::from_str(r#"{}"#)
        .expect("locale/mute欠落の旧AppConfig JSONを読み込めること");
    assert_eq!(legacy.locale, AppLocale::Ja, "${msg} (locale欠落がjaでない)");
    assert!(!legacy.notification_mute.enabled, "${msg} (mute欠落をONへ移行した)");

    for (locale, wire) in [
        (AppLocale::Ja, "ja"),
        (AppLocale::En, "en"),
        (AppLocale::ZhHans, "zh-Hans"),
    ] {
        let mut cfg = AppConfig::default();
        cfg.locale = locale.clone();
        cfg.notification_mute = DailyMuteWindow {
            enabled: true,
            start_minute: 22 * 60 + 15,
            end_minute: 6 * 60 + 45,
        };
        let encoded = serde_json::to_string(&cfg).expect("AppConfigをserializeできること");
        let value: serde_json::Value = serde_json::from_str(&encoded)
            .expect("serialize済みAppConfigがJSONであること");
        assert_eq!(value["locale"], wire, "${msg} (locale wire値)");
        assert_eq!(value["notificationMute"]["enabled"], true, "${msg} (mute enabled wire値)");
        assert_eq!(value["notificationMute"]["startMinute"], 1335, "${msg} (mute start wire値)");
        assert_eq!(value["notificationMute"]["endMinute"], 405, "${msg} (mute end wire値)");

        let round_trip: AppConfig = serde_json::from_str(&encoded)
            .expect("serialize済みAppConfigを再読込できること");
        assert_eq!(round_trip.locale, locale, "${msg} (locale round-trip)");
        assert!(round_trip.notification_mute.enabled, "${msg} (mute enabled round-trip)");
        assert_eq!(round_trip.notification_mute.start_minute, 1335, "${msg} (mute start round-trip)");
        assert_eq!(round_trip.notification_mute.end_minute, 405, "${msg} (mute end round-trip)");
    }

    for invalid in [
        DailyMuteWindow { enabled: true, start_minute: -1, end_minute: 60 },
        DailyMuteWindow { enabled: true, start_minute: 60, end_minute: -1 },
        DailyMuteWindow { enabled: true, start_minute: 1440, end_minute: 60 },
        DailyMuteWindow { enabled: true, start_minute: 60, end_minute: 1440 },
        DailyMuteWindow { enabled: true, start_minute: 65_536, end_minute: 60 },
    ] {
        assert!(!invalid.is_valid(), "${msg} (範囲外分値をvalid扱いした)");
        assert!(
            (0u16..1440).all(|minute| !invalid.is_muted_at_minute(minute)),
            "${msg} (不正設定が通知を止めた)"
        );
        assert!(!invalid.is_muted_at_minute(1440), "${msg} (範囲外の現在分をミュートした)");
    }

    let base = AppConfig::default();
    let projection = filter::notification_projection(&base.filter());
    let mut presentation_only = base;
    presentation_only.locale = AppLocale::ZhHans;
    presentation_only.notification_mute = DailyMuteWindow {
        enabled: true,
        start_minute: 1320,
        end_minute: 420,
    };
    assert_eq!(
        filter::notification_projection(&presentation_only.filter()),
        projection,
        "${msg} (locale/mute変更でnotification projectionが変化した)"
    );
}`;
  }
  if (c.pattern === "timed_content_fixture") {
    switch (c.scenario) {
      case "wire_shape":
        return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let mut snapshot = timed::TimedContentSnapshot::default();

    let mut arbitration = mk_timed_card("arbitration", Some(base_now() + Duration::hours(1)));
    arbitration.kind = "arbitration".to_string();
    arbitration.temporal_status = timed::TimedTemporalStatus::Active;
    arbitration.provenance = timed::TimedProvenance {
        kind: timed::TimedSourceKind::CommunitySchedule,
        contributors: vec![
            timed::TimedSourceId::BrowseWfArbitrationSchedule,
            timed::TimedSourceId::BrowseWfRegions,
        ],
    };
    arbitration.source_id = timed::TimedSourceId::BrowseWfArbitrationSchedule;

    let mut circuit = mk_timed_card("circuit", Some(base_now() + Duration::days(1)));
    circuit.kind = "circuit".to_string();
    circuit.temporal_status = timed::TimedTemporalStatus::Upcoming;
    circuit.provenance = timed::TimedProvenance {
        kind: timed::TimedSourceKind::OfficialLive,
        contributors: vec![timed::TimedSourceId::DeWorldstate],
    };
    circuit.source_id = timed::TimedSourceId::DeWorldstate;

    let mut bounty = mk_timed_card("bounty", Some(base_now() + Duration::hours(2)));
    bounty.kind = "bounty".to_string();
    bounty.provenance = timed::TimedProvenance {
        kind: timed::TimedSourceKind::CommunityLive,
        contributors: vec![timed::TimedSourceId::BrowseWfBountyCycle],
    };
    bounty.source_id = timed::TimedSourceId::BrowseWfBountyCycle;

    let mut area_objective = mk_timed_card("area-objective", Some(base_now() + Duration::hours(2)));
    area_objective.kind = "area-objective".to_string();
    area_objective.provenance = timed::TimedProvenance {
        kind: timed::TimedSourceKind::CommunityLive,
        contributors: vec![
            timed::TimedSourceId::BrowseWfLocationBounties,
            timed::TimedSourceId::BrowseWfExportBounties,
            timed::TimedSourceId::BrowseWfDictionaryEn,
        ],
    };
    area_objective.source_id = timed::TimedSourceId::BrowseWfLocationBounties;

    snapshot.arbitration = vec![arbitration];
    snapshot.circuit = vec![circuit];
    snapshot.bounties = vec![bounty];
    snapshot.area_objectives = vec![area_objective];
    snapshot.sources.wfcd.freshness = timed::TimedFreshness::Fresh;
    snapshot.sources.de_descendia.freshness = timed::TimedFreshness::Stale;
    snapshot.sources.de_circuit.freshness = timed::TimedFreshness::OutOfRange;
    snapshot.sources.browse_wf_bounties.freshness = timed::TimedFreshness::Unavailable;
    snapshot.sources.browse_wf_location_bounties.freshness = timed::TimedFreshness::Stale;
    snapshot.last_poll = Some(base_now());

    let value = serde_json::to_value(&snapshot).expect("TimedContentSnapshotをserializeできること");
    assert_eq!(value["arbitration"][0]["temporalStatus"], "active", "${msg} (active wire)");
    assert_eq!(value["circuit"][0]["temporalStatus"], "upcoming", "${msg} (upcoming wire)");
    assert_eq!(value["arbitration"][0]["provenance"]["kind"], "community-schedule", "${msg} (schedule provenance)");
    assert_eq!(value["bounties"][0]["provenance"]["kind"], "community-live", "${msg} (community live provenance)");
    assert_eq!(value["circuit"][0]["provenance"]["kind"], "official-live", "${msg} (official provenance)");
    assert_eq!(
        value["arbitration"][0]["provenance"]["contributors"],
        serde_json::json!(["browse-wf-arbitration-schedule", "browse-wf-regions"]),
        "${msg} (物理contributor ID群)",
    );
    assert_eq!(value["sources"]["wfcd"]["freshness"], "fresh", "${msg} (fresh wire)");
    assert_eq!(value["sources"]["deDescendia"]["freshness"], "stale", "${msg} (stale wire)");
    assert_eq!(value["sources"]["deCircuit"]["freshness"], "out-of-range", "${msg} (out-of-range wire)");
    assert_eq!(value["sources"]["browseWfBounties"]["freshness"], "unavailable", "${msg} (unavailable wire)");
    assert_eq!(value["sources"]["browseWfLocationBounties"]["freshness"], "stale", "${msg} (location freshness wire)");
    assert_eq!(value["areaObjectives"][0]["sourceId"], "browse-wf-location-bounties", "${msg} (location source wire)");
    assert!(value.get("areaMissions").is_some(), "${msg} (camelCase areaMissions)");
    assert!(value.get("areaEnvironments").is_some(), "${msg} (camelCase areaEnvironments)");
    assert!(value.get("areaObjectives").is_some(), "${msg} (camelCase areaObjectives)");
    assert!(value.get("areaEvents").is_some(), "${msg} (camelCase areaEvents)");
    assert!(value.get("lastPoll").is_some(), "${msg} (camelCase lastPoll)");
    let encoded = serde_json::to_string(&value).unwrap();
    assert!(!encoded.contains("availability"), "${msg} (旧synthetic availabilityを残した)");
    assert!(!encoded.contains("netracells"), "${msg} (取得不能netracells fieldを残した)");
}`;
      case "arbitration_join":
        return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let now = base_now();
    let schedule = format!(
        "{},ClanNode7\\n{},ClanNode8\\n",
        now.timestamp(),
        (now + Duration::hours(1)).timestamp(),
    );
    let regions = serde_json::json!({
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
        },
        "ClanNode8": {
            "name": "/node/Cholistan",
            "systemName": "/system/Europa",
            "missionName": "/mission/Excavation",
            "faction": "FC_INFESTATION",
            "minEnemyLevel": 23,
            "maxEnemyLevel": 33
        }
    });
    let challenges = serde_json::json!({
        "/challenge/kill": {
            "name": "/challenge/name",
            "description": "/challenge/description",
            "requiredCount": 10
        }
    });
    let dictionary = serde_json::json!({
        "/node/Cholistan": "Cholistan",
        "/system/Europa": "Europa",
        "/mission/Excavation": "EXCAVATION",
        "/challenge/name": "Operator",
        "/challenge/description": "Kill |COUNT| enemies",
        "/faction/infested": "INFESTED"
    });
    let factions = serde_json::json!({
        "FC_INFESTATION": { "index": 2, "name": "/faction/infested" }
    });
    let assets = timed::parse_community_assets(
        &schedule,
        &regions.to_string(),
        &challenges.to_string(),
        &dictionary.to_string(),
        &factions.to_string(),
    )
    .expect("Public Export fixtureを結合できること");
    let card = timed::arbitration_card(&assets, now + Duration::seconds(1))
        .expect("対象時刻の仲裁cardを生成できること");

    assert_eq!(card.activation, Some(now), "${msg} (activation)");
    assert_eq!(card.expiry, Some(now + Duration::hours(1)), "${msg} (1時間expiry)");
    assert_eq!(card.temporal_status, timed::TimedTemporalStatus::Active, "${msg} (active)");
    assert_eq!(card.provenance.kind, timed::TimedSourceKind::CommunitySchedule, "${msg} (schedule provenance)");
    assert_eq!(card.source_id, timed::TimedSourceId::BrowseWfArbitrationSchedule, "${msg} (source ID)");
    assert_eq!(card.source_name, "browse.wf", "${msg} (source credit)");
    assert!(card.source_url.as_deref().is_some_and(|url| url.contains("browse.wf")), "${msg} (source URL)");
    assert_eq!(card.stages.len(), 1, "${msg} (stage数)");
    assert_eq!(card.stages[0].title, "Excavation", "${msg} (mission)");
    assert_eq!(card.stages[0].node.as_deref(), Some("Cholistan (Europa)"), "${msg} (node/惑星)");
    assert_eq!(card.stages[0].detail.as_deref(), Some("Infested"), "${msg} (faction)");
    assert_eq!(card.stages[0].enemy_levels, vec![23, 33], "${msg} (enemy level)");
    for (key, expected) in [
        ("resourceBonusPercent", "25"),
        ("xpBonusPercent", "18"),
        ("weaponXpBonusFor", "Melee"),
        ("weaponXpBonusPercent", "12"),
    ] {
        assert!(
            card.metadata.iter().any(|item| item.key == key && item.value == expected),
            "${msg} (Dark Sector {key}={expected})",
        );
    }
}`;
      case "oracle_bounties":
        return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let now = base_now();
    let schedule = format!(
        "{},ClanNode7\\n{},ClanNode8\\n",
        now.timestamp(),
        (now + Duration::hours(1)).timestamp(),
    );
    let regions = serde_json::json!({
        "ClanNode7": {
            "name": "/node/Cholistan",
            "systemName": "/system/Europa",
            "missionName": "/mission/Excavation",
            "faction": "FC_INFESTATION",
            "minEnemyLevel": 23,
            "maxEnemyLevel": 33
        },
        "ClanNode8": {
            "name": "/node/Cholistan",
            "systemName": "/system/Europa",
            "missionName": "/mission/Excavation",
            "faction": "FC_INFESTATION",
            "minEnemyLevel": 23,
            "maxEnemyLevel": 33
        }
    });
    let challenges = serde_json::json!({
        "/challenge/kill": {
            "name": "/challenge/name",
            "description": "/challenge/description",
            "requiredCount": 10
        }
    });
    let dictionary = serde_json::json!({
        "/node/Cholistan": "Cholistan",
        "/system/Europa": "Europa",
        "/mission/Excavation": "EXCAVATION",
        "/challenge/name": "Operator",
        "/challenge/description": "Kill |COUNT| enemies as Operator",
        "/faction/infested": "INFESTED"
    });
    let factions = serde_json::json!({
        "FC_INFESTATION": { "index": 2, "name": "/faction/infested" }
    });
    let assets = timed::parse_community_assets(
        &schedule,
        &regions.to_string(),
        &challenges.to_string(),
        &dictionary.to_string(),
        &factions.to_string(),
    )
    .expect("Public Export fixtureを結合できること");
    let expiry = now + Duration::hours(1);
    let bounty = serde_json::json!({
        "expiry": expiry.timestamp_millis(),
        "rot": "B",
        "vaultRot": "C",
        "zarimanFaction": "FC_INFESTATION",
        "bounties": {
            "ZarimanSyndicate": [{"node":"ClanNode7","challenge":"/challenge/kill"}],
            "EntratiLabSyndicate": [{"node":"ClanNode7","challenge":"/challenge/kill"}],
            "HexSyndicate": [{
                "node":"ClanNode7",
                "challenge":"/challenge/kill",
                "ally":"/Lotus/Types/ArthurAllyAgent"
            }]
        }
    });
    let cards = timed::parse_bounty_cards(&bounty.to_string(), now, &assets)
        .expect("Oracle fixtureを3 cardへ変換できること");
    assert_eq!(cards.len(), 3, "${msg} (3 syndicateを分離しない)");
    assert_eq!(
        cards.iter().map(|card| card.variant.as_deref()).collect::<Vec<_>>(),
        vec![Some("holdfasts"), Some("cavia"), Some("hex")],
        "${msg} (variant順)",
    );
    for card in &cards {
        assert_eq!(card.expiry, Some(expiry), "${msg} (expiry)");
        assert_eq!(card.provenance.kind, timed::TimedSourceKind::CommunityLive, "${msg} (Oracle provenance)");
        assert_eq!(card.source_id, timed::TimedSourceId::BrowseWfBountyCycle, "${msg} (Oracle source)");
        for (key, expected) in [
            ("rotation", "B"),
            ("vaultRotation", "C"),
            ("zarimanFaction", "Infested"),
        ] {
            assert!(card.metadata.iter().any(|item| item.key == key && item.value == expected), "${msg} ({key})");
        }
        let stage = &card.stages[0];
        assert_eq!(stage.title, "Cholistan", "${msg} (node)");
        assert_eq!(stage.node.as_deref(), Some("Excavation · Europa"), "${msg} (mission/system)");
        assert_eq!(stage.detail.as_deref(), Some("Operator — Kill 10 enemies as Operator"), "${msg} (challenge)");
        assert!(stage.enemy_levels.is_empty() && stage.standing_stages.is_empty(), "${msg} (Oracleにないlevel/standingを捏造した)");
    }
    assert_eq!(
        cards[2].stages[0].ally.as_deref(),
        Some("/Lotus/Types/ArthurAllyAgent"),
        "${msg} (Hex ally raw identifier)",
    );

    for tag in ["ZarimanSyndicate", "EntratiLabSyndicate", "HexSyndicate"] {
        let mut missing = bounty.clone();
        missing["bounties"].as_object_mut().unwrap().remove(tag);
        assert!(timed::parse_bounty_cards(&missing.to_string(), now, &assets).is_err(), "${msg} (必須tag {tag}欠落)");
    }
    for (field, bad) in [("node", ""), ("challenge", "")] {
        let mut missing = bounty.clone();
        missing["bounties"]["HexSyndicate"][0][field] = serde_json::json!(bad);
        assert!(timed::parse_bounty_cards(&missing.to_string(), now, &assets).is_err(), "${msg} ({field}欠落)");
    }
    assert!(
        timed::parse_bounty_cards(
            &serde_json::json!({
                "expiry": expiry.timestamp_millis(),
                "rot": "B",
                "vaultRot": "C",
                "zarimanFaction": "FC_INFESTATION"
            }).to_string(),
            now,
            &assets,
        ).is_err(),
        "${msg} (bounties root欠落)",
    );

    let raw_dictionary = serde_json::json!({"unrelated":"value"});
    let raw_assets = timed::parse_community_assets(
        &schedule,
        &regions.to_string(),
        &challenges.to_string(),
        &raw_dictionary.to_string(),
        &factions.to_string(),
    )
    .expect("未知identifierを含むfixture自体は有効であること");
    let raw_cards = timed::parse_bounty_cards(&bounty.to_string(), now, &raw_assets)
        .expect("未知identifierはraw fallbackでcard化すること");
    for card in &raw_cards {
        let stage = &card.stages[0];
        assert_eq!(stage.title, "/node/Cholistan", "${msg} (未知node keyを改変した)");
        assert_eq!(
            stage.node.as_deref(),
            Some("/mission/Excavation · /system/Europa"),
            "${msg} (未知mission/system keyを改変した)",
        );
        assert_eq!(
            stage.detail.as_deref(),
            Some("/challenge/name — /challenge/description"),
            "${msg} (未知challenge keyを改変した)",
        );
        assert!(stage.modifiers.iter().any(|value| value == "/faction/infested"), "${msg} (未知faction keyを改変した)");
        assert!(card.metadata.iter().any(|item| item.key == "zarimanFaction" && item.value == "/faction/infested"), "${msg} (未知zarimanFaction keyを改変した)");
    }
}`;
      case "circuit":
        return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let now = base_now();
    let activation = now - Duration::hours(1);
    let expiry = now + Duration::days(6);
    let schedule_entry = |activation: DateTime<Utc>, expiry: DateTime<Utc>| {
        serde_json::json!({
            "Activation": {"$date":{"$numberLong":activation.timestamp_millis().to_string()}},
            "Expiry": {"$date":{"$numberLong":expiry.timestamp_millis().to_string()}},
            "CategoryChoices": [
                {"Category":"EXC_NORMAL","Choices":["Ash","Mag","Volt"]},
                {"Category":"EXC_HARD","Choices":["Braton","Lato","Skana","Paris","Kunai"]}
            ]
        })
    };
    let fixture = serde_json::json!({
        "EndlessXpSchedule": [schedule_entry(activation, expiry)]
    });
    let cards = timed::parse_circuit_json(&fixture.to_string(), now)
        .expect("DE Circuit fixtureをparseできること");
    assert_eq!(cards.len(), 1, "${msg} (1 scheduleを複数cardへ分割した)");
    let card = &cards[0];
    assert_eq!(card.activation, Some(activation), "${msg} (activation)");
    assert_eq!(card.expiry, Some(expiry), "${msg} (expiry)");
    assert_eq!(card.temporal_status, timed::TimedTemporalStatus::Active, "${msg} (active)");
    assert_eq!(card.kind, "circuit", "${msg} (kind)");
    assert_eq!(card.variant, None, "${msg} (variant)");
    assert_eq!(card.provenance.kind, timed::TimedSourceKind::OfficialLive, "${msg} (official source)");
    assert_eq!(card.provenance.contributors, vec![timed::TimedSourceId::DeWorldstate], "${msg} (DE contributor)");
    assert_eq!(card.stages.len(), 2, "${msg} (Normal/Hard stage)");
    assert_eq!(card.stages[0].title, "Normal Circuit", "${msg} (Normal stage title)");
    assert_eq!(card.stages[1].title, "Steel Path Circuit", "${msg} (Hard stage title)");
    assert_eq!(card.stages[0].choices, vec!["Ash", "Mag", "Volt"], "${msg} (Normal 3 frame)");
    assert_eq!(card.stages[1].choices, vec!["Braton", "Lato", "Skana", "Paris", "Kunai"], "${msg} (Hard 5 weapon)");

    for (case, invalid) in [
        ("empty schedule", serde_json::json!({"EndlessXpSchedule": []})),
        (
            "no active entry",
            serde_json::json!({
                "EndlessXpSchedule": [
                    schedule_entry(now - Duration::days(2), now - Duration::days(1)),
                    schedule_entry(now + Duration::days(1), now + Duration::days(2))
                ]
            }),
        ),
        (
            "multiple active entries",
            serde_json::json!({
                "EndlessXpSchedule": [
                    schedule_entry(now - Duration::hours(2), now + Duration::days(1)),
                    schedule_entry(now - Duration::hours(1), now + Duration::days(2))
                ]
            }),
        ),
    ] {
        assert!(
            timed::parse_circuit_json(&invalid.to_string(), now).is_err(),
            "${msg} (不正Circuit {case}を空成功・先頭選択した)",
        );
    }
}`;
      case "area_sources":
        return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let now = base_now();
    let activation = now - Duration::hours(1);
    let expiry = now + Duration::hours(2);
    let mission_expiry = now + Duration::hours(6);
    let area_job = |id: &str, title: &str| serde_json::json!({
        "id": id,
        "expiry": expiry.to_rfc3339(),
        "type": title,
        "enemyLevels": [5, 15],
        "standingStages": [400, 600, 1000],
        "minMR": 0,
        "locationTag": null,
        "timeBound": null,
        "rewardPool": ["Endo"],
        "rewardPoolDrops": [{
            "item": "Endo",
            "rarity": "Common",
            "chance": 25.0,
            "count": 100
        }],
        "uniqueName": format!("/Lotus/Jobs/{id}"),
        "isVault": false
    });
    let event_job = |title: &str| serde_json::json!({
        "type": title,
        "expiry": expiry.to_rfc3339(),
        "enemyLevels": [15, 25],
        "standingStages": [310, 310, 460],
        "minMR": 0,
        "rewardPool": ["Event Reward"]
    });
    let fixture = serde_json::json!({
        "sortie": null,
        "archonHunt": null,
        "syndicateMissions": [
            {
                "id": "ostrons",
                "activation": activation.to_rfc3339(),
                "expiry": mission_expiry.to_rfc3339(),
                "syndicate": "Ostrons",
                "syndicateKey": "CetusSyndicate",
                "nodes": [],
                "jobs": [area_job("ostrons-job", "Ostron Bounty")]
            },
            {
                "id": "solaris",
                "activation": activation.to_rfc3339(),
                "expiry": mission_expiry.to_rfc3339(),
                "syndicate": "Solaris United",
                "syndicateKey": "SolarisSyndicate",
                "nodes": [],
                "jobs": [area_job("solaris-job", "Solaris Bounty")]
            },
            {
                "id": "entrati",
                "activation": activation.to_rfc3339(),
                "expiry": mission_expiry.to_rfc3339(),
                "syndicate": "Entrati",
                "syndicateKey": "EntratiSyndicate",
                "nodes": [],
                "jobs": [area_job("entrati-job", "Entrati Bounty")]
            }
        ],
        "archimedeas": [],
        "cetusCycle": {
            "id": "cetus-cycle",
            "activation": activation.to_rfc3339(),
            "expiry": expiry.to_rfc3339(),
            "state": "day",
            "isDay": true,
        },
        "vallisCycle": {
            "id": "vallis-cycle",
            "activation": activation.to_rfc3339(),
            "expiry": expiry.to_rfc3339(),
            "state": "cold",
            "isWarm": false,
        },
        "cambionCycle": {
            "id": "cambion-cycle",
            "activation": activation.to_rfc3339(),
            "expiry": expiry.to_rfc3339(),
            "state": "fass"
        },
        "zarimanCycle": {
            "id": "zariman-cycle",
            "activation": activation.to_rfc3339(),
            "expiry": expiry.to_rfc3339(),
            "state": "grineer",
            "isCorpus": false,
        },
        "duviriCycle": {
            "id": "duviri-cycle",
            "activation": activation.to_rfc3339(),
            "expiry": expiry.to_rfc3339(),
            "state": "fear",
            "choices": [{"category":"normal","choices":["Ash","Mag","Volt"]}],
        },
        "earthCycle": {
            "id": "earth-cycle",
            "activation": activation.to_rfc3339(),
            "expiry": expiry.to_rfc3339(),
            "state": "night"
        },
        "events": [
            {
                "id": "thermia",
                "activation": activation.to_rfc3339(),
                "expiry": expiry.to_rfc3339(),
                "description": "Thermia Fractures",
                "tooltip": "Seal fractures across the Orb Vallis",
                "node": "Orb Vallis (Venus)",
                "tag": "HeatFissure",
                "currentScore": 19,
                "maximumScore": 100,
                "health": 19,
                "jobs": []
            },
            {
                "id": "ghouls",
                "activation": activation.to_rfc3339(),
                "expiry": expiry.to_rfc3339(),
                "description": "Ghoul Purge",
                "tooltip": "Defeat the Ghouls",
                "node": null,
                "tag": "GhoulEmergence",
                "affiliatedWith": "Ostrons",
                "jobs": [event_job("Eliminate A Ghoul Alpha")]
            },
            {
                "id": "plague-star",
                "activation": activation.to_rfc3339(),
                "expiry": expiry.to_rfc3339(),
                "description": "Operation: Plague Star",
                "tooltip": "Defend the Plains",
                "node": null,
                "tag": "InfestedPlains",
                "affiliatedWith": "Operations Syndicate",
                "jobs": [event_job("Plague Star")]
            },
            {
                "id": "unrelated",
                "activation": "not-a-date",
                "expiry": "also-not-a-date",
                "description": "Unrelated Relay",
                "tag": "TennoConRelay",
                "jobs": []
            },
            {
                "id": "expired-thermia",
                "activation": (now - Duration::days(2)).to_rfc3339(),
                "expiry": (now - Duration::days(1)).to_rfc3339(),
                "description": "Old Thermia",
                "tag": "HeatFissure",
                "jobs": []
            }
        ]
    });

    let parsed = timed::parse_wfcd_json(&fixture.to_string(), now)
        .expect("Areaを含むWFCD fixtureをparseできること");
    let environment_variants = parsed
        .area_environments
        .iter()
        .filter_map(|card| card.variant.as_deref())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        environment_variants,
        std::collections::BTreeSet::from(["cetus", "vallis", "cambion", "zariman", "duviri"]),
        "${msg} (5 environment variant)",
    );
    assert!(parsed.area_environments.iter().all(|card| {
        card.kind == "area-environment"
            && card.activation == Some(activation)
            && card.expiry == Some(expiry)
            && card.metadata.iter().any(|item| item.key == "state")
            && card.stages.is_empty()
    }), "${msg} (cycle正規化)");
    assert!(parsed.area_environments.iter().all(|card| card.variant.as_deref() != Some("earth")), "${msg} (earthCycleをAreaへ複製した)");
    assert!(parsed.area_environments.iter().all(|card| card.stages.iter().all(|stage| stage.choices.is_empty())), "${msg} (Duviri choicesをAreaへ複製した)");

    let core_variants = parsed
        .area_missions
        .iter()
        .filter_map(|card| card.variant.as_deref())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        core_variants,
        std::collections::BTreeSet::from(["ostrons", "solaris-united", "entrati"]),
        "${msg} (WFCD 3勢力variant)",
    );

    let event_variants = parsed
        .area_events
        .iter()
        .filter_map(|card| card.variant.as_deref())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        event_variants,
        std::collections::BTreeSet::from(["heat-fissure", "ghoul-emergence", "infested-plains"]),
        "${msg} (allowlisted active event)",
    );
    assert!(parsed.area_events.iter().all(|card| {
        card.kind == "area-event"
            && card.expiry == Some(expiry)
            && !card.metadata.iter().any(|item| ["currentScore", "maximumScore", "health"].contains(&item.key.as_str()))
    }), "${msg} (event正規化または個人進捗表示)");

    for (field, state) in [
        ("cetusCycle", "eclipse"),
        ("vallisCycle", "storm"),
        ("cambionCycle", "night"),
        ("zarimanCycle", "murmur"),
        ("duviriCycle", "calm"),
    ] {
        let mut invalid = fixture.clone();
        invalid[field]["state"] = serde_json::json!(state);
        assert!(timed::parse_wfcd_json(&invalid.to_string(), now).is_err(), "${msg} ({field} unknown state)");
    }
    let mut inconsistent_day = fixture.clone();
    inconsistent_day["cetusCycle"]["isDay"] = serde_json::json!(false);
    assert!(timed::parse_wfcd_json(&inconsistent_day.to_string(), now).is_err(), "${msg} (Cetus state/isDay不一致)");
    let mut missing_cycle = fixture.clone();
    missing_cycle.as_object_mut().unwrap().remove("duviriCycle");
    assert!(timed::parse_wfcd_json(&missing_cycle.to_string(), now).is_err(), "${msg} (cycle root欠落)");

    let known_path = "/Lotus/Types/Gameplay/Eidolon/Jobs/AttritionBountyCap";
    let other_path = "/Lotus/Types/Gameplay/Venus/Jobs/VenusArtifactJobAmbush";
    let unknown_path = "/Lotus/Types/Gameplay/InfestedMicroplanet/Jobs/UnknownObjective";
    let export = serde_json::json!({
        (known_path): {
            "name": "/Lotus/Language/OstronJobs/AttritionBountyCapTitle",
            "description": "/Lotus/Language/OstronJobs/AttritionBountyCapDesc",
            "icon": "/Lotus/Interface/Icons/Test.png",
            "stages": []
        },
        (other_path): {
            "name": "/Lotus/Language/SolarisJobs/ArtifactTitle",
            "description": "/Lotus/Language/SolarisJobs/ArtifactDesc",
            "icon": "/Lotus/Interface/Icons/Test.png",
            "stages": []
        }
    });
    let dictionary = serde_json::json!({
        "/Lotus/Language/OstronJobs/AttritionBountyCapTitle": "CAPTURE THEIR LEADER",
        "/Lotus/Language/OstronJobs/AttritionBountyCapDesc": "Draw out the target.",
        "/Lotus/Language/SolarisJobs/ArtifactTitle": "RECOVER THE ARTIFACT",
        "/Lotus/Language/SolarisJobs/ArtifactDesc": "Find the artifact."
    });
    let assets = timed::parse_location_bounty_assets(&export.to_string(), &dictionary.to_string())
        .expect("location-bounties static assetsをparseできること");
    let locations = serde_json::json!({
        "expiry": expiry.timestamp_millis(),
        "CetusSyndicate": {"TentA": [known_path]},
        "SolarisSyndicate": {"BountyNefsHead": [other_path]},
        "EntratiSyndicate": {"ChamberA": [unknown_path]}
    });
    let cards = timed::parse_location_bounty_cards(&locations.to_string(), now, &assets)
        .expect("location-bounties fixtureを3 cardへ変換できること");
    assert_eq!(
        cards.iter().map(|card| card.variant.as_deref()).collect::<Vec<_>>(),
        vec![Some("ostrons"), Some("solaris-united"), Some("entrati")],
        "${msg} (location 3勢力variant)",
    );
    assert!(cards.iter().all(|card| {
        card.kind == "area-objective"
            && card.expiry == Some(expiry)
            && card.source_id == timed::TimedSourceId::BrowseWfLocationBounties
            && !card.stages.is_empty()
    }), "${msg} (location card正規化)");
    assert_eq!(cards[0].stages[0].title, "TentA", "${msg} (location tagを推測改名した)");
    assert_eq!(cards[0].stages[0].choices, vec!["Capture Their Leader"], "${msg} (ExportBounties/dict join)");
    assert_eq!(cards[2].stages[0].choices, vec!["UnknownObjective"], "${msg} (未知identifier raw leaf fallback)");

    let mut missing_syndicate = locations.clone();
    missing_syndicate.as_object_mut().unwrap().remove("SolarisSyndicate");
    assert!(timed::parse_location_bounty_cards(&missing_syndicate.to_string(), now, &assets).is_err(), "${msg} (location必須勢力欠落)");
    let mut empty_location = locations.clone();
    empty_location["CetusSyndicate"]["TentA"] = serde_json::json!([]);
    assert!(timed::parse_location_bounty_cards(&empty_location.to_string(), now, &assets).is_err(), "${msg} (location空配列)");
    let mut duplicate_path = locations.clone();
    duplicate_path["CetusSyndicate"]["TentA"] = serde_json::json!([known_path, known_path]);
    assert!(timed::parse_location_bounty_cards(&duplicate_path.to_string(), now, &assets).is_err(), "${msg} (location path重複)");
    let mut bad_path = locations.clone();
    bad_path["CetusSyndicate"]["TentA"] = serde_json::json!(["not-a-resource-path"]);
    assert!(timed::parse_location_bounty_cards(&bad_path.to_string(), now, &assets).is_err(), "${msg} (location不正path)");
    let mut expired = locations.clone();
    expired["expiry"] = serde_json::json!(now.timestamp_millis());
    assert!(timed::parse_location_bounty_cards(&expired.to_string(), now, &assets).is_err(), "${msg} (location期限切れ)");
}`;
      case "rich_details":
        return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let now = base_now();
    let mission_activation = now - Duration::hours(1);
    let activation = mission_activation.to_rfc3339();
    let mission_expiry = (now + Duration::days(6)).to_rfc3339();
    let first_job_expiry = now + Duration::hours(2);
    let second_job_expiry = now + Duration::hours(4);
    let expired_job_expiry = now - Duration::minutes(30);
    let area_cycle = |id: &str, state: &str| serde_json::json!({
        "id": id,
        "activation": mission_activation.to_rfc3339(),
        "expiry": mission_expiry.clone(),
        "state": state
    });
    let area_job = |id: &str, title: &str, expiry: DateTime<Utc>, count: u32| {
        serde_json::json!({
            "id": id,
            "expiry": expiry.to_rfc3339(),
            "type": title,
            "enemyLevels": [5, 15],
            "standingStages": [400, 600, 1000],
            "minMR": 1,
            "locationTag": "Plains of Eidolon",
            "timeBound": "Day",
            "rewardPool": ["Lith Relic", "Endo"],
            "rewardPoolDrops": [{
                "item": "Endo",
                "rarity": "Common",
                "chance": 25.5,
                "count": count
            }],
            "uniqueName": format!("Bounty {id}"),
            "isVault": false
        })
    };
    let wfcd_fixture = serde_json::json!({
        "sortie": null,
        "archonHunt": null,
        "syndicateMissions": [{
            "id": "ostrons",
            "activation": activation,
            "expiry": mission_expiry,
            "syndicate": "Ostrons",
            "syndicateKey": "",
            "nodes": ["Ares (Mars)", "Spear (Mars)"],
            "jobs": [
                area_job("job-a1", "Capture", first_job_expiry, 100),
                area_job("job-a2", "Rescue", first_job_expiry, 200),
                area_job("job-b1", "Exterminate", second_job_expiry, 300),
                area_job("job-expired", "Expired Job", expired_job_expiry, 999)
            ]
        }],
        "archimedeas": [{
            "id": "deep-current",
            "activation": activation,
            "expiry": mission_expiry,
            "type": "Deep Archimedea",
            "typeKey": "CT_LAB",
            "personalModifiers": [{
                "key": "gear-embargo",
                "name": "Gear Embargo",
                "description": "Gear items cannot be used."
            }],
            "missions": [{
                "faction": "The Murmur",
                "factionKey": "",
                "missionType": "Mirror Defense",
                "missionTypeKey": "",
                "deviation": {
                    "key": "energy-drain",
                    "name": "Energy Drain",
                    "description": "Energy drains over time."
                },
                "risks": [
                    {
                        "key": "standard-risk",
                        "name": "Standard Risk",
                        "description": "Standard description.",
                        "isHard": false
                    },
                    {
                        "key": "elite-risk",
                        "name": "Elite Risk",
                        "description": "Elite description.",
                        "isHard": true
                    }
                ]
            }]
        }],
        "cetusCycle": area_cycle("cetus", "day"),
        "vallisCycle": area_cycle("vallis", "cold"),
        "cambionCycle": area_cycle("cambion", "fass"),
        "zarimanCycle": area_cycle("zariman", "corpus"),
        "duviriCycle": area_cycle("duviri", "fear"),
        "events": []
    });
    let wfcd = timed::parse_wfcd_json(&wfcd_fixture.to_string(), now)
        .expect("WFCD rich fixtureをparseできること");
    assert_eq!(wfcd.syndicates.len(), 1, "${msg} (Syndicate card欠落)");
    assert_eq!(wfcd.syndicates[0].stages.len(), 2, "${msg} (Syndicate node stages欠落)");
    assert_eq!(wfcd.syndicates[0].stages[0].node.as_deref(), Some("Ares (Mars)"), "${msg} (Syndicate node保持)");
    assert_eq!(wfcd.area_missions.len(), 2, "${msg} (job expiryごとにArea cardを分離しない)");
    let first_group = wfcd
        .area_missions
        .iter()
        .find(|card| card.expiry == Some(first_job_expiry))
        .expect("first job expiry group");
    let second_group = wfcd
        .area_missions
        .iter()
        .find(|card| card.expiry == Some(second_job_expiry))
        .expect("second job expiry group");
    assert_eq!(first_group.activation, Some(mission_activation), "${msg} (mission activationをgroup cardへ保持しない)");
    assert_eq!(second_group.activation, Some(mission_activation), "${msg} (別groupのmission activation)");
    assert_eq!(first_group.stages.len(), 2, "${msg} (同じjob expiryを同一cardへgroupしない)");
    assert_eq!(second_group.stages.len(), 1, "${msg} (別job expiryを混在させた)");
    assert!(wfcd.area_missions.iter().flat_map(|card| &card.stages).all(|stage| stage.title != "Expired Job"), "${msg} (期限切れjobを残した)");
    let area_stage = first_group
        .stages
        .iter()
        .find(|stage| stage.title == "Capture")
        .expect("Capture area stage");
    assert_eq!(area_stage.reward_drops.len(), 1, "${msg} (reward drop欠落)");
    assert_eq!(area_stage.reward_drops[0].item, "Endo", "${msg} (reward item)");
    assert_eq!(area_stage.reward_drops[0].rarity, "Common", "${msg} (reward rarity)");
    assert_eq!(area_stage.reward_drops[0].chance_percent, 25.5, "${msg} (reward chance)");
    assert_eq!(area_stage.reward_drops[0].count, 100, "${msg} (reward count)");
    assert_eq!(wfcd.archimedea.len(), 1, "${msg} (Archimedea)");
    assert_eq!(wfcd.archimedea[0].personal_modifiers[0].description, "Gear items cannot be used.", "${msg} (personal condition description)");
    let conditions = &wfcd.archimedea[0].stages[0].conditions;
    assert!(conditions.iter().any(|item| item.description == "Energy drains over time." && !item.elite_only), "${msg} (deviation description)");
    assert!(conditions.iter().any(|item| item.description == "Standard description." && !item.elite_only), "${msg} (standard risk)");
    assert!(conditions.iter().any(|item| item.description == "Elite description." && item.elite_only), "${msg} (elite risk)");

    // Sortie/Archonで使用しない片側専用fieldは、集約sourceが省略しても正当なpayloadとして扱う。
    let branch_specific_fixture = serde_json::json!({
        "sortie": {
            "id": "sortie-current",
            "activation": activation,
            "expiry": mission_expiry,
            "rewardPool": "Sortie Rewards",
            "boss": "Lephantis",
            "faction": "Infestation",
            "factionKey": "Infestation",
            "variants": [{
                "missionType": "Survival",
                "missionTypeKey": "Survival",
                "modifier": "Energy Reduction",
                "modifierDescription": "Low energy",
                "node": "Nabuk (Kuva Fortress)",
                "nodeKey": "Nabuk (Kuva Fortress)"
            }]
        },
        "archonHunt": {
            "id": "archon-current",
            "activation": activation,
            "expiry": mission_expiry,
            "boss": "Archon Nira",
            "faction": "Narmer",
            "factionKey": "Narmer",
            "missions": [{
                "node": "Metis (Jupiter)",
                "nodeKey": "Metis (Jupiter)",
                "type": "Mobile Defense",
                "typeKey": "Mobile Defense"
            }]
        },
        "syndicateMissions": [],
        "archimedeas": [],
        "cetusCycle": area_cycle("cetus", "day"),
        "vallisCycle": area_cycle("vallis", "cold"),
        "cambionCycle": area_cycle("cambion", "fass"),
        "zarimanCycle": area_cycle("zariman", "corpus"),
        "duviriCycle": area_cycle("duviri", "fear"),
        "events": []
    });
    let branch_specific = timed::parse_wfcd_json(&branch_specific_fixture.to_string(), now)
        .expect("Sortie/Archonの未使用field欠落を許容すること");
    let sortie = &branch_specific.sortie[0];
    assert_eq!(sortie.kind, "sortie", "${msg} (Sortie kind)");
    assert_eq!(sortie.title, "Sortie", "${msg} (Sortie title)");
    assert_eq!(sortie.subtitle.as_deref(), Some("Lephantis · Infestation · Sortie Rewards"), "${msg} (Sortie subtitle)");
    assert_eq!(sortie.stages.len(), 1, "${msg} (Sortie variants欠落)");
    assert_eq!(sortie.stages[0].title, "Survival", "${msg} (Sortie stage title)");
    assert_eq!(sortie.stages[0].node.as_deref(), Some("Nabuk (Kuva Fortress)"), "${msg} (Sortie node)");
    assert_eq!(sortie.stages[0].detail.as_deref(), Some("Low energy"), "${msg} (Sortie modifier description)");
    assert_eq!(sortie.stages[0].modifiers, vec!["Energy Reduction"], "${msg} (Sortie modifier)");

    let archon = &branch_specific.archon[0];
    assert_eq!(archon.kind, "archon", "${msg} (Archon kind)");
    assert_eq!(archon.title, "Archon Hunt", "${msg} (Archon title)");
    assert_eq!(archon.subtitle.as_deref(), Some("Archon Nira · Narmer"), "${msg} (Archon faction subtitle)");
    assert_eq!(archon.stages.len(), 1, "${msg} (Archon missions欠落)");
    assert_eq!(archon.stages[0].title, "Mobile Defense", "${msg} (Archon stage title)");
    assert_eq!(archon.stages[0].node.as_deref(), Some("Metis (Jupiter)"), "${msg} (Archon node)");
    let mut missing_sortie_reward = branch_specific_fixture.clone();
    missing_sortie_reward["sortie"].as_object_mut().unwrap().remove("rewardPool");
    assert!(timed::parse_wfcd_json(&missing_sortie_reward.to_string(), now).is_err(), "${msg} (使用するSortie rewardPool欠落を受理した)");
    let mut missing_sortie_stages = branch_specific_fixture.clone();
    missing_sortie_stages["sortie"].as_object_mut().unwrap().remove("variants");
    assert!(timed::parse_wfcd_json(&missing_sortie_stages.to_string(), now).is_err(), "${msg} (使用するSortie variants欠落を受理した)");
    let mut missing_archon_stages = branch_specific_fixture.clone();
    missing_archon_stages["archonHunt"].as_object_mut().unwrap().remove("missions");
    assert!(timed::parse_wfcd_json(&missing_archon_stages.to_string(), now).is_err(), "${msg} (使用するArchon missions欠落を受理した)");

    // 一部に有効entryがあっても、取得中entryの必須timestamp/intervalが壊れたpayloadは全体を失敗させる。
    let mut bad_mission_timestamp = wfcd_fixture.clone();
    bad_mission_timestamp["syndicateMissions"][0]["activation"] = serde_json::json!("not-rfc3339");
    assert!(timed::parse_wfcd_json(&bad_mission_timestamp.to_string(), now).is_err(), "${msg} (不正mission activationを部分freshにした)");
    let mut bad_job_timestamp = wfcd_fixture.clone();
    bad_job_timestamp["syndicateMissions"][0]["jobs"][0]["expiry"] = serde_json::json!("not-rfc3339");
    assert!(timed::parse_wfcd_json(&bad_job_timestamp.to_string(), now).is_err(), "${msg} (不正job expiryを部分freshにした)");
    let mut bad_archimedea_timestamp = wfcd_fixture.clone();
    bad_archimedea_timestamp["archimedeas"][0]["expiry"] = serde_json::json!("not-rfc3339");
    assert!(timed::parse_wfcd_json(&bad_archimedea_timestamp.to_string(), now).is_err(), "${msg} (不正Archimedea expiryを部分freshにした)");
    let mut inverted_job_interval = wfcd_fixture.clone();
    inverted_job_interval["syndicateMissions"][0]["jobs"][0]["expiry"] =
        serde_json::json!(mission_activation.to_rfc3339());
    assert!(timed::parse_wfcd_json(&inverted_job_interval.to_string(), now).is_err(), "${msg} (job expiry<=mission activationを受理した)");
    for field in ["item", "rarity", "chance", "count"] {
        let mut missing_drop_field = wfcd_fixture.clone();
        missing_drop_field["syndicateMissions"][0]["jobs"][0]["rewardPoolDrops"][0]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(
            timed::parse_wfcd_json(&missing_drop_field.to_string(), now).is_err(),
            "${msg} (reward drop必須field {field}欠落を部分freshにした)",
        );
    }

    let descent = |activation: DateTime<Utc>, expiry: DateTime<Utc>, seed: u64| {
        let challenges = (1u32..=21)
            .map(|index| serde_json::json!({
                "Index": index,
                "Type": format!("DT_FLOOR_{index}"),
                "Challenge": format!("Challenge{index}"),
                "Level": format!("/Lotus/Levels/Floor{index}.level"),
                "Specs": [format!("Spec {index}")],
                "Auras": [format!("Aura {index}")]
            }))
            .collect::<Vec<_>>();
        serde_json::json!({
            "Activation": {"$date":{"$numberLong":activation.timestamp_millis().to_string()}},
            "Expiry": {"$date":{"$numberLong":expiry.timestamp_millis().to_string()}},
            "RandSeed": seed,
            "Challenges": challenges
        })
    };
    let current_descent = descent(now - Duration::days(1), now + Duration::weeks(1), 1);
    let mut descents = vec![descent(
        now - Duration::weeks(2),
        now - Duration::weeks(1),
        0,
    )];
    descents.push(current_descent.clone());
    for week in 1i64..=5 {
        descents.push(descent(
            now + Duration::weeks(week),
            now + Duration::weeks(week + 1),
            (week + 1) as u64,
        ));
    }
    let de_fixture = serde_json::json!({"Descents": descents});
    let cards = timed::parse_descents_json(&de_fixture.to_string(), now)
        .expect("DE Descents rich fixtureをparseできること");
    assert_eq!(cards.len(), 6, "${msg} (expired除外/current 1週+future 5週)");
    assert_eq!(cards[0].temporal_status, timed::TimedTemporalStatus::Active, "${msg} (current active)");
    assert!(cards[1..].iter().all(|card| card.temporal_status == timed::TimedTemporalStatus::Upcoming), "${msg} (future upcoming)");
    assert!(cards.windows(2).all(|pair| pair[0].activation < pair[1].activation), "${msg} (activation順)");
    assert!(cards.iter().all(|card| card.stages.len() == 21), "${msg} (各週21 stage)");
    assert!(cards.iter().flat_map(|card| &card.stages).all(|stage| {
        stage.specs.len() == 1 && stage.auras.len() == 1
    }), "${msg} (Specs/Auras欠落)");

    for (case, invalid_fixture) in [
        ("empty Descents", serde_json::json!({"Descents": []})),
        (
            "all expired Descents",
            serde_json::json!({
                "Descents": [descent(
                    now - Duration::weeks(2),
                    now - Duration::weeks(1),
                    99,
                )]
            }),
        ),
    ] {
        assert!(
            timed::parse_descents_json(&invalid_fixture.to_string(), now).is_err(),
            "${msg} ({case}を空成功した)",
        );
    }

    let mut equal_interval = current_descent.clone();
    equal_interval["Activation"] = equal_interval["Expiry"].clone();
    let mut inverted_interval = current_descent.clone();
    inverted_interval["Activation"]["$date"]["$numberLong"] =
        serde_json::json!((now + Duration::days(2)).timestamp_millis().to_string());
    inverted_interval["Expiry"]["$date"]["$numberLong"] =
        serde_json::json!((now + Duration::days(1)).timestamp_millis().to_string());
    let mut empty_challenges = current_descent.clone();
    empty_challenges["Challenges"] = serde_json::json!([]);
    let mut duplicate_index = current_descent.clone();
    duplicate_index["Challenges"][1]["Index"] = duplicate_index["Challenges"][0]["Index"].clone();
    let mut missing_specs = current_descent.clone();
    missing_specs["Challenges"][0].as_object_mut().unwrap().remove("Specs");
    let mut missing_auras = current_descent;
    missing_auras["Challenges"][0].as_object_mut().unwrap().remove("Auras");
    for (case, invalid) in [
        ("activation==expiry", equal_interval),
        ("activation>expiry", inverted_interval),
        ("empty Challenges", empty_challenges),
        ("duplicate Index", duplicate_index),
        ("missing Specs", missing_specs),
        ("missing Auras", missing_auras),
    ] {
        let invalid_fixture = serde_json::json!({"Descents": [invalid]});
        assert!(
            timed::parse_descents_json(&invalid_fixture.to_string(), now).is_err(),
            "${msg} (不正Descents {case}を部分受理した)",
        );
    }
}`;
      default:
        throw new Error(`未知の時限content fixtureシナリオ: ${c.scenario} (${c.id})`);
    }
  }
  if (c.pattern === "static_check") {
    switch (c.scenario) {
      case "bundle_identity":
        return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let release: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(manifest.join("tauri.conf.json"))
            .expect("tauri.conf.jsonを読めること"),
    )
    .expect("tauri.conf.jsonがJSONであること");
    let test: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(manifest.join("tauri.notification-test.conf.json"))
            .expect("tauri.notification-test.conf.jsonを読めること"),
    )
    .expect("tauri.notification-test.conf.jsonがJSONであること");

    assert_eq!(
        release["identifier"], "com.annenpolka.relico",
        "${msg} (配布identifier)"
    );
    assert_eq!(release["productName"], "relico", "${msg} (配布productName)");
    assert_eq!(
        test["identifier"], "com.annenpolka.relico.notification-test",
        "${msg} (通知テストidentifier)"
    );
    assert_eq!(
        test["productName"], "RELICO Notification Test",
        "${msg} (通知テストproductName)"
    );
    let e2e: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(manifest.join("tauri.e2e.conf.json"))
            .expect("tauri.e2e.conf.jsonを読めること"),
    )
    .expect("tauri.e2e.conf.jsonがJSONであること");
    assert_eq!(
        e2e["identifier"], "com.annenpolka.relico.e2e",
        "${msg} (E2E identifier)"
    );
    assert_eq!(e2e["productName"], "RELICO E2E", "${msg} (E2E productName)");

    for (left, right) in [(&release, &test), (&release, &e2e), (&test, &e2e)] {
        assert_ne!(left["identifier"], right["identifier"], "${msg} (identifier衝突)");
        assert_ne!(left["productName"], right["productName"], "${msg} (productName衝突)");
    }
}`;
      case "tray_template_icon":
        return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let bytes = std::fs::read(manifest.join("icons/tray-icon.png"))
        .expect("icons/tray-icon.pngを読めること");
    assert_eq!(
        &bytes[..8],
        &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
        "${msg} (PNGシグネチャ)"
    );
    // IHDRのcolor type: 0=grayscale / 4=grayscale+alpha だけをテンプレート互換とする
    let color_type = bytes[25];
    assert!(
        color_type == 0 || color_type == 4,
        "${msg} (colortype={color_type}: モノクロ+アルファのPNGであること)"
    );

    let lib_rs = std::fs::read_to_string(manifest.join("src/lib.rs"))
        .expect("src/lib.rsを読めること");
    assert!(
        lib_rs.contains("tray-icon.png"),
        "${msg} (専用tray-icon.pngを使う配線が失われた)"
    );
    assert!(
        lib_rs.contains(".icon_as_template("),
        "${msg} (テンプレート登録の配線が失われた)"
    );
}`;
      case "autostart_bundle_icon":
        return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let lib_rs = std::fs::read_to_string(manifest.join("src/lib.rs"))
        .expect("src/lib.rsを読めること");
    assert!(
        lib_rs.contains("MacosLauncher::AppleScript"),
        "${msg} (.app bundleをLogin Item登録するlauncherでない)"
    );
    assert!(
        !lib_rs.contains("MacosLauncher::LaunchAgent"),
        "${msg} (内部Unix実行ファイルをLaunchAgent登録している)"
    );
    assert!(
        lib_rs.contains("migrate_legacy_launch_agent"),
        "${msg} (旧relico.plistの移行配線がない)"
    );
    let legacy = r#"<key>Label</key><string>relico</string><key>ProgramArguments</key><array><string>/Users/test/Applications/relico.app/Contents/MacOS/relico</string></array>"#;
    assert!(
        relico_lib::autostart::is_legacy_relico_launch_agent(legacy),
        "${msg} (正規の旧plistを移行対象と認識しない)"
    );
    assert!(
        !relico_lib::autostart::is_legacy_relico_launch_agent(
            r#"<key>Label</key><string>other</string><key>ProgramArguments</key><array><string>/tmp/other</string></array>"#,
        ),
        "${msg} (無関係な同名plistを移行対象にした)"
    );
}`;
      case "dependency_free_i18n":
        return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.parent().expect("repository root");
    let ts = std::fs::read_to_string(root.join("src/i18n.ts"))
        .expect("src/i18n.tsを読めること");
    let rust = std::fs::read_to_string(manifest.join("src/i18n.rs"))
        .expect("src-tauri/src/i18n.rsを読めること");
    let package = std::fs::read_to_string(root.join("package.json"))
        .expect("package.jsonを読めること")
        .to_ascii_lowercase();
    let cargo = std::fs::read_to_string(manifest.join("Cargo.toml"))
        .expect("Cargo.tomlを読めること")
        .to_ascii_lowercase();

    for import in ts.lines().map(str::trim).filter(|line| line.starts_with("import ")) {
        assert!(
            import.contains(" from \\\"./"),
            "${msg} (TS i18nが外部importを持つ: {import})"
        );
    }
    assert!(
        !ts.contains("import("),
        "${msg} (TS i18nが動的importを持つ)"
    );
    for import in rust.lines().map(str::trim).filter(|line| line.starts_with("use ")) {
        assert!(
            import.starts_with("use std::")
                || import.starts_with("use crate::")
                || import.starts_with("use super::")
                || import.starts_with("use serde_json::"),
            "${msg} (Rust i18nが外部crateを直接使う: {import})"
        );
    }
    for dependency in [
        "i18next",
        "react-i18next",
        "@lingui",
        "@formatjs",
        "intl-messageformat",
        "messageformat",
        "fluent-bundle",
        "fluent-syntax",
        "unic-langid",
        "icu_locid",
        "icu-locale",
    ] {
        assert!(
            !package.contains(dependency) && !cargo.contains(dependency),
            "${msg} (i18n専用外部依存が追加された: {dependency})"
        );
    }
    assert!(
        ts.contains("from \\\"./locales.json\\\""),
        "${msg} (TSがsrc/locales.jsonを直接読まない)"
    );
    assert!(
        rust.contains("include_str!(\\\"../../src/locales.json\\\")"),
        "${msg} (Rustがsrc/locales.jsonを直接埋め込まない)"
    );
}`;
      default:
        throw new Error(`未知のstatic checkシナリオ: ${c.scenario} (${c.id})`);
    }
  }
  if (c.pattern === "approved_asset") {
    return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    use sha2::{Digest, Sha256};
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let bytes = std::fs::read(manifest.join("${c.path}"))
        .expect("承認済みアセット ${c.path} を読めること");
    let digest = format!("{:x}", Sha256::digest(&bytes));
    assert_eq!(
        digest, "${c.sha256}",
        "${msg} — ${c.path} が承認済み内容から変わった。見た目を目視で再承認し、specs/notifier.pkl のsha256を更新して just spec-gen すること"
    );
}`;
  }
  if (c.pattern !== "notification_example") {
    throw new Error(`未知のexampleパターン: ${c.pattern} (${c.id})`);
  }

  switch (c.scenario) {
    case "outcomes":
      return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let accepted = notify::summarize_test_outcomes(&[
        NotificationOutcome::Requested { destination: "desktop" },
        NotificationOutcome::Requested { destination: "discord" },
    ])
    .expect("全選択先がRequestedなら成功すること");
    assert!(
        accepted.contains("通知要求を受け付けました"),
        "${msg} (要求受付の文言がない: {accepted})"
    );
    for forbidden in ["送信OK", "表示済み", "配信済み"] {
        assert!(
            !accepted.contains(forbidden),
            "${msg} (結果不明なのに成功を主張した: {accepted})"
        );
    }

    let partial = notify::summarize_test_outcomes(&[
        NotificationOutcome::Requested { destination: "desktop" },
        NotificationOutcome::Failed {
            destination: "discord",
            reason: "HTTP 500".to_string(),
        },
    ])
    .expect_err("1件でもFailedなら失敗すること");
    assert!(partial.contains("desktop"), "${msg} (部分成功先がない: {partial})");
    assert!(partial.contains("discord"), "${msg} (失敗先がない: {partial})");
    assert!(partial.contains("HTTP 500"), "${msg} (失敗理由がない: {partial})");
    for forbidden in ["送信OK", "表示済み", "配信済み"] {
        assert!(
            !partial.contains(forbidden),
            "${msg} (エラーに成功語がある: {partial})"
        );
    }

    assert!(
        notify::summarize_test_outcomes(&[]).is_err(),
        "${msg} (通知先なしを成功扱いした)"
    );
}`;
    case "desktop_payload":
      return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let now = base_now();
    let mut fissure = Fissure {
        id: "notification-example".to_string(),
        activation: now,
        expiry: now + Duration::minutes(30),
        node: "Test Node (Void)".to_string(),
        mission_type: "Survival".to_string(),
        enemy: "Orokin".to_string(),
        tier: "Axi".to_string(),
        tier_num: 4,
        is_storm: true,
        is_hard: true,
    };

    let payload = notify::desktop_payload(&fissure, now);
    assert_eq!(
        payload.title,
        "Axi Survival — Test Node (Void) 【鋼】 [STORM]",
        "${msg} (title)"
    );
    assert_eq!(
        payload.body,
        "Orokin / 消滅まで残り30分",
        "${msg} (body)"
    );

    fissure.expiry = now - Duration::seconds(1);
    let expired = notify::desktop_payload(&fissure, now);
    assert_eq!(
        expired.body,
        "Orokin / 消滅まで残り0分",
        "${msg} (期限切れbody)"
    );
}`;
    case "desktop_unavailable":
      return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let detail = "notification backend unavailable";
    let message = notify::desktop_unavailable_message(detail);
    assert!(message.contains(detail), "${msg} (失敗詳細がない: {message})");
    assert!(
        message.contains("just notification-test"),
        "${msg} (実行コマンドがない: {message})"
    );
    assert!(
        message.contains(".app"),
        "${msg} (bundleアプリを使う案内がない: {message})"
    );
    for forbidden in ["送信OK", "表示済み", "配信済み"] {
        assert!(
            !message.contains(forbidden),
            "${msg} (利用不能案内に成功語がある: {message})"
        );
    }
}`;
    case "discord_receipt":
      return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let request_url = match notify::discord_request_url(
        "https://discord.com/api/webhooks/123/test-token?thread_id=456&wait=false&foo=bar&wait=false",
    ) {
        Ok(url) => url,
        Err(_) => panic!("${msg} (有効なWebhook URLを構築できない)"),
    };
    let query: Vec<(String, String)> = request_url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    assert!(
        query.iter().any(|pair| pair == &("thread_id".to_string(), "456".to_string())),
        "${msg} (既存thread_id queryが失われた)"
    );
    assert!(
        query.iter().any(|pair| pair == &("foo".to_string(), "bar".to_string())),
        "${msg} (既存queryが失われた)"
    );
    let waits: Vec<&str> = query
        .iter()
        .filter(|(key, _)| key == "wait")
        .map(|(_, value)| value.as_str())
        .collect();
    assert_eq!(
        waits,
        vec!["true"],
        "${msg} (wait queryはtrueをちょうど1つだけ持つこと)"
    );

    let message_id = notify::discord_message_id(r#"{"id":"1234567890"}"#)
        .unwrap_or_else(|_| panic!("${msg} (非空Message IDを拒否した)"));
    assert_eq!(message_id, "1234567890", "${msg} (Message IDを保持しない)");

    for invalid_response in [r#"{}"#, r#"{"id":""}"#, "not json"] {
        assert!(
            notify::discord_message_id(invalid_response).is_err(),
            "${msg} (ID欠落・空文字・不正JSONを成功扱いした)"
        );
    }
}`;
    case "localized_backend":
      return `
/// ${c.id}: ${c.desc}
#[test]
fn ${name}() {
    let now = base_now();
    let fissure = Fissure {
        id: "localized-notification".to_string(),
        activation: now,
        expiry: now + Duration::minutes(30),
        node: "Test Node (Void)".to_string(),
        mission_type: "Survival".to_string(),
        enemy: "Orokin".to_string(),
        tier: "Axi".to_string(),
        tier_num: 4,
        is_storm: false,
        is_hard: true,
    };

    for (locale, hard, body, accepted, watch_prefix, storm_include, storm_only, candidate_error, rule_error) in [
        (AppLocale::Ja, "鋼", "Orokin / 消滅まで残り30分", "通知要求を受け付けました: desktop", "監視:", "+VOID嵐", "VOID嵐のみ", "不明な候補ID: bad", "不明なルール番号: 99"),
        (AppLocale::En, "Steel Path", "Orokin / 30 min remaining", "Notification request accepted: desktop", "Watch:", "+VOID STORM", "VOID STORM ONLY", "Unknown candidate ID: bad", "Unknown rule index: 99"),
        (AppLocale::ZhHans, "钢铁之路", "Orokin / 剩余 30 分钟", "通知请求已接受：desktop", "监视：", "+虚空风暴", "仅虚空风暴", "未知候选项 ID：bad", "未知规则序号：99"),
    ] {
        let payload = notify::desktop_payload_for_locale(&fissure, now, locale);
        assert!(payload.title.contains(hard), "${msg} (hard label: {})", payload.title);
        assert_eq!(payload.body, body, "${msg} (body)");
        let summary = notify::summarize_test_outcomes_for_locale(
            &[NotificationOutcome::Requested { destination: "desktop" }],
            locale,
        )
        .expect("Requestedをlocale別に要約できること");
        assert_eq!(summary, accepted, "${msg} (test summary)");

        let mut cfg = AppConfig::default();
        cfg.locale = locale;
        cfg.rules[0].storms = StormMode::Include;
        let include_watch = relico_lib::watch_line(&cfg);
        assert!(include_watch.starts_with(watch_prefix), "${msg} (tray: {include_watch})");
        assert!(include_watch.contains(storm_include), "${msg} (Storm Include: {include_watch})");
        cfg.rules[0].storms = StormMode::Only;
        let only_watch = relico_lib::watch_line(&cfg);
        assert!(only_watch.contains(storm_only), "${msg} (Storm Only: {only_watch})");

        let actual_candidate_error = relico_lib::i18n::format(
            locale,
            "error.unknownCandidate",
            &[("id", "bad")],
        );
        let actual_rule_error = relico_lib::i18n::format(
            locale,
            "error.unknownRuleIndex",
            &[("index", "99")],
        );
        assert_eq!(actual_candidate_error, candidate_error, "${msg} (candidate error)");
        assert_eq!(actual_rule_error, rule_error, "${msg} (rule error)");
        for rendered in [
            &payload.title,
            &payload.body,
            &summary,
            &include_watch,
            &only_watch,
            &actual_candidate_error,
            &actual_rule_error,
        ] {
            assert!(!rendered.contains("[["), "${msg} (missing marker: {rendered})");
        }
    }
}`;
    default:
      throw new Error(`未知のnotification example scenario: ${c.scenario} (${c.id})`);
  }
}

// ---- bun test(icons.ts写像)の生成 ----
function genGlyphClause(c: Clause): string {
  const name = fnName(c.id);
  switch (c.scenario) {
    case "glyph_known_values":
      return `
// ${c.id}: ${c.desc}
test("${c.id} ${name}", () => {
  const pools: Array<[GlyphKind, string[]]> = [
    ["tier", ${tsStrArray(TIER_POOL)}],
    ["planet", ${tsStrArray(PLANET_POOL)}],
    ["mission", ${tsStrArray(MISSION_POOL)}],
    ["faction", ${tsStrArray(FACTION_POOL)}],
    ["difficulty", ${tsStrArray(DIFFICULTY_POOL)}],
    ["storm", ${tsStrArray(STORM_POOL)}],
    ["action", ${tsStrArray(ACTION_POOL)}],
  ];
  for (const [kind, values] of pools) {
    // 未知値はカテゴリ別の汎用グリフへフォールバックし、例外を出さない
    const generic = glyphHtml(kind, "__unknown-value__");
    expect(generic).toContain('aria-hidden="true"');
    expect(generic).toContain("viewBox");
    for (const value of values) {
      const html = glyphHtml(kind, value);
      // 既知値には汎用と区別できる専用グリフが割り当てられている
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toBe(generic);
    }
  }
  // パレット候補のfacet→グリフ種の写像(modeはdifficultyグリフを使う)
  expect(candidateGlyphHtml("mode", "mode:SteelPath")).toBe(glyphHtml("difficulty", "SteelPath"));
  expect(candidateGlyphHtml("tier", "tier:Axi")).toBe(glyphHtml("tier", "Axi"));
  expect(candidateGlyphHtml("storm", "storm:Only")).toBe(glyphHtml("storm", "Only"));
});`;
    case "planet_proxima_view":
      return `
// ${c.id}: ${c.desc}
test("${c.id} ${name}", () => {
  for (const planet of ${tsStrArray(PROXIMA_PLANETS)}) {
    expect(planetForFissure(planet, true)).toBe(planet + " Proxima");
    expect(planetForFissure(planet, false)).toBe(planet);
  }
  expect(planetForFissure("Mars", true)).toBe("Mars");
  expect(planetForFissure("  Earth  ", true)).toBe("Earth Proxima");
  expect(planetForFissure(null, true)).toBe("");
  expect(planetForFissure(null, false)).toBe("");
});`;
    default:
      throw new Error(`未知のglyphシナリオ: ${c.scenario} (${c.id})`);
  }
}

// ---- bun test(開発tooling)の生成 ----
function genToolingClause(c: Clause): string {
  const name = fnName(c.id);
  switch (c.scenario) {
    case "e2e_targeted_cleanup":
      return `
// ${c.id}: ${c.desc}
test("${c.id} ${name}", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "relico-e2e-cleanup-"));
  const leasePath = join(tempRoot, "owned.lease");
  const otherLeasePath = join(tempRoot, "other.lease");
  writeFileSync(leasePath, "owned");
  writeFileSync(otherLeasePath, "other");

  let foreign: ChildProcess | undefined;
  let survivor: ChildProcess | undefined;
  let owned: ChildProcess | undefined;
  let idle: ChildProcess | undefined;
  let stubborn: ChildProcess | undefined;
  let changed: ChildProcess | undefined;
  try {
    const foreignFixture = await spawnFixture({ listen: true });
    foreign = foreignFixture.child;
    const survivorFixture = await spawnFixture({ listen: true, leasePath: otherLeasePath });
    survivor = survivorFixture.child;
    expect(processExists(foreign.pid!)).toBe(true);
    expect(processExists(survivor.pid!)).toBe(true);

    // leaseを持たない同port listenerはfail-closedで拒否し、終了しない。
    await expect(
      cleanupOwnedListener({
        port: foreignFixture.port!,
        expectedExecutable: process.execPath,
        leasePath,
        graceMs: 200,
      }),
    ).rejects.toThrow(/refusing to terminate foreign listener/);
    expect(processExists(foreign.pid!)).toBe(true);

    await stopFixture(foreign);
    const ownedFixture = await spawnFixture({ listen: true, leasePath });
    owned = ownedFixture.child;
    const graceful = await cleanupOwnedListener({
      port: ownedFixture.port!,
      expectedExecutable: process.execPath,
      leasePath,
      graceMs: 1_000,
    });
    expect(graceful.terminatedPids).toEqual([owned.pid]);
    expect(graceful.forcedPids).toEqual([]);
    expect(processExists(owned.pid!)).toBe(false);
    // 同じ実行ファイルでも別port・別leaseなら対象にしない。
    expect(processExists(survivor.pid!)).toBe(true);

    // holder/listenerなしは冪等なno-op。
    const noOp = await cleanupOwnedListener({
      port: ownedFixture.port!,
      expectedExecutable: process.execPath,
      leasePath,
      graceMs: 200,
    });
    expect(noOp).toEqual({ terminatedPids: [], forcedPids: [] });

    // portをまだLISTENしていなくても、lease holderを回収する。
    const idleFixture = await spawnFixture({ leasePath });
    idle = idleFixture.child;
    const preBind = await cleanupOwnedListener({
      port: ownedFixture.port!,
      expectedExecutable: process.execPath,
      leasePath,
      graceMs: 1_000,
    });
    expect(preBind.terminatedPids).toEqual([idle.pid]);
    expect(preBind.forcedPids).toEqual([]);
    expect(processExists(idle.pid!)).toBe(false);

    // TERMを無視する対象だけ、identity再照合後のKILLへ進む。
    const stubbornFixture = await spawnFixture({ ignoreTerm: true, leasePath });
    stubborn = stubbornFixture.child;
    const forced = await cleanupOwnedListener({
      port: ownedFixture.port!,
      expectedExecutable: process.execPath,
      leasePath,
      graceMs: 100,
    });
    expect(forced.terminatedPids).toEqual([stubborn.pid]);
    expect(forced.forcedPids).toEqual([stubborn.pid]);
    expect(processExists(stubborn.pid!)).toBe(false);

    // TERM後にlease inodeが変わったPIDへはKILLを送らず、cleanup自体を失敗させる。
    const changedFixture = await spawnFixture({ ignoreTerm: true, leasePath });
    changed = changedFixture.child;
    const termSeen = once(changed.stdout!, "data");
    const changedCleanup = cleanupOwnedListener({
      port: ownedFixture.port!,
      expectedExecutable: process.execPath,
      leasePath,
      graceMs: 500,
    });
    await termSeen;
    renameSync(leasePath, leasePath + ".previous");
    writeFileSync(leasePath, "replacement");
    await expect(changedCleanup).rejects.toThrow(/ownership identity changed/);
    expect(processExists(changed.pid!)).toBe(true);
    expect(leaseHolderPids(leasePath)).not.toContain(changed.pid!);
  } finally {
    await Promise.all([
      stopFixture(foreign),
      stopFixture(survivor),
      stopFixture(owned),
      stopFixture(idle),
      stopFixture(stubborn),
      stopFixture(changed),
    ]);
    rmSync(tempRoot, { recursive: true, force: true });
  }

  const justfile = readFileSync(new URL("../../justfile", import.meta.url), "utf8");
  const wdioConfig = readFileSync(new URL("../../wdio.conf.ts", import.meta.url), "utf8");
  const mainRs = readFileSync(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8");
  expect(justfile).toContain("tools/e2e-process.ts cleanup");
  expect(justfile).toContain("trap cleanup EXIT");
  expect(justfile).toContain("src-tauri/target.noindex");
  expect(justfile).toContain("e2e_port=4445");
  expect(justfile).toContain('TAURI_WEBDRIVER_PORT="$e2e_port"');
  expect(justfile).toContain('RELICO_E2E_LEASE_PATH="$e2e_lease"');
  expect(justfile).toContain("cap_status");
  expect(justfile).toContain("lease_status");
  expect(wdioConfig).toContain("embeddedPort: e2ePort");
  expect(wdioConfig).not.toContain("4445");
  expect(mainRs).toContain("RELICO_E2E_LEASE_PATH");
  expect(mainRs).toContain("std::fs::File::open");
  expect(justfile).not.toMatch(/\\b(?:pkill|killall)\\b/);
});`;
    default:
      throw new Error(`未知のtoolingシナリオ: ${c.scenario} (${c.id})`);
  }
}

// ---- Playwright renderer統合テスト(IPC mock)の生成 ----
function genRendererClause(c: Clause): string {
  switch (c.scenario) {
    case "palette_keyboard":
      return `
// ${c.id}: ${c.desc}
test("${c.id} palette keyboard", async ({ page }) => {
  await bootConsole(page);
  // どこでも打鍵で開き、入力を引き継ぐ
  await page.keyboard.press("s");
  await expect(page.locator("#palette-overlay")).toBeVisible();
  await expect(page.locator("#palette-input")).toHaveValue("s");
  // Escで閉じる
  await page.keyboard.press("Escape");
  await expect(page.locator("#palette-overlay")).toBeHidden();
  // 一覧画面のEscは設定を変更しない(リセットはCLEARボタン/パレット候補のみ)
  await page.keyboard.press("Escape");
  await expect(page.locator("#rules-meta")).toHaveText("1/2 VIEW");
  expect((await calls(page)).some((entry) => entry.cmd === "clear_filter")).toBe(false);
  // 一覧画面のSpaceはパレットを開かず、編集中ルールのVIEW選択(enabled)をトグルする
  await page.keyboard.press(" ");
  await expect(page.locator("#palette-overlay")).toBeHidden();
  await expect(page.locator("#rules-meta")).toHaveText("0/2 VIEW");
  await expect(page.locator(".rule-row .rule-toggle").first()).toHaveText("[ ]");
  expect(
    (await calls(page)).filter(
      (entry) => entry.cmd === "apply_candidate" && entry.args.id === "action:toggle-rule",
    ).length,
  ).toBe(1);
  // 再度Spaceで元に戻る(トグル)
  await page.keyboard.press(" ");
  await expect(page.locator("#rules-meta")).toHaveText("1/2 VIEW");
  await expect(page.locator(".rule-row .rule-toggle").first()).toHaveText("[x]");
  // DESELECT ALL RULESは全VIEW選択だけを解除し、notify・ルール数・edit focusを保持する
  await page.keyboard.press("d");
  await page.locator("#palette-input").fill("deselect all rules");
  await page.keyboard.press("Enter");
  await expect(page.locator("#rules-meta")).toHaveText("0/2 VIEW");
  await expect(page.locator("#rules-list .rule-row")).toHaveCount(2);
  await expect(page.locator(".rule-row .rule-toggle").first()).toHaveText("[ ]");
  await expect(page.locator(".rule-row .rule-toggle").nth(1)).toHaveText("[ ]");
  await expect(page.locator(".rule-row .rule-notify").first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".rule-row .rule-notify").nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#editing-meta")).toHaveText("R1/2");
  await expect(page.locator("#sb-watch")).toHaveText("WATCH: 2 RULES");
  const deselectCalls = (await calls(page)).filter(
    (entry) => entry.cmd === "apply_candidate" && entry.args.id === "action:deselect-all-rules",
  );
  expect(deselectCalls).toHaveLength(1);
  expect((await calls(page)).some((entry) => entry.cmd === "set_rule_notify")).toBe(false);
  expect((await calls(page)).some((entry) => entry.cmd === "clear_filter")).toBe(false);
  await page.keyboard.press("Escape");
  await expect(page.locator("#palette-overlay")).toBeHidden();
  // 一覧画面の↑/↓はedit focusを前後のルールへ巡回移動する(設定は変更しない)
  const mutations = async () =>
    (await calls(page)).filter(
      (entry) => entry.cmd === "set_config" || entry.cmd === "set_rule_enabled",
    ).length;
  const mutationsBefore = await mutations();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#editing-meta")).toHaveText("R2/2");
  await expect(page.locator(".rule-row").nth(1)).toHaveClass(/rule-focus/);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#editing-meta")).toHaveText("R1/2");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#editing-meta")).toHaveText("R2/2");
  // Ctrl+1..9は対応indexのルールへ直接ジャンプする。Cmd+数字はコンテンツタブ専用
  await page.keyboard.press("Control+1");
  await expect(page.locator("#editing-meta")).toHaveText("R1/2");
  expect(await mutations()).toBe(mutationsBefore);
  // Cmd+1..9はコンテンツタブ専用で、rule edit focus・設定を変更しない。
  await page.keyboard.press("Meta+9");
  await expect(page.locator('#content-tabs [aria-selected="true"]')).toHaveAttribute(
    "data-tab-id",
    "descendia",
  );
  await expect(page.locator("#editing-meta")).toHaveText("R1/2");
  expect(await mutations()).toBe(mutationsBefore);
  await page.keyboard.press("Meta+1");
  await expect(page.locator('#content-tabs [aria-selected="true"]')).toHaveAttribute(
    "data-tab-id",
    "fissures",
  );
  // IME変換中(composition中)のEnterは候補を適用しない
  await page.keyboard.press("a");
  await expect(page.locator("#palette-overlay")).toBeVisible();
  await page.locator("#palette-input").dispatchEvent("compositionstart");
  const appliedBefore = (await calls(page)).filter((entry) => entry.cmd === "apply_candidate").length;
  await page.keyboard.press("Enter");
  expect((await calls(page)).filter((entry) => entry.cmd === "apply_candidate").length).toBe(appliedBefore);
  await page.locator("#palette-input").dispatchEvent("compositionend");
  // 確定後のEnterは候補を適用し、開いたままクエリだけリセット(連続入力)
  await page.locator("#palette-input").fill("axi");
  await page.keyboard.press("Enter");
  const applied = (await calls(page)).filter((entry) => entry.cmd === "apply_candidate");
  expect(applied.length).toBe(appliedBefore + 1);
  expect(applied[applied.length - 1].args.id).toBe("tier:Axi");
  await expect(page.locator("#palette-overlay")).toBeVisible();
  await expect(page.locator("#palette-input")).toHaveValue("");
  // パレット表示中もCtrl+数字で編集対象を切り替えられる(開いたまま)
  await page.keyboard.press("Control+2");
  await expect(page.locator("#palette-rule")).toContainText("EDIT R2");
  await expect(page.locator("#palette-overlay")).toBeVisible();
});`;
    case "delivery_flush":
      return `
// ${c.id}: ${c.desc}
test("${c.id} delivery flush", async ({ page }) => {
  await bootConsole(page);
  await page.locator("#delivery-tab").click();
  await page.locator("#webhook-input").fill("https://discord.com/api/webhooks/1/tok");
  await page.locator("#test-btn").click();
  await expect(page.locator("#rail-msg")).toHaveText(/通知要求/);
  const sequence = await calls(page);
  const saveIndex = sequence.findIndex(
    (entry) =>
      entry.cmd === "set_config" &&
      entry.args.config.discordWebhookUrl === "https://discord.com/api/webhooks/1/tok",
  );
  const testIndex = sequence.findIndex((entry) => entry.cmd === "test_notification");
  expect(saveIndex).toBeGreaterThanOrEqual(0);
  expect(testIndex).toBeGreaterThan(saveIndex);
});`;
    case "rule_row_controls":
      return `
// ${c.id}: ${c.desc}
test("${c.id} toggle vs edit focus", async ({ page }) => {
  await bootConsole(page);
  const editingBefore = await page.locator("#editing-meta").textContent();
  // VIEW選択(enabled)切替はset_rule_enabledだけを呼び、notify・edit focus・パレットを動かさない
  await page.locator(".rule-row .rule-toggle").first().click();
  const toggles = (await calls(page)).filter((entry) => entry.cmd === "set_rule_enabled");
  expect(toggles.length).toBe(1);
  expect(toggles[0].args).toEqual({ index: 0, enabled: false });
  await expect(page.locator(".rule-row .rule-notify").first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#editing-meta")).toHaveText(editingBefore ?? "");
  await expect(page.locator("#palette-overlay")).toBeHidden();
  // notify切替はset_rule_notifyだけを呼び、VIEW選択(enabled)もedit focusも変えない
  await page.locator(".rule-row .rule-notify").first().click();
  const notifies = (await calls(page)).filter((entry) => entry.cmd === "set_rule_notify");
  expect(notifies.length).toBe(1);
  expect(notifies[0].args).toEqual({ index: 0, notify: false });
  await expect(page.locator(".rule-row .rule-notify").first()).toHaveAttribute("aria-pressed", "false");
  expect((await calls(page)).filter((entry) => entry.cmd === "set_rule_enabled").length).toBe(1);
  await expect(page.locator("#editing-meta")).toHaveText(editingBefore ?? "");
  // 行本体はedit focusをそのルールへ移すだけで、パレットも切替も呼ばない
  await page.locator(".rule-row .rule-edit").nth(1).click();
  await expect(page.locator("#editing-meta")).toHaveText("R2/2");
  await expect(page.locator(".rule-row").nth(1)).toHaveClass(/rule-focus/);
  await expect(page.locator("#palette-overlay")).toBeHidden();
  expect((await calls(page)).filter((entry) => entry.cmd === "set_rule_enabled").length).toBe(1);
  // DEL/CLEARは2度押し確認: 1クリック目はSURE?表示になるだけで実行しない
  await page.locator("#rule-del").click();
  await expect(page.locator("#rule-del")).toHaveText("SURE?");
  const delCalls = async () =>
    (await calls(page)).filter(
      (entry) => entry.cmd === "apply_candidate" && entry.args.id === "action:delete-rule",
    ).length;
  expect(await delCalls()).toBe(0);
  // 2秒で自動復帰する
  await expect(page.locator("#rule-del")).not.toHaveText("SURE?", { timeout: 4000 });
  expect(await delCalls()).toBe(0);
  // SURE?表示中のクリックだけが実行する
  await page.locator("#rule-del").click();
  await page.locator("#rule-del").click();
  await expect.poll(delCalls).toBe(1);
  await expect(page.locator("#rules-list .rule-row")).toHaveCount(1);
  // CLEARも同じ2度押し(1クリック目は実行しない)
  await page.locator("#clear-btn").click();
  await expect(page.locator("#clear-btn")).toHaveText("SURE?");
  expect((await calls(page)).some((entry) => entry.cmd === "clear_filter")).toBe(false);
});

// ${c.id}: ${c.desc} (全ルールのVIEW選択解除)
test("${c.id} all rules view off", async ({ page }) => {
  await bootConsole(page, { allRulesDisabled: true });
  // VIEW無指定でも一覧は全亀裂を表示し、notify=trueルールのWATCHは継続する
  await expect(page.locator("#fissure-rows tr")).toHaveCount(3);
  await expect(page.locator("#fissure-rows td.empty")).toHaveCount(0);
  await expect(page.locator("#rules-meta")).toHaveText("0/2 VIEW");
  await expect(page.locator("#sb-watch")).toHaveText("WATCH: 2 RULES");
  await expect(page.locator(".rule-row .rule-notify").first()).toHaveAttribute("aria-pressed", "true");
});`;
    case "sidebar_fit":
      return `
// ${c.id}: ${c.desc}
test("${c.id} sidebar fits minimum window", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await bootConsole(page);
  const railFits = () =>
    page.locator(".rail").evaluate((el) => el.scrollHeight <= el.clientHeight);
  expect(await railFits()).toBe(true);
  // FILTERSタブ: ルール一覧・NEW/DEL/CLEAR・5軸launcherへ到達できる
  await expect(page.locator(".rule-focus")).toBeVisible();
  for (const id of ["rule-new", "rule-del", "clear-btn"]) {
    await expect(page.locator("#" + id)).toBeVisible();
  }
  for (const id of ["tier-checks", "mode-checks", "storm-checks", "mission-checks", "planet-checks"]) {
    await expect(page.locator("#" + id)).toBeVisible();
  }
  // launcherは既存パレットをその軸に絞って開く
  await page.locator("#mission-checks").click();
  await expect(page.locator("#palette-overlay")).toBeVisible();
  await expect(page.locator("#palette-rule")).toContainText("MISSION");
  const facets = await page.locator("#palette-cands .cand .facet").allTextContents();
  expect(facets.length).toBeGreaterThan(0);
  expect(facets.every((facet) => facet === "MISSION")).toBe(true);
  await page.keyboard.press("Escape");
  // DELIVERYタブ: 配送先・TEST・時間設定・PAUSEへ到達できる
  await page.locator("#delivery-tab").click();
  for (const id of ["desktop-check", "webhook-input", "test-btn", "minremain-input", "poll-input", "pause-btn"]) {
    await expect(page.locator("#" + id)).toBeVisible();
  }
  expect(await railFits()).toBe(true);
  // 既定サイズでも縦スクロールを必要としない
  await page.setViewportSize({ width: 960, height: 620 });
  expect(await railFits()).toBe(true);
});

// ${c.id}: ${c.desc} (ルール一覧の固定比率領域と内側縦スクロール)
test("${c.id} rules list scrolls inside fixed-ratio area", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await bootConsole(page);
  const listHeight = () => page.locator("#rules-list").evaluate((el) => el.clientHeight);
  const fewHeight = await listHeight();
  // ルールが増えても一覧領域の高さ(固定比率)は変わらず、railもスクロールしない
  for (let i = 0; i < 10; i++) {
    await page.locator("#rule-new").click();
  }
  await expect(page.locator("#rules-list .rule-row")).toHaveCount(12);
  expect(Math.abs((await listHeight()) - fewHeight)).toBeLessThanOrEqual(1);
  expect(await page.locator(".rail").evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  // 全ルール行を保持したまま一覧の内側だけ縦スクロールする
  expect(await page.locator("#rules-list").evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // focus行(最後に追加したR12)は可視領域へ追従する
  await expect(page.locator(".rule-focus .rno")).toHaveText("R12");
  await expect(page.locator(".rule-focus")).toBeInViewport();
});`;
    case "rule_naming":
      return `
// ${c.id}: ${c.desc}
test("${c.id} rule naming and palette toggle", async ({ page }) => {
  await bootConsole(page);
  // NAME入力は編集中ルール(R1)の名前をdebounce保存する
  await page.locator("#rulename-input").fill("MY FARM");
  await expect
    .poll(async () =>
      (await calls(page)).some(
        (entry) => entry.cmd === "set_config" && entry.args.config.rules[0].name === "MY FARM",
      ),
    )
    .toBe(true);
  // ルール行は名前を要約より優先表示する
  await expect(page.locator(".rule-focus .rule-summary")).toHaveText("MY FARM");
  const editingBefore = await page.locator("#editing-meta").textContent();
  // パレットは名前でRULE候補を検索できる(どこでも打鍵で開く)
  await page.locator("#rulename-input").blur();
  await page.keyboard.press("m");
  await expect(page.locator("#palette-overlay")).toBeVisible();
  await page.locator("#palette-input").fill("my farm");
  const cand = page.locator("#palette-cands .cand", { hasText: "MY FARM" });
  await expect(cand.locator(".facet")).toHaveText("RULE");
  await expect(cand.locator(".box")).toHaveText("[x]");
  // 適用は対象ルールのenabledトグルだけで、edit focus表示を変えない
  await page.keyboard.press("Enter");
  const applied = (await calls(page)).filter((entry) => entry.cmd === "apply_candidate");
  expect(applied[applied.length - 1].args.id).toBe("rule:0");
  await expect(page.locator(".rule-row").first()).toHaveClass(/disabled/);
  await expect(page.locator(".rule-row .rule-toggle").first()).toHaveText("[ ]");
  await expect(page.locator("#editing-meta")).toHaveText(editingBefore ?? "");
  // RENAME RULE候補の適用はパレット入力を改名モードへ切り替える(現在名をprefill)
  await page.locator("#palette-input").fill("rename");
  await page.keyboard.press("Enter");
  await expect(page.locator("#palette-input")).toHaveValue("MY FARM");
  // Escは保存せず通常モードへ戻る(パレットは開いたまま)
  await page.keyboard.press("Escape");
  await expect(page.locator("#palette-overlay")).toBeVisible();
  await expect(page.locator("#palette-input")).toHaveValue("");
  // 改名モードのEnterは編集中ルールの名前を保存して通常モードへ戻る
  await page.locator("#palette-input").fill("rename");
  await page.keyboard.press("Enter");
  await page.locator("#palette-input").fill("VOID RUSH");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () =>
      (await calls(page)).some(
        (entry) => entry.cmd === "set_config" && entry.args.config.rules[0].name === "VOID RUSH",
      ),
    )
    .toBe(true);
  await expect(page.locator(".rule-focus .rule-summary")).toHaveText("VOID RUSH");
  await expect(page.locator("#palette-overlay")).toBeVisible();
  await expect(page.locator("#palette-input")).toHaveValue("");
});`;
    case "table_sort":
      return `
// ${c.id}: ${c.desc}
test("${c.id} table sort by column", async ({ page }) => {
  await bootConsole(page);
  const firstRow = () => page.locator("#fissure-rows tr").first();
  // 既定はT-REMAIN昇順(消滅が近い順)
  await expect(page.locator("th.col-timer")).toHaveAttribute("aria-sort", "ascending");
  await expect(firstRow().locator(".col-tier")).toContainText("REQUIEM");
  // ヘッダクリックでその列の昇順ソート
  await page.locator("th.col-tier").click();
  await expect(page.locator("th.col-tier")).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator("th.col-timer")).not.toHaveAttribute("aria-sort");
  await expect(firstRow().locator(".col-tier")).toContainText("LITH");
  // 同じ列の再クリックで降順へトグル
  await page.locator("th.col-tier").click();
  await expect(page.locator("th.col-tier")).toHaveAttribute("aria-sort", "descending");
  await expect(firstRow().locator(".col-tier")).toContainText("REQUIEM");
  // 別の列をクリックするとその列の昇順から始まる
  await page.locator("th.col-mission").click();
  await expect(page.locator("th.col-mission")).toHaveAttribute("aria-sort", "ascending");
  await expect(firstRow().locator(".col-mission")).toContainText("CAPTURE");
  // ソートは表示のみ: 設定・通知の変更を呼ばない
  expect(
    (await calls(page)).filter((entry) =>
      ["set_config", "set_rule_enabled", "set_rule_notify", "apply_candidate"].includes(entry.cmd),
    ).length,
  ).toBe(0);
});`;
    case "compact_table":
      return `
// ${c.id}: ${c.desc}
test("${c.id} compact table breakpoints", async ({ page }) => {
  await page.setViewportSize({ width: 950, height: 620 });
  await bootConsole(page);
  await expect(page.locator("th[scope=col]")).toHaveCount(7);
  const firstRow = page.locator("#fissure-rows tr").first();
  // 950px(表領域740px)では7列1段のtable表示を維持する
  expect(await firstRow.evaluate((el) => getComputedStyle(el).display)).toBe("table-row");
  for (const width of [949, 800, 720]) {
    await page.setViewportSize({ width, height: 620 });
    // 2段gridへ切り替わる
    expect(await firstRow.evaluate((el) => getComputedStyle(el).display)).toBe("grid");
    // 横スクロールを必要としない
    expect(await page.locator(".tablewrap").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // ヘッダはsticky
    expect(await page.locator("thead").evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  }
  // MODEとSTORMは別セル・別ラベルのまま
  const stormRow = page.locator("#fissure-rows tr", { hasText: "Nsu Grid" });
  await expect(stormRow.locator(".col-mode .flag")).toHaveText(/HARD/);
  await expect(stormRow.locator(".col-storm .flag")).toHaveText(/STORM/);
  // 長い値はellipsisしてもDOM上の全文と行tooltipを保持する
  const longRow = page.locator("#fissure-rows tr", { hasText: "Taveuni" });
  await expect(longRow.locator(".col-node .icon-label > span:last-child")).toHaveText(
    "Taveuni (Kuva Fortress)",
  );
  expect(await longRow.getAttribute("title")).toContain("Taveuni (Kuva Fortress)");
  // 実APIのFACTION名THE MURMURは標準幅でも省略しない
  const murmur = longRow.locator(".col-faction .icon-label > span:last-child");
  await expect(murmur).toHaveText("THE MURMUR");
  expect(await murmur.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

// ${c.id}: ${c.desc} (empty rowの全幅表示)
test("${c.id} empty row spans full width", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await bootConsole(page, { noFissures: true });
  const spansFullWidth = await page.locator("#fissure-rows td.empty").evaluate((el) => {
    const row = el.closest("tr");
    if (!row) return false;
    return Math.abs(el.getBoundingClientRect().width - row.getBoundingClientRect().width) <= 1;
  });
  expect(spansFullWidth).toBe(true);
});`;
    case "expiry_cleanup":
      return `
// ${c.id}: ${c.desc}
test("${c.id} expiry cleanup", async ({ page }) => {
  await bootConsole(page, { firstExpirySecs: 1 });
  const expiring = page.locator("#fissure-rows tr", { hasText: "Taveuni" });
  await expect(expiring).toHaveCount(1);
  await expect(expiring).toHaveCount(0, { timeout: 3500 });
  await expect(page.locator("#fissure-rows tr", { hasText: "Nsu Grid" })).toHaveCount(1);
  const statusIds = await page.evaluate(() => {
    const state = (window as unknown as { __MOCK_STATE__: { status: { fissures: Array<{ id: string }> } } }).__MOCK_STATE__;
    return state.status.fissures.map((fissure) => fissure.id);
  });
  expect(statusIds).not.toContain("fx-requiem");
  expect(
    (await calls(page)).filter((entry) =>
      ["set_config", "set_rule_enabled", "set_rule_notify", "apply_candidate"].includes(entry.cmd),
    ).length,
  ).toBe(0);
});`;
    case "unselected_picker_create":
      return `
// ${c.id}: ${c.desc}
test("${c.id} unselected picker creates a view rule", async ({ page }) => {
  await bootConsole(page, { allRulesDisabled: true });
  // 全VIEW解除後も残っているR2のedit focusを、暗黙作成時に誤編集しない
  await page.locator(".rule-row .rule-edit").nth(1).click();
  await expect(page.locator("#editing-meta")).toHaveText("R2/2");
  const before = await page.evaluate(() =>
    structuredClone(
      (window as unknown as { __MOCK_STATE__: { config: { rules: unknown[] } } })
        .__MOCK_STATE__.config.rules,
    ),
  );

  await page.locator("#tier-checks").click();
  await page.locator("#palette-cands .cand", { hasText: "Requiem" }).click();

  await expect(page.locator("#rules-list .rule-row")).toHaveCount(3);
  await expect(page.locator("#rules-meta")).toHaveText("1/3 VIEW");
  await expect(page.locator("#editing-meta")).toHaveText("R3/3");
  const after = await page.evaluate(() =>
    structuredClone(
      (window as unknown as {
        __MOCK_STATE__: {
          config: {
            rules: Array<{
              enabled: boolean;
              notify: boolean;
              tiers: string[];
            }>;
          };
        };
      }).__MOCK_STATE__.config.rules,
    ),
  );
  expect(after.slice(0, 2)).toEqual(before);
  expect(after[2]).toMatchObject({ enabled: true, notify: false, tiers: ["Requiem"] });
  const applied = (await calls(page)).filter((entry) => entry.cmd === "apply_candidate");
  expect(applied[applied.length - 1].args).toEqual({ id: "tier:Requiem", active: 1 });
});

// ${c.id}: ${c.desc} (NEW RULE応答中の後続候補を旧ルールへ適用しない)
test("${c.id} serializes rapid new rule and filter apply", async ({ page }) => {
  await bootConsole(page, { allRulesDisabled: true, applyCandidateDelayMs: 80 });
  const before = await page.evaluate(() =>
    structuredClone(
      (window as unknown as { __MOCK_STATE__: { config: { rules: unknown[] } } })
        .__MOCK_STATE__.config.rules,
    ),
  );

  await page.keyboard.press("n");
  await page.locator("#palette-input").fill("new rule");
  await page.keyboard.press("Enter");
  // 最初のIPC応答を待たず、異なるfilter候補を確定する
  await page.locator("#palette-input").fill("axi");
  await expect(page.locator("#palette-cands .cand", { hasText: "Axi" })).toHaveCount(1);
  await page.keyboard.press("Enter");

  await expect(page.locator("#rules-list .rule-row")).toHaveCount(3);
  await expect(page.locator("#rules-meta")).toHaveText("1/3 VIEW");
  await expect(page.locator("#editing-meta")).toHaveText("R3/3");
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as unknown as {
          __MOCK_STATE__: { config: { rules: Array<{ tiers: string[] }> } };
        }).__MOCK_STATE__.config.rules[2]?.tiers,
      ),
    )
    .toEqual(["Axi"]);
  const after = await page.evaluate(() =>
    structuredClone(
      (window as unknown as {
        __MOCK_STATE__: {
          config: { rules: Array<{ enabled: boolean; notify: boolean; tiers: string[] }> };
        };
      }).__MOCK_STATE__.config.rules,
    ),
  );
  expect(after.slice(0, 2)).toEqual(before);
  expect(after[2]).toMatchObject({ enabled: true, notify: false, tiers: ["Axi"] });
});`;
    case "content_tabs":
      return `
// ${c.id}: ${c.desc}
test("${c.id} content tabs and browser shortcuts", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 620 });
  await bootConsole(page, { locale: "en" });
  const tabs = [
    ["fissures", "Fissures"],
    ["arbitration", "Arbitration"],
    ["sortie", "Sortie"],
    ["archon", "Archon Hunt"],
    ["syndicates", "Syndicates"],
    ["area-missions", "Area Missions"],
    ["circuit", "Circuit"],
    ["archimedea", "Archimedea"],
    ["descendia", "Descendia"],
  ] as const;
  await expect(page.locator("#content-tabs")).toHaveAttribute("role", "tablist");
  await expect(page.locator("#content-tabs [role=tab]")).toHaveCount(tabs.length);
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(tabs.length);
  expect(
    await page.locator("#content-tabs [role=tab]").evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-tab-id")),
    ),
  ).toEqual(tabs.map(([id]) => id));
  await expect(
    page.locator("#tab-netracells, #panel-netracells"),
  ).toHaveCount(0);

  for (const [id, label] of tabs) {
    const tab = page.locator("#tab-" + id);
    const panel = page.locator("#panel-" + id);
    await expect(tab).toHaveAttribute("role", "tab");
    await expect(tab).toHaveAttribute("data-tab-id", id);
    await expect(tab).toHaveAttribute("aria-controls", "panel-" + id);
    await expect(tab).toHaveText(label);
    await expect(panel).toHaveAttribute("role", "tabpanel");
    await expect(panel).toHaveAttribute("aria-labelledby", "tab-" + id);
  }

  const assertActive = async (id: string) => {
    await expect(page.locator('#content-tabs [role="tab"][aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator('#content-tabs [role="tab"][tabindex="0"]')).toHaveCount(1);
    await expect(page.locator('#content-tabs [role="tab"][aria-selected="true"]')).toHaveAttribute(
      "data-tab-id",
      id,
    );
    await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveCount(1);
    await expect(page.locator("#panel-" + id)).toBeVisible();
    await expect(page.locator('#content-tabs [role="tab"][aria-selected="false"]')).toHaveCount(
      tabs.length - 1,
    );
    await expect(page.locator('#content-tabs [role="tab"][tabindex="-1"]')).toHaveCount(
      tabs.length - 1,
    );
  };

  await assertActive("fissures");
  for (let i = 0; i < tabs.length; i++) {
    await page.keyboard.press("Meta+" + (i + 1));
    await assertActive(tabs[i][0]);
  }
  // 最終タブから次へ、先頭タブから前へ循環する。
  await page.keyboard.press("Control+Tab");
  await assertActive("fissures");
  await page.keyboard.press("Control+Shift+Tab");
  await assertActive("descendia");

  // Ctrl+数字はタブではなく従来のrule edit focusだけを変更する。
  await page.keyboard.press("Control+2");
  await expect(page.locator("#editing-meta")).toHaveText("R2/2");
  await assertActive("descendia");

  // ARIA roving focusは矢印/Home/Endでactive tabと共に移動する。
  await page.locator("#tab-fissures").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tab-arbitration")).toBeFocused();
  await assertActive("arbitration");
  await page.keyboard.press("Home");
  await expect(page.locator("#tab-fissures")).toBeFocused();
  await assertActive("fissures");
  await page.keyboard.press("End");
  await expect(page.locator("#tab-descendia")).toBeFocused();
  await assertActive("descendia");

  // source・時間状態・Area内のsource分離をDOM属性で保持する。
  await page.keyboard.press("Meta+2");
  const arbitration = page.locator(
    '#panel-arbitration .timed-card[data-card-id="arbitration-current"]',
  );
  await expect(arbitration).toHaveAttribute("data-temporal-status", "active");
  await expect(arbitration).toHaveAttribute("data-provenance", "community-schedule");
  expect(await page.locator("#timed-arbitration").getAttribute("aria-live")).toBeNull();
  // 亀裂表と同じ時間文法: 絶対日時のStarts表記ではなくdata-expiry駆動のカウントダウン。
  const arbitrationTimer = arbitration.locator(".t-timer[data-expiry]");
  await expect(arbitrationTimer).toHaveCount(1);
  await expect(arbitrationTimer).toHaveText(/^\\d+:\\d{2}(:\\d{2})?$/);
  expect(await arbitration.textContent()).not.toContain("Starts ");
  await expect(arbitration.locator(".timed-source-link")).toHaveAttribute(
    "href",
    /browse\\.wf/,
  );
  await expect(
    page.locator(
      '#panel-arbitration .timed-source-validity[data-source="browseWfArbitration"]',
    ),
  ).toBeVisible();

  await page.keyboard.press("Meta+6");
  const areaGroups = page.locator("#panel-area-missions .timed-card-group");
  await expect(areaGroups).toHaveCount(5);
  expect(
    await areaGroups.evaluateAll((groups) => groups.map((group) => group.getAttribute("data-group"))),
  ).toEqual(["environments", "worldstate", "location-objectives", "bounties", "events"]);
  await expect(page.locator('#panel-area-missions .timed-card-group[data-group="environments"] .timed-card')).toHaveCount(5);
  await expect(page.locator('#panel-area-missions .timed-card-group[data-group="location-objectives"] .timed-card')).toHaveCount(3);
  await expect(page.locator('#panel-area-missions .timed-card-group[data-group="events"] .timed-card')).toHaveCount(1);
  const areaFactionVariants = await page
    .locator('#panel-area-missions .timed-card-group[data-group="worldstate"] .timed-card, #panel-area-missions .timed-card-group[data-group="bounties"] .timed-card')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-variant")));
  for (const variant of ["ostrons", "solaris-united", "entrati", "holdfasts", "cavia", "hex"]) {
    expect(areaFactionVariants).toContain(variant);
  }
  await expect(
    page.locator(
      '#panel-area-missions .timed-source-error[data-source="wfcd"][data-freshness="stale"]',
    ),
  ).toContainText("wfcd down");
  await expect(
    page.locator(
      '#panel-area-missions .timed-source-error[data-source="browseWfBounties"][data-freshness="unavailable"]',
    ),
  ).toContainText("oracle down");
  await expect(
    page.locator(
      '#panel-area-missions .timed-source-error[data-source="browseWfLocationBounties"][data-freshness="unavailable"]',
    ),
  ).toContainText("location oracle down");

  await page.keyboard.press("Meta+7");
  const circuit = page.locator('#panel-circuit .timed-card[data-provenance="official-live"]');
  await expect(circuit).toHaveCount(1);
  await expect(circuit.locator(".timed-stage")).toHaveCount(2);
  await expect(circuit.locator(".timed-stage").nth(0)).toContainText(/Excalibur.*Mag.*Volt/s);
  await expect(circuit.locator(".timed-stage").nth(1)).toContainText(/Braton.*Lato.*Skana.*Paris.*Kunai/s);

  await page.keyboard.press("Meta+9");
  await expect(page.locator('#panel-descendia .timed-card[data-temporal-status="active"]')).toBeVisible();
  await expect(
    page.locator('#panel-descendia details.timed-upcoming[data-card-id="descendia-next"]'),
  ).toBeVisible();
  // upcomingは開始までのカウントダウン(data-activation駆動)を表示する。
  await expect(
    page.locator(
      '#panel-descendia details.timed-upcoming[data-card-id="descendia-next"] .t-timer[data-activation]',
    ),
  ).toHaveCount(1);
  // 個人進捗の非公開を説明するprogress noteはどのタブにも表示しない。
  await expect(page.locator(".timed-progress-note")).toHaveCount(0);
});`;
    case "mute_window":
      return `
// ${c.id}: ${c.desc}
test("${c.id} notification mute window", async ({ page }) => {
  await bootConsole(page, { locale: "en", notificationsMuted: true });
  await page.locator("#delivery-tab").click();
  await expect(page.locator("#mute-status")).toHaveAttribute("data-muted", "true");
  await expect(page.locator("#mute-status")).toBeVisible();

  const rulesBefore = await page.locator("#rules-list .rule-row").count();
  await expect(page.locator("#mute-check")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#mute-start-input")).toBeDisabled();
  await expect(page.locator("#mute-end-input")).toBeDisabled();
  await page.locator("#mute-check").click();
  await expect(page.locator("#mute-check")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#mute-start-input")).toBeEnabled();
  await expect(page.locator("#mute-end-input")).toBeEnabled();
  await page.locator("#mute-start-input").fill("22:15");
  await page.locator("#mute-start-input").dispatchEvent("change");
  await page.locator("#mute-end-input").fill("06:45");
  await page.locator("#mute-end-input").dispatchEvent("change");

  await expect
    .poll(async () =>
      (await calls(page)).some(
        (entry) =>
          entry.cmd === "set_config" &&
          entry.args.config.notificationMute.enabled === true &&
          entry.args.config.notificationMute.startMinute === 1335 &&
          entry.args.config.notificationMute.endMinute === 405,
      ),
    )
    .toBe(true);
  await expect(page.locator("#rules-list .rule-row")).toHaveCount(rulesBefore);
  expect(
    (await calls(page)).filter((entry) =>
      ["set_rule_enabled", "set_rule_notify", "apply_candidate", "clear_filter"].includes(entry.cmd),
    ),
  ).toHaveLength(0);

  // backendがMUTEDと報告していても、明示操作のTEST DELIVERYは抑止しない。
  await page.locator("#test-btn").click();
  await expect
    .poll(async () => (await calls(page)).some((entry) => entry.cmd === "test_notification"))
    .toBe(true);
});`;
    case "locale_display":
      return `
// ${c.id}: ${c.desc}
const localeGoldens = {
  ja: {
    text: [
      ["#tab-fissures", "tabs.fissures", "亀裂"],
      ["#tab-arbitration", "tabs.arbitration", "仲裁"],
      ["#tab-sortie", "tabs.sortie", "ソーティー"],
      ["#tab-archon", "tabs.archon", "アルコン討伐戦"],
      ["#tab-syndicates", "tabs.syndicates", "シンジケート"],
      ["#tab-area-missions", "tabs.areaMissions", "地位ミッション"],
      ["#tab-circuit", "tabs.circuit", "サーキット"],
      ["#tab-archimedea", "tabs.archimedea", "アルキメデア"],
      ["#tab-descendia", "tabs.descendia", "ディセンディア"],
      ["#filters-tab", "sidebar.filters", "フィルター"],
      ["#delivery-tab", "sidebar.delivery", "通知"],
      ["#test-btn", "delivery.test", "通知をテスト"],
      ["#pause-btn", "common.pause", "一時停止"],
      ['#mute-check [data-i18n-key="delivery.muteSchedule"]', "delivery.muteSchedule", "通知ミュート"],
    ],
    appTitle: "RELICO — 時限コンテンツ",
    tabsLabel: "時限コンテンツ",
    languageLabel: "表示言語",
    rulePlaceholder: "ルール名 (R1)",
    arbitrationProvenance: "コミュニティ予測",
    areaGroups: ["環境サイクル", "通常依頼", "ローカル依頼候補", "追加依頼", "エリアイベント"],
    environmentState: "状態 昼",
    circuitStages: ["通常サーキット", "鋼の道のりサーキット"],
  },
  en: {
    text: [
      ["#tab-fissures", "tabs.fissures", "Fissures"],
      ["#tab-arbitration", "tabs.arbitration", "Arbitration"],
      ["#tab-sortie", "tabs.sortie", "Sortie"],
      ["#tab-archon", "tabs.archon", "Archon Hunt"],
      ["#tab-syndicates", "tabs.syndicates", "Syndicates"],
      ["#tab-area-missions", "tabs.areaMissions", "Area Missions"],
      ["#tab-circuit", "tabs.circuit", "Circuit"],
      ["#tab-archimedea", "tabs.archimedea", "Archimedea"],
      ["#tab-descendia", "tabs.descendia", "Descendia"],
      ["#filters-tab", "sidebar.filters", "Filters"],
      ["#delivery-tab", "sidebar.delivery", "Delivery"],
      ["#test-btn", "delivery.test", "Test Delivery"],
      ["#pause-btn", "common.pause", "Pause"],
      ['#mute-check [data-i18n-key="delivery.muteSchedule"]', "delivery.muteSchedule", "Notification mute"],
    ],
    appTitle: "RELICO — TIMED CONTENT",
    tabsLabel: "Timed content",
    languageLabel: "Display language",
    rulePlaceholder: "Rule name (R1)",
    arbitrationProvenance: "Community prediction",
    areaGroups: ["Environments", "Open-world bounties", "Objective rotations", "Additional bounties", "Area events"],
    environmentState: "State Day",
    circuitStages: ["Normal Circuit", "Steel Path Circuit"],
  },
  "zh-Hans": {
    text: [
      ["#tab-fissures", "tabs.fissures", "裂隙"],
      ["#tab-arbitration", "tabs.arbitration", "仲裁"],
      ["#tab-sortie", "tabs.sortie", "突击"],
      ["#tab-archon", "tabs.archon", "执刑官猎杀"],
      ["#tab-syndicates", "tabs.syndicates", "集团"],
      ["#tab-area-missions", "tabs.areaMissions", "地区任务"],
      ["#tab-circuit", "tabs.circuit", "无尽回廊"],
      ["#tab-archimedea", "tabs.archimedea", "科研考察"],
      ["#tab-descendia", "tabs.descendia", "后裔战场"],
      ["#filters-tab", "sidebar.filters", "筛选"],
      ["#delivery-tab", "sidebar.delivery", "通知"],
      ["#test-btn", "delivery.test", "测试通知"],
      ["#pause-btn", "common.pause", "暂停"],
      ['#mute-check [data-i18n-key="delivery.muteSchedule"]', "delivery.muteSchedule", "通知静音"],
    ],
    appTitle: "RELICO — 限时内容",
    tabsLabel: "限时内容",
    languageLabel: "显示语言",
    rulePlaceholder: "规则名称 (R1)",
    arbitrationProvenance: "社区预测",
    areaGroups: ["环境周期", "开放世界赏金", "目标轮换", "额外赏金", "地区活动"],
    environmentState: "状态 白昼",
    circuitStages: ["普通无尽回廊", "钢铁之路无尽回廊"],
  },
} as const;

for (const [locale, golden] of Object.entries(localeGoldens)) {
  test("${c.id} semantic DOM golden " + locale, async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 480 });
    await bootConsole(page, { locale: locale as "ja" | "en" | "zh-Hans" });
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("#locale-select")).toHaveValue(locale);
    await expect(page).toHaveTitle(golden.appTitle);

    for (const [selector, key, expectedText] of golden.text) {
      const node = page.locator(selector);
      await expect(node).toHaveAttribute("data-i18n-key", key);
      await expect(node).toHaveText(expectedText);
    }
    await expect(page.locator("#content-tabs")).toHaveAttribute("data-i18n-aria-label-key", "tabs.label");
    await expect(page.locator("#content-tabs")).toHaveAttribute("aria-label", golden.tabsLabel);
    await expect(page.locator("#locale-select")).toHaveAttribute(
      "data-i18n-aria-label-key",
      "delivery.language",
    );
    await expect(page.locator("#locale-select")).toHaveAttribute("aria-label", golden.languageLabel);
    await expect(page.locator("#rulename-input")).toHaveAttribute(
      "data-i18n-placeholder-key",
      "rules.namePlaceholder",
    );
    await expect(page.locator("#rulename-input")).toHaveAttribute("placeholder", golden.rulePlaceholder);
    await expect(
      page.locator('#panel-arbitration .timed-card[data-provenance="community-schedule"] .timed-provenance-badge'),
    ).toHaveText(golden.arbitrationProvenance);
    await page.locator("#tab-area-missions").click();
    const areaHeadings = page.locator("#panel-area-missions .timed-group-heading");
    await expect(areaHeadings).toHaveCount(5);
    for (const [index, expected] of golden.areaGroups.entries()) {
      await expect(areaHeadings.nth(index)).toHaveText(expected);
    }
    await expect(
      page.locator('#panel-area-missions .timed-card-group[data-group="environments"] .timed-card').first().locator(".timed-meta"),
    ).toContainText(golden.environmentState);
    const circuitStages = page.locator("#panel-circuit .timed-stage-title");
    await expect(circuitStages).toHaveCount(2);
    await expect(circuitStages.nth(0)).toHaveText(golden.circuitStages[0]);
    await expect(circuitStages.nth(1)).toHaveText(golden.circuitStages[1]);
    await expect(page.locator("[data-i18n-missing]")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(/\\[\\[[^\\]]+\\]\\]/);

    for (const width of [720, 950]) {
      await page.setViewportSize({ width, height: 620 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.locator(".rail").evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
      const tabLabelsFit = await page.locator('#content-tabs [role="tab"]').evaluateAll((tabs) =>
        tabs.every((tab) => tab.scrollWidth <= tab.clientWidth),
      );
      expect(tabLabelsFit).toBe(true);
    }
  });
}`;
    default:
      throw new Error(`未知のrendererシナリオ: ${c.scenario} (${c.id})`);
  }
}

// ---- WDIO Tauri E2E(実IPC・実WKWebView)の生成 ----
function genE2eClause(c: Clause): string {
  switch (c.scenario) {
    case "palette_apply_ipc":
      return `
// ${c.id}: ${c.desc}
describe("${c.id}", () => {
  it("palette apply round-trips through real IPC", async () => {
    await waitForInit();
    // どこでも打鍵でパレットが開き(打鍵結線自体はRND-001)、実Rustのfuzzy(FZY-003)が候補を返す
    await browser.keys("a");
    await browser.waitUntil(async () => await $("#palette-overlay").isDisplayed(), {
      timeoutMsg: "パレットが開かない",
    });
    await browser.keys("xi");
    await browser.keys("Enter");
    // 実apply_candidateのApplyResultがrule summaryへ反映される
    await browser.waitUntil(
      async () => (await $(".rule-summary").getText()).includes("AXI"),
      { timeoutMsg: "実IPCのapply_candidate結果がsummaryへ反映されない" },
    );
    await browser.keys("Escape");
    await browser.waitUntil(async () => !(await $("#palette-overlay").isDisplayed()));
    // 実configへ保存され、watch行にも反映されている
    await expect($("#sb-watch")).toHaveText(expect.stringContaining("AXI"));
  });
});`;
    case "delivery_error_surface":
      return `
// ${c.id}: ${c.desc}
describe("${c.id}", () => {
  it("TEST DELIVERY surfaces the real backend outcome", async () => {
    await waitForInit();
    await $("#delivery-tab").click();
    // desktopをOFFにして通知先ゼロにする(設定変更も実set_configを通る)
    const desktopCheck = $("#desktop-check");
    if ((await desktopCheck.getText()).includes("[x]")) {
      await desktopCheck.click();
      await browser.waitUntil(async () => (await desktopCheck.getText()).includes("[ ]"));
    }
    await $("#test-btn").click();
    // 実test_notificationがNTF-001の「通知先なしは失敗」を返し、railへ表示される
    await browser.waitUntil(
      async () => (await $("#rail-msg").getText()).includes("通知先"),
      { timeoutMsg: "実backendの失敗理由がrail-msgへ表示されない" },
    );
    await expect($("#rail-msg")).not.toHaveText(expect.stringContaining("受け付けました"));
  });
});`;
    case "locale_config_roundtrip":
      return `
// ${c.id}: ${c.desc}
describe("${c.id}", () => {
  it("locale round-trips through real config IPC", async () => {
    const expectSynchronizedTitle = async (expected: string) => {
      const documentTitle = await browser.execute(() => document.title);
      const states = (await browser.tauri.execute(({ core }) =>
        core.invoke("plugin:wdio|get_window_states"),
      )) as Array<{ label: string; title: string }>;
      expect(documentTitle).toBe(expected);
      expect(states.find((state) => state.label === "main")?.title).toBe(expected);
    };
    const selectLocale = async (locale: "en" | "zh-Hans") => {
      await $("#locale-select").selectByAttribute("value", locale);
      // tauri-plugin-wdioのWebKit select helperは値だけを変えてchangeを発火しないため、
      // rendererで検証済みのDOM結線を明示発火し、その先の実set_config往復をここで検査する。
      await browser.execute((nextLocale) => {
        const select = document.querySelector("#locale-select") as HTMLSelectElement | null;
        if (!select) throw new Error("locale-select not found");
        select.value = nextLocale;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, locale);
      await browser.waitUntil(
        async () => (await browser.execute(() => document.documentElement.lang)) === locale,
        { timeoutMsg: "locale変更が実set_config完了後に反映されない" },
      );
    };

    await waitForInit();
    await expectSynchronizedTitle("RELICO — 時限コンテンツ");
    await $("#delivery-tab").click();
    await selectLocale("en");
    await expectSynchronizedTitle("RELICO — TIMED CONTENT");
    await selectLocale("zh-Hans");
    await expectSynchronizedTitle("RELICO — 限时内容");
    await expect($("#tab-fissures")).toHaveText("裂隙");

    await browser.refresh();
    await waitForInit();
    await expect($("html")).toHaveAttribute("lang", "zh-Hans");
    await expect($("#locale-select")).toHaveValue("zh-Hans");
    await expect($("#tab-fissures")).toHaveText("裂隙");
    await expectSynchronizedTitle("RELICO — 限时内容");
  });
});`;
    default:
      throw new Error(`未知のe2eシナリオ: ${c.scenario} (${c.id})`);
  }
}

const RUST_EXAMPLE_PATTERNS = new Set([
  "legacy_rule_enabled",
  "rule_name_config",
  "rule_notify_config",
  "app_config_compat",
  "timed_content_fixture",
  "notification_example",
  "static_check",
  "approved_asset",
]);
const TS_EXAMPLE_PATTERNS = new Set([
  "renderer_glyphs",
  "tooling_scenario",
  "renderer_scenario",
  "e2e_scenario",
]);
for (const c of spec.clauses) {
  if (
    c.label === "example-tested" &&
    !RUST_EXAMPLE_PATTERNS.has(c.pattern) &&
    !TS_EXAMPLE_PATTERNS.has(c.pattern)
  ) {
    throw new Error(`example-testedの出力先が未定義: ${c.pattern} (${c.id})`);
  }
}

const propertyTests = spec.clauses
  .filter((c) => c.label === "property-tested")
  .map(genClause)
  .filter(Boolean)
  .join("\n");
const exampleTests = spec.clauses
  .filter((c) => RUST_EXAMPLE_PATTERNS.has(c.pattern))
  .map(genExampleClause)
  .join("\n");
const glyphTests = spec.clauses
  .filter((c) => c.pattern === "renderer_glyphs")
  .map(genGlyphClause)
  .join("\n");
const toolingTests = spec.clauses
  .filter((c) => c.pattern === "tooling_scenario")
  .map(genToolingClause)
  .join("\n");
const rendererTests = spec.clauses
  .filter((c) => c.pattern === "renderer_scenario")
  .map(genRendererClause)
  .join("\n");
const e2eTests = spec.clauses
  .filter((c) => c.pattern === "e2e_scenario")
  .map(genE2eClause)
  .join("\n");

const oracle = `// @generated by tools/spec-gen.ts from specs/notifier.pkl — DO NOT EDIT
// テストを直したくなったら specs/ を編集して \`just spec-gen\` を実行する。
// 各テスト名は docs/SPEC.md の条項idに対応する。

use std::collections::HashMap;

use chrono::{DateTime, Duration, TimeZone, Utc};
use proptest::prelude::*;
use relico_lib::backoff::Backoff;
use relico_lib::config::{AppConfig, AppLocale, DailyMuteWindow};
use relico_lib::dedup::NotifiedSet;
use relico_lib::filter::{self, FilterSettings, Mode, StormMode, WatchRule};
use relico_lib::model::Fissure;
use relico_lib::notify::{self, NotificationOutcome};
use relico_lib::palette::{self, Candidate, Facet};
use relico_lib::poller;
use relico_lib::timed;

const TIERS: &[&str] = &[${rustStrArray(TIER_POOL)}];
const MISSIONS: &[&str] = &[${rustStrArray(MISSION_POOL)}];
const PLANETS: &[&str] = &[${rustStrArray(PLANET_POOL)}];

/// オラクルは純粋関数を対象とするため、現在時刻は固定値でよい
fn base_now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
}

fn mk_timed_card(id: &str, expiry: Option<DateTime<Utc>>) -> timed::TimedContent {
    timed::TimedContent {
        id: id.to_string(),
        kind: "test".to_string(),
        variant: None,
        title: id.to_string(),
        subtitle: None,
        activation: Some(base_now() - Duration::hours(1)),
        expiry,
        temporal_status: timed::TimedTemporalStatus::Active,
        provenance: timed::TimedProvenance {
            kind: timed::TimedSourceKind::CommunityLive,
            contributors: vec![timed::TimedSourceId::WfcdWorldstate],
        },
        source_id: timed::TimedSourceId::WfcdWorldstate,
        source_name: "WFCD".to_string(),
        source_url: Some("https://api.warframestat.us/pc".to_string()),
        metadata: vec![],
        personal_modifiers: vec![],
        stages: vec![],
    }
}

fn mk_timed_status(source: timed::TimedSourceId) -> timed::TimedSourceStatus {
    timed::TimedSourceStatus {
        source,
        freshness: timed::TimedFreshness::Fresh,
        last_attempt: Some(base_now() - Duration::minutes(5)),
        last_success: Some(base_now() - Duration::minutes(5)),
        valid_until: Some(base_now() + Duration::hours(1)),
        error: None,
    }
}

fn arb_mode() -> impl Strategy<Value = Mode> {
    prop_oneof![Just(Mode::Normal), Just(Mode::SteelPath), Just(Mode::Both)]
}

fn arb_storm_mode() -> impl Strategy<Value = StormMode> {
    prop_oneof![
        Just(StormMode::Exclude),
        Just(StormMode::Include),
        Just(StormMode::Only),
    ]
}

fn arb_subset(pool: &'static [&'static str]) -> impl Strategy<Value = Vec<String>> {
    proptest::sample::subsequence(pool.to_vec(), 0..=pool.len())
        .prop_map(|v| v.into_iter().map(String::from).collect())
}

fn arb_rule_name() -> impl Strategy<Value = Option<String>> {
    proptest::option::of("[A-Za-z0-9 ]{1,12}")
}

fn arb_rule() -> impl Strategy<Value = WatchRule> {
    (
        any::<bool>(),
        any::<bool>(),
        arb_rule_name(),
        arb_subset(TIERS),
        arb_subset(MISSIONS),
        arb_subset(PLANETS),
        arb_mode(),
        arb_storm_mode(),
    )
        .prop_map(|(enabled, notify, name, tiers, mission_types, planets, mode, storms)| WatchRule {
            enabled,
            notify,
            name,
            tiers,
            mission_types,
            planets,
            mode,
            storms,
        })
}

fn arb_settings() -> impl Strategy<Value = FilterSettings> {
    (proptest::collection::vec(arb_rule(), 0..4), 0u64..1800)
        .prop_map(|(rules, min_remaining_secs)| FilterSettings {
            rules,
            min_remaining_secs,
        })
}

fn arb_fissure() -> impl Strategy<Value = Fissure> {
    (
        "[a-f0-9]{8}",
        proptest::sample::select(TIERS.to_vec()),
        proptest::sample::select(MISSIONS.to_vec()),
        proptest::sample::select(PLANETS.to_vec()),
        any::<bool>(),
        any::<bool>(),
        -600i64..7200,
    )
        .prop_map(|(id, tier, mission, planet, is_storm, is_hard, expiry_off)| {
            let now = base_now();
            Fissure {
                id,
                activation: now - Duration::hours(1),
                expiry: now + Duration::seconds(expiry_off),
                node: format!("Node ({planet})"),
                mission_type: mission.to_string(),
                enemy: "Grineer".to_string(),
                tier: tier.to_string(),
                tier_num: 1,
                is_storm,
                is_hard,
            }
        })
}

fn mk_catalog(labels: Vec<String>) -> Vec<Candidate> {
    labels
        .into_iter()
        .enumerate()
        .map(|(i, label)| Candidate {
            id: format!("test:{i}"),
            value: label.clone(),
            label,
            aliases: vec![],
            facet: Facet::Mission,
        })
        .collect()
}

proptest! {
${propertyTests}
}

${exampleTests}
`;

// ---- TSオラクル生成 ----
const unitOracle = `// @generated by tools/spec-gen.ts from specs/notifier.pkl — DO NOT EDIT
// テストを直したくなったら specs/ を編集して \`just spec-gen\` を実行する。
// 実行: bun test tests/unit

import { expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateGlyphHtml, glyphHtml, planetForFissure, type GlyphKind } from "../../src/icons";
import { cleanupOwnedListener, leaseHolderPids, processExists } from "../../tools/e2e-process";

const E2E_PROCESS_FIXTURE = ${JSON.stringify(`
const fs = require("node:fs");
const net = require("node:net");
if (process.env.RELICO_TEST_IGNORE_TERM === "1") {
  process.on("SIGTERM", () => process.stdout.write("term\\n"));
}
if (process.env.RELICO_TEST_LEASE) {
  globalThis.__relicoLeaseFd = fs.openSync(process.env.RELICO_TEST_LEASE, "r");
}
if (process.env.RELICO_TEST_LISTEN === "1") {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    process.stdout.write(String(server.address().port) + "\\n");
  });
} else {
  process.stdout.write("ready\\n");
}
setInterval(() => {}, 1000);
`)};

async function spawnFixture(options: {
  listen?: boolean;
  ignoreTerm?: boolean;
  leasePath?: string;
}): Promise<{ child: ChildProcess; port: number | null }> {
  const child = spawn(process.execPath, ["-e", E2E_PROCESS_FIXTURE], {
    env: {
      ...process.env,
      RELICO_TEST_IGNORE_TERM: options.ignoreTerm ? "1" : "0",
      RELICO_TEST_LISTEN: options.listen ? "1" : "0",
      RELICO_TEST_LEASE: options.leasePath ?? "",
    },
    stdio: ["ignore", "pipe", "ignore"],
  });
  const [chunk] = (await once(child.stdout!, "data")) as [Buffer];
  const ready = chunk.toString().trim();
  return { child, port: options.listen ? Number(ready) : null };
}

async function stopFixture(child?: ChildProcess): Promise<void> {
  if (!child) return;
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
}
${glyphTests}
${toolingTests}
`;

const rendererOracle = `// @generated by tools/spec-gen.ts from specs/notifier.pkl — DO NOT EDIT
// テストを直したくなったら specs/ を編集して \`just spec-gen\` を実行する。
// Tauri IPCをmockしたrenderer統合テスト。Rust commandやOS通知を通った証明にはしない(docs/E2E.md)。
// 実行: just renderer-test (Playwright / WebKit)

import { expect, test } from "@playwright/test";
import { bootConsole, calls } from "./harness";
${rendererTests}
`;

const e2eOracle = `// @generated by tools/spec-gen.ts from specs/notifier.pkl — DO NOT EDIT
// テストを直したくなったら specs/ を編集して \`just spec-gen\` を実行する。
// WDIO Tauri E2E: 実アプリ(実IPC・実WKWebView)を通す。DOM結線の網羅はrenderer統合(RND)が担い、
// ここは「本物のRust commandを往復する」ことの証明に絞る。
// 実行: just e2e (e2e featureビルド + @wdio/tauri-service embedded provider)

import { $, browser, expect } from "@wdio/globals";

async function waitForInit(): Promise<void> {
  // title同期前に$()/findElementを呼ぶとtauri-serviceのauto-focusが旧titleを探索するため、
  // 初期ready判定はfocus hook対象外のexecuteだけで行う。
  await browser.waitUntil(async () => await browser.execute(() => {
    const watch = document.querySelector("#sb-watch");
    return document.readyState === "complete" && Boolean(watch?.textContent?.trim());
  }), {
    timeout: 20000,
    timeoutMsg: "コンソールが初期化されない",
  });
}
${e2eTests}
`;

// ---- SPEC.md生成 ----
const labelNote: Record<string, string> = {
  "property-tested": "proptestオラクルで機械検証",
  "example-tested": "具体例テストで機械検証",
  manual: "手動確認(残余)",
};

const rows = spec.clauses
  .map((c) => `| ${c.id} | \`${c.pattern}\` | ${c.label} | ${c.desc} |`)
  .join("\n");

const manualBlock = (clauses: Clause[]) =>
  clauses.map((c) => `#### ${c.id}: ${c.desc}\n\n${c.procedure}`).join("\n\n");
const manualPerRelease = manualBlock(
  spec.clauses.filter((c) => c.pattern === "manual" && c.cadence !== "one-time"),
);
const manualOneTime = manualBlock(
  spec.clauses.filter((c) => c.pattern === "manual" && c.cadence === "one-time"),
);

const specMd = `# ${spec.title}

> **生成物 — 手編集禁止。** 正本は \`specs/notifier.pkl\`。変更は正本を編集して \`just spec-gen\`。
>
> 保証の勾配: このプロジェクトの機械保証の最上位は property-based test である。
> proven(証明) / model-checked(モデル検査) の条項は存在しない。勾配を平らに見せない。
>
> ルール内はAND、複数ルールは用途ごとにORする。一覧表示はenabled=trueのVIEWルール、
> 通知はnotify=trueのNOTIFYルールを使い、両者は独立する。
> enabled=false, notify=trueの非表示ルールも通知対象になる。
> VIEW選択、NOTIFY参加、UIのedit focusは互いに独立する。

## 条項一覧

| ID | パターン | 保証 | 内容 |
|:---|:---|:---|:---|
${rows}

保証ラベルの意味: ${Object.entries(labelNote)
  .map(([k, v]) => `**${k}** = ${v}`)
  .join(" / ")}

オラクルの実行先: \`rule_*\` 等のRustパターンは \`cargo test\`(src-tauri/tests/oracles_generated.rs)、
\`renderer_glyphs\` / \`tooling_scenario\` は \`bun test tests/unit\`、\`renderer_scenario\` は \`just renderer-test\`
(Playwright/WebKit、Tauri IPCはmock — Rust commandやOS通知を通った証明にはしない。docs/E2E.md参照)、
\`e2e_scenario\` は \`just e2e\`(WDIO Tauri E2E。実IPC・実WKWebViewを通し、専用identity
com.annenpolka.relico.e2e で実行する)。

## 手動確認手順(manual条項)

### 毎リリース実施

${manualPerRelease}

### 一回限りの受入(対象が変わったときだけ再実施)

${manualOneTime}
`;

await Bun.write(`${root}src-tauri/tests/oracles_generated.rs`, oracle);
await Bun.write(`${root}tests/unit/oracles_generated.test.ts`, unitOracle);
await Bun.write(`${root}tests/renderer/oracles_generated.spec.ts`, rendererOracle);
await Bun.write(`${root}tests/e2e/oracles_generated.e2e.ts`, e2eOracle);
await Bun.write(`${root}docs/SPEC.md`, specMd);

const counts = spec.clauses.reduce(
  (acc, c) => ((acc[c.label] = (acc[c.label] ?? 0) + 1), acc),
  {} as Record<string, number>,
);
console.log(
  `生成完了: 条項${spec.clauses.length}件 (${Object.entries(counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ")})`,
);
console.log("  -> src-tauri/tests/oracles_generated.rs");
console.log("  -> tests/unit/oracles_generated.test.ts");
console.log("  -> tests/renderer/oracles_generated.spec.ts");
console.log("  -> tests/e2e/oracles_generated.e2e.ts");
console.log("  -> docs/SPEC.md");
