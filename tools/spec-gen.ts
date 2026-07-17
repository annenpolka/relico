// specs/notifier.pkl(正本) から以下を生成する:
//   - src-tauri/tests/oracles_generated.rs       (proptest/exampleオラクル。手編集禁止)
//   - tests/unit/oracles_generated.test.ts       (bun testオラクル。手編集禁止)
//   - tests/renderer/oracles_generated.spec.ts   (Playwright rendererオラクル。手編集禁止)
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
    | "bundle_identity"
    | "tray_template_icon"
    | "autostart_bundle_icon"
    | "glyph_known_values"
    | "planet_proxima_view"
    | "palette_keyboard"
    | "delivery_flush"
    | "rule_row_controls"
    | "sidebar_fit"
    | "compact_table"
    | "expiry_cleanup"
    | "rule_naming"
    | "table_sort"
    | "unselected_picker_create"
    | "palette_apply_ipc"
    | "delivery_error_surface";
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
        let first = poller::select_notifications(&mut notified, visible.clone(), false);
        prop_assert_eq!(first.len(), 1, "${msg} (最初の通知候補が1件でない)");
        prop_assert_eq!(first[0].id.as_str(), f.id.as_str(), "${msg} (別idを通知した)");
        let second = poller::select_notifications(&mut notified, visible, false);
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
        let out = poller::select_notifications(&mut set, fs.clone(), true);
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
        let seeded = poller::select_notifications(&mut notified, existing.clone(), true);
        prop_assert!(seeded.is_empty(), "${msg} (scope change直後の現存亀裂を一括通知した)");
        prop_assert!(notified.contains(&f.id), "${msg} (現存亀裂をsilent seedしていない)");
        let repeated = poller::select_notifications(&mut notified, existing, false);
        prop_assert!(repeated.is_empty(), "${msg} (seed済み現存亀裂を次回通知した)");

        let mut new_fissure = f.clone();
        new_fissure.id = format!("{}-new", f.id);
        let newly_visible = poller::notify_candidates(&current, &[new_fissure.clone()], now);
        let fresh = poller::select_notifications(&mut notified, newly_visible.clone(), false);
        prop_assert_eq!(fresh.len(), 1, "${msg} (scope change後の新規idを通知候補にしない)");
        prop_assert_eq!(fresh[0].id.as_str(), new_fissure.id.as_str(), "${msg} (新規idを保持しない)");
        let duplicate = poller::select_notifications(&mut notified, newly_visible, false);
        prop_assert!(duplicate.is_empty(), "${msg} (scope change後の新規idを再通知した)");
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
  // Cmd/Ctrl+1..9は対応indexのルールへ直接ジャンプする
  await page.keyboard.press("ControlOrMeta+1");
  await expect(page.locator("#editing-meta")).toHaveText("R1/2");
  expect(await mutations()).toBe(mutationsBefore);
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
  // パレット表示中もCmd/Ctrl+数字で編集対象を切り替えられる(開いたまま)
  await page.keyboard.press("ControlOrMeta+2");
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
    default:
      throw new Error(`未知のe2eシナリオ: ${c.scenario} (${c.id})`);
  }
}

const RUST_EXAMPLE_PATTERNS = new Set([
  "legacy_rule_enabled",
  "rule_name_config",
  "rule_notify_config",
  "notification_example",
  "static_check",
  "approved_asset",
]);
const TS_EXAMPLE_PATTERNS = new Set(["renderer_glyphs", "renderer_scenario", "e2e_scenario"]);
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
use relico_lib::dedup::NotifiedSet;
use relico_lib::filter::{self, FilterSettings, Mode, StormMode, WatchRule};
use relico_lib::model::Fissure;
use relico_lib::notify::{self, NotificationOutcome};
use relico_lib::palette::{self, Candidate, Facet};
use relico_lib::poller;

const TIERS: &[&str] = &[${rustStrArray(TIER_POOL)}];
const MISSIONS: &[&str] = &[${rustStrArray(MISSION_POOL)}];
const PLANETS: &[&str] = &[${rustStrArray(PLANET_POOL)}];

/// オラクルは純粋関数を対象とするため、現在時刻は固定値でよい
fn base_now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
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
import { candidateGlyphHtml, glyphHtml, planetForFissure, type GlyphKind } from "../../src/icons";
${glyphTests}
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
  await browser.waitUntil(async () => (await $("#sb-watch").getText()).length > 0, {
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
\`renderer_glyphs\` は \`bun test tests/unit\`、\`renderer_scenario\` は \`just renderer-test\`
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
