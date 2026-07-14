import type { TreeStage, UsageStatus } from "../shared/types";
import type { AchievementCategory } from "./i18n";

export type WeatherId = "clear" | "breeze" | "drizzle" | "rain" | "thunder" | "storm";
export type ViewMode = "pet" | "manager" | "toast" | "menubar";
export type HistorySourceId = "codex" | "openclaw" | "pi" | "opencode" | "claude" | "gemini" | "hermes" | "kimi" | "cloud";
export type HistoryFilter = "all" | HistorySourceId;
export type SourceScope = "today" | "total";
export type BadgeMetric = "level" | "total" | "rate";
export type TotalDisplayUnit = "raw" | "k" | "m" | "wan" | "yi";
export type DashboardTab = "home" | "achievements" | "leaderboard" | "social";
export type AchievementCategoryFilter = AchievementCategory;
export type AchievementStatusFilter = "all" | "unlocked" | "locked" | "hidden";

export interface WeatherState {
  id: WeatherId;
  label: string;
  tokensPerMinute: number;
  activity: number;
}

export interface Stats {
  xp: number;
  todayXp: number;
  level: number;
  levelXp: number;
  nextLevelXp: number;
  levelProgress: number;
  stage: TreeStage;
  nextStageLabel?: string;
  stageProgress: number;
  weather: WeatherState;
  lastFiveMinuteXp: number;
  recentXp: number;
  activeSessions: number;
}

export interface HistoryDayRow {
  label: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  sources: Record<HistorySourceId, number>;
}

export interface SourceBreakdown {
  id: string;
  label: string;
  xp: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface PureSvgManifest {
  stages: Array<{
    id: string;
    label: string;
    asset: string;
  }>;
}

export interface GameBalance {
  xp: {
    levelBase: number;
    levelExponent: number;
    maxLevel: number;
  };
  weather: {
    rateWindowSeconds: number;
    thresholds: Array<{ id: WeatherId; label: string; minXpPerMinute: number }>;
  };
  activity: {
    activeWindowSeconds: number;
    peakWindowSeconds: number;
  };
  stages: Array<{ minLevel: number; id: string; label: string }>;
}

export interface SourceVisibility {
  enabled: Set<HistorySourceId>;
  visible: HistorySourceId[];
  visibleSet: Set<HistorySourceId>;
}

export interface AgentSource {
  id: HistorySourceId;
  label: string;
  statusKey?: keyof UsageStatus;
}

export type BaseStatsSnapshot = Pick<
  Stats,
  "xp" | "todayXp" | "level" | "levelXp" | "nextLevelXp" | "levelProgress" | "stage" | "nextStageLabel" | "stageProgress"
>;
