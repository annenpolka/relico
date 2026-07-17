import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// WDIO E2Eビルド(VITE_E2E=1)だけwdio frontend pluginを読み込む。通常ビルドでは除去される
if (import.meta.env.VITE_E2E) {
  void import("@wdio/tauri-plugin");
}
import { candidateGlyphHtml, glyphHtml, planetForFissure } from "./icons";
import type {
  AppConfig,
  ApplyResult,
  CandView,
  Facet,
  Fissure,
  StatusSnapshot,
  WatchRule,
} from "./types";

let config: AppConfig | null = null;
let status: StatusSnapshot | null = null;
let autostart = false;
let editingRuleIndex = 0;
let catalogView: CandView[] = []; // q="" の全候補(レール描画用)
let nextRefresh = 0;
// facet絞りlauncherの対象5軸(actionとruleトグル候補は対象外)
type RuleFacet = Exclude<Facet, "action" | "rule">;
let railTab: "filters" | "delivery" = "filters";
let paletteFacet: RuleFacet | null = null;

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
      railMsg(`保存失敗: ${e}`, "err");
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
    config = res.config;
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
    config = await invoke<AppConfig>("set_rule_enabled", { index, enabled });
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
    config = await invoke<AppConfig>("set_rule_notify", { index, notify });
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
  const tiers = r.tiers.length ? r.tiers.map((t) => t.toUpperCase()).join("+") : "ALL";
  const mode = r.mode === "SteelPath" ? "鋼" : r.mode === "Normal" ? "通常" : "両方";
  let s = `${tiers}/${mode}`;
  if (r.missionTypes.length) s += `/M${r.missionTypes.length}`;
  if (r.planets.length) s += `/P${r.planets.length}`;
  if (r.storms === "Include") s += "/+STORM";
  if (r.storms === "Only") s += "/STORM ONLY";
  return s;
}

function renderRules() {
  const box = $("rules-list");
  const rules = config?.rules ?? [];
  const viewCount = rules.filter((rule) => rule.enabled).length;
  $("rules-meta").textContent = `${viewCount}/${rules.length} VIEW`;
  // NEWゴースト行は静的な#rule-newノードを流用し、リスト末尾へ置き直す(リスナー維持)
  const ghost = $("rule-new");
  if (!rules.length) {
    $("editing-meta").textContent = "NO RULE";
    const p = document.createElement("p");
    p.className = "norules";
    p.textContent = "NO RULES";
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
        `${r.enabled ? "一覧表示から外す" : "一覧表示に含める"}: ルール R${i + 1}`,
      );
      toggle.title = r.enabled
        ? "VIEW ON — クリックで一覧表示から外す"
        : "VIEW OFF — クリックで一覧表示に含める";
      toggle.addEventListener("click", () => setRuleEnabled(i, !r.enabled));

      const edit = document.createElement("button");
      edit.className = "rule-edit";
      edit.type = "button";
      // 名前があれば要約より優先して表示する(要約はtooltipに残す)
      edit.innerHTML = `<span class="rno">R${i + 1}</span><span class="rule-summary">${esc(r.name ?? summarize(r))}</span>`;
      if (focused) edit.setAttribute("aria-current", "true");
      edit.setAttribute("aria-label", `ルール ${r.name ?? `R${i + 1}`} を編集対象にする: ${summarize(r)}`);
      edit.title = `${summarize(r)} — クリックして編集対象にする`;
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
        `${r.notify ? "通知を無効にする" : "通知を有効にする"}: ルール R${i + 1}`,
      );
      notifyBtn.title = r.notify
        ? "NOTIFY ON — クリックで通知対象から外す"
        : "NOTIFY OFF — クリックで通知対象に含める";
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
  $("rule-del").innerHTML = `${glyphHtml("action", "delete-rule")}<span>DEL${editingIndex === null ? "" : ` R${editingIndex + 1}`}</span>`;
  $("clear-btn").innerHTML = `${glyphHtml("action", "clear")}<span>CLEAR</span>`;
  $("rule-del").title = "編集中ルールを削除(2度押しで実行)";
  $("clear-btn").title = "ルール構成を既定(全対象1本)に戻す(2度押しで実行)";
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
  btn.innerHTML = `<span>SURE?</span>`;
  armTimer = setTimeout(() => {
    renderRuleButtons(config?.rules.length ? editingRuleIndex : null);
  }, 2000);
}

const FACET_LABELS: Record<RuleFacet, string> = {
  tier: "TIER",
  mode: "MODE",
  storm: "STORM",
  mission: "MISSION",
  planet: "PLANET",
};

function renderFacetLauncher(containerId: string, facet: RuleFacet) {
  const button = $<HTMLButtonElement>(containerId);
  const selected = catalogView.filter((c) => c.facet === facet && c.on);
  const summary =
    selected.length === 0
      ? "ALL"
      : selected.length <= 2
        ? selected.map((c) => c.label.toUpperCase()).join(" + ")
        : `${selected[0].label.toUpperCase()} +${selected.length - 1}`;
  const full = selected.length ? selected.map((c) => c.label).join(", ") : "All";
  const icon =
    selected.length === 1
      ? candidateGlyphHtml(facet, selected[0].id)
      : candidateGlyphHtml(facet, `${facet}:`);

  button.innerHTML = `<span class="facet-name">${FACET_LABELS[facet]}</span><span class="facet-icon">${icon}</span><span class="facet-value">${esc(summary)}</span><span class="facet-arrow">›</span>`;
  button.title = `${FACET_LABELS[facet]}: ${full}`;
  button.setAttribute("aria-label", `${FACET_LABELS[facet]}を編集。現在値: ${full}`);
  button.setAttribute("aria-haspopup", "dialog");
  button.onclick = () => openPalette("", facet);
}

function setCheck(id: string, on: boolean) {
  const btn = $(id);
  btn.classList.toggle("off", !on);
  const box = btn.querySelector(".box");
  if (box) box.textContent = `[${on ? "x" : " "}]`;
}

function renderRail() {
  if (!config) return;
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
  nameInput.placeholder = editingRule ? `RULE NAME (R${editingRuleIndex + 1})` : "RULE NAME";
  if (document.activeElement !== nameInput) {
    nameInput.value = editingRule?.name ?? "";
  }

  ($("webhook-input") as HTMLInputElement).value = config.discordWebhookUrl ?? "";
  ($("minremain-input") as HTMLInputElement).value = String(config.minRemainingSecs);
  ($("poll-input") as HTMLInputElement).value = String(config.pollIntervalSecs);

  const pauseBtn = $("pause-btn");
  pauseBtn.textContent = config.paused ? "RESUME" : "PAUSE";
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
  document.querySelectorAll<HTMLTableCellElement>("thead th[scope=col]").forEach((th) => {
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
  document.querySelectorAll<HTMLTableCellElement>("thead th[scope=col]").forEach((th) => {
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
        ? "API UNREACHABLE — BACKING OFF"
        : status?.lastPoll
          ? "NO MATCHING FISSURES — ADJUST RULES"
          : "WAITING FOR WORLDSTATE…";
    rows.innerHTML = `<tr><td colspan="7" class="empty">${msg}</td></tr>`;
    return;
  }
  rows.replaceChildren(
    ...fissures.map((f) => {
      const tr = document.createElement("tr");
      const difficulty = f.isHard ? "SteelPath" : "Normal";
      const mode = `<span class="flag ${f.isHard ? "t-hard" : "t-normal"}">${glyphHtml("difficulty", difficulty)}<span>${f.isHard ? "HARD" : "NORMAL"}</span></span>`;
      const storm = f.isStorm
        ? `<span class="flag t-storm">${glyphHtml("storm", "Only")}<span>STORM</span></span>`
        : `<span class="t-no-storm">—</span>`;
      const planet = planetForFissure(f.planet, f.isStorm);
      tr.title = [
        f.tier.toUpperCase(),
        f.node,
        f.missionType.toUpperCase(),
        f.enemy.toUpperCase(),
        f.isHard ? "HARD" : "NORMAL",
        f.isStorm ? "STORM" : "NO STORM",
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

// ---- ステータスバー ----
function renderStatusbar() {
  if (!status) return;
  $("sb-poll").textContent = `POLL ${config?.pollIntervalSecs ?? "--"}s`;
  const api = $("sb-api");
  if (status.paused) {
    api.textContent = "PAUSED";
    api.className = "err";
  } else if (status.apiOk) {
    api.textContent = "API OK";
    api.className = "ok";
  } else {
    api.textContent = "API ERR";
    api.className = "err";
  }
  $("sb-notified").textContent = `ATTEMPTED TODAY: ${status.notifiedToday}`;
  renderWatchLine();
}

function renderWatchLine() {
  if (!config) return;
  const total = config.rules.length;
  const notifying = config.rules.filter((rule) => rule.notify);
  $("sb-watch").textContent =
    notifying.length === 0
      ? "WATCH: NO NOTIFICATION RULES"
      : notifying.length === 1 && total === 1
        ? `WATCH: ${summarize(notifying[0])}`
        : notifying.length === total
          ? `WATCH: ${notifying.length} RULES`
          : `WATCH: ${notifying.length}/${total} RULES`;
}

function tickStatusbar() {
  const el = $("sb-next");
  if (status?.paused) {
    el.textContent = "NEXT REFRESH --";
    return;
  }
  nextRefresh = Math.max(0, nextRefresh - 1);
  el.textContent = `NEXT REFRESH ${nextRefresh}s`;
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
    ? `EDIT R${index + 1}/${rules.length} · VIEW ${rules[index].enabled ? "ON" : "OFF"} · NOTIFY ${rules[index].notify ? "ON" : "OFF"}${paletteFacet ? ` · ${FACET_LABELS[paletteFacet]}` : ""}`
    : "NO RULES";
  const box = $("palette-cands");
  if (!paletteResults.length) {
    box.innerHTML = `<div class="cand none">NO MATCH</div>`;
    return;
  }
  box.replaceChildren(
    ...paletteResults.slice(0, PALETTE_MAX).map((c, i) => {
      const div = document.createElement("div");
      div.className = `cand${c.on ? "" : " off"}${i === paletteSel ? " sel" : ""}`;
      const label = c.via ? esc(c.label) : hl(c.label, c.indices);
      const via = c.via ? `<span class="via">⌁ ${hl(c.via, c.indices)}</span>` : "";
      div.innerHTML = `<span class="box">[${c.on ? "x" : " "}]</span>${candidateGlyphHtml(c.facet, c.id)}<span class="label">${label}</span>${via}<span class="facet">${c.facet.toUpperCase()}</span>`;
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
  input.placeholder = `RENAME R${editingRuleIndex + 1}…`;
  input.select();
  $("palette-rule").textContent = `RENAME R${editingRuleIndex + 1}`;
  $("palette-cands").innerHTML =
    `<div class="cand none">新しい名前を入力して⏎(空欄で名前解除 / ESCで戻る)</div>`;
}

function exitRenameMode() {
  paletteRenaming = false;
  const input = $("palette-input") as HTMLInputElement;
  input.value = "";
  input.placeholder = paletteFacet ? `SEARCH ${FACET_LABELS[paletteFacet]}…` : "SEARCH ALL FILTERS…";
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
      railMsg(`保存失敗: ${e}`, "err");
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
  input.placeholder = facet ? `SEARCH ${FACET_LABELS[facet]}…` : "SEARCH ALL FILTERS…";
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
    config = await invoke<AppConfig>("clear_filter");
    editingRuleIndex = 0;
    await refreshCatalog();
    renderRail();
    renderStatusbar();
    railMsg("ルールを既定に戻した", "ok");
  } catch (e) {
    railMsg(String(e), "err");
  }
}

// ---- 初期化 ----
async function init() {
  config = await invoke<AppConfig>("get_config");
  status = await invoke<StatusSnapshot>("get_status");
  autostart = await invoke<boolean>("get_autostart").catch(() => false);
  editingRuleIndex = 0;
  await refreshCatalog();
  nextRefresh = status.nextPollSecs;
  renderRail();
  renderTable();
  renderStatusbar();

  await listen<StatusSnapshot>("status", (event) => {
    status = event.payload;
    nextRefresh = status.nextPollSecs;
    renderTable();
    renderStatusbar();
  });

  // トレイのPAUSE等、フロント外からの設定変更に追随する
  await listen<AppConfig>("config", async (event) => {
    config = event.payload;
    editingRuleIndex = Math.max(0, Math.min(editingRuleIndex, config.rules.length - 1));
    await refreshCatalog();
    renderRail();
    renderTable();
    renderStatusbar();
  });

  initSortHeaders();
  $("rule-new").innerHTML = `${glyphHtml("action", "new-rule")}<span>NEW RULE</span>`;
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
      railMsg(`AUTOSTART失敗: ${e}`, "err");
    }
  });
  $("test-btn").addEventListener("click", async () => {
    railMsg("REQUESTING…");
    try {
      await flushSave();
      railMsg(await invoke<string>("test_notification"), "ok");
    } catch (e) {
      railMsg(String(e), "err");
    }
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
    // Cmd/Ctrl+1..9: 対応indexのルールへedit focusを移す(一覧・パレット共通)。RND-001
    const digitCombo = (e.metaKey || e.ctrlKey) && !e.altKey && /^Digit([1-9])$/.exec(e.code);
    if (digitCombo && !paletteRenaming) {
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
      const t = e.target as HTMLElement;
      const inField = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
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
