import type { MessageKey } from "./i18n";

export const CONTENT_TAB_IDS = [
  "fissures",
  "arbitration",
  "sortie",
  "archon",
  "syndicates",
  "area-missions",
  "circuit",
  "archimedea",
  "descendia",
] as const;

export type ContentTabId = (typeof CONTENT_TAB_IDS)[number];

export const CONTENT_TABS: ReadonlyArray<{ id: ContentTabId; labelKey: MessageKey }> = [
  { id: "fissures", labelKey: "tabs.fissures" },
  { id: "arbitration", labelKey: "tabs.arbitration" },
  { id: "sortie", labelKey: "tabs.sortie" },
  { id: "archon", labelKey: "tabs.archon" },
  { id: "syndicates", labelKey: "tabs.syndicates" },
  { id: "area-missions", labelKey: "tabs.areaMissions" },
  { id: "circuit", labelKey: "tabs.circuit" },
  { id: "archimedea", labelKey: "tabs.archimedea" },
  { id: "descendia", labelKey: "tabs.descendia" },
];

let activeTab: ContentTabId = "fissures";
let onChange: ((tab: ContentTabId) => void) | undefined;

function tabButton(id: ContentTabId): HTMLButtonElement | null {
  return document.getElementById(`tab-${id}`) as HTMLButtonElement | null;
}

function tabPanel(id: ContentTabId): HTMLElement | null {
  return document.getElementById(`panel-${id}`);
}

export function getActiveContentTab(): ContentTabId {
  return activeTab;
}

export function activateContentTab(id: ContentTabId, focus = false): void {
  activeTab = id;
  for (const candidate of CONTENT_TAB_IDS) {
    const selected = candidate === id;
    const button = tabButton(candidate);
    const panel = tabPanel(candidate);
    if (button) {
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle("active", selected);
    }
    if (panel) panel.hidden = !selected;
  }

  const selectedButton = tabButton(id);
  selectedButton?.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (focus) selectedButton?.focus();
  onChange?.(id);
}

function offsetTab(offset: number, focus: boolean): void {
  const current = CONTENT_TAB_IDS.indexOf(activeTab);
  const next = (current + offset + CONTENT_TAB_IDS.length) % CONTENT_TAB_IDS.length;
  activateContentTab(CONTENT_TAB_IDS[next], focus);
}

function onTabKeydown(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
  const origin = (event.currentTarget as HTMLElement | null)?.dataset.tabId;
  const originIndex = CONTENT_TAB_IDS.indexOf(origin as ContentTabId);
  const current = originIndex >= 0 ? originIndex : CONTENT_TAB_IDS.indexOf(activeTab);
  let next: ContentTabId | null = null;
  if (event.key === "ArrowRight") {
    next = CONTENT_TAB_IDS[(current + 1) % CONTENT_TAB_IDS.length];
  } else if (event.key === "ArrowLeft") {
    next = CONTENT_TAB_IDS[
      (current - 1 + CONTENT_TAB_IDS.length) % CONTENT_TAB_IDS.length
    ];
  } else if (event.key === "Home") {
    next = CONTENT_TAB_IDS[0];
  } else if (event.key === "End") {
    next = CONTENT_TAB_IDS[CONTENT_TAB_IDS.length - 1];
  }
  if (!next) return;
  event.preventDefault();
  activateContentTab(next, true);
}

/** あふれている側だけedge fadeヒントを付け、スクロール可能な方向を示す(RND-010) */
function updateTabOverflowHints(tablist: HTMLElement): void {
  // リサイズ時のscrollLeftクランプはscrollイベントを発火しないことがあるため、
  // 収まっている場合はscrollLeftに依らず両ヒントを外す
  const overflowing = tablist.scrollWidth > tablist.clientWidth + 1;
  tablist.classList.toggle("scrolled-start", overflowing && tablist.scrollLeft > 1);
  tablist.classList.toggle(
    "scrolled-end",
    overflowing && tablist.scrollLeft + tablist.clientWidth < tablist.scrollWidth - 1,
  );
}

export function initContentTabs(change?: (tab: ContentTabId) => void): void {
  onChange = change;
  for (const { id } of CONTENT_TABS) {
    const button = tabButton(id);
    if (!button) continue;
    button.addEventListener("click", () => activateContentTab(id));
    button.addEventListener("keydown", onTabKeydown);
  }
  const tablist = document.getElementById("content-tabs");
  if (tablist) {
    const update = () => updateTabOverflowHints(tablist);
    tablist.addEventListener("scroll", update, { passive: true });
    // resize直後はflex再レイアウト前のことがあるため、次フレームでも再評価する
    window.addEventListener("resize", () => {
      update();
      requestAnimationFrame(update);
    });
    update();
  }
  activateContentTab("fissures");
}

function targetIsEditable(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element?.isContentEditable === true
  );
}

/**
 * macOSブラウザ風のglobal tab shortcut。Ctrl+数字は既存rule focus用に予約する。
 * input/IME中は奪わず、処理した場合だけtrueを返す。
 */
export function handleContentTabShortcut(event: KeyboardEvent, blocked = false): boolean {
  if (blocked || event.isComposing || targetIsEditable(event.target)) return false;

  const digit = /^Digit([1-9])$/.exec(event.code);
  if (event.metaKey && !event.ctrlKey && !event.altKey && digit) {
    const index = Number(digit[1]) - 1;
    if (index >= CONTENT_TAB_IDS.length) return false;
    event.preventDefault();
    activateContentTab(CONTENT_TAB_IDS[index]);
    return true;
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
    event.preventDefault();
    offsetTab(event.shiftKey ? -1 : 1, false);
    return true;
  }
  return false;
}
