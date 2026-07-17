// Rust側(config.rs / model.rs / poller.rs / commands.rs)のserde camelCase表現をミラーする。
// 判定・スコアリングのロジックはRust側にのみ存在する。ここは型だけ。

export type Mode = "Normal" | "SteelPath" | "Both";
export type Facet = "tier" | "mission" | "planet" | "mode" | "toggle" | "action";

export interface WatchRule {
  tiers: string[];
  missionTypes: string[];
  planets: string[];
  mode: Mode;
  includeStorms: boolean;
}

export interface AppConfig {
  rules: WatchRule[];
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
  /** いずれかのルールに合致する亀裂のみ(SPEC: VIS-001)。消滅が近い順 */
  fissures: Fissure[];
  apiOk: boolean;
  lastError: string | null;
  lastPoll: string | null;
  nextPollSecs: number;
  notifiedToday: number;
  paused: boolean;
}

/** パレット候補(on状態はアクティブルール基準) */
export interface CandView {
  id: string;
  label: string;
  facet: Facet;
  on: boolean;
  indices: number[];
  via: string | null;
}

export interface ApplyResult {
  config: AppConfig;
  active: number;
}
