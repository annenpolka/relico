import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppConfig, ApplyResult, CandView, Facet, StatusSnapshot, WatchRule } from "./types";

let config: AppConfig | null = null;
let status: StatusSnapshot | null = null;
let autostart = false;
let active = 0;
let catalogView: CandView[] = []; // q="" の全候補(レール描画用)
let nextRefresh = 0;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function railMsg(text: string, kind: "ok" | "err" | "" = "") {
  const el = $("rail-msg");
  el.textContent = text;
  el.className = kind;
}

// ---- 設定の保存(パレット外の項目: 通知先・間隔など) ----
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  if (!config) return;
  clearTimeout(saveTimer);
  const snapshot = { ...config };
  saveTimer = setTimeout(async () => {
    try {
      await invoke("set_config", { config: snapshot });
    } catch (e) {
      railMsg(`保存失敗: ${e}`, "err");
    }
  }, 300);
}

// ---- パレット候補の適用(ルール編集はすべてこの経路 = SAT-001の解決を通る) ----
async function refreshCatalog() {
  catalogView = await invoke<CandView[]>("query_candidates", { q: "", active });
}

async function applyCand(id: string) {
  try {
    const res = await invoke<ApplyResult>("apply_candidate", { id, active });
    config = res.config;
    active = res.active;
    await refreshCatalog();
    renderRail();
    renderStatusbar();
  } catch (e) {
    railMsg(String(e), "err");
  }
}

// ---- ルール一覧 ----
function summarize(r: WatchRule): string {
  const tiers = r.tiers.length ? r.tiers.map((t) => t.toUpperCase()).join("+") : "ALL";
  const mode = r.mode === "SteelPath" ? "鋼" : r.mode === "Normal" ? "通常" : "両方";
  let s = `${tiers}/${mode}`;
  if (r.missionTypes.length) s += `/M${r.missionTypes.length}`;
  if (r.planets.length) s += `/P${r.planets.length}`;
  if (r.includeStorms) s += "/STORM";
  return s;
}

function renderRules() {
  const box = $("rules-list");
  const rules = config?.rules ?? [];
  if (!rules.length) {
    box.innerHTML = `<p class="norules">NO RULES</p>`;
    return;
  }
  box.replaceChildren(
    ...rules.map((r, i) => {
      const btn = document.createElement("button");
      btn.className = `rule${i === active ? " on" : ""}`;
      btn.innerHTML = `<span class="rno">R${i + 1}</span> ${esc(summarize(r))}`;
      btn.addEventListener("click", async () => {
        active = i;
        await refreshCatalog();
        renderRail();
      });
      return btn;
    }),
  );
}

function renderChecksFromCatalog(containerId: string, facets: Facet[]) {
  const container = $(containerId);
  const items = catalogView.filter((c) => facets.includes(c.facet));
  container.replaceChildren(
    ...items.map((c) => {
      const btn = document.createElement("button");
      btn.className = `check${c.on ? "" : " off"}`;
      btn.innerHTML = `<span class="box">[${c.on ? "x" : " "}]</span> ${esc(c.label.toUpperCase())}`;
      btn.addEventListener("click", () => applyCand(c.id));
      return btn;
    }),
  );
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
  renderChecksFromCatalog("tier-checks", ["tier"]);
  renderChecksFromCatalog("mode-checks", ["mode", "toggle"]);
  renderChecksFromCatalog("mission-checks", ["mission"]);
  renderChecksFromCatalog("planet-checks", ["planet"]);

  setCheck("desktop-check", config.desktopNotification);
  setCheck("autostart-check", autostart);

  ($("webhook-input") as HTMLInputElement).value = config.discordWebhookUrl ?? "";
  ($("minremain-input") as HTMLInputElement).value = String(config.minRemainingSecs);
  ($("poll-input") as HTMLInputElement).value = String(config.pollIntervalSecs);

  const pauseBtn = $("pause-btn");
  pauseBtn.textContent = config.paused ? "RESUME" : "PAUSE";
  pauseBtn.classList.toggle("hot", config.paused);

  renderWatchLine();
}

// ---- テーブル ----
function renderTable() {
  const rows = $("fissure-rows");
  // 表示されるのは合致亀裂のみ(SPEC: VIS-001)
  const fissures = status?.fissures ?? [];
  if (fissures.length === 0) {
    const msg =
      status?.apiOk === false
        ? "API UNREACHABLE — BACKING OFF"
        : status?.lastPoll
          ? "NO MATCHING FISSURES — ADJUST RULES"
          : "WAITING FOR WORLDSTATE…";
    rows.innerHTML = `<tr><td colspan="6" class="empty">${msg}</td></tr>`;
    return;
  }
  rows.replaceChildren(
    ...fissures.map((f) => {
      const tr = document.createElement("tr");
      const flags = [
        f.isHard ? `<span class="t-hard">HARD</span>` : "",
        f.isStorm ? `<span class="t-storm">STORM</span>` : "",
      ]
        .filter(Boolean)
        .join(" ");
      tr.innerHTML = `
        <td class="t-tier">${esc(f.tier.toUpperCase())}</td>
        <td>${esc(f.node)}</td>
        <td>${esc(f.missionType.toUpperCase())}</td>
        <td class="t-mute">${esc(f.enemy.toUpperCase())}</td>
        <td class="t-timer" data-expiry="${f.expiry}">--:--</td>
        <td>${flags}</td>`;
      return tr;
    }),
  );
  tickTimers();
}

function tickTimers() {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>(".t-timer").forEach((el) => {
    const expiry = Date.parse(el.dataset.expiry ?? "");
    const rest = Math.max(0, Math.floor((expiry - now) / 1000));
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
  $("sb-notified").textContent = `NOTIFIED TODAY: ${status.notifiedToday}`;
  renderWatchLine();
}

function renderWatchLine() {
  if (!config) return;
  const n = config.rules.length;
  $("sb-watch").textContent =
    n === 0 ? "WATCH: NO RULES" : n === 1 ? `WATCH: ${summarize(config.rules[0])}` : `WATCH: ${n} RULES`;
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
let paletteSel = 0;
let paletteResults: CandView[] = [];
const PALETTE_MAX = 12;

function hl(text: string, indices: number[]): string {
  const set = new Set(indices);
  return Array.from(text)
    .map((ch, i) => (set.has(i) ? `<span class="hl">${esc(ch)}</span>` : esc(ch)))
    .join("");
}

async function paletteQuery() {
  const q = ($("palette-input") as HTMLInputElement).value;
  paletteResults = await invoke<CandView[]>("query_candidates", { q, active });
  paletteSel = Math.min(paletteSel, Math.max(0, Math.min(paletteResults.length, PALETTE_MAX) - 1));
  renderPalette();
}

function renderPalette() {
  const rules = config?.rules ?? [];
  $("palette-rule").textContent = rules.length ? `RULE ${Math.min(active, rules.length - 1) + 1}/${rules.length}` : "NO RULES";
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
      div.innerHTML = `<span class="box">[${c.on ? "x" : " "}]</span><span class="label">${label}</span>${via}<span class="facet">${c.facet.toUpperCase()}</span>`;
      div.addEventListener("click", () => {
        paletteSel = i;
        paletteApply();
      });
      return div;
    }),
  );
}

async function paletteApply() {
  const c = paletteResults[paletteSel];
  if (!c) return;
  await applyCand(c.id);
  const input = $("palette-input") as HTMLInputElement;
  input.value = ""; // 連続入力: 開いたままクエリだけリセット
  paletteSel = 0;
  await paletteQuery();
}

function openPalette(seed: string) {
  paletteOpen = true;
  $("palette-overlay").hidden = false;
  const input = $("palette-input") as HTMLInputElement;
  input.value = seed;
  paletteSel = 0;
  input.focus();
  paletteQuery();
}

function closePalette() {
  paletteOpen = false;
  $("palette-overlay").hidden = true;
  ($("palette-input") as HTMLInputElement).blur();
}

// ---- 初期化 ----
async function init() {
  config = await invoke<AppConfig>("get_config");
  status = await invoke<StatusSnapshot>("get_status");
  autostart = await invoke<boolean>("get_autostart").catch(() => false);
  active = 0;
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
    active = Math.max(0, Math.min(active, config.rules.length - 1));
    await refreshCatalog();
    renderRail();
    renderStatusbar();
  });

  $("rule-new").addEventListener("click", () => applyCand("action:new-rule"));
  $("rule-del").addEventListener("click", () => applyCand("action:delete-rule"));
  $("clear-btn").addEventListener("click", async () => {
    try {
      config = await invoke<AppConfig>("clear_filter");
      active = 0;
      await refreshCatalog();
      renderRail();
      renderStatusbar();
      railMsg("ルールを既定に戻した", "ok");
    } catch (e) {
      railMsg(String(e), "err");
    }
  });
  $("pause-btn").addEventListener("click", () => applyCand("action:pause"));

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
    railMsg("SENDING…");
    try {
      railMsg(await invoke<string>("test_notification"), "ok");
    } catch (e) {
      railMsg(String(e), "err");
    }
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
    if (!paletteOpen) {
      const t = e.target as HTMLElement;
      const inField = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
      if (!inField && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && e.key !== " ") {
        e.preventDefault();
        openPalette(e.key);
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
  $("palette-input").addEventListener("input", () => {
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
