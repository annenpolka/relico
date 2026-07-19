// Rust側(config.rs / model.rs / poller.rs / commands.rs)のserde camelCase表現をミラーする。
// 判定・スコアリングのロジックはRust側にのみ存在する。ここは型だけ。

export type Mode = "Normal" | "SteelPath" | "Both";
export type StormMode = "Exclude" | "Include" | "Only";
export type Facet =
  | "tier"
  | "mission"
  | "planet"
  | "faction"
  | "mode"
  | "storm"
  | "action"
  | "rule";
export type AppLocale = "ja" | "en" | "zh-Hans";

export interface NotificationMute {
  enabled: boolean;
  /** ローカル時刻の0:00からの分数。時刻区間の判定はRust側だけが行う。 */
  startMinute: number;
  /** ローカル時刻の0:00からの分数。日跨ぎを含む判定はRust側だけが行う。 */
  endMinute: number;
}

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
  /** 陣営(APIのenemy値)。空=全陣営対象 */
  factions: string[];
  mode: Mode;
  storms: StormMode;
}

/** 亀裂以外の時限コンテンツ監視ルール。合致・通知判定はRust側(content_filter.rs)が正本 */
export interface ContentWatchRule {
  notify: boolean;
  name: string | null;
  /** 対象card kind(空=全kind) */
  kinds: string[];
  /** ミッション種別キーワード(空=全種別)。正準化はRust側 */
  missionTypes: string[];
  /** enemy level下限。null=レベル条件なし */
  minEnemyLevel: number | null;
}

export interface AppConfig {
  rules: WatchRule[];
  contentRules: ContentWatchRule[];
  minRemainingSecs: number;
  pollIntervalSecs: number;
  desktopNotification: boolean;
  discordWebhookUrl: string | null;
  paused: boolean;
  locale: AppLocale;
  notificationMute: NotificationMute;
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

export type TimedTemporalStatus = "active" | "upcoming";
export type TimedSourceKind = "official-live" | "community-live" | "community-schedule";
export type TimedSourceId =
  | "wfcd-worldstate"
  | "de-worldstate"
  | "browse-wf-arbitration-schedule"
  | "browse-wf-bounty-cycle"
  | "browse-wf-location-bounties"
  | "browse-wf-export-bounties"
  | "browse-wf-regions"
  | "browse-wf-challenges"
  | "browse-wf-dictionary-en"
  | "browse-wf-factions";
export type TimedFreshness = "fresh" | "stale" | "out-of-range" | "unavailable";
export type TimedConditionKind = "personal" | "deviation" | "risk";

export interface TimedProvenance {
  kind: TimedSourceKind;
  contributors: TimedSourceId[];
}

export interface TimedSourceStatus {
  source: TimedSourceId;
  freshness: TimedFreshness;
  lastAttempt: string | null;
  lastSuccess: string | null;
  validUntil: string | null;
  error: string | null;
}

export interface TimedSourceStatuses {
  wfcd: TimedSourceStatus;
  deDescendia: TimedSourceStatus;
  deCircuit: TimedSourceStatus;
  browseWfBounties: TimedSourceStatus;
  browseWfLocationBounties: TimedSourceStatus;
  browseWfArbitration: TimedSourceStatus;
}

export interface TimedCondition {
  key: string;
  name: string;
  description: string;
  kind: TimedConditionKind;
  eliteOnly: boolean;
}

export interface TimedRewardDrop {
  item: string;
  rarity: string;
  chancePercent: number;
  count: number;
}

export interface TimedMetadata {
  key: string;
  value: string;
}

export interface TimedContentStage {
  order: number;
  title: string;
  node: string | null;
  detail: string | null;
  modifiers?: string[];
  conditions?: TimedCondition[];
  enemyLevels?: number[];
  standingStages?: number[];
  minMr?: number;
  timeBound?: string;
  rewardPool?: string[];
  rewardDrops?: TimedRewardDrop[];
  specs?: string[];
  auras?: string[];
  choices?: string[];
  ally?: string;
}

/** 各公開sourceをRust側で正規化してUIへ渡す共通カード。 */
export interface TimedContentCard {
  id: string;
  kind: string;
  variant: string | null;
  title: string;
  subtitle: string | null;
  activation: string | null;
  expiry: string | null;
  temporalStatus: TimedTemporalStatus;
  provenance: TimedProvenance;
  sourceId: TimedSourceId;
  sourceName: string;
  sourceUrl: string | null;
  metadata?: TimedMetadata[];
  personalModifiers?: TimedCondition[];
  stages: TimedContentStage[];
}

export interface TimedContentSnapshot {
  arbitration: TimedContentCard[];
  sortie: TimedContentCard[];
  archon: TimedContentCard[];
  syndicates: TimedContentCard[];
  areaEnvironments: TimedContentCard[];
  areaMissions: TimedContentCard[];
  areaObjectives: TimedContentCard[];
  bounties: TimedContentCard[];
  areaEvents: TimedContentCard[];
  circuit: TimedContentCard[];
  archimedea: TimedContentCard[];
  descendia: TimedContentCard[];
  sources: TimedSourceStatuses;
  lastPoll: string | null;
}

export interface StatusSnapshot {
  /** full-snapshot eventの新旧判定に使うbackend単調増加番号。 */
  revision: number;
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
  /** backendが現在時刻と設定から判定した通知ミュート状態。TSでは再計算しない。 */
  notificationsMuted: boolean;
  suppressedToday: number;
  /** 亀裂NODE表示用のnode表示名→[min, max] enemy level(ExportRegions由来) */
  nodeLevels: Record<string, [number, number]>;
  timedContent: TimedContentSnapshot;
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
