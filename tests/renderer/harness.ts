// renderer統合テストのハーネス(手書き)。
// Tauri IPC(window.__TAURI_INTERNALS__)をmockしてフロントエンドだけを起動する。
// Rust側の判定・fuzzy・dedupはここで再現しない: このレイヤはDOM結線とレイアウトの証拠のみを扱い、
// Rust commandやOS通知を通った証明にはしない(docs/E2E.mdの線引き)。

import type { Page } from "@playwright/test";

export interface BootOptions {
  /** 全ルールをdisabledで起動する(NO ENABLED表示・empty rowの検査用) */
  allRulesDisabled?: boolean;
}

export interface MockCall {
  cmd: string;
  args: Record<string, unknown> | undefined;
}

/** mockを注入してコンソールを起動し、init()完了(ステータスバー描画)まで待つ */
export async function bootConsole(page: Page, options: BootOptions = {}): Promise<void> {
  await page.addInitScript(installMock, { allRulesDisabled: options.allRulesDisabled ?? false });
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

function installMock({ allRulesDisabled }: { allRulesDisabled: boolean }) {
  type Rule = {
    enabled: boolean;
    tiers: string[];
    missionTypes: string[];
    planets: string[];
    mode: string;
    storms: string;
  };

  const iso = (offsetSecs: number) => new Date(Date.now() + offsetSecs * 1000).toISOString();
  const rule = (enabled: boolean): Rule => ({
    enabled,
    tiers: [],
    missionTypes: [],
    planets: [],
    mode: "Both",
    storms: "Exclude",
  });

  // MAN-011の代表的な長い値を含むfixture
  const fissures = allRulesDisabled
    ? []
    : [
        {
          id: "fx-requiem",
          activation: iso(-3600),
          expiry: iso(1800),
          node: "Taveuni (Kuva Fortress)",
          missionType: "Mobile Defense",
          enemy: "Corrupted",
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
    },
    status: {
      fissures,
      apiOk: true,
      lastError: null as string | null,
      lastPoll: iso(0),
      nextPollSecs: 60,
      notifiedToday: 0,
      paused: false,
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
    { id: "action:clear", label: "CLEAR FILTERS", facet: "action" },
    { id: "action:pause", label: "PAUSE WATCH", facet: "action" },
  ];

  const activeRule = (): Rule => state.config.rules[state.active] ?? state.config.rules[0];
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
      default:
        return false;
    }
  };
  const candView = (q: string) => {
    const query = q.trim().toLowerCase();
    return catalog
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

  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
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
    apply_candidate: (args) => {
      state.active = Number(args.active ?? 0);
      const id = String(args.id);
      const value = id.slice(id.indexOf(":") + 1);
      const r = activeRule();
      if (id === "action:new-rule") {
        state.config.rules.push(rule(false));
        state.active = state.config.rules.length - 1;
      } else if (id === "action:delete-rule") {
        state.config.rules.splice(state.active, 1);
        if (state.config.rules.length === 0) state.config.rules.push(rule(true));
        state.active = Math.min(state.active, state.config.rules.length - 1);
      } else if (id === "action:clear") {
        state.config.rules = [rule(true)];
        state.active = 0;
      } else if (id === "action:pause") {
        state.config.paused = !state.config.paused;
      } else if (id.startsWith("tier:")) {
        toggle(r.tiers, value);
      } else if (id.startsWith("mission:")) {
        toggle(r.missionTypes, value);
      } else if (id.startsWith("planet:")) {
        toggle(r.planets, value);
      } else if (id.startsWith("mode:")) {
        r.mode = value;
      } else if (id.startsWith("storm:")) {
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
