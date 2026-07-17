// renderer統合テストのハーネス(手書き)。
// Tauri IPC(window.__TAURI_INTERNALS__)をmockしてフロントエンドだけを起動する。
// Rust側の判定・fuzzy・dedupはここで再現しない: このレイヤはDOM結線とレイアウトの証拠のみを扱い、
// Rust commandやOS通知を通った証明にはしない(docs/E2E.mdの線引き)。

import type { Page } from "@playwright/test";

export interface BootOptions {
  /** AppConfig.localeとして返す表示言語 */
  locale?: "ja" | "en" | "zh-Hans";
  /** backend snapshotが報告する現在のミュート状態 */
  notificationsMuted?: boolean;
  /** 全ルールをVIEW未選択で起動する(通知参加は維持) */
  allRulesDisabled?: boolean;
  /** 亀裂0件のworldstateで起動する(empty rowの検査用) */
  noFissures?: boolean;
  /** 先頭亀裂が指定秒後に失効する(期限到達時の即時除去検査用) */
  firstExpirySecs?: number;
  /** apply_candidateの応答遅延(候補の多重確定を再現する) */
  applyCandidateDelayMs?: number;
}

export interface MockCall {
  cmd: string;
  args: Record<string, unknown> | undefined;
}

/** mockを注入してコンソールを起動し、init()完了(ステータスバー描画)まで待つ */
export async function bootConsole(page: Page, options: BootOptions = {}): Promise<void> {
  await page.addInitScript(installMock, {
    allRulesDisabled: options.allRulesDisabled ?? false,
    noFissures: options.noFissures ?? false,
    firstExpirySecs: options.firstExpirySecs ?? 1800,
    applyCandidateDelayMs: options.applyCandidateDelayMs ?? 0,
    locale: options.locale ?? "en",
    notificationsMuted: options.notificationsMuted ?? false,
  });
  await page.goto("/");
  await page.waitForFunction(() => {
    const watch = document.getElementById("sb-watch");
    return watch !== null && (watch.textContent ?? "") !== "";
  });
}

/** ページ内のIPC mockが記録した呼び出し列を取得する */
export async function calls(page: Page): Promise<MockCall[]> {
  return page.evaluate(() => (window as unknown as { __MOCK_CALLS__: MockCall[] }).__MOCK_CALLS__);
}

// ---- ここからはブラウザ内で実行される(シリアライズされてinit scriptになる) ----

function installMock({
  allRulesDisabled,
  noFissures,
  firstExpirySecs,
  applyCandidateDelayMs,
  locale,
  notificationsMuted,
}: {
  allRulesDisabled: boolean;
  noFissures: boolean;
  firstExpirySecs: number;
  applyCandidateDelayMs: number;
  locale: "ja" | "en" | "zh-Hans";
  notificationsMuted: boolean;
}) {
  type Rule = {
    enabled: boolean;
    notify: boolean;
    name: string | null;
    tiers: string[];
    missionTypes: string[];
    planets: string[];
    mode: string;
    storms: string;
  };

  const iso = (offsetSecs: number) => new Date(Date.now() + offsetSecs * 1000).toISOString();
  const rule = (enabled: boolean, notify = true): Rule => ({
    enabled,
    notify,
    name: null,
    tiers: [],
    missionTypes: [],
    planets: [],
    mode: "Both",
    storms: "Exclude",
  });

  // MAN-011の代表的な長い値を含むfixture。
  // 無指定(全ルール無効)でもbackendは全件をsnapshotへ入れる(VIS-001)ためfissuresは空にしない
  const fissures = noFissures
    ? []
    : [
        {
          id: "fx-requiem",
          activation: iso(-3600),
          expiry: iso(firstExpirySecs),
          node: "Taveuni (Kuva Fortress)",
          missionType: "Mobile Defense",
          enemy: "The Murmur",
          tier: "Requiem",
          tierNum: 5,
          isStorm: false,
          isHard: true,
          planet: "Kuva Fortress",
        },
        {
          id: "fx-storm",
          activation: iso(-3600),
          expiry: iso(2400),
          node: "Nsu Grid (Veil Proxima)",
          missionType: "Survival",
          enemy: "Grineer",
          tier: "Axi",
          tierNum: 4,
          isStorm: true,
          isHard: true,
          planet: "Veil",
        },
        {
          id: "fx-lith",
          activation: iso(-3600),
          expiry: iso(3600),
          node: "Hepit (Void)",
          missionType: "Capture",
          enemy: "Corrupted",
          tier: "Lith",
          tierNum: 1,
          isStorm: false,
          isHard: false,
          planet: "Void",
        },
      ];

  const state = {
    active: 0,
    autostart: false,
    config: {
      rules: [
        Object.assign(rule(!allRulesDisabled)),
        Object.assign(rule(false), { tiers: ["Axi"] }),
      ],
      minRemainingSecs: 300,
      pollIntervalSecs: 60,
      desktopNotification: true,
      discordWebhookUrl: null as string | null,
      paused: false,
      locale,
      notificationMute: {
        enabled: false,
        startMinute: 22 * 60,
        endMinute: 7 * 60,
      },
    },
    status: {
      revision: 0,
      fissures,
      nextNotification: fissures[0] ?? null,
      apiOk: true,
      lastError: null as string | null,
      lastPoll: iso(0),
      nextPollSecs: 60,
      notifiedToday: 0,
      paused: false,
      notificationsMuted,
      suppressedToday: notificationsMuted ? 2 : 0,
      timedContent: {
        sortie: [
          {
            id: "sortie-current",
            kind: "sortie",
            variant: null,
            title: "Sortie",
            subtitle: "Grineer",
            activation: iso(-3600),
            expiry: iso(18 * 3600),
            availability: "available",
            stages: [
              {
                order: 1,
                title: "Extermination",
                node: "Adaro (Sedna)",
                detail: null,
                modifiers: ["Enemy Physical Enhancement"],
              },
            ],
          },
        ],
        archon: [],
        syndicates: [],
        areaMissions: [],
        archimedea: [],
        descendia: [],
        wfcdOk: true,
        wfcdError: null,
        descentsOk: true,
        descentsError: null,
        lastPoll: iso(0),
      },
    },
  };

  type Cand = { id: string; label: string; facet: string };
  const catalog: Cand[] = [
    ...["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"].map((t) => ({
      id: "tier:" + t,
      label: t,
      facet: "tier",
    })),
    { id: "mode:Normal", label: "Normal", facet: "mode" },
    { id: "mode:SteelPath", label: "Steel Path", facet: "mode" },
    { id: "mode:Both", label: "Both Modes", facet: "mode" },
    { id: "storm:Exclude", label: "Exclude Storms", facet: "storm" },
    { id: "storm:Include", label: "Include Storms", facet: "storm" },
    { id: "storm:Only", label: "Storms Only", facet: "storm" },
    { id: "mission:Survival", label: "Survival", facet: "mission" },
    { id: "mission:Mobile Defense", label: "Mobile Defense", facet: "mission" },
    { id: "mission:Capture", label: "Capture", facet: "mission" },
    { id: "planet:Sedna", label: "Sedna", facet: "planet" },
    { id: "planet:Kuva Fortress", label: "Kuva Fortress", facet: "planet" },
    { id: "planet:Void", label: "Void", facet: "planet" },
    { id: "action:new-rule", label: "NEW RULE", facet: "action" },
    { id: "action:delete-rule", label: "DELETE RULE", facet: "action" },
    { id: "action:rename-rule", label: "RENAME RULE", facet: "action" },
    { id: "action:toggle-rule", label: "TOGGLE VIEW", facet: "action" },
    { id: "action:deselect-all-rules", label: "DESELECT ALL RULES", facet: "action" },
    { id: "action:notify-rule", label: "TOGGLE NOTIFY", facet: "action" },
    { id: "action:clear", label: "CLEAR FILTERS", facet: "action" },
    { id: "action:pause", label: "PAUSE WATCH", facet: "action" },
  ];

  const activeRule = (): Rule => state.config.rules[state.active] ?? state.config.rules[0];
  const isEmptyDraft = (candidate: Rule | undefined): boolean =>
    candidate !== undefined &&
    !candidate.enabled &&
    !candidate.notify &&
    candidate.tiers.length === 0 &&
    candidate.missionTypes.length === 0 &&
    candidate.planets.length === 0 &&
    candidate.mode === "Both" &&
    candidate.storms === "Exclude";
  const prepareFilterTarget = (): Rule => {
    if (state.config.rules.some((candidate) => candidate.enabled)) return activeRule();
    const active = activeRule();
    if (!isEmptyDraft(active)) {
      state.config.rules.push(rule(false, false));
      state.active = state.config.rules.length - 1;
    }
    const target = activeRule();
    target.enabled = true;
    return target;
  };
  const candOn = (cand: Cand): boolean => {
    const r = activeRule();
    if (!r) return false;
    const value = cand.id.slice(cand.id.indexOf(":") + 1);
    switch (cand.facet) {
      case "tier":
        return r.tiers.includes(value);
      case "mission":
        return r.missionTypes.includes(value);
      case "planet":
        return r.planets.includes(value);
      case "mode":
        return r.mode === value;
      case "storm":
        return r.storms === value;
      case "rule":
        // RULE候補のonは対象ルールのVIEW選択(編集中ルール基準ではない)
        return state.config.rules[Number(value)]?.enabled ?? false;
      default:
        return false;
    }
  };
  // 実行時カタログ: 静的語彙 + 現在ルールのトグル候補(label=名前またはR{n})
  const ruleCands = (): Cand[] =>
    state.config.rules.map((r, i) => ({
      id: "rule:" + i,
      label: r.name ?? "R" + (i + 1),
      facet: "rule",
    }));
  const candView = (q: string) => {
    const query = q.trim().toLowerCase();
    return [...catalog, ...ruleCands()]
      .filter((cand) => query === "" || cand.label.toLowerCase().includes(query))
      .map((cand) => ({
        id: cand.id,
        label: cand.label,
        facet: cand.facet,
        on: candOn(cand),
        indices: [],
        via: null,
      }));
  };
  const toggle = (list: string[], value: string) => {
    const at = list.indexOf(value);
    if (at >= 0) list.splice(at, 1);
    else list.push(value);
  };

  const handlers: Record<string, (args: Record<string, unknown>) => unknown | Promise<unknown>> = {
    get_config: () => state.config,
    get_status: () => state.status,
    get_autostart: () => state.autostart,
    set_autostart: (args) => {
      state.autostart = Boolean(args.enabled);
      return null;
    },
    query_candidates: (args) => {
      state.active = Number(args.active ?? 0);
      return candView(String(args.q ?? ""));
    },
    apply_candidate: async (args) => {
      if (applyCandidateDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, applyCandidateDelayMs));
      }
      state.active = Number(args.active ?? 0);
      const id = String(args.id);
      const value = id.slice(id.indexOf(":") + 1);
      if (id === "action:new-rule") {
        state.config.rules.push(rule(false, false));
        state.active = state.config.rules.length - 1;
      } else if (id === "action:delete-rule") {
        state.config.rules.splice(state.active, 1);
        state.active = Math.min(state.active, Math.max(0, state.config.rules.length - 1));
      } else if (id === "action:clear") {
        state.config.rules = [rule(true)];
        state.active = 0;
      } else if (id === "action:pause") {
        state.config.paused = !state.config.paused;
      } else if (id === "action:toggle-rule") {
        // 編集中(active)ルールのVIEW選択(enabled)だけを反転する
        const target = state.config.rules[state.active];
        if (target) target.enabled = !target.enabled;
      } else if (id === "action:deselect-all-rules") {
        // 全VIEW選択だけを解除し、notify・ルール構成・edit focusは保持する
        for (const target of state.config.rules) target.enabled = false;
      } else if (id === "action:notify-rule") {
        // 編集中(active)ルールのnotifyだけを反転する
        const target = state.config.rules[state.active];
        if (target) target.notify = !target.notify;
      } else if (id.startsWith("rule:")) {
        // 対象ルールのVIEW選択(enabled)だけを反転し、editフォーカス(active)は動かさない
        const target = state.config.rules[Number(value)];
        if (target) target.enabled = !target.enabled;
      } else if (id.startsWith("tier:")) {
        const r = prepareFilterTarget();
        toggle(r.tiers, value);
      } else if (id.startsWith("mission:")) {
        const r = prepareFilterTarget();
        toggle(r.missionTypes, value);
      } else if (id.startsWith("planet:")) {
        const r = prepareFilterTarget();
        toggle(r.planets, value);
      } else if (id.startsWith("mode:")) {
        const r = prepareFilterTarget();
        r.mode = value;
      } else if (id.startsWith("storm:")) {
        const r = prepareFilterTarget();
        r.storms = value;
      }
      return { config: state.config, active: state.active };
    },
    set_rule_enabled: (args) => {
      const rules = state.config.rules;
      const index = Number(args.index);
      if (rules[index]) rules[index].enabled = Boolean(args.enabled);
      return state.config;
    },
    set_rule_notify: (args) => {
      const rules = state.config.rules;
      const index = Number(args.index);
      if (rules[index]) rules[index].notify = Boolean(args.notify);
      return state.config;
    },
    clear_filter: () => {
      state.config.rules = [rule(true)];
      state.active = 0;
      return state.config;
    },
    set_config: (args) => {
      state.config = args.config as typeof state.config;
      return null;
    },
    test_notification: () => "TEST: 通知要求を受け付けました (desktop / discord)",
  };

  const recorded: Array<{ cmd: string; args: unknown }> = [];
  let callbackId = 1;
  const target = window as unknown as Record<string, unknown>;
  target.__MOCK_CALLS__ = recorded;
  target.__MOCK_STATE__ = state;
  target.__TAURI_INTERNALS__ = {
    transformCallback: () => callbackId++,
    unregisterCallback: () => undefined,
    convertFileSrc: (path: string) => path,
    invoke: (cmd: string, args?: Record<string, unknown>) => {
      recorded.push({ cmd, args });
      if (cmd.startsWith("plugin:event|")) return Promise.resolve(callbackId++);
      const handler = handlers[cmd];
      if (!handler) return Promise.reject(new Error("unmocked command: " + cmd));
      try {
        return Promise.resolve(handler(args ?? {}));
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}
