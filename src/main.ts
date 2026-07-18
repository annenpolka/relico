import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

// WDIO E2Eビルド(VITE_E2E=1)だけwdio frontend pluginを読み込む。通常ビルドでは除去される
if (import.meta.env.VITE_E2E) {
  void import("@wdio/tauri-plugin");
}
import { candidateGlyphHtml, glyphHtml, planetForFissure } from "./icons";
import {
  applyDocumentTranslations,
  candidateLabel,
  getLocale,
  normalizeLocale,
  setLocale,
  t,
  type MessageKey,
} from "./i18n";
import { handleContentTabShortcut, initContentTabs, type ContentTabId } from "./tabs";
import type {
  AppLocale,
  AppConfig,
  ApplyResult,
  CandView,
  Facet,
  Fissure,
  StatusSnapshot,
  TimedCondition,
  TimedContentCard,
  TimedContentSnapshot,
  TimedContentStage,
  TimedSourceStatus,
  WatchRule,
} from "./types";

let config: AppConfig | null = null;
let status: StatusSnapshot | null = null;
let autostart = false;
let editingRuleIndex = 0;
let catalogView: CandView[] = []; // q="" の全候補(レール描画用)
let nextRefresh = 0;
let pendingLocale: AppLocale | null = null;
// facet絞りlauncherの対象5軸(actionとruleトグル候補は対象外)
type RuleFacet = Exclude<Facet, "action" | "rule">;
let railTab: "filters" | "delivery" = "filters";
let paletteFacet: RuleFacet | null = null;

function withFrontendDefaults(next: AppConfig): AppConfig {
  return {
    ...next,
    locale: normalizeLocale(next.locale),
    notificationMute: next.notificationMute ?? {
      enabled: false,
      startMinute: 22 * 60,
      endMinute: 7 * 60,
    },
  };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function railMsg(text: string, kind: "ok" | "err" | "" = "") {
  const el = $("rail-msg");
  el.textContent = text;
  el.title = text;
  el.className = kind;
}

// ---- 設定の保存(パレット外の項目: 通知先・間隔など) ----
let saveTimer: ReturnType<typeof setTimeout> | undefined;
async function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!config) return;
  const snapshot = { ...config };
  await invoke("set_config", { config: snapshot });
}

function save() {
  if (!config) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushSave().catch((e) => {
      railMsg(t("common.saveFailed", { error: String(e) }), "err");
    });
  }, 300);
}

// ---- パレット候補の適用(ルール編集はすべてこの経路 = SAT-001の解決を通る) ----
async function refreshCatalog() {
  catalogView = await invoke<CandView[]>("query_candidates", { q: "", active: editingRuleIndex });
}

async function applyCand(id: string) {
  try {
    const res = await invoke<ApplyResult>("apply_candidate", { id, active: editingRuleIndex });
    config = withFrontendDefaults(res.config);
    editingRuleIndex = res.active;
    await refreshCatalog();
    renderRail();
    renderStatusbar();
  } catch (e) {
    railMsg(String(e), "err");
  }
}

async function setRuleEnabled(index: number, enabled: boolean) {
  try {
    config = withFrontendDefaults(await invoke<AppConfig>("set_rule_enabled", { index, enabled }));
    editingRuleIndex = Math.max(0, Math.min(editingRuleIndex, config.rules.length - 1));
    await refreshCatalog();
    renderRail();
    renderTable();
    renderStatusbar();
  } catch (e) {
    railMsg(String(e), "err");
  }
}

async function setRuleNotify(index: number, notify: boolean) {
  try {
    config = withFrontendDefaults(await invoke<AppConfig>("set_rule_notify", { index, notify }));
    editingRuleIndex = Math.max(0, Math.min(editingRuleIndex, config.rules.length - 1));
    await refreshCatalog();
    renderRail();
    renderTable();
    renderStatusbar();
  } catch (e) {
    railMsg(String(e), "err");
  }
}

async function focusRule(index: number) {
  const count = config?.rules.length ?? 0;
  if (!count) return;
  editingRuleIndex = (index + count) % count;
  await refreshCatalog();
  renderRail();
}

// ---- ルール一覧 ----
function summarize(r: WatchRule): string {
  const tiers = r.tiers.length ? r.tiers.map((tier) => tier.toUpperCase()).join("+") : t("rules.all");
  const mode =
    r.mode === "SteelPath"
      ? t("rules.modeSteel")
      : r.mode === "Normal"
        ? t("rules.modeNormal")
        : t("rules.modeBoth");
  let s = `${tiers}/${mode}`;
  if (r.missionTypes.length) s += `/M${r.missionTypes.length}`;
  if (r.planets.length) s += `/P${r.planets.length}`;
  if (r.storms === "Include") s += `/${t("rules.stormInclude")}`;
  if (r.storms === "Only") s += `/${t("rules.stormOnly")}`;
  return s;
}

function renderRules() {
  const box = $("rules-list");
  const rules = config?.rules ?? [];
  const viewCount = rules.filter((rule) => rule.enabled).length;
  $("rules-meta").textContent = t("rules.viewCount", { current: viewCount, total: rules.length });
  // NEWゴースト行は静的な#rule-newノードを流用し、リスト末尾へ置き直す(リスナー維持)
  const ghost = $("rule-new");
  if (!rules.length) {
    $("editing-meta").textContent = t("rules.noRule");
    const p = document.createElement("p");
    p.className = "norules";
    p.textContent = t("rules.noRules");
    box.replaceChildren(p, ghost);
    renderRuleButtons(null);
    return;
  }

  editingRuleIndex = Math.max(0, Math.min(editingRuleIndex, rules.length - 1));
  $("editing-meta").textContent = `R${editingRuleIndex + 1}/${rules.length}`;
  renderRuleButtons(editingRuleIndex);

  box.replaceChildren(
    ...rules.map((r, i) => {
      const focused = i === editingRuleIndex;
      const row = document.createElement("div");
      row.className = `rule-row${focused ? " rule-focus" : ""}${r.enabled ? "" : " disabled"}`;

      const toggle = document.createElement("button");
      toggle.className = "rule-toggle";
      toggle.type = "button";
      toggle.innerHTML = `<span class="box">[${r.enabled ? "x" : " "}]</span>`;
      toggle.setAttribute("aria-pressed", String(r.enabled));
      toggle.setAttribute(
        "aria-label",
        t(r.enabled ? "rules.excludeView" : "rules.includeView", { index: i + 1 }),
      );
      toggle.title = t(r.enabled ? "rules.viewOnTitle" : "rules.viewOffTitle");
      toggle.addEventListener("click", () => setRuleEnabled(i, !r.enabled));

      const edit = document.createElement("button");
      edit.className = "rule-edit";
      edit.type = "button";
      // 名前があれば要約より優先して表示する(要約はtooltipに残す)
      edit.innerHTML = `<span class="rno">R${i + 1}</span><span class="rule-summary">${esc(r.name ?? summarize(r))}</span>`;
      if (focused) edit.setAttribute("aria-current", "true");
      edit.setAttribute(
        "aria-label",
        t("rules.editAria", { name: r.name ?? `R${i + 1}`, summary: summarize(r) }),
      );
      edit.title = t("rules.editTitle", { summary: summarize(r) });
      // 行本体はedit focusを移すだけ。パレットは打鍵かfacet launcherで開く(RND-003)
      edit.addEventListener("click", () => {
        if (i !== editingRuleIndex) void focusRule(i);
      });

      // 通知トグル。一覧表示(enabled)とは独立し、OFFは斜線入りベルで明示する
      const notifyBtn = document.createElement("button");
      notifyBtn.className = `rule-notify${r.notify ? "" : " off"}`;
      notifyBtn.type = "button";
      notifyBtn.innerHTML = glyphHtml("action", r.notify ? "notify-rule" : "notify-rule-off");
      notifyBtn.setAttribute("aria-pressed", String(r.notify));
      notifyBtn.setAttribute(
        "aria-label",
        t(r.notify ? "rules.disableNotify" : "rules.enableNotify", { index: i + 1 }),
      );
      notifyBtn.title = t(r.notify ? "rules.notifyOnTitle" : "rules.notifyOffTitle");
      notifyBtn.addEventListener("click", () => setRuleNotify(i, !r.notify));

      row.replaceChildren(toggle, edit, notifyBtn);
      return row;
    }),
    ghost,
  );
  box.querySelector(".rule-focus")?.scrollIntoView({ block: "nearest" });
}

/** DEL/CLEARツールバー。DELは削除対象(編集中ルール)をラベルで明示する。
    再描画は2度押し確認(SURE?)を解除する */
let armTimer: ReturnType<typeof setTimeout> | undefined;

function renderRuleButtons(editingIndex: number | null) {
  clearTimeout(armTimer);
  armTimer = undefined;
  $("rule-del").classList.remove("armed");
  $("clear-btn").classList.remove("armed");
  $("rule-del").innerHTML = `${glyphHtml("action", "delete-rule")}<span>${esc(t("rules.delete"))}${editingIndex === null ? "" : ` R${editingIndex + 1}`}</span>`;
  $("clear-btn").innerHTML = `${glyphHtml("action", "clear")}<span>${esc(t("rules.clear"))}</span>`;
  $("rule-del").title = t("rules.deleteTitle");
  $("clear-btn").title = t("rules.clearTitle");
}

/** 破壊系の2度押し確認: 1クリック目はSURE?表示のみ、2秒で復帰、SURE?中のクリックだけ実行(RND-003) */
function armOrFire(id: "rule-del" | "clear-btn", fire: () => void) {
  const btn = $(id);
  if (btn.classList.contains("armed")) {
    renderRuleButtons(config?.rules.length ? editingRuleIndex : null);
    fire();
    return;
  }
  renderRuleButtons(config?.rules.length ? editingRuleIndex : null);
  btn.classList.add("armed");
  btn.innerHTML = `<span>${esc(t("common.confirm"))}</span>`;
  armTimer = setTimeout(() => {
    renderRuleButtons(config?.rules.length ? editingRuleIndex : null);
  }, 2000);
}

const FACET_LABEL_KEYS: Record<RuleFacet, MessageKey> = {
  tier: "facets.tier",
  mode: "facets.mode",
  storm: "facets.storm",
  mission: "facets.mission",
  planet: "facets.planet",
};

const PALETTE_FACET_LABEL_KEYS: Record<Facet, MessageKey> = {
  ...FACET_LABEL_KEYS,
  action: "facets.action",
  rule: "facets.rule",
};

const facetLabel = (facet: RuleFacet): string => t(FACET_LABEL_KEYS[facet]).toUpperCase();

function renderFacetLauncher(containerId: string, facet: RuleFacet) {
  const button = $<HTMLButtonElement>(containerId);
  const selected = catalogView.filter((c) => c.facet === facet && c.on);
  const summary =
    selected.length === 0
      ? t("rules.all").toUpperCase()
      : selected.length <= 2
        ? selected.map((c) => c.label.toUpperCase()).join(" + ")
        : `${selected[0].label.toUpperCase()} +${selected.length - 1}`;
  const full = selected.length ? selected.map((c) => c.label).join(", ") : t("rules.all");
  const icon =
    selected.length === 1
      ? candidateGlyphHtml(facet, selected[0].id)
      : candidateGlyphHtml(facet, `${facet}:`);

  button.innerHTML = `<span class="facet-name">${esc(facetLabel(facet))}</span><span class="facet-icon">${icon}</span><span class="facet-value">${esc(summary)}</span><span class="facet-arrow">›</span>`;
  button.title = `${facetLabel(facet)}: ${full}`;
  button.setAttribute("aria-label", t("facets.editAria", { facet: facetLabel(facet), value: full }));
  button.setAttribute("aria-haspopup", "dialog");
  button.onclick = () => openPalette("", facet);
}

function setCheck(id: string, on: boolean) {
  const btn = $(id);
  btn.classList.toggle("off", !on);
  btn.setAttribute("aria-pressed", String(on));
  const box = btn.querySelector(".box");
  if (box) box.textContent = `[${on ? "x" : " "}]`;
}

function minuteToTime(value: number): string {
  const minute = ((Math.trunc(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function timeToMinute(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function renderMuteSettings() {
  if (!config) return;
  const mute = config.notificationMute;
  setCheck("mute-check", mute.enabled);
  const start = $<HTMLInputElement>("mute-start-input");
  const end = $<HTMLInputElement>("mute-end-input");
  start.value = minuteToTime(mute.startMinute);
  end.value = minuteToTime(mute.endMinute);
  start.disabled = !mute.enabled;
  end.disabled = !mute.enabled;

  // 現在ミュート中かはbackend snapshotだけを表示し、時刻区間をTSで再判定しない。RND-011
  const muted = status?.notificationsMuted ?? false;
  const suppressed = status?.suppressedToday ?? 0;
  const muteStatus = $("mute-status");
  muteStatus.dataset.muted = String(muted);
  muteStatus.textContent = !mute.enabled
    ? t("delivery.muteDisabled")
    : t(muted ? "delivery.muteActive" : "delivery.muteInactive", { count: suppressed });
  muteStatus.title = muteStatus.textContent;
}

function renderRail() {
  if (!config) return;
  $("rule-new").innerHTML = `${glyphHtml("action", "new-rule")}<span>${esc(t("rules.new"))}</span>`;
  renderRules();
  renderFacetLauncher("tier-checks", "tier");
  renderFacetLauncher("mode-checks", "mode");
  renderFacetLauncher("storm-checks", "storm");
  renderFacetLauncher("mission-checks", "mission");
  renderFacetLauncher("planet-checks", "planet");

  setCheck("desktop-check", config.desktopNotification);
  setCheck("autostart-check", autostart);

  // 編集中ルールの名前を同期する(入力中のclobberを避けるためfocus中は触らない)
  const nameInput = $("rulename-input") as HTMLInputElement;
  const editingRule = config.rules[Math.min(editingRuleIndex, config.rules.length - 1)];
  nameInput.dataset.i18nPlaceholderKey = editingRule
    ? "rules.namePlaceholder"
    : "rules.namePlaceholderEmpty";
  nameInput.placeholder = editingRule
    ? t("rules.namePlaceholder", { index: editingRuleIndex + 1 })
    : t("rules.namePlaceholderEmpty");
  if (document.activeElement !== nameInput) {
    nameInput.value = editingRule?.name ?? "";
  }

  ($("webhook-input") as HTMLInputElement).value = config.discordWebhookUrl ?? "";
  ($("minremain-input") as HTMLInputElement).value = String(config.minRemainingSecs);
  ($("poll-input") as HTMLInputElement).value = String(config.pollIntervalSecs);
  $<HTMLSelectElement>("locale-select").value = config.locale;
  renderMuteSettings();

  const pauseBtn = $("pause-btn");
  pauseBtn.dataset.i18nKey = config.paused ? "common.resume" : "common.pause";
  pauseBtn.textContent = t(config.paused ? "common.resume" : "common.pause");
  pauseBtn.classList.toggle("hot", config.paused);

  renderRailTabs();
  renderWatchLine();
}

function renderRailTabs() {
  const filters = railTab === "filters";
  $("filters-panel").hidden = !filters;
  $("delivery-panel").hidden = filters;
  $("filters-tab").classList.toggle("active", filters);
  $("delivery-tab").classList.toggle("active", !filters);
  $("filters-tab").setAttribute("aria-selected", String(filters));
  $("delivery-tab").setAttribute("aria-selected", String(!filters));
  $("filters-tab").setAttribute("aria-pressed", String(filters));
  $("delivery-tab").setAttribute("aria-pressed", String(!filters));
}

function setRailTab(next: "filters" | "delivery") {
  railTab = next;
  renderRailTabs();
}

// ---- テーブル ----
// 項目別ソート: 表示のみで設定・通知に影響しない(SPEC: RND-007)
type SortKey = "tier" | "node" | "mission" | "faction" | "timer" | "mode" | "storm";
let sortKey: SortKey = "timer";
let sortDir: 1 | -1 = 1;
const SORT_ACCESSORS: Record<SortKey, (f: Fissure) => number | string> = {
  tier: (f) => f.tierNum,
  node: (f) => f.node.toLowerCase(),
  mission: (f) => f.missionType.toLowerCase(),
  faction: (f) => f.enemy.toLowerCase(),
  timer: (f) => Date.parse(f.expiry),
  mode: (f) => (f.isHard ? 1 : 0),
  storm: (f) => (f.isStorm ? 1 : 0),
};

function sortedFissures(fissures: Fissure[]): Fissure[] {
  const get = SORT_ACCESSORS[sortKey];
  return [...fissures].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av !== bv) return (av < bv ? -1 : 1) * sortDir;
    return Date.parse(a.expiry) - Date.parse(b.expiry); // 同値は消滅が近い順で安定させる
  });
}

function thSortKey(th: HTMLTableCellElement): SortKey | null {
  const cls = Array.from(th.classList).find((c) => c.startsWith("col-"));
  const key = cls?.slice("col-".length) ?? "";
  return key in SORT_ACCESSORS ? (key as SortKey) : null;
}

function renderSortHeaders() {
  document.querySelectorAll<HTMLTableCellElement>("#fissure-table thead th[scope=col]").forEach((th) => {
    const active = thSortKey(th) === sortKey;
    th.querySelector(".sort-mark")?.remove();
    if (active) {
      th.setAttribute("aria-sort", sortDir === 1 ? "ascending" : "descending");
      const mark = document.createElement("span");
      mark.className = "sort-mark";
      mark.textContent = sortDir === 1 ? "▲" : "▼";
      th.appendChild(mark);
    } else {
      th.removeAttribute("aria-sort");
    }
  });
}

function initSortHeaders() {
  document.querySelectorAll<HTMLTableCellElement>("#fissure-table thead th[scope=col]").forEach((th) => {
    const key = thSortKey(th);
    if (!key) return;
    th.addEventListener("click", () => {
      if (sortKey === key) {
        sortDir = sortDir === 1 ? -1 : 1;
      } else {
        sortKey = key;
        sortDir = 1;
      }
      renderSortHeaders();
      renderTable();
    });
  });
  renderSortHeaders();
}

function renderTable() {
  const rows = $("fissure-rows");
  // 有効ルールがあれば合致のみ、無指定なら全件がsnapshotに入っている(SPEC: VIS-001)
  const fissures = sortedFissures(status?.fissures ?? []);
  if (fissures.length === 0) {
    const msg =
      status?.apiOk === false
        ? t("table.unreachable")
        : status?.lastPoll
          ? t("table.noMatches")
          : t("table.waiting");
    rows.innerHTML = `<tr><td colspan="7" class="empty">${msg}</td></tr>`;
    return;
  }
  rows.replaceChildren(
    ...fissures.map((f) => {
      const tr = document.createElement("tr");
      const difficulty = f.isHard ? "SteelPath" : "Normal";
      const modeLabel = t(f.isHard ? "table.hard" : "table.normal").toUpperCase();
      const mode = `<span class="flag ${f.isHard ? "t-hard" : "t-normal"}">${glyphHtml("difficulty", difficulty)}<span>${esc(modeLabel)}</span></span>`;
      const storm = f.isStorm
        ? `<span class="flag t-storm">${glyphHtml("storm", "Only")}<span>${esc(t("table.stormValue").toUpperCase())}</span></span>`
        : `<span class="t-no-storm">—</span>`;
      const planet = planetForFissure(f.planet, f.isStorm);
      tr.title = [
        f.tier.toUpperCase(),
        f.node,
        f.missionType.toUpperCase(),
        f.enemy.toUpperCase(),
        modeLabel,
        f.isStorm ? t("table.stormValue") : t("table.noStorm"),
      ].join(" · ");
      tr.innerHTML = `
        <td class="col-tier t-tier"><span class="icon-label">${glyphHtml("tier", f.tier)}<span>${esc(f.tier.toUpperCase())}</span></span></td>
        <td class="col-node"><span class="icon-label">${glyphHtml("planet", planet)}<span>${esc(f.node)}</span></span></td>
        <td class="col-mission"><span class="icon-label">${glyphHtml("mission", f.missionType)}<span>${esc(f.missionType.toUpperCase())}</span></span></td>
        <td class="col-faction t-mute"><span class="icon-label">${glyphHtml("faction", f.enemy)}<span>${esc(f.enemy.toUpperCase())}</span></span></td>
        <td class="col-timer t-timer" data-expiry="${f.expiry}">--:--</td>
        <td class="col-mode">${mode}</td>
        <td class="col-storm">${storm}</td>`;
      return tr;
    }),
  );
  tickTimers();
}

/** poll待ちやAPI障害・PAUSE中でも、失効した行をfrontend snapshotから除去する。RND-008 */
function pruneExpiredFissures(now: number): boolean {
  if (!status) return false;
  const before = status.fissures.length;
  status.fissures = status.fissures.filter((fissure) => Date.parse(fissure.expiry) > now);
  return status.fissures.length !== before;
}

function tickTimers() {
  const now = Date.now();
  if (pruneExpiredFissures(now)) {
    renderTable();
    return;
  }
  document.querySelectorAll<HTMLElement>(".t-timer").forEach((el) => {
    const expiry = Date.parse(el.dataset.expiry ?? "");
    const rest = Math.floor((expiry - now) / 1000);
    const h = Math.floor(rest / 3600);
    const m = Math.floor((rest % 3600) / 60);
    const s = rest % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    el.textContent = h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    el.classList.toggle("urgent", rest < 600);
  });
}

// ---- ソーティー・アルコン等の時限コンテンツカード ----
type TimedTabId = Exclude<ContentTabId, "fissures">;
type TimedCardField = Exclude<keyof TimedContentSnapshot, "sources" | "lastPoll">;
type TimedSourceKey = keyof TimedContentSnapshot["sources"];

const TIMED_TAB_FIELDS: Record<TimedTabId, readonly TimedCardField[]> = {
  arbitration: ["arbitration"],
  sortie: ["sortie"],
  archon: ["archon"],
  syndicates: ["syndicates"],
  "area-missions": ["areaMissions", "bounties"],
  circuit: ["circuit"],
  archimedea: ["archimedea"],
  descendia: ["descendia"],
};

const TIMED_TAB_SOURCES: Record<TimedTabId, readonly TimedSourceKey[]> = {
  arbitration: ["browseWfArbitration"],
  sortie: ["wfcd"],
  archon: ["wfcd"],
  syndicates: ["wfcd"],
  "area-missions": ["wfcd", "browseWfBounties"],
  circuit: ["deCircuit"],
  archimedea: ["wfcd"],
  descendia: ["deDescendia"],
};

const PERSONAL_PROGRESS_KEYS: Partial<Record<TimedTabId, MessageKey>> = {
  circuit: "timed.circuitProgressUnavailable",
  archimedea: "timed.personalProgressUnavailable",
  descendia: "timed.personalProgressUnavailable",
};

const TEMPORAL_STATUS_KEYS: Record<TimedContentCard["temporalStatus"], MessageKey> = {
  active: "timed.active",
  upcoming: "timed.upcoming",
};

const PROVENANCE_KEYS: Record<TimedContentCard["provenance"]["kind"], MessageKey> = {
  "official-live": "timed.officialLive",
  "community-live": "timed.communityLive",
  "community-schedule": "timed.communitySchedule",
};

const SOURCE_NAME_KEYS: Record<TimedSourceKey, MessageKey> = {
  wfcd: "timed.sourceWfcd",
  deDescendia: "timed.sourceDeDescendia",
  deCircuit: "timed.sourceDeCircuit",
  browseWfBounties: "timed.sourceBrowseBounties",
  browseWfArbitration: "timed.sourceBrowseArbitration",
};

const TIMED_TITLE_KEYS: Partial<Record<string, MessageKey>> = {
  arbitration: "tabs.arbitration",
  sortie: "tabs.sortie",
  archon: "tabs.archon",
  descendia: "tabs.descendia",
};

const TIMED_METADATA_KEYS: Partial<Record<string, MessageKey>> = {
  rot: "timed.rotation",
  rotation: "timed.rotation",
  vaultRot: "timed.vaultRotation",
  vaultRotation: "timed.vaultRotation",
  zarimanFaction: "timed.faction",
  faction: "timed.faction",
  week: "timed.week",
};

function localizedDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function appendTimedMeta(container: HTMLElement, key: MessageKey, value: string): void {
  appendTimedMetaLabel(container, t(key), value);
}

function appendTimedMetaLabel(container: HTMLElement, label: string, value: string): void {
  const item = document.createElement("span");
  const heading = document.createElement("strong");
  heading.textContent = label;
  item.append(heading, ` ${value}`);
  container.append(item);
}

function timedCardDescription(card: TimedContentCard): string | null {
  if (card.subtitle) return card.subtitle;
  if (
    card.kind.includes("syndicat") ||
    card.kind === "area-mission" ||
    card.kind.includes("bounty") ||
    card.kind === "descendia"
  ) {
    return t("timed.stageCount", { count: card.stages.length });
  }
  return null;
}

function timedStageTitle(card: TimedContentCard, stage: TimedContentStage): string {
  if (card.kind === "circuit") {
    if (stage.title === "Normal Circuit" || stage.order === 1) return t("timed.normalCircuit");
    if (stage.title === "Steel Path Circuit" || stage.order === 2) {
      return t("timed.steelPathCircuit");
    }
  }
  return stage.title;
}

function timedIdentifierLabel(value: string): string {
  const leaf = (value.split("/").pop() ?? value)
    .replace(/AllyAgent$/, "")
    .replace(/\.level$/, "");
  return leaf
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

function timedTitle(card: TimedContentCard): string {
  if (card.kind.includes("circuit")) {
    if (card.variant === "normal") return t("timed.normalCircuit");
    if (card.variant === "steel-path" || card.variant === "hard") {
      return t("timed.steelPathCircuit");
    }
    return t("tabs.circuit");
  }
  if (card.kind === "archimedea") {
    if (card.variant === "deep") return t("timed.deepArchimedea");
    if (card.variant === "temporal") return t("timed.temporalArchimedea");
  }
  const localizedTitleKey = TIMED_TITLE_KEYS[card.kind];
  return localizedTitleKey ? t(localizedTitleKey) : card.title;
}

function safeSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function sourceElement(card: TimedContentCard): HTMLElement {
  const safeUrl = safeSourceUrl(card.sourceUrl);
  if (!safeUrl) {
    const label = document.createElement("span");
    label.className = "timed-source-label";
    label.textContent = card.sourceName;
    return label;
  }

  const link = document.createElement("a");
  link.className = "timed-source-link";
  link.href = safeUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = card.sourceName;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    void openUrl(safeUrl).catch((error) => {
      railMsg(t("timed.openSourceFailed", { error: String(error) }), "err");
    });
  });
  return link;
}

function timedBadge(className: string, text: string): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = `timed-badge ${className}`;
  badge.textContent = text;
  return badge;
}

function conditionGroup(labelKey: MessageKey, conditions: TimedCondition[]): HTMLElement | null {
  if (!conditions.length) return null;
  const group = document.createElement("section");
  group.className = "timed-condition-group";
  const heading = document.createElement("h4");
  heading.textContent = t(labelKey);
  const list = document.createElement("ul");
  for (const condition of conditions) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = condition.name || condition.key || condition.description;
    item.append(name);
    if (condition.eliteOnly) {
      item.append(timedBadge("timed-elite-badge", t("timed.eliteOnly")));
    }
    if (condition.description && condition.description !== name.textContent) {
      const description = document.createElement("span");
      description.className = "timed-condition-description";
      description.textContent = condition.description;
      item.append(description);
    }
    list.append(item);
  }
  group.append(heading, list);
  return group;
}

function namedValues(labelKey: MessageKey, values: string[]): HTMLElement | null {
  const present = values.filter((value) => value.trim() !== "");
  if (!present.length) return null;
  const group = document.createElement("div");
  group.className = "timed-value-group";
  const heading = document.createElement("strong");
  heading.textContent = t(labelKey);
  const list = document.createElement("ul");
  for (const value of present) {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  }
  group.append(heading, list);
  return group;
}

function rewardDetails(stage: TimedContentStage): HTMLDetailsElement | null {
  const pool = stage.rewardPool ?? [];
  const drops = stage.rewardDrops ?? [];
  if (!pool.length && !drops.length) return null;
  const details = document.createElement("details");
  details.className = "timed-rewards";
  const summary = document.createElement("summary");
  summary.textContent = t("timed.rewards");
  details.append(summary);
  const poolGroup = namedValues("timed.rewardPool", pool);
  if (poolGroup) details.append(poolGroup);
  if (drops.length) {
    const list = document.createElement("ul");
    list.className = "timed-reward-drops";
    const number = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 3 });
    for (const drop of drops) {
      const item = document.createElement("li");
      item.textContent = t("timed.rewardDrop", {
        item: drop.item,
        rarity: drop.rarity || t("timed.unknownRarity"),
        chance: number.format(drop.chancePercent),
        count: drop.count,
      });
      list.append(item);
    }
    details.append(list);
  }
  return details;
}

function appendStageDetails(body: HTMLElement, stage: TimedContentStage): void {
  const structured: string[] = [];
  if (stage.enemyLevels?.length) {
    structured.push(
      t("timed.enemyLevels", {
        min: stage.enemyLevels[0],
        max: stage.enemyLevels[stage.enemyLevels.length - 1],
      }),
    );
  }
  if (stage.standingStages?.length) {
    structured.push(
      t("timed.standingTotal", {
        value: stage.standingStages.reduce((total, value) => total + value, 0),
      }),
    );
  }
  if (stage.minMr !== undefined) structured.push(t("timed.minMr", { value: stage.minMr }));
  if (stage.timeBound) structured.push(t("timed.timeBound", { value: stage.timeBound }));
  if (structured.length) {
    const details = document.createElement("div");
    details.className = "timed-stage-detail timed-stage-structured";
    details.textContent = structured.join(" · ");
    body.append(details);
  }
  if (stage.ally) {
    const ally = document.createElement("div");
    ally.className = "timed-stage-detail";
    const allyLabel = timedIdentifierLabel(stage.ally);
    ally.textContent = `${t("timed.ally")}: ${allyLabel}`;
    if (allyLabel !== stage.ally) ally.title = stage.ally;
    body.append(ally);
  }
  const legacyModifiers = namedValues("timed.modifiers", stage.modifiers ?? []);
  if (legacyModifiers) body.append(legacyModifiers);
  for (const [kind, key] of [
    ["deviation", "timed.deviation"],
    ["risk", "timed.risks"],
  ] as const) {
    const group = conditionGroup(
      key,
      (stage.conditions ?? []).filter((condition) => condition.kind === kind),
    );
    if (group) body.append(group);
  }
  for (const [key, values] of [
    ["timed.choices", stage.choices ?? []],
    ["timed.specs", stage.specs ?? []],
    ["timed.auras", stage.auras ?? []],
  ] as const) {
    const group = namedValues(key, [...values]);
    if (group) body.append(group);
  }
  const rewards = rewardDetails(stage);
  if (rewards) body.append(rewards);
}

function timedCardElement(card: TimedContentCard, headingTag: "h2" | "h3" = "h2"): HTMLElement {
  const article = document.createElement("article");
  article.className = "timed-card";
  article.dataset.cardId = card.id;
  article.dataset.kind = card.kind;
  article.dataset.temporalStatus = card.temporalStatus;
  article.dataset.provenance = card.provenance.kind;
  article.dataset.sourceId = card.sourceId;
  if (card.variant) article.dataset.variant = card.variant;

  const header = document.createElement("div");
  header.className = "timed-card-header";
  const title = document.createElement(headingTag);
  title.textContent = timedTitle(card);
  const badges = document.createElement("div");
  badges.className = "timed-badges";
  badges.append(
    timedBadge("timed-status-badge", t(TEMPORAL_STATUS_KEYS[card.temporalStatus])),
    timedBadge("timed-provenance-badge", t(PROVENANCE_KEYS[card.provenance.kind])),
    sourceElement(card),
  );
  badges.title = card.provenance.contributors.join(", ");
  header.append(title, badges);
  article.append(header);

  // API由来固有名詞はraw表示し、状態・出典・構造ラベルはapp catalogを使う。
  const description = timedCardDescription(card);
  if (description) {
    const subtitle = document.createElement("p");
    subtitle.className = "timed-subtitle";
    subtitle.textContent = description;
    article.append(subtitle);
  }

  const meta = document.createElement("div");
  meta.className = "timed-meta";
  if (card.activation) appendTimedMeta(meta, "timed.activation", localizedDate(card.activation));
  if (card.expiry) appendTimedMeta(meta, "timed.expiry", localizedDate(card.expiry));
  for (const item of card.metadata ?? []) {
    const key = TIMED_METADATA_KEYS[item.key];
    const fallback = item.key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .trim();
    appendTimedMetaLabel(meta, key ? t(key) : fallback, item.value);
  }
  article.append(meta);

  const personal = conditionGroup("timed.personalModifiers", card.personalModifiers ?? []);
  if (personal) article.append(personal);

  if (card.stages.length) {
    const stages = document.createElement("ol");
    stages.className = "timed-stages";
    for (const stage of [...card.stages].sort((a, b) => a.order - b.order)) {
      const item = document.createElement("li");
      item.className = "timed-stage";
      item.dataset.stageOrder = String(stage.order);
      const order = document.createElement("span");
      order.className = "timed-stage-order";
      order.textContent = String(stage.order).padStart(2, "0");
      const body = document.createElement("div");
      const stageTitle = document.createElement("div");
      stageTitle.className = "timed-stage-title";
      stageTitle.textContent = [timedStageTitle(card, stage), stage.node]
        .filter(Boolean)
        .join(" — ");
      body.append(stageTitle);
      if (stage.detail) {
        const detail = document.createElement("div");
        detail.className = "timed-stage-detail";
        detail.textContent = stage.detail;
        body.append(detail);
      }
      appendStageDetails(body, stage);
      item.append(order, body);
      stages.append(item);
    }
    article.append(stages);
  }
  return article;
}

function upcomingDescendiaElement(card: TimedContentCard): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "timed-upcoming";
  details.dataset.cardId = card.id;
  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.textContent = timedTitle(card);
  const dates = document.createElement("span");
  dates.textContent = card.activation
    ? `${t("timed.upcoming")} · ${localizedDate(card.activation)}`
    : t("timed.upcoming");
  summary.append(title, dates);
  details.append(summary, timedCardElement(card, "h3"));
  return details;
}

function sourceStatusElement(
  sourceKey: TimedSourceKey,
  source: TimedSourceStatus,
  polled: boolean,
): HTMLElement | null {
  if (source.freshness === "fresh") return null;
  if (!polled && !source.lastAttempt && !source.error) return null;
  const messageKey: MessageKey =
    source.freshness === "stale"
      ? "timed.sourceStale"
      : source.freshness === "out-of-range"
        ? "timed.sourceOutOfRange"
        : "timed.sourceUnavailable";
  const message = document.createElement("p");
  message.className = `timed-source-error timed-source-${source.freshness}`;
  message.dataset.source = sourceKey;
  message.dataset.freshness = source.freshness;
  message.setAttribute("role", "status");
  message.textContent = t(messageKey, {
    source: t(SOURCE_NAME_KEYS[sourceKey]),
    error: source.error ?? t("timed.noErrorDetail"),
  });
  return message;
}

function sourceValidityElement(sourceKey: TimedSourceKey, source: TimedSourceStatus): HTMLElement | null {
  if (sourceKey !== "browseWfArbitration" || !source.validUntil) return null;
  const message = document.createElement("p");
  message.className = "timed-source-validity";
  message.dataset.source = sourceKey;
  message.textContent = t("timed.sourceValidUntil", { value: localizedDate(source.validUntil) });
  return message;
}

function cardsForTab(tab: TimedTabId, timed: TimedContentSnapshot | undefined): TimedContentCard[] {
  if (!timed) return [];
  return TIMED_TAB_FIELDS[tab].flatMap((field) => timed[field] ?? []);
}

function areaGroup(
  group: "worldstate" | "bounties",
  labelKey: MessageKey,
  cards: TimedContentCard[],
): HTMLElement | null {
  if (!cards.length) return null;
  const section = document.createElement("section");
  section.className = "timed-card-group";
  section.dataset.group = group;
  const heading = document.createElement("h2");
  heading.className = "timed-group-heading";
  heading.textContent = t(labelKey);
  const grid = document.createElement("div");
  grid.className = "timed-card-group-grid";
  grid.append(...cards.map((card) => timedCardElement(card, "h3")));
  section.append(heading, grid);
  return section;
}

function renderTimedPanel(tab: TimedTabId): void {
  const root = $(`timed-${tab}`);
  const timed = status?.timedContent;
  const cards = cardsForTab(tab, timed);
  const children: HTMLElement[] = [];

  for (const sourceKey of TIMED_TAB_SOURCES[tab]) {
    const source = timed?.sources?.[sourceKey];
    if (!source) continue;
    const problem = sourceStatusElement(sourceKey, source, timed?.lastPoll != null);
    if (problem) children.push(problem);
    const validity = sourceValidityElement(sourceKey, source);
    if (validity) children.push(validity);
  }

  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "timed-empty";
    empty.textContent = t("timed.noContent");
    children.push(empty);
  } else if (tab === "area-missions") {
    const worldstate = areaGroup(
      "worldstate",
      "timed.areaWorldstate",
      timed?.areaMissions ?? [],
    );
    const bounties = areaGroup("bounties", "timed.areaBounties", timed?.bounties ?? []);
    if (worldstate) children.push(worldstate);
    if (bounties) children.push(bounties);
  } else {
    children.push(
      ...cards.map((card) =>
        tab === "descendia" && card.temporalStatus === "upcoming"
          ? upcomingDescendiaElement(card)
          : timedCardElement(card),
      ),
    );
  }

  const progressKey = PERSONAL_PROGRESS_KEYS[tab];
  if (progressKey) {
    const note = document.createElement("p");
    note.className = "timed-progress-note";
    note.dataset.i18nKey = progressKey;
    note.textContent = t(progressKey);
    children.push(note);
  }
  root.replaceChildren(...children);
}

function renderTimedContent() {
  for (const tab of Object.keys(TIMED_TAB_FIELDS) as TimedTabId[]) renderTimedPanel(tab);
}

// ---- ステータスバー ----
function renderStatusbar() {
  if (!status) return;
  $("sb-poll").textContent = t("status.poll", { seconds: config?.pollIntervalSecs ?? "--" });
  const api = $("sb-api");
  if (status.paused) {
    api.textContent = t("status.paused");
    api.className = "err";
  } else if (status.apiOk) {
    api.textContent = t("status.apiOk");
    api.className = "ok";
  } else {
    api.textContent = t("status.apiError");
    api.className = "err";
  }
  $("sb-notified").textContent = t("status.attempted", { count: status.notifiedToday });
  renderWatchLine();
  renderMuteSettings();
}

function renderWatchLine() {
  if (!config) return;
  const total = config.rules.length;
  const notifying = config.rules.filter((rule) => rule.notify);
  $("sb-watch").textContent =
    notifying.length === 0
      ? t("status.watchNone")
      : notifying.length === 1 && total === 1
        ? t("status.watchRule", { rule: summarize(notifying[0]) })
        : notifying.length === total
          ? t("status.watchCount", { count: notifying.length })
          : t("status.watchPartial", { current: notifying.length, total });
}

function tickStatusbar() {
  const el = $("sb-next");
  if (status?.paused) {
    el.textContent = t("status.nextRefreshPaused");
    return;
  }
  nextRefresh = Math.max(0, nextRefresh - 1);
  el.textContent = t("status.nextRefresh", { seconds: nextRefresh });
}

// ---- ファジーパレット ----
let paletteOpen = false;
let paletteComposing = false;
/** RENAME RULE適用中: 入力は検索クエリではなく新しいルール名(RND-006) */
let paletteRenaming = false;
let paletteSel = 0;
let paletteResults: CandView[] = [];
let paletteApplying = false;
let paletteApplyingId: string | null = null;
const palettePendingIds: string[] = [];
const PALETTE_MAX = 12;

function hl(text: string, indices: number[]): string {
  const set = new Set(indices);
  return Array.from(text)
    .map((ch, i) => (set.has(i) ? `<span class="hl">${esc(ch)}</span>` : esc(ch)))
    .join("");
}

async function paletteQuery() {
  const q = ($("palette-input") as HTMLInputElement).value;
  const results = await invoke<CandView[]>("query_candidates", { q, active: editingRuleIndex });
  paletteResults = paletteFacet ? results.filter((candidate) => candidate.facet === paletteFacet) : results;
  if (paletteFacet && q.trim() === "") {
    paletteResults = [
      ...paletteResults.filter((candidate) => candidate.on),
      ...paletteResults.filter((candidate) => !candidate.on),
    ];
  }
  paletteSel = Math.min(paletteSel, Math.max(0, Math.min(paletteResults.length, PALETTE_MAX) - 1));
  renderPalette();
}

function renderPalette() {
  const rules = config?.rules ?? [];
  const index = Math.min(editingRuleIndex, rules.length - 1);
  $("palette-rule").textContent = rules.length
    ? `${t("palette.edit", {
        index: index + 1,
        total: rules.length,
        view: t(rules[index].enabled ? "common.on" : "common.off"),
        notify: t(rules[index].notify ? "common.on" : "common.off"),
      }).toUpperCase()}${paletteFacet ? ` · ${facetLabel(paletteFacet)}` : ""}`
    : t("palette.noRules");
  const box = $("palette-cands");
  if (!paletteResults.length) {
    box.innerHTML = `<div class="cand none">${esc(t("palette.noMatch"))}</div>`;
    return;
  }
  box.replaceChildren(
    ...paletteResults.slice(0, PALETTE_MAX).map((c, i) => {
      const div = document.createElement("div");
      div.className = `cand${c.on ? "" : " off"}${i === paletteSel ? " sel" : ""}`;
      const localizedLabel = candidateLabel(c.id, c.label);
      const label =
        localizedLabel !== c.label || c.via ? esc(localizedLabel) : hl(localizedLabel, c.indices);
      const via = c.via ? `<span class="via">⌁ ${hl(c.via, c.indices)}</span>` : "";
      div.innerHTML = `<span class="box">[${c.on ? "x" : " "}]</span>${candidateGlyphHtml(c.facet, c.id)}<span class="label">${label}</span>${via}<span class="facet">${esc(t(PALETTE_FACET_LABEL_KEYS[c.facet]).toUpperCase())}</span>`;
      div.addEventListener("click", () => {
        paletteSel = i;
        paletteApply();
      });
      return div;
    }),
  );
}

async function drainPaletteApply(firstId: string) {
  paletteApplying = true;
  $("palette-overlay").setAttribute("aria-busy", "true");
  let id: string | undefined = firstId;
  try {
    while (id) {
      paletteApplyingId = id;
      await applyCand(id);
      const input = $("palette-input") as HTMLInputElement;
      input.value = ""; // 連続入力: 開いたままクエリだけリセット
      paletteSel = 0;
      await paletteQuery();
      id = palettePendingIds.shift();
    }
  } finally {
    paletteApplying = false;
    paletteApplyingId = null;
    palettePendingIds.length = 0;
    $("palette-overlay").removeAttribute("aria-busy");
  }
}

function paletteApply() {
  const c = paletteResults[paletteSel];
  if (!c) return;
  if (c.id === "action:rename-rule") {
    if (paletteApplying) return;
    enterRenameMode();
    return;
  }

  if (paletteApplying) {
    // 同じEnterのkey repeatは捨て、異なる後続候補だけを最新activeへ順番に適用する。
    const lastQueued = palettePendingIds[palettePendingIds.length - 1] ?? paletteApplyingId;
    if (lastQueued !== c.id) palettePendingIds.push(c.id);
    return;
  }
  void drainPaletteApply(c.id);
}

// ---- 改名モード: 入力を検索ではなく編集中ルールの新しい名前として扱う ----
function enterRenameMode() {
  const rules = config?.rules ?? [];
  const rule = rules[Math.min(editingRuleIndex, rules.length - 1)];
  if (!rule) return;
  paletteRenaming = true;
  const input = $("palette-input") as HTMLInputElement;
  input.value = rule.name ?? "";
  input.placeholder = t("palette.renamePlaceholder", { index: editingRuleIndex + 1 });
  input.select();
  $("palette-rule").textContent = t("palette.rename", { index: editingRuleIndex + 1 }).toUpperCase();
  $("palette-cands").innerHTML = `<div class="cand none">${esc(t("palette.renameHint"))}</div>`;
}

function exitRenameMode() {
  paletteRenaming = false;
  const input = $("palette-input") as HTMLInputElement;
  input.value = "";
  input.placeholder = paletteFacet
    ? t("palette.searchFacet", { facet: facetLabel(paletteFacet) })
    : t("palette.searchAll");
  paletteSel = 0;
  void paletteQuery();
}

async function commitRename() {
  const rule = config?.rules[editingRuleIndex];
  if (rule) {
    const v = ($("palette-input") as HTMLInputElement).value.trim();
    rule.name = v === "" ? null : v;
    try {
      await flushSave();
    } catch (e) {
      railMsg(t("common.saveFailed", { error: String(e) }), "err");
    }
    renderRail();
  }
  exitRenameMode();
}

function openPalette(seed: string, facet: RuleFacet | null = null) {
  paletteOpen = true;
  paletteRenaming = false;
  paletteFacet = facet;
  $("palette-overlay").hidden = false;
  const input = $("palette-input") as HTMLInputElement;
  input.value = seed;
  input.placeholder = facet
    ? t("palette.searchFacet", { facet: facetLabel(facet) })
    : t("palette.searchAll");
  paletteSel = 0;
  input.focus();
  paletteQuery();
}

function closePalette() {
  paletteOpen = false;
  paletteComposing = false;
  paletteRenaming = false;
  paletteFacet = null;
  $("palette-overlay").hidden = true;
  ($("palette-input") as HTMLInputElement).blur();
}

async function clearFilter() {
  try {
    config = withFrontendDefaults(await invoke<AppConfig>("clear_filter"));
    editingRuleIndex = 0;
    await refreshCatalog();
    renderRail();
    renderStatusbar();
    railMsg(t("common.resetDone"), "ok");
  } catch (e) {
    railMsg(String(e), "err");
  }
}

function renderLocaleSensitiveUi() {
  applyDocumentTranslations();
  renderRail();
  renderTable();
  renderTimedContent();
  renderStatusbar();
  renderSortHeaders();
  if (paletteOpen && !paletteRenaming) renderPalette();
}

async function persistLocale(locale: AppLocale) {
  if (!config || locale === config.locale) return;
  const next = { ...config, locale };
  clearTimeout(saveTimer);
  saveTimer = undefined;
  pendingLocale = locale;
  try {
    // html langと表示の切替は、実set_configが成功した後だけ行う。E2E-003
    await invoke("set_config", { config: next });
    config = next;
    setLocale(locale);
    renderLocaleSensitiveUi();
  } catch (error) {
    $<HTMLSelectElement>("locale-select").value = config.locale;
    railMsg(t("common.saveFailed", { error: String(error) }), "err");
  } finally {
    pendingLocale = null;
  }
}

// ---- 初期化 ----
async function init() {
  config = withFrontendDefaults(await invoke<AppConfig>("get_config"));
  status = await invoke<StatusSnapshot>("get_status");
  autostart = await invoke<boolean>("get_autostart").catch(() => false);
  editingRuleIndex = 0;
  setLocale(config.locale);
  await refreshCatalog();
  nextRefresh = status.nextPollSecs;
  renderRail();
  renderTable();
  renderTimedContent();
  renderStatusbar();

  await listen<StatusSnapshot>("status", (event) => {
    if (status && event.payload.revision < status.revision) return;
    status = event.payload;
    nextRefresh = status.nextPollSecs;
    renderTable();
    renderTimedContent();
    renderStatusbar();
  });

  // トレイのPAUSE等、フロント外からの設定変更に追随する
  await listen<AppConfig>("config", async (event) => {
    config = withFrontendDefaults(event.payload);
    if (pendingLocale === config.locale) return;
    setLocale(config.locale);
    editingRuleIndex = Math.max(0, Math.min(editingRuleIndex, config.rules.length - 1));
    await refreshCatalog();
    renderRail();
    renderTable();
    renderTimedContent();
    renderStatusbar();
  });

  initContentTabs(() => {
    if (paletteOpen) closePalette();
  });
  initSortHeaders();
  $("rule-new").addEventListener("click", () => applyCand("action:new-rule"));
  $("rule-del").addEventListener("click", () =>
    armOrFire("rule-del", () => void applyCand("action:delete-rule")),
  );
  $("clear-btn").addEventListener("click", () => armOrFire("clear-btn", () => void clearFilter()));
  $("pause-btn").addEventListener("click", () => applyCand("action:pause"));
  $("filters-tab").addEventListener("click", () => setRailTab("filters"));
  $("delivery-tab").addEventListener("click", () => setRailTab("delivery"));

  $("desktop-check").addEventListener("click", () => {
    if (!config) return;
    config.desktopNotification = !config.desktopNotification;
    save();
    renderRail();
  });
  $("autostart-check").addEventListener("click", async () => {
    try {
      await invoke("set_autostart", { enabled: !autostart });
      autostart = !autostart;
      renderRail();
    } catch (e) {
      railMsg(t("common.autostartFailed", { error: String(e) }), "err");
    }
  });
  $("test-btn").addEventListener("click", async () => {
    railMsg(t("common.requesting"));
    try {
      await flushSave();
      railMsg(await invoke<string>("test_notification"), "ok");
    } catch (e) {
      railMsg(String(e), "err");
    }
  });
  $<HTMLSelectElement>("locale-select").addEventListener("change", (event) => {
    const locale = normalizeLocale((event.target as HTMLSelectElement).value);
    void persistLocale(locale);
  });
  $("mute-check").addEventListener("click", () => {
    if (!config) return;
    config.notificationMute = {
      ...config.notificationMute,
      enabled: !config.notificationMute.enabled,
    };
    save();
    renderMuteSettings();
  });
  $<HTMLInputElement>("mute-start-input").addEventListener("change", (event) => {
    if (!config) return;
    const minute = timeToMinute((event.target as HTMLInputElement).value);
    if (minute === null) return renderMuteSettings();
    config.notificationMute = { ...config.notificationMute, startMinute: minute };
    save();
  });
  $<HTMLInputElement>("mute-end-input").addEventListener("change", (event) => {
    if (!config) return;
    const minute = timeToMinute((event.target as HTMLInputElement).value);
    if (minute === null) return renderMuteSettings();
    config.notificationMute = { ...config.notificationMute, endMinute: minute };
    save();
  });
  ($("rulename-input") as HTMLInputElement).addEventListener("input", (e) => {
    if (!config) return;
    const rule = config.rules[editingRuleIndex];
    if (!rule) return;
    const v = (e.target as HTMLInputElement).value.trim();
    rule.name = v === "" ? null : v;
    save();
    renderRules();
  });
  ($("webhook-input") as HTMLInputElement).addEventListener("input", (e) => {
    if (!config) return;
    const v = (e.target as HTMLInputElement).value.trim();
    config.discordWebhookUrl = v === "" ? null : v;
    save();
  });
  ($("minremain-input") as HTMLInputElement).addEventListener("change", (e) => {
    if (!config) return;
    config.minRemainingSecs = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
    save();
  });
  ($("poll-input") as HTMLInputElement).addEventListener("change", (e) => {
    if (!config) return;
    config.pollIntervalSecs = Math.max(30, Number((e.target as HTMLInputElement).value) || 60);
    save();
    renderStatusbar();
  });

  // どこでも打鍵でパレット起動(入力欄フォーカス時を除く)。MAN-003
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    const inField =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable;
    const composing = paletteComposing || e.isComposing || e.key === "Process" || e.keyCode === 229;

    // Cmd+1..9 and Ctrl(+Shift)+Tab are browser-style content navigation.
    // Editable fields and IME composition retain their native key handling.
    if (handleContentTabShortcut(e, paletteRenaming || composing)) {
      if (paletteOpen) closePalette();
      return;
    }

    // Ctrl+1..9 is reserved for edit focus. Meta+digits belong to content tabs.
    const digitCombo =
      e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      /^Digit([1-9])$/.exec(e.code);
    const paletteSearchFocused = paletteOpen && target === $("palette-input");
    if (digitCombo && !paletteRenaming && (!inField || paletteSearchFocused) && !composing) {
      const index = Number(digitCombo[1]) - 1;
      if (config && index < config.rules.length) {
        e.preventDefault();
        void focusRule(index).then(() => {
          if (paletteOpen) return paletteQuery();
        });
      }
      return;
    }
    if (!paletteOpen) {
      const plainKey = !e.metaKey && !e.ctrlKey && !e.altKey;
      // 一覧画面のSpaceは編集中ルールのVIEW選択トグル(パレットは開かない)。RND-001
      if (!inField && plainKey && e.key === " ") {
        e.preventDefault();
        void applyCand("action:toggle-rule");
        return;
      }
      // 一覧画面の↑/↓はedit focusを前後のルールへ巡回移動する。RND-001
      if (!inField && plainKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        void focusRule(editingRuleIndex + (e.key === "ArrowDown" ? 1 : -1));
        return;
      }
      // macOS IMEは最初のkeydownをProcess/229として送ることがある。
      // 既定動作を止めず先にinputへフォーカスし、compositionを継続させる。
      if (!inField && plainKey && (e.isComposing || e.key === "Process" || e.keyCode === 229)) {
        openPalette("");
        return;
      }
      if (!inField && plainKey && e.key.length === 1 && e.key !== " ") {
        e.preventDefault();
        openPalette(e.key);
      }
      return;
    }
    // 変換確定のEnterを候補適用として扱わない。
    if (paletteComposing || e.isComposing || e.key === "Process" || e.keyCode === 229) return;
    if (paletteRenaming) {
      // 改名モード: Enterで保存、Escで保存せず通常モードへ戻る(パレットは閉じない)
      if (e.key === "Enter") {
        e.preventDefault();
        void commitRename();
      } else if (e.key === "Escape") {
        e.preventDefault();
        exitRenameMode();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    } else if (e.key === "Enter") {
      e.preventDefault();
      paletteApply();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      paletteSel = Math.min(paletteSel + 1, Math.max(0, Math.min(paletteResults.length, PALETTE_MAX) - 1));
      renderPalette();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      paletteSel = Math.max(0, paletteSel - 1);
      renderPalette();
    }
  });
  const paletteInput = $("palette-input") as HTMLInputElement;
  paletteInput.addEventListener("compositionstart", () => {
    paletteComposing = true;
  });
  paletteInput.addEventListener("compositionend", () => {
    paletteComposing = false;
    paletteSel = 0;
    paletteQuery();
  });
  paletteInput.addEventListener("input", () => {
    if (paletteComposing || paletteRenaming) return;
    paletteSel = 0;
    paletteQuery();
  });
  $("palette-overlay").addEventListener("click", (e) => {
    if (e.target === $("palette-overlay")) closePalette();
  });

  setInterval(() => {
    tickTimers();
    tickStatusbar();
  }, 1000);
}

window.addEventListener("DOMContentLoaded", init);
