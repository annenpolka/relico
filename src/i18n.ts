import rawCatalogs from "./locales.json";
import type { AppLocale } from "./types";

export const SUPPORTED_LOCALES = ["ja", "en", "zh-Hans"] as const satisfies readonly AppLocale[];
export type MessageKey = keyof (typeof rawCatalogs)["ja"];
export type MessageParams = Record<string, string | number>;

const catalogs: Record<AppLocale, Record<MessageKey, string>> = rawCatalogs;
let activeLocale: AppLocale = "ja";

const CANDIDATE_KEYS: Partial<Record<string, MessageKey>> = {
  "mode:Normal": "candidate.mode.normal",
  "mode:SteelPath": "candidate.mode.steelPath",
  "mode:Both": "candidate.mode.both",
  "storm:Exclude": "candidate.storm.exclude",
  "storm:Include": "candidate.storm.include",
  "storm:Only": "candidate.storm.only",
  "action:new-rule": "candidate.action.newRule",
  "action:delete-rule": "candidate.action.deleteRule",
  "action:rename-rule": "candidate.action.renameRule",
  "action:toggle-rule": "candidate.action.toggleView",
  "action:notify-rule": "candidate.action.toggleNotify",
  "action:deselect-all-rules": "candidate.action.deselectAll",
  "action:clear": "candidate.action.clear",
  "action:pause": "candidate.action.pause",
};

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: unknown): AppLocale {
  return isLocale(value) ? value : "ja";
}

export function getLocale(): AppLocale {
  return activeLocale;
}

export function t(key: MessageKey, params: MessageParams = {}): string {
  const template = catalogs[activeLocale][key] ?? catalogs.ja[key];
  return template.replace(PLACEHOLDER, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token,
  );
}

export function candidateLabel(id: string, fallback: string): string {
  const key = CANDIDATE_KEYS[id];
  return key ? t(key) : fallback;
}

function messageKey(value: string | undefined): MessageKey | null {
  if (!value) return null;
  return Object.prototype.hasOwnProperty.call(catalogs.ja, value) ? (value as MessageKey) : null;
}

function translateAttribute(
  element: HTMLElement,
  dataAttribute: string,
  attribute: "aria-label" | "title" | "placeholder",
): void {
  const rawKey = element.dataset[dataAttribute];
  if (!rawKey) return;
  const key = messageKey(rawKey);
  if (!key) {
    element.dataset.i18nMissing = rawKey;
    element.setAttribute(attribute, `[[${rawKey}]]`);
    return;
  }
  element.removeAttribute("data-i18n-missing");
  element.setAttribute(attribute, t(key));
}

/** data-i18n-*を持つ静的DOMを現在localeへ同期する。動的placeholderは呼出側で上書きする。 */
export function applyDocumentTranslations(root: ParentNode = document): void {
  const textNodes = root.querySelectorAll<HTMLElement>("[data-i18n-key]");
  for (const element of textNodes) {
    const rawKey = element.dataset.i18nKey;
    const key = messageKey(rawKey);
    if (!key) {
      if (rawKey) element.dataset.i18nMissing = rawKey;
      element.textContent = `[[${rawKey ?? "missing"}]]`;
      continue;
    }
    element.removeAttribute("data-i18n-missing");
    element.textContent = t(key);
  }

  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-aria-label-key]")) {
    translateAttribute(element, "i18nAriaLabelKey", "aria-label");
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-title-key]")) {
    translateAttribute(element, "i18nTitleKey", "title");
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-placeholder-key]")) {
    translateAttribute(element, "i18nPlaceholderKey", "placeholder");
  }

  document.title = t("app.title");
}

export function setLocale(locale: AppLocale): void {
  activeLocale = normalizeLocale(locale);
  document.documentElement.lang = activeLocale;
  applyDocumentTranslations();
}

/** 起動時にcatalogの欠落・余剰・placeholder不一致を即座に検出する。 */
export function validateCatalogs(): void {
  const baseKeys = Object.keys(catalogs.ja).sort();
  const placeholders = (value: string) =>
    Array.from(value.matchAll(new RegExp(PLACEHOLDER.source, "g")), (match) => match[1]).sort();

  for (const locale of SUPPORTED_LOCALES) {
    const keys = Object.keys(catalogs[locale]).sort();
    if (keys.join("\u0000") !== baseKeys.join("\u0000")) {
      throw new Error(`i18n key mismatch: ${locale}`);
    }
    for (const key of baseKeys as MessageKey[]) {
      const value = catalogs[locale][key];
      if (!value.trim()) throw new Error(`empty i18n value: ${locale}.${key}`);
      if (placeholders(value).join("\u0000") !== placeholders(catalogs.ja[key]).join("\u0000")) {
        throw new Error(`i18n placeholder mismatch: ${locale}.${key}`);
      }
    }
  }
}

validateCatalogs();
