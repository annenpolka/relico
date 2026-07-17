// Rust側(config.rs / model.rs / poller.rs)のserde camelCase表現をミラーする。
// 判定ロジックはRust側にのみ存在する。ここは型だけ。

export type Mode = "Normal" | "SteelPath" | "Both";

export interface AppConfig {
  tiers: string[];
  missionTypes: string[];
  planets: string[];
  mode: Mode;
  includeStorms: boolean;
  minRemainingSecs: number;
  pollIntervalSecs: number;
  desktopNotification: boolean;
  discordWebhookUrl: string | null;
  paused: boolean;
}

export interface Fissure {
  id: string;
  activation: string;
  expiry: string;
  node: string;
  missionType: string;
  enemy: string;
  tier: string;
  tierNum: number;
  isStorm: boolean;
  isHard: boolean;
}

export interface StatusSnapshot {
  fissures: Fissure[];
  matchedIds: string[];
  apiOk: boolean;
  lastError: string | null;
  lastPoll: string | null;
  nextPollSecs: number;
  notifiedToday: number;
  paused: boolean;
}

export const TIERS = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"] as const;

export const KNOWN_MISSIONS = [
  "Capture",
  "Extermination",
  "Sabotage",
  "Rescue",
  "Spy",
  "Survival",
  "Defense",
  "Mobile Defense",
  "Excavation",
  "Disruption",
  "Interception",
  "Hijack",
  "Assault",
  "Defection",
  "Infested Salvage",
  "Void Flood",
  "Void Cascade",
  "Void Armageddon",
  "Alchemy",
  "Hive",
  "Skirmish",
  "Volatile",
  "Orphix",
] as const;

export const KNOWN_PLANETS = [
  "Mercury",
  "Venus",
  "Earth",
  "Lua",
  "Mars",
  "Phobos",
  "Deimos",
  "Ceres",
  "Jupiter",
  "Europa",
  "Saturn",
  "Uranus",
  "Neptune",
  "Pluto",
  "Sedna",
  "Eris",
  "Void",
  "Kuva Fortress",
  "Zariman",
  "Earth Proxima",
  "Venus Proxima",
  "Saturn Proxima",
  "Neptune Proxima",
  "Pluto Proxima",
  "Veil Proxima",
] as const;
