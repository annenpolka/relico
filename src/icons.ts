import type { Facet } from "./types";

/**
 * UI専用の小型SVGグリフ。
 *
 * フィルタ意味論はRust側にだけ置き、ここではAPI/カタログ値を視覚表現へ写像する。
 * 文字ラベルは常に併記するため、アイコンは装飾扱い(aria-hidden)にする。
 */
export type GlyphKind = "tier" | "planet" | "mission" | "faction" | "difficulty" | "storm" | "action";

const dot = (x: number, y: number, r = 1.25) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;

const GENERIC: Record<GlyphKind, string> = {
  tier: `<path d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6Z"/>${dot(10, 10, 1.5)}`,
  planet: `<circle cx="9" cy="10" r="5.5"/><path d="M2.5 13.5c3.5 1.2 9.7-.7 15-5"/>`,
  mission: `<path d="M4 4h12v12H4zM7 7h6M7 10h6M7 13h3"/>`,
  faction: `<path d="M10 2.5 16 6v7l-6 4.5L4 13V6Z"/><path d="M7 9h6M10 6v7"/>`,
  difficulty: `<path d="M10 2.5 16 5v4.5c0 3.8-2.4 6.3-6 8-3.6-1.7-6-4.2-6-8V5Z"/>`,
  // 未知値のフォールバック。既知3値(exclude/include/only)と区別するため破線にする
  storm: `<path d="m11.5 2.5-6 8h4l-1 7 6-9h-4z" stroke-dasharray="2.5 2"/>`,
  action: `<circle cx="10" cy="10" r="6.5"/><path d="M7 10h6M10 7v6"/>`,
};

const TIERS: Record<string, string> = {
  lith: `<path d="m10 3 6 12H4Z"/>${dot(10, 11)}`,
  meso: `<rect x="4" y="4" width="12" height="12" rx="2"/>${dot(10, 10)}`,
  neo: `<path d="m10 2.5 7.5 7.5-7.5 7.5L2.5 10Z"/>${dot(10, 10)}`,
  axi: `<path d="m10 2.5 6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5Z"/>${dot(10, 10)}`,
  requiem: `<path d="M10 2.5a7.5 7.5 0 1 0 0 15M10 2.5a7.5 7.5 0 0 1 0 15M10 6v8"/>`,
  omnia: `<circle cx="10" cy="10" r="6"/><path d="M10 1.8v4M10 14.2v4M1.8 10h4M14.2 10h4M4.2 4.2 7 7M13 13l2.8 2.8M15.8 4.2 13 7M7 13l-2.8 2.8"/>${dot(10, 10, 1.6)}`,
};

const PLANETS: Record<string, string> = {
  mercury: `<circle cx="10" cy="10" r="4"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4"/>`,
  venus: `<circle cx="9" cy="9" r="5.5"/><path d="M5 8c2-2 6-2 8 0M6 11c1.8 1.3 4.2 1.3 6 0M9 14.5V18M7 17h4"/>`,
  earth: `<circle cx="10" cy="10" r="7"/><path d="M4 7.5 7 6l2 1.5-.5 2L11 11l-1 3 2 2M13 4.2l-1 2 2 1 1.7-.5"/>`,
  lua: `<path d="M14.5 3.5A7 7 0 1 0 16 14a6 6 0 0 1-7.5-8.5 7 7 0 0 1 6-2Z"/>`,
  mars: `<circle cx="9" cy="11" r="5.5"/><path d="m13 7 4-4M13.5 3H17v3.5M5 12l8-3M7 7l4 8"/>`,
  phobos: `<path d="m5 6 4-3 5 2 3 5-2 5-6 2-5-4Z"/>${dot(8, 8, 1)}${dot(13, 12, 1.3)}`,
  deimos: `<path d="m4 8 3-4 6-1 4 5-1 6-5 3-6-2Z"/>${dot(8, 12, 1.4)}${dot(13, 7, 1)}`,
  ceres: `<circle cx="10" cy="10" r="6"/>${dot(7, 8, 1)}${dot(12.5, 12, 1.4)}<path d="M5 13.5c2-1 6-1 9 .5"/>`,
  jupiter: `<circle cx="10" cy="10" r="7"/><path d="M3.5 7h13M3.2 11h13.6M5 14h10"/>${dot(13, 9, 1.2)}`,
  europa: `<circle cx="10" cy="10" r="6.5"/><path d="M5 5.5c3 2 7 1 10 0M4 10c4-1 8 2 12 0M5 14c3-1 5-1 10 .5"/>`,
  saturn: `<circle cx="10" cy="10" r="4.5"/><path d="M2 12c3.5-5 11.5-7 16-4M2.5 13c4 1.5 11.5-.5 15-5"/>`,
  uranus: `<circle cx="10" cy="10" r="4.5"/><ellipse cx="10" cy="10" rx="7.5" ry="3" transform="rotate(78 10 10)"/>`,
  neptune: `<circle cx="10" cy="10" r="6.5"/><path d="M4 9c2-2 3 2 5 0s3 2 5 0 2 0 2 0M5 13c2-1 3 1 5 0s3 1 5 0"/>`,
  pluto: `<circle cx="9" cy="11" r="5"/>${dot(15.5, 5, 1.4)}<path d="M5 10c2 1 5 1 8-1"/>`,
  sedna: `<path d="m10 3 6 5-2 7-8 1-3-7Z"/><path d="M4 6c4-2 9-2 13 1"/>`,
  eris: `<circle cx="10" cy="10" r="6.5"/><path d="M5 5l10 10M15 5 5 15"/>`,
  void: `<circle cx="10" cy="10" r="6.5"/><path d="M14.5 7.5c-1-3-6-3.5-8-.5-2.2 3.2.5 7.5 4.2 6.5 3-.8 2.8-4.5.2-4.8-1.8-.2-2.4 1.8-1.2 2.6"/>`,
  "kuva fortress": `<path d="m10 2.5 6 3.5v8l-6 3.5L4 14V6Z"/><path d="M7 5v4l3 2 3-2V5M7 15v-3M13 15v-3"/>`,
  zariman: `<path d="m10 2.5 6.5 14L10 14l-6.5 2.5Z"/><path d="M10 6v8M6.5 11h7"/>`,
  veil: `<path d="M2.5 10c2.5-4 5-6 7.5-6s5 2 7.5 6c-2.5 4-5 6-7.5 6s-5-2-7.5-6Z"/><path d="M6 10c1.5-2 3-2.5 4-2.5s2.5.5 4 2.5c-1.5 2-3 2.5-4 2.5S7.5 12 6 10Z"/>${dot(10, 10, 1)}`,
};

const MISSIONS: Record<string, string> = {
  survival: `<path d="M2.5 10h3l1.5-4 3 8 2-5 1.5 3H18"/>`,
  defense: `<path d="M10 2.5 16 5v4.5c0 3.8-2.4 6.3-6 8-3.6-1.7-6-4.2-6-8V5Z"/><path d="M7 10h6"/>`,
  "mobile defense": `<path d="M10 3 15 5v4c0 3-2 5.2-5 6.7C7 14.2 5 12 5 9V5Z"/>${dot(3, 15, 1)}${dot(17, 15, 1)}<path d="M4 14l3-2M16 14l-3-2"/>`,
  capture: `<circle cx="10" cy="10" r="4"/><path d="M10 2v4M10 14v4M2 10h4M14 10h4"/>${dot(10, 10, 1.5)}`,
  extermination: `<path d="M3 3l14 14M17 3 3 17"/><circle cx="10" cy="10" r="4"/>`,
  rescue: `<path d="M6 9V6a4 4 0 0 1 7-2.5M5 9h10v8H5Z"/>${dot(10, 13, 1.3)}`,
  sabotage: `<circle cx="10" cy="10" r="3.5"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3M4.4 4.4l2.1 2.1M13.5 13.5l2.1 2.1M15.6 4.4 4.4 15.6"/>`,
  spy: `<path d="M2.5 10c2.5-4 5-6 7.5-6s5 2 7.5 6c-2.5 4-5 6-7.5 6s-5-2-7.5-6Z"/><circle cx="10" cy="10" r="2.5"/>`,
  disruption: `<path d="m8.5 3-5 7 5 7M11.5 3l5 7-5 7M6 10h8"/>`,
  excavation: `<path d="M8 3h4l1 5-3 9-3-9Z"/><path d="M5 8h10M4 17h12"/>`,
  interception: `<path d="M10 7v10M6 17h8"/>${dot(10, 5, 1.4)}<path d="M6.5 8.5a5 5 0 0 1 0-7M13.5 1.5a5 5 0 0 1 0 7M4 11a8 8 0 0 1 0-12M16-1a8 8 0 0 1 0 12"/>`,
  hijack: `<rect x="3" y="7" width="11" height="7" rx="2"/><path d="M14 9h3l1 2v3h-4M6 14v2M12 14v2M6 4h8M12 2l2 2-2 2"/>`,
  assault: `<path d="m3 5 7 5-7 5M10 5l7 5-7 5"/>`,
  defection: `<path d="M4 3h8v14H4zM8 10h10M15 7l3 3-3 3"/>`,
  "infested salvage": `<path d="M10 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9Z"/><path d="M7 13c1 1 3 1.5 5 0"/>`,
  hive: `<path d="m7 3 3 2v4l-3 2-3-2V5Zm6 6 3 2v4l-3 2-3-2v-4Zm0-6 3 2v4l-3 2-3-2V5Z"/>`,
  alchemy: `<path d="M7 2.5h6M8 2.5v5L4.5 15a2 2 0 0 0 2 2.5h7a2 2 0 0 0 2-2.5L12 7.5v-5M6 13h8"/>`,
  "void flood": `<path d="M2 7c2-2 4 2 6 0s4 2 6 0 4 0 4 0M2 12c2-2 4 2 6 0s4 2 6 0 4 0 4 0M2 16c2-1 4 1 6 0s4 1 6 0 4 0 4 0"/>`,
  "void cascade": `<path d="M5 3v9M10 3v14M15 3v7M3 10l2 2 2-2M8 15l2 2 2-2M13 8l2 2 2-2"/>`,
  "void armageddon": `<path d="m10 2 1.8 5.2L17 5l-2.2 5L18 12l-5.2 1.2L15 18l-5-2.5L5 18l2.2-4.8L2 12l3.2-2L3 5l5.2 2.2Z"/>`,
  volatile: `<path d="M11 2.5c1 4-2 4.5-1 7 1-1.5 3-2 4-3 2 2 3 4 3 6.2a7 7 0 0 1-14 0c0-3.5 2-6.2 5-8.7-.5 3 1 3.5 1.5 4.5C10 6 10 4 11 2.5Z"/>`,
  skirmish: `<path d="M4 3l5 6-2 2-4-1-1-1 4-2-4-3ZM16 3l-5 6 2 2 4-1 1-1-4-2 4-3ZM7 14l3-3 3 3M10 11v7"/>`,
  orphix: `<path d="m10 2.5 6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5Z"/><path d="M5.5 10c1.5-2 3-3 4.5-3s3 1 4.5 3c-1.5 2-3 3-4.5 3s-3-1-4.5-3Z"/>${dot(10, 10, 1.2)}`,
};

const DIFFICULTIES: Record<string, string> = {
  normal: `<circle cx="10" cy="10" r="6.5"/><path d="M7 10h6"/>`,
  steelpath: `<path d="m10 2.5 6.5 5-2.5 8H6l-2.5-8Z"/><path d="M7 10h6M10 7v6"/>`,
  both: `<circle cx="7.5" cy="10" r="4.5"/><path d="M10 5.8a4.5 4.5 0 1 1 0 8.4"/>`,
};

const STORMS: Record<string, string> = {
  exclude: `<path d="m11.5 2.5-6 8h4l-1 7 6-9h-4zM3 3l14 14"/>`,
  include: `<path d="m11.5 2.5-6 8h4l-1 7 6-9h-4z"/>`,
  only: `<circle cx="10" cy="10" r="7.5"/><path d="m11.5 3.5-5.5 7h4l-1 6 5-8h-3z"/>`,
};

const ACTIONS: Record<string, string> = {
  "new-rule": `<circle cx="10" cy="10" r="6.5"/><path d="M10 6v8M6 10h8"/>`,
  "delete-rule": `<circle cx="10" cy="10" r="6.5"/><path d="M6 10h8"/>`,
  "rename-rule": `<path d="m12.5 3 4.5 4.5L7.5 17H3v-4.5Z"/><path d="m10.5 5 4.5 4.5"/>`,
  "toggle-rule": `<rect x="2.5" y="6.5" width="15" height="7" rx="3.5"/><circle cx="13.5" cy="10" r="2"/>`,
  "deselect-all-rules": `<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/><path d="M2.5 2.5 17.5 17.5"/>`,
  "notify-rule": `<path d="M10 3a4.5 4.5 0 0 1 4.5 4.5V11l1.5 2.5H4L5.5 11V7.5A4.5 4.5 0 0 1 10 3Z"/><path d="M8.5 16a1.5 1.5 0 0 0 3 0"/>`,
  "notify-rule-off": `<path d="M10 3a4.5 4.5 0 0 1 4.5 4.5V11l1.5 2.5H4L5.5 11V7.5A4.5 4.5 0 0 1 10 3Z"/><path d="M8.5 16a1.5 1.5 0 0 0 3 0"/><path d="m3.5 3 13 14"/>`,
  clear: `<path d="m4 4 12 12M16 4 4 16"/>`,
  pause: `<circle cx="10" cy="10" r="6.5"/><path d="M8 7v6M12 7v6"/>`,
};

function factionShape(value: string): string {
  if (value.includes("grineer")) {
    return `<path d="M4 8 7 3h6l3 5-2 7-4 2-4-2Z"/><path d="M6 9h8M7 12l3 2 3-2"/>`;
  }
  if (value.includes("corpus")) {
    return `<path d="m10 2.5 7.5 7.5-7.5 7.5L2.5 10Z"/><rect x="7" y="7" width="6" height="6"/>`;
  }
  if (value.includes("infested")) {
    return `<path d="M10 4c3-3 6 0 4 3 4 0 4 5 1 6 2 3-3 5-5 2-2 3-7 1-5-2-3-1-2-6 2-7-2-3 2-6 5-3Z"/>${dot(8, 9, 1)}${dot(12, 12, 1.3)}`;
  }
  if (value.includes("orokin")) {
    return `<circle cx="10" cy="10" r="3"/><path d="M10 2v4M10 14v4M2 10h4M14 10h4M4.3 4.3 7 7M13 13l2.7 2.7M15.7 4.3 13 7M7 13l-2.7 2.7"/>`;
  }
  if (value.includes("corrupted")) {
    return `<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h4l2.5-4 2.5 8 2-4h2"/>`;
  }
  if (value.includes("murmur")) {
    return `<path d="M16 10a6 6 0 1 1-2-4.5M13.5 7.5a4 4 0 1 1-2-1.2M11 9a1.8 1.8 0 1 1-1.5-.8"/>`;
  }
  if (value.includes("sentient")) {
    return `<path d="M10 2.5 14 7l3 1-3 2 1 6-5-3-5 3 1-6-3-2 3-1Z"/>`;
  }
  if (value.includes("narmer")) {
    return `<path d="M10 2.5 16 6v8l-6 3.5L4 14V6Z"/><path d="M5 6.5 10 10l5-3.5M10 10v7"/>`;
  }
  if (value.includes("crossfire")) {
    return `<path d="M3 4l13 12M16 4 3 17M6 3l2 4-2 2-3-2ZM14 3l-2 4 2 2 3-2Z"/>`;
  }
  return GENERIC.faction;
}

function planetShape(value: string): string {
  const isProxima = value.endsWith(" proxima");
  const base = isProxima ? value.slice(0, -" proxima".length) : value;
  const body = PLANETS[value] ?? PLANETS[base] ?? GENERIC.planet;
  const proximaMark = isProxima
    ? `<path d="m15.5 2 .7 1.8L18 4.5l-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" fill="currentColor" stroke="none"/>`
    : "";
  return body + proximaMark;
}

function shapeFor(kind: GlyphKind, value: string): string {
  const key = value.trim().toLowerCase();
  switch (kind) {
    case "tier":
      return TIERS[key] ?? GENERIC.tier;
    case "planet":
      return planetShape(key);
    case "mission":
      return MISSIONS[key] ?? GENERIC.mission;
    case "faction":
      return factionShape(key);
    case "difficulty":
      return DIFFICULTIES[key] ?? GENERIC.difficulty;
    case "storm":
      return STORMS[key] ?? GENERIC.storm;
    case "action":
      return ACTIONS[key] ?? GENERIC.action;
  }
}

export function glyphHtml(kind: GlyphKind, value: string): string {
  return `<svg class="glyph glyph-${kind}" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${shapeFor(kind, value)}</g></svg>`;
}

export function candidateGlyphHtml(facet: Facet, id: string): string {
  const value = id.slice(id.indexOf(":") + 1);
  switch (facet) {
    case "tier":
    case "planet":
    case "mission":
    case "faction":
    case "storm":
    case "action":
      return glyphHtml(facet, value);
    case "mode":
      return glyphHtml("difficulty", value);
    case "rule":
      // ルールトグル候補は汎用アクショングリフで表す
      return glyphHtml("action", "rule");
  }
}

/** Rust側で抽出した惑星値を受け取り、VOID嵐だけProxima表記へ寄せる。 */
export function planetForFissure(planet: string | null, isStorm: boolean): string {
  planet = planet?.trim() ?? "";
  if (isStorm && ["Earth", "Venus", "Saturn", "Neptune", "Pluto", "Veil"].includes(planet)) {
    return `${planet} Proxima`;
  }
  return planet;
}
