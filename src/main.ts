import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppConfig, Fissure, StatusSnapshot } from "./types";
import { KNOWN_MISSIONS, KNOWN_PLANETS, TIERS } from "./types";

let config: AppConfig | null = null;
let status: StatusSnapshot | null = null;
let nextRefresh = 0;
let autostart = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- 設定の保存(300msデバウンス) ----
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

function railMsg(text: string, kind: "ok" | "err" | "" = "") {
  const el = $("rail-msg");
  el.textContent = text;
  el.className = kind;
}

// ---- チェックリスト描画 ----
function renderChecklist(
  containerId: string,
  items: string[],
  selected: string[],
  onToggle: (item: string, on: boolean) => void,
) {
  const container = $(containerId);
  container.replaceChildren(
    ...items.map((item) => {
      const on = selected.includes(item);
      const btn = document.createElement("button");
      btn.className = `check${on ? "" : " off"}`;
      btn.innerHTML = `<span class="box">[${on ? "x" : " "}]</span> ${item.toUpperCase()}`;
      btn.addEventListener("click", () => {
        onToggle(item, !on);
        save();
        renderRail();
        renderTable(); // 合致ハイライトは次回ポーリングで正になるが、見た目の即時性を優先
      });
      return btn;
    }),
  );
}

const MODES: { key: AppConfig["mode"]; label: string }[] = [
  { key: "Normal", label: "NORMAL ONLY" },
  { key: "SteelPath", label: "HARD ONLY" },
  { key: "Both", label: "BOTH" },
];

function renderRail() {
  if (!config) return;
  const cfg = config;

  renderChecklist("tier-checks", [...TIERS], cfg.tiers, (t, on) => {
    cfg.tiers = on ? [...cfg.tiers, t] : cfg.tiers.filter((x) => x !== t);
  });

  // MODEはラジオ動作
  const modeBox = $("mode-checks");
  modeBox.replaceChildren(
    ...MODES.map(({ key, label }) => {
      const on = cfg.mode === key;
      const btn = document.createElement("button");
      btn.className = `check${on ? "" : " off"}`;
      btn.innerHTML = `<span class="box">[${on ? "x" : " "}]</span> ${label}`;
      btn.addEventListener("click", () => {
        cfg.mode = key;
        save();
        renderRail();
      });
      return btn;
    }),
  );

  setCheck("storm-check", cfg.includeStorms);
  setCheck("desktop-check", cfg.desktopNotification);
  setCheck("autostart-check", autostart);

  const missions = union(KNOWN_MISSIONS, observed((f) => f.missionType), cfg.missionTypes);
  renderChecklist("mission-checks", missions, cfg.missionTypes, (m, on) => {
    cfg.missionTypes = on ? [...cfg.missionTypes, m] : cfg.missionTypes.filter((x) => x !== m);
  });

  const planets = union(KNOWN_PLANETS, observed(planetOf), cfg.planets);
  renderChecklist("planet-checks", planets, cfg.planets, (p, on) => {
    cfg.planets = on ? [...cfg.planets, p] : cfg.planets.filter((x) => x !== p);
  });

  ($("webhook-input") as HTMLInputElement).value = cfg.discordWebhookUrl ?? "";
  ($("minremain-input") as HTMLInputElement).value = String(cfg.minRemainingSecs);
  ($("poll-input") as HTMLInputElement).value = String(cfg.pollIntervalSecs);

  const pauseBtn = $("pause-btn");
  pauseBtn.textContent = cfg.paused ? "RESUME" : "PAUSE";
  pauseBtn.classList.toggle("hot", cfg.paused);

  renderWatchLine();
}

function setCheck(id: string, on: boolean) {
  const btn = $(id);
  btn.classList.toggle("off", !on);
  const box = btn.querySelector(".box");
  if (box) box.textContent = `[${on ? "x" : " "}]`;
}

function union(...lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat())];
}

function observed(pick: (f: Fissure) => string | null): string[] {
  return (status?.fissures ?? []).map(pick).filter((x): x is string => !!x);
}

// Rust側 filter::extract_planet と同じ「最後の括弧」規則(表示専用の複製)
function planetOf(f: Fissure): string | null {
  const m = f.node.match(/\(([^)]*)\)[^(]*$/);
  const p = m?.[1]?.trim();
  return p ? p : null;
}

// ---- テーブル描画 ----
function renderTable() {
  const rows = $("fissure-rows");
  const fissures = status?.fissures ?? [];
  if (fissures.length === 0) {
    rows.innerHTML = `<tr><td colspan="6" class="empty">${
      status?.apiOk === false ? "API UNREACHABLE — BACKING OFF" : "WAITING FOR WORLDSTATE…"
    }</td></tr>`;
    return;
  }
  const matched = new Set(status?.matchedIds ?? []);
  rows.replaceChildren(
    ...fissures.map((f) => {
      const tr = document.createElement("tr");
      if (matched.has(f.id)) tr.className = "match";
      const flags = [
        f.isHard ? `<span class="t-hard">HARD</span>` : "",
        f.isStorm ? `<span class="t-storm">STORM</span>` : "",
      ]
        .filter(Boolean)
        .join(" ");
      tr.innerHTML = `
        <td class="t-tier">${f.tier.toUpperCase()}</td>
        <td>${f.node}</td>
        <td>${f.missionType.toUpperCase()}</td>
        <td class="t-mute">${f.enemy.toUpperCase()}</td>
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
  const tiers = config.tiers.length ? config.tiers.join("+") : "ALL TIERS";
  const mode = config.mode === "SteelPath" ? "HARD" : config.mode === "Normal" ? "NORMAL" : "BOTH";
  $("sb-watch").textContent = `WATCH: ${tiers.toUpperCase()} / ${mode}`;
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

// ---- 初期化 ----
async function init() {
  config = await invoke<AppConfig>("get_config");
  status = await invoke<StatusSnapshot>("get_status");
  autostart = await invoke<boolean>("get_autostart").catch(() => false);
  nextRefresh = status.nextPollSecs;
  renderRail();
  renderTable();
  renderStatusbar();

  await listen<StatusSnapshot>("status", (event) => {
    status = event.payload;
    nextRefresh = status.nextPollSecs;
    renderTable();
    renderStatusbar();
    renderRail(); // observed惑星/ミッションの選択肢を追随
  });

  // トレイのPAUSE等、フロント外からの設定変更に追随する
  await listen<AppConfig>("config", (event) => {
    config = event.payload;
    renderRail();
    renderStatusbar();
  });

  $("storm-check").addEventListener("click", () => {
    if (!config) return;
    config.includeStorms = !config.includeStorms;
    save();
    renderRail();
  });
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
  $("pause-btn").addEventListener("click", () => {
    if (!config) return;
    config.paused = !config.paused;
    save();
    renderRail();
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

  setInterval(() => {
    tickTimers();
    tickStatusbar();
  }, 1000);
}

window.addEventListener("DOMContentLoaded", init);
