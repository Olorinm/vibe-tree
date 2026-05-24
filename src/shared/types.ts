export interface LedgerEntry {
  id: string;
  createdAt: string;
  source: "manual" | string;
  tokens: number;
  note?: string;
  agent?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type AppLanguage = "zh-CN" | "en-US";
export type UiTheme = "day" | "night" | "soft";

export type LeaderboardRange = "today" | "7d" | "30d" | "all";

export interface LeaderboardProfile {
  id: string;
  username: string;
  avatarUrl?: string;
}

export interface LeaderboardStatus {
  configured: boolean;
  authenticated: boolean;
  joined: boolean;
  syncing: boolean;
  profile?: LeaderboardProfile;
  lastSyncedAt?: string;
  error?: string;
}

export type LeaderboardPreferencePeriod = "early" | "morning" | "afternoon" | "evening" | "night";

export interface LeaderboardUsagePreference {
  favoriteAgent?: {
    label: string;
    percent: number;
  };
  favoriteModel?: string;
  favoritePeriod?: {
    id: LeaderboardPreferencePeriod;
    startHour: number;
    endHour: number;
  };
  peakTokensPerMinute?: number;
  updatedAt?: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatarUrl?: string;
  tokens: number;
  xp?: number;
  daysActive?: number;
  usagePreference?: LeaderboardUsagePreference;
}

export interface LeaderboardData {
  range: LeaderboardRange;
  entries: LeaderboardEntry[];
  updatedAt?: string;
  me?: LeaderboardEntry;
  error?: string;
}

export interface LeaderboardCollection {
  ranges: Record<LeaderboardRange, LeaderboardData>;
  updatedAt?: string;
}

export interface Settings {
  locked: boolean;
  alwaysOnTop: boolean;
  language: AppLanguage;
  uiTheme: UiTheme;
  scale: 0.5 | 1 | 1.5 | 2 | number;
  badgeFrontMetric: "level" | "total" | "rate";
  badgeBackMetric: "level" | "total" | "rate";
  totalDisplayUnit: "raw" | "k" | "m" | "wan" | "yi";
  updateCheckEnabled: boolean;
  lastUpdateCheckedAt?: string;
  lastUpdateReminderVersion?: string;
  leaderboardEnabled: boolean;
  leaderboardProfile?: LeaderboardProfile;
  leaderboardLastSyncedAt?: string;
  leaderboardPreferencesPublic: boolean;
  launchOnStartup: boolean;
  silentStartup: boolean;
  proxyUrl?: string;
  enabledSourceIds: string[];
  windowPosition?: {
    x: number;
    y: number;
  };
  fontScale?: number;
  codexSessionsDir?: string;
  claudeSessionsDir?: string;
  openclawSessionsDir?: string;
  piSessionsDir?: string;
  opencodeSessionsDir?: string;
  geminiSessionsDir?: string;
  hermesSessionsDir?: string;
}

export interface LedgerFile {
  entries: LedgerEntry[];
  settings: Settings;
  installedAt: string;
}

export interface AchievementUnlock {
  id: string;
  unlockedAt: string;
  trigger?: Record<string, unknown>;
}

export interface AchievementState {
  version?: number;
  unlocked: AchievementUnlock[];
  stats?: Record<string, unknown>;
}

export interface AchievementUnlockResult {
  state: AchievementState;
  unlocked: AchievementUnlock[];
}

export interface UpdateStatus {
  checking: boolean;
  installing: boolean;
  available: boolean;
  canTerminalUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  checkedAt?: string;
  error?: string;
  installLog?: string;
  installError?: string;
  installedAt?: string;
  needsRestart?: boolean;
}

export interface UsageEvent {
  id: string;
  createdAt: string;
  source: string;
  agent: string;
  provider: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  status?: number;
  durationMs?: number;
  streaming?: boolean;
}

export interface UsageStatus {
  codexSession: SessionMonitorStatus;
  claudeSession: SessionMonitorStatus;
  openclawSession: SessionMonitorStatus;
  piSession: SessionMonitorStatus;
  opencodeSession: SessionMonitorStatus;
  geminiSession: SessionMonitorStatus;
  hermesSession: SessionMonitorStatus;
}

export interface SessionMonitorStatus {
  running: boolean;
  sessionsRoot: string;
  exists: boolean;
  filesWatched: number;
  eventsImported: number;
  importHistory: boolean;
  historyStartAt?: string;
  lastScanAt?: string;
  lastEventAt?: string;
}

export interface TreeStage {
  id: string;
  label: string;
  image: string;
}

export interface TreeAsset {
  id: string;
  displayName: string;
  baseSize: {
    width: number;
    height: number;
  };
  defaultScale: number;
  palette: {
    leaf: string;
    rain: string;
    storm: string;
    soilGlow: string;
    wind: string;
  };
  stages: TreeStage[];
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
