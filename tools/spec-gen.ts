// specs/notifier.pkl(正本) から以下を生成する:
//   - src-tauri/tests/oracles_generated.rs  (proptestオラクル。手編集禁止)
//   - docs/SPEC.md                          (可読ドキュメント。手編集禁止)
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
    | "discord_receipt";
  procedure?: string;
};

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
  const msg = `SPEC ${c.id} 違反: ${c.desc.replace(/"/g, '\\"')}`;
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
    fn ${name}(s in arb_settings(), mut f in arb_fissure()) {
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
        let remaining_ok = f.expiry.signed_duration_since(now).num_seconds() >= min as i64;
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
        let remaining_ok = f.expiry.signed_duration_since(now).num_seconds()
            >= s.min_remaining_secs as i64;
        let enabled_or = s.rules.iter().any(|rule|
            rule.enabled && filter::rule_matches(rule, &f)
        );
        prop_assert_eq!(
            filter::matches(&s, &f, now),
            remaining_ok && enabled_or,
            "${msg} (有効ルールORの完全な等式)"
        );

        let mut all_disabled = s.clone();
        for rule in &mut all_disabled.rules {
            rule.enabled = false;
        }
        let mut valid_fissure = f.clone();
        valid_fissure.expiry = now + Duration::seconds(s.min_remaining_secs as i64 + 1);
        prop_assert!(
            !filter::matches(&all_disabled, &valid_fissure, now),
            "${msg} (全ルールdisabledなのに合致した)"
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
    case "enabled_projection":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(
        s in arb_settings(),
        mut disabled in arb_rule(),
        mut edited_disabled in arb_rule(),
        mut enabled in arb_rule(),
    ) {
        let base = filter::enabled_projection(&s);
        let expected: Vec<WatchRule> = s.rules.iter()
            .filter(|rule| rule.enabled)
            .cloned()
            .collect();
        prop_assert_eq!(base.rules.as_slice(), expected.as_slice(), "${msg} (有効ルールと一致しない)");
        prop_assert_eq!(base.min_remaining_secs, s.min_remaining_secs, "${msg} (min_remaining_secsを保持しない)");

        disabled.enabled = false;
        let mut with_disabled = s.clone();
        with_disabled.rules.push(disabled);
        let added = filter::enabled_projection(&with_disabled);
        prop_assert_eq!(added.rules.as_slice(), base.rules.as_slice(), "${msg} (disabled追加で射影が変化した)");
        prop_assert_eq!(added.min_remaining_secs, base.min_remaining_secs, "${msg} (disabled追加で時間条件が変化した)");

        edited_disabled.enabled = false;
        *with_disabled.rules.last_mut().expect("disabled ruleを追加済み") = edited_disabled;
        let edited = filter::enabled_projection(&with_disabled);
        prop_assert_eq!(edited.rules.as_slice(), base.rules.as_slice(), "${msg} (disabled条件編集で射影が変化した)");
        with_disabled.rules.pop();
        let removed = filter::enabled_projection(&with_disabled);
        prop_assert_eq!(removed.rules.as_slice(), base.rules.as_slice(), "${msg} (disabled削除で射影が変化した)");

        enabled.enabled = true;
        let mut with_enabled = s.clone();
        with_enabled.rules.push(enabled.clone());
        let enabled_added = filter::enabled_projection(&with_enabled);
        prop_assert_eq!(enabled_added.rules.len(), base.rules.len() + 1, "${msg} (enabled追加が射影へ反映されない)");
        prop_assert_eq!(enabled_added.rules.last(), Some(&enabled), "${msg} (enabled追加の条件を保持しない)");

        let toggled_rule = WatchRule {
            enabled: false,
            ..WatchRule::default()
        };
        let mut toggled = FilterSettings {
            rules: vec![toggled_rule],
            min_remaining_secs: s.min_remaining_secs,
        };
        prop_assert!(filter::enabled_projection(&toggled).rules.is_empty(), "${msg} (disabledを射影へ含めた)");
        toggled.rules[0].enabled = true;
        prop_assert_eq!(filter::enabled_projection(&toggled).rules.len(), 1, "${msg} (enabled切替が射影へ反映されない)");

        let mut changed_condition = toggled.clone();
        changed_condition.rules[0].tiers = vec!["__projection_changed__".to_string()];
        prop_assert_ne!(
            filter::enabled_projection(&toggled).rules,
            filter::enabled_projection(&changed_condition).rules,
            "${msg} (有効ルール条件の変更が射影へ反映されない)"
        );

        let changed_min = FilterSettings {
            rules: s.rules.clone(),
            min_remaining_secs: s.min_remaining_secs + 1,
        };
        prop_assert_ne!(
            filter::enabled_projection(&s).min_remaining_secs,
            filter::enabled_projection(&changed_min).min_remaining_secs,
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
        let visible = poller::visible_fissures(&settings, &[f.clone()], now);
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
        mut disabled in arb_rule(),
    ) {
        let previous_projection = filter::enabled_projection(&previous);
        let current_projection = filter::enabled_projection(&current);
        let expected = previous_projection.min_remaining_secs != current_projection.min_remaining_secs
            || previous_projection.rules != current_projection.rules;
        prop_assert_eq!(
            poller::notification_scope_changed(Some(&previous), &current),
            expected,
            "${msg} (enabled projectionとの差分と一致しない)"
        );
        prop_assert!(
            poller::notification_scope_changed(None, &current),
            "${msg} (初回評価をscope changeと判定しない)"
        );

        disabled.enabled = false;
        let mut disabled_only_change = previous.clone();
        disabled_only_change.rules.push(disabled);
        prop_assert!(
            !poller::notification_scope_changed(Some(&previous), &disabled_only_change),
            "${msg} (disabled draft追加をscope changeと誤判定した)"
        );
    }

    /// ${c.id}: ${c.desc} (scope change時のsilent seed)
    #[test]
    fn ${fnName(c.id, "silent_seed")}(mut f in arb_fissure()) {
        let now = base_now();
        f.expiry = now + Duration::hours(1);
        f.is_storm = false;

        let enabled_rule = WatchRule::default();
        let mut disabled_rule = enabled_rule.clone();
        disabled_rule.enabled = false;
        let previous = FilterSettings {
            rules: vec![disabled_rule],
            min_remaining_secs: 0,
        };
        let current = FilterSettings {
            rules: vec![enabled_rule],
            min_remaining_secs: 0,
        };
        prop_assert!(
            poller::notification_scope_changed(Some(&previous), &current),
            "${msg} (ルール有効化をscope changeと判定しない)"
        );

        let existing = poller::visible_fissures(&current, &[f.clone()], now);
        prop_assert_eq!(existing.len(), 1, "${msg} (現存合致亀裂を取得できない)");
        let mut notified = NotifiedSet::new();
        let seeded = poller::select_notifications(&mut notified, existing.clone(), true);
        prop_assert!(seeded.is_empty(), "${msg} (scope change直後の現存亀裂を一括通知した)");
        prop_assert!(notified.contains(&f.id), "${msg} (現存亀裂をsilent seedしていない)");
        let repeated = poller::select_notifications(&mut notified, existing, false);
        prop_assert!(repeated.is_empty(), "${msg} (seed済み現存亀裂を次回通知した)");

        let mut new_fissure = f.clone();
        new_fissure.id = format!("{}-new", f.id);
        let newly_visible = poller::visible_fissures(&current, &[new_fissure.clone()], now);
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
        for f in &visible {
            prop_assert!(filter::matches(&s, f, now), "${msg} (対象外が表示された)");
        }
        for f in fs.iter().filter(|f| filter::matches(&s, f, now)) {
            prop_assert!(visible.iter().any(|v| v.id == f.id), "${msg} (合致亀裂が欠落した)");
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

    /// ${c.id}: ${c.desc} (disabled draftの条件編集)
    #[test]
    fn ${fnName(c.id, "disabled_edit")}(
        mut rule in arb_rule(),
        ops in proptest::collection::vec(any::<prop::sample::Index>(), 0..40),
    ) {
        rule.enabled = false;
        let mut state = palette::EditorState { rules: vec![rule], active: 0 };
        let candidates: Vec<Candidate> = palette::catalog()
            .into_iter()
            .filter(|candidate| candidate.facet != Facet::Action)
            .collect();
        for op in ops {
            let candidate = &candidates[op.index(candidates.len())];
            palette::apply(&mut state, candidate);
            prop_assert!(!state.rules[0].enabled, "${msg} ({} 適用でdisabled ruleを再有効化した)", candidate.id);
            let settings = FilterSettings {
                rules: state.rules.clone(),
                min_remaining_secs: 0,
            };
            prop_assert!(
                filter::enabled_projection(&settings).rules.is_empty(),
                "${msg} (disabled編集中にruntime projectionへ現れた)"
            );
        }
    }`;
    case "new_rule_disabled":
      return `
    /// ${c.id}: ${c.desc}
    #[test]
    fn ${name}(
        rules in proptest::collection::vec(arb_rule(), 0..5),
        pick in any::<prop::sample::Index>(),
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
        prop_assert_eq!(state.active, state.rules.len() - 1, "${msg} (新しいdraftがedit対象でない)");
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
  const msg = `SPEC ${c.id} 違反: ${c.desc.replace(/"/g, '\\"')}`;
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

const propertyTests = spec.clauses
  .filter((c) => c.label === "property-tested")
  .map(genClause)
  .filter(Boolean)
  .join("\n");
const exampleTests = spec.clauses
  .filter((c) => c.label === "example-tested")
  .map(genExampleClause)
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

const TIERS: &[&str] = &["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"];
const MISSIONS: &[&str] = &[
    "Defense", "Survival", "Capture", "Extermination", "Rescue",
    "Disruption", "Mobile Defense", "Void Flood", "Void Cascade", "Volatile",
];
const PLANETS: &[&str] = &[
    "Mars", "Ceres", "Sedna", "Void", "Saturn", "Phobos",
    "Zariman", "Veil Proxima", "Kuva Fortress", "Lua",
];

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

fn arb_rule() -> impl Strategy<Value = WatchRule> {
    (
        any::<bool>(),
        arb_subset(TIERS),
        arb_subset(MISSIONS),
        arb_subset(PLANETS),
        arb_mode(),
        arb_storm_mode(),
    )
        .prop_map(|(enabled, tiers, mission_types, planets, mode, storms)| WatchRule {
            enabled,
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

// ---- SPEC.md生成 ----
const labelNote: Record<string, string> = {
  "property-tested": "proptestオラクルで機械検証",
  "example-tested": "具体例テストで機械検証",
  manual: "手動確認(残余)",
};

const rows = spec.clauses
  .map((c) => `| ${c.id} | \`${c.pattern}\` | ${c.label} | ${c.desc} |`)
  .join("\n");

const manuals = spec.clauses
  .filter((c) => c.pattern === "manual")
  .map((c) => `### ${c.id}: ${c.desc}\n\n${c.procedure}`)
  .join("\n\n");

const specMd = `# ${spec.title}

> **生成物 — 手編集禁止。** 正本は \`specs/notifier.pkl\`。変更は正本を編集して \`just spec-gen\`。
>
> 保証の勾配: このプロジェクトの機械保証の最上位は property-based test である。
> proven(証明) / model-checked(モデル検査) の条項は存在しない。勾配を平らに見せない。
>
> フィルタの意味論は有効ルールOR: 設定は監視ルール(WatchRule)のリストで、亀裂が
> enabled=trueのどれか1つのルールに合致すれば通知・表示対象になる。
> enabled=falseのルールは保存・編集できるがruntime判定には参加しない。ルール内はAND。
> UIのedit focusはruntime activationとは独立する。

## 条項一覧

| ID | パターン | 保証 | 内容 |
|:---|:---|:---|:---|
${rows}

保証ラベルの意味: ${Object.entries(labelNote)
  .map(([k, v]) => `**${k}** = ${v}`)
  .join(" / ")}

## 手動確認手順(manual条項)

リリース前に以下を実施する。

${manuals}
`;

await Bun.write(`${root}src-tauri/tests/oracles_generated.rs`, oracle);
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
console.log("  -> docs/SPEC.md");
