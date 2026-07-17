// Rust側(config.rs / model.rs / poller.rs / commands.rs)のserde camelCase表現をミラーする。
// 判定・スコアリングのロジックはRust側にのみ存在する。ここは型だけ。

export type Mode = "Normal" | "SteelPath" | "Both";
export type StormMode = "Exclude" | "Include" | "Only";
export type Facet = "tier" | "mission" | "planet" | "mode" | "storm" | "action" | "rule";

export interface WatchRule {
  /** 一覧のVIEWフィルタへ参加するか。通知参加とは独立 */
  enabled: boolean;
  /** 通知へ参加するか。VIEW選択(enabled)とは独立 */
  notify: boolean;
  /** 表示用の任意名。判定・通知projectionには関与しない */
  name: string | null;
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
  /** VIEW選択ルールに合致する亀裂。VIEW未選択では全件。消滅が近い順 */
  fissures: Fissure[];
  /** 通知参加ルールに合致する次の亀裂。VIEW結果とは独立 */
  nextNotification: Fissure | null;
  apiOk: boolean;
  lastError: string | null;
  lastPoll: string | null;
  nextPollSecs: number;
  notifiedToday: number;
  paused: boolean;
}

/** パレット候補(on状態は編集中ルール基準。RULE候補はVIEW選択を表す) */
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
