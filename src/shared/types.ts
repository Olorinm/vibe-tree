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
  deviceId?: string;
  syncedFromCloud?: boolean;
  eventFingerprint?: string;
}

export type AppLanguage = "zh-CN" | "en-US";
export type UiTheme = "day" | "night" | "soft";

export type LeaderboardRange = "24h" | "7d" | "30d" | "all";
export type SocialGroupLeaderboardBasis = "total" | "since_join";

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

export interface CloudSyncStatus {
  configured: boolean;
  authenticated: boolean;
  enabled: boolean;
  syncing: boolean;
  hasRemoteTree?: boolean;
  deviceId?: string;
  profile?: LeaderboardProfile;
  lastSyncedAt?: string;
  lastPulledAt?: string;
  lastUploadedCount?: number;
  lastDownloadedCount?: number;
  devices?: CloudDeviceSummary[];
  modelStats?: CloudModelStat[];
  error?: string;
}

export interface CloudDeviceSummary {
  deviceId: string;
  alias?: string;
  platform?: string;
  lastSyncedAt?: string;
  appVersion?: string;
  entryCount: number;
  tokens: number;
}

export interface CloudModelStat {
  deviceId: string;
  date: string;
  source: string;
  model: string;
  tokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
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

export type SocialGroupRole = "leader" | "officer" | "member";
export type SocialGroupVisibility = "invite" | "closed";
export type SocialFriendStatus = "pending" | "accepted";
export type SocialGroupJoinRequestType = "invite_code" | "friend_invite";
export type SocialGroupJoinRequestStatus = "pending" | "approved" | "declined" | "cancelled";
export type SocialProfileVisibility = "relations" | "friends" | "private";

export interface SocialProfilePrivacy {
  profileVisibility: SocialProfileVisibility;
  showLevel: boolean;
  showTokenTotal: boolean;
  showActiveDays: boolean;
  showAchievements: boolean;
  updatedAt?: string;
}

export interface SocialFriend {
  userId: string;
  username: string;
  avatarUrl?: string;
  status: SocialFriendStatus;
  direction?: "incoming" | "outgoing";
  requestedByMe: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SocialFriendList {
  friends: SocialFriend[];
  updatedAt?: string;
  error?: string;
}

export interface CreateSocialFriendInput {
  username?: string;
  userId?: string;
}

export interface SocialGroupMember {
  userId: string;
  username: string;
  avatarUrl?: string;
  role: SocialGroupRole;
  shareUsage: boolean;
  joinedAt?: string;
  updatedAt?: string;
}

export interface SocialGroup {
  groupId: string;
  name: string;
  description?: string;
  iconEmoji?: string;
  visibility: SocialGroupVisibility;
  ownerUserId: string;
  createdAt?: string;
  updatedAt?: string;
  memberCount: number;
  role?: SocialGroupRole;
  shareUsage?: boolean;
  members?: SocialGroupMember[];
}

export interface SocialGroupList {
  groups: SocialGroup[];
  updatedAt?: string;
  error?: string;
}

export interface SocialGroupJoinRequest {
  requestId: string;
  groupId: string;
  groupName: string;
  groupIconEmoji?: string;
  type: SocialGroupJoinRequestType;
  status: SocialGroupJoinRequestStatus;
  role: Exclude<SocialGroupRole, "leader">;
  requesterUserId: string;
  requesterUsername: string;
  requesterAvatarUrl?: string;
  invitedByUserId?: string;
  invitedByUsername?: string;
  invitedByAvatarUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
}

export interface SocialGroupRequestList {
  incomingInvites: SocialGroupJoinRequest[];
  outgoingRequests: SocialGroupJoinRequest[];
  updatedAt?: string;
  error?: string;
}

export interface SocialGroupModerationList {
  requests: SocialGroupJoinRequest[];
  updatedAt?: string;
  error?: string;
}

export interface SocialProfileAchievement {
  id: string;
  unlockedAt?: string;
}

export interface SocialProfile {
  id: string;
  username: string;
  avatarUrl?: string;
  joinedAt?: string;
  isSelf: boolean;
  isFriend: boolean;
  mutualGroupCount: number;
  friendCount: number;
  groupCount: number;
  // When false, the viewer has no consent signal to see usage figures and the
  // fields below are omitted (identity-only card).
  usageVisible: boolean;
  levelVisible?: boolean;
  tokenTotalVisible?: boolean;
  activeDaysVisible?: boolean;
  achievementsVisible?: boolean;
  level?: number;
  totalTokens?: number;
  daysActive?: number;
  achievements?: SocialProfileAchievement[];
}

export interface SocialProfileResult {
  profile?: SocialProfile;
  error?: string;
}

export interface CreateSocialGroupInput {
  name: string;
  description?: string;
  iconEmoji?: string;
  visibility?: SocialGroupVisibility;
}

export interface CreateSocialGroupInviteInput {
  role?: Exclude<SocialGroupRole, "leader">;
  maxUses?: number;
  expiresInDays?: number;
}

export interface CreateSocialGroupFriendInviteInput {
  userId: string;
  role?: Exclude<SocialGroupRole, "leader">;
}

export interface SocialGroupInvite {
  code: string;
  groupId: string;
  role: Exclude<SocialGroupRole, "leader">;
  maxUses?: number;
  uses: number;
  expiresAt?: string;
  createdAt?: string;
}

export interface SocialGroupLeaderboardEntry extends LeaderboardEntry {
  role?: SocialGroupRole;
}

export interface SocialGroupLeaderboardData {
  groupId: string;
  range: LeaderboardRange;
  basis: SocialGroupLeaderboardBasis;
  entries: SocialGroupLeaderboardEntry[];
  updatedAt?: string;
  me?: SocialGroupLeaderboardEntry;
  error?: string;
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
  leaderboardAutoSyncEnabled: boolean;
  leaderboardPreferencesPublic: boolean;
  socialGroupCount: number;
  cloudSyncEnabled: boolean;
  cloudSyncDeviceId?: string;
  cloudSyncLastSyncedAt?: string;
  cloudSyncLastPulledAt?: string;
  cloudSyncAutoSyncEnabled: boolean;
  treeStartMode?: "new" | "cloud";
  launchOnStartup: boolean;
  silentStartup: boolean;
  proxyUrl?: string;
  enabledSourceIds: string[];
  // Ordered list of visible menu bar popover component ids, in display order.
  menubarVizIds: string[];
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
  kimiSessionsDir?: string;
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

export type ToastPlacement = "left" | "right";

export type TreeToastItem =
  | { type: "achievement"; id: string }
  | { type: "level"; from: number; to: number };

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
  kimiSession: SessionMonitorStatus;
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
