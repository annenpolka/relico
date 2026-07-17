// Rust側(config.rs / model.rs / poller.rs / commands.rs)のserde camelCase表現をミラーする。
// 判定・スコアリングのロジックはRust側にのみ存在する。ここは型だけ。

export type Mode = "Normal" | "SteelPath" | "Both";
export type StormMode = "Exclude" | "Include" | "Only";
export type Facet = "tier" | "mission" | "planet" | "mode" | "storm" | "action";

export interface WatchRule {
  enabled: boolean;
  tiers: string[];
  missionTypes: string[];
  planets: string[];
  mode: Mode;
  storms: StormMode;
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
  /** Rustの既存extract_planetでnodeから抽出した表示用の惑星名 */
  planet: string | null;
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

/** パレット候補(on状態は編集中ルール基準。runtime enabledとは独立) */
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
