import type {
  AchievementState,
  AchievementUnlock,
  AppLanguage,
  CloudSyncStatus,
  LedgerEntry,
  LedgerFile,
  LeaderboardCollection,
  LeaderboardData,
  LeaderboardEntry,
  LeaderboardRange,
  LeaderboardStatus,
  SessionMonitorStatus,
  SocialFriend,
  SocialGroup,
  SocialGroupInvite,
  SocialGroupJoinRequest,
  SocialGroupLeaderboardBasis,
  SocialGroupLeaderboardData,
  SocialGroupRole,
  SocialProfile,
  SocialProfilePrivacy,
  TreeAsset,
  UiTheme,
  UpdateStatus,
  UsageStatus,
  WindowBounds,
  TreeToastItem,
} from "../shared/types";
import { countedTokenBreakdownForEntry } from "../shared/tokenAccounting";
import { ACHIEVEMENTS, CATEGORY_ORDER, rarityOrder } from "./achievements";
import type { AchievementContext, AchievementDef } from "./achievements";
import { appShellHtml } from "./appShell";
import {
  clamp,
  dateKey,
  formatByUnit as formatValueByUnit,
  formatCompact,
  formatIntegerWithCommas,
  formatNumber as formatLocaleNumber,
} from "./format";
import {
  ACHIEVEMENT_CATEGORY_LABELS,
  ACHIEVEMENT_RARITY_LABELS,
  ACHIEVEMENT_TEXT_EN,
  UI_TEXT,
  browserLanguage,
  normalizeLanguage,
} from "./i18n";
import type { AchievementCategory, AchievementRarity } from "./i18n";
import { renderHistoryChart } from "./historyChart";
import {
  AGENT_SOURCES,
  combineSourceRows,
  defaultSourceLabel,
  emptySourceTotals,
  enabledStatsSourceIds as normalizeEnabledStatsSourceIds,
  enabledStatsSourceSet as normalizedEnabledStatsSourceSet,
  entryMatchesSourceKey,
  getSourceBreakdown,
  historySourceId,
  isHistorySourceId,
  safeTokens,
  sourceMatchesBreakdownRow,
  sourceMonitorStatus as monitorStatusForSource,
  sourceVisibility as buildSourceVisibility,
  xpForEntry,
} from "./sources";
import { StatsCache, summarizeXpProgression } from "./stats";
import { DEFAULT_GAME_BALANCE, DEFAULT_PURE_SVG_MANIFEST, buildTreeAsset } from "./treeAssets";
import type {
  AchievementCategoryFilter,
  AchievementStatusFilter,
  BadgeMetric,
  DashboardTab,
  GameBalance,
  HistoryFilter,
  HistorySourceId,
  PureSvgManifest,
  SourceBreakdown,
  SourceScope,
  SourceVisibility,
  Stats,
  TotalDisplayUnit,
  ViewMode,
  WeatherId,
} from "./types";
import { weatherBackHtml, weatherFrontHtml } from "./weatherArt";
import { toBlob } from "html-to-image";
import * as QRCode from "qrcode";
import "./styles.css";

type ShareTemplateId = "receipt" | "glass" | "mono";

interface ShareReportData {
  generatedAt: Date;
  totalTokens: number;
  todayTokens: number;
  peakTokensPerMinute: number;
  level: number;
  stageLabel: string;
  treeImage: string;
  mostUsedAgent: string;
  activeDays: number;
  currentStreak: number;
  heatLevels: number[];
  qrCodeImage: string;
  favoritePeriod: {
    label: string;
    range: string;
  };
}

const SHARE_TEMPLATES: Array<{ id: ShareTemplateId; titleKey: string; noteKey: string }> = [
  { id: "receipt", titleKey: "shareTemplateReceiptTitle", noteKey: "shareTemplateReceiptNote" },
  { id: "glass", titleKey: "shareTemplateGlassTitle", noteKey: "shareTemplateGlassNote" },
  { id: "mono", titleKey: "shareTemplateMonoTitle", noteKey: "shareTemplateMonoNote" },
];
const SHARE_PREVIEW_SIZE = { width: 284, height: 442 };
const SHARE_EXPORT_SIZE = { width: 2160, height: 3360 };
const SHARE_QR_TARGET_URL = "https://github.com/Olorinm/vibe-tree";

function shareTemplateForUiTheme(theme: UiTheme | undefined): ShareTemplateId {
  if (theme === "day") return "mono";
  if (theme === "soft") return "receipt";
  return "glass";
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
document.title = "Vibe Tree";

const viewParam = new URLSearchParams(location.search).get("view");
const uiThemeParam = new URLSearchParams(location.search).get("uiTheme");
const viewMode: ViewMode =
  viewParam === "manager"
    ? "manager"
    : viewParam === "toast"
      ? "toast"
      : viewParam === "menubar"
        ? "menubar"
        : "pet";
const UI_THEME_STORAGE_KEY = "vibe-tree:ui-theme";
const LEADERBOARD_CACHE_STORAGE_KEY = "vibe-tree:leaderboard-cache";
const LEADERBOARD_CACHE_TTL_MS = 60 * 60 * 1000;
const LEADERBOARD_CACHE_DISPLAY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TREE_START_FEEDBACK_HOLD_MS = 700;
const TREE_START_CLOUD_HELP_MS = 8_000;
const initialUiTheme = viewMode === "toast" ? "night" : readCachedUiTheme();
const platformName = rendererPlatform();
document.documentElement.dataset.platform = platformName;
if (viewMode === "pet") {
  delete document.documentElement.dataset.uiTheme;
} else {
  document.documentElement.dataset.uiTheme = initialUiTheme;
}
let ledger: LedgerFile | null = null;
let tree: TreeAsset | null = null;
let gameBalance: GameBalance | null = null;
let usageStatus: UsageStatus | null = null;
let updateStatus: UpdateStatus = {
  checking: false,
  installing: false,
  available: false,
  canTerminalUpdate: false,
  currentVersion: "",
};
let leaderboardStatus: LeaderboardStatus = {
  configured: false,
  authenticated: false,
  joined: false,
  syncing: false,
};
let socialProfilePrivacy: SocialProfilePrivacy | null = null;
let socialProfilePrivacyLoading = false;
let socialProfilePrivacyMessage = "";
let socialProfilePrivacyError = "";
let cloudSyncStatus: CloudSyncStatus = {
  configured: false,
  authenticated: false,
  enabled: false,
  syncing: false,
};
let leaderboardRange: LeaderboardRange = "7d";
let leaderboardData: LeaderboardData = {
  range: "7d",
  entries: [],
};
let leaderboardLoadedRange: LeaderboardRange | null = null;
const LEADERBOARD_RANGES: LeaderboardRange[] = ["24h", "7d", "30d", "all"];
const leaderboardDataCache = new Map<LeaderboardRange, LeaderboardData>();
let leaderboardDataCacheSavedAt: number | null = null;
let leaderboardLoading = false;
let socialPanel: "friends" | "groups" = "friends";
let socialFriends: SocialFriend[] = [];
let socialFriendsUpdatedAt: string | undefined;
let socialGroups: SocialGroup[] = [];
let socialGroupsUpdatedAt: string | undefined;
let socialIncomingGroupInvites: SocialGroupJoinRequest[] = [];
let socialOutgoingGroupRequests: SocialGroupJoinRequest[] = [];
let socialGroupJoinRequests: SocialGroupJoinRequest[] = [];
let socialSelectedGroupId: string | null = null;
let socialLoading = false;
let socialError = "";
let socialNotice = "";
let socialInvite: SocialGroupInvite | null = null;
let socialInviteCopiedAt = 0;
let socialGroupRange: LeaderboardRange = "24h";
let socialGroupBasis: SocialGroupLeaderboardBasis = "total";
let socialGroupLeaderboard: SocialGroupLeaderboardData | null = null;
let socialGroupLeaderboardLoading = false;
const socialGroupLeaderboardCache = new Map<string, SocialGroupLeaderboardData>();
let socialRenderKey = "";
let socialProfileOpen = false;
let socialProfileLoading = false;
let socialProfileUserId: string | null = null;
let socialProfile: SocialProfile | null = null;
let socialProfileError = "";
let achievementState: AchievementState = { unlocked: [] };
let lastWeatherId: WeatherId | null = null;
let lastRenderedLevel: number | null = null;
let levelUpTimer: number | undefined;
let achievementSyncInFlight = false;
let achievementReconcileInFlight = false;
let achievementToastTimer: number | undefined;
let lockedAchievementHintTimer: number | undefined;
const achievementToastQueue: TreeToastItem[] = [];
const ACHIEVEMENT_TOAST_DURATION_MS = 5_000;
const TOAST_PREVIEW_IDS = ["sprout", "deep_night", "xp_1m", "xp_100m", "fibonacci"];
const RENDER_INTERVAL_MS = viewMode === "pet" ? 2_500 : 1_000;
let toastPreviewIndex = 0;
let pendingLevelUp: { from: number; to: number } | null = null;
const AUTO_BADGE_FLIP_MS = 30_000;
const BADGE_TOKEN_HOLD_MS = 2_500;
const badgeFlipTimers = new Map<string, number>();
let badgeAutoFlipTimer: number | undefined;
const LUNAR_NEW_YEAR_PERIOD_DAYS = 7;
const ACHIEVEMENT_STATE_VERSION = 2;
const ACCOUNTING_RECONCILED_ACHIEVEMENTS = new Set([
  "sprout",
  "sapling",
  "big_tree",
  "xp_10k",
  "xp_100k",
  "xp_1m",
  "xp_10m",
  "xp_100m",
  "xp_1b",
  "daily_1k",
  "daily_10k",
  "daily_50k",
  "daily_1m",
  "daily_10m",
  "daily_100m",
  "raid_boss_5m",
  "raid_boss_50m",
  "burst_60",
  "burst_10k",
  "burst_100k",
  "burst_1m",
  "faction_loyalist",
  "fibonacci",
]);
const LUNAR_NEW_YEAR_DATES: Record<number, string> = {
  2015: "2015-02-19",
  2016: "2016-02-08",
  2017: "2017-01-28",
  2018: "2018-02-16",
  2019: "2019-02-05",
  2020: "2020-01-25",
  2021: "2021-02-12",
  2022: "2022-02-01",
  2023: "2023-01-22",
  2024: "2024-02-10",
  2025: "2025-01-29",
  2026: "2026-02-17",
  2027: "2027-02-06",
  2028: "2028-01-26",
  2029: "2029-02-13",
  2030: "2030-02-03",
  2031: "2031-01-23",
  2032: "2032-02-11",
  2033: "2033-01-31",
  2034: "2034-02-19",
  2035: "2035-02-08",
  2036: "2036-01-28",
};
let historyFilter: HistoryFilter = "all";
let lastHistoryChartKey = "";
let sourceScope: SourceScope = "today";
let dashboardTab: DashboardTab = "home";
let treeStartPendingAction: "new" | "cloud" | null = null;
let treeStartCloudHelpTimer: number | undefined;
let treeStartPendingVersion = 0;
let achievementCategoryFilter: AchievementCategoryFilter = "growth";
let achievementStatusFilter: AchievementStatusFilter = "all";
let seenAchievementIds = new Set<string>();
let expandedSourceKey: string | null = null;
let sourceBreakdownCacheKey = "";
let achievementContextCacheKey = "";
let cachedAchievementContext: AchievementContext | undefined;
let achievementRenderKey = "";
let achievementSyncKey = "";
let updateStatusRenderKey = "";
let leaderboardSettingsRenderKey = "";
let leaderboardRenderKey = "";
let dragState: null | {
  startMouse: { x: number; y: number };
  startBounds: WindowBounds;
  pointerId: number;
} = null;
let pendingDragPointerId: number | null = null;
let activePetPointer: null | {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
} = null;
let appLanguage: AppLanguage = browserLanguage();
const statsCache = new StatsCache();


app.innerHTML = appShellHtml(viewMode);

const root = document.querySelector<HTMLElement>(
  viewMode === "pet"
    ? ".pet-root"
    : viewMode === "manager"
      ? ".manager-root"
      : viewMode === "menubar"
        ? ".menubar-root"
        : ".toast-root",
)!;
if (viewMode === "pet") {
  delete root.dataset.uiTheme;
} else {
  root.dataset.uiTheme = initialUiTheme;
}
root.dataset.platform = platformName;
const treeImage = document.querySelector<HTMLImageElement>("#treeImage");
const previewTreeImage = document.querySelector<HTMLImageElement>("#previewTreeImage");
const menubarLevelChip = document.querySelector<HTMLElement>("#menubarLevelChip");
const menubarWeatherText = document.querySelector<HTMLElement>("#menubarWeatherText");
const menubarLiveDot = document.querySelector<HTMLElement>("#menubarLiveDot");
const menubarTodayText = document.querySelector<HTMLElement>("#menubarTodayText");
const menubarTodayCtx = document.querySelector<HTMLElement>("#menubarTodayCtx");
const menubarNextLevelText = document.querySelector<HTMLElement>("#menubarNextLevelText");
const menubarProgressPercent = document.querySelector<HTMLElement>("#menubarProgressPercent");
const menubarProgressText = document.querySelector<HTMLElement>("#menubarProgressText");
const menubarProgressBar = document.querySelector<HTMLElement>("#menubarProgressBar");
const menubarRhythmBars = document.querySelector<HTMLElement>("#menubarRhythmBars");
const menubarRhythmMeta = document.querySelector<HTMLElement>("#menubarRhythmMeta");
const menubarSourceSummary = document.querySelector<HTMLElement>("#menubarSourceSummary");
const menubarSourceList = document.querySelector<HTMLElement>("#menubarSourceList");
const menubarWave = document.querySelector<HTMLElement>("#menubarWave");
const menubarSpeedMeta = document.querySelector<HTMLElement>("#menubarSpeedMeta");
const menubarSpeedWindow = document.querySelector<HTMLElement>("#menubarSpeedWindow");
const menubarSpeedTotal = document.querySelector<HTMLElement>("#menubarSpeedTotal");
const menubarSpeedPeak = document.querySelector<HTMLElement>("#menubarSpeedPeak");
const menubarSyncButton = document.querySelector<HTMLButtonElement>("#menubarSyncButton");
const menubarSyncList = document.querySelector<HTMLElement>("#menubarSyncList");
const menubarActivityMeta = document.querySelector<HTMLElement>("#menubarActivityMeta");
const menubarActivityList = document.querySelector<HTMLElement>("#menubarActivityList");
const menubarRankRefreshButton = document.querySelector<HTMLButtonElement>("#menubarRankRefreshButton");
const menubarRankList = document.querySelector<HTMLElement>("#menubarRankList");
const menubarDots = document.querySelector<HTMLElement>("#menubarDots");
const menubarSlot = document.querySelector<HTMLElement>(".menubar-slot");
const weatherBack = document.querySelector<HTMLElement>("#weatherBack");
const weatherFront = document.querySelector<HTMLElement>("#weatherFront");
const previewWeatherBack = document.querySelector<HTMLElement>("#previewWeatherBack");
const previewWeatherFront = document.querySelector<HTMLElement>("#previewWeatherFront");
const petLevelBadge = document.querySelector<HTMLElement>("#petLevelBadge");
const previewLevelBadge = document.querySelector<HTMLElement>("#previewLevelBadge");
const lockInput = document.querySelector<HTMLInputElement>("#lockInput");
const settingsButton = document.querySelector<HTMLButtonElement>("#settingsButton");
const settingsCloseButton = document.querySelector<HTMLButtonElement>("#settingsCloseButton");
const settingsBackdrop = document.querySelector<HTMLElement>("#settingsBackdrop");
const settingsModal = document.querySelector<HTMLElement>("#settingsModal");
const settingsNav = document.querySelector<HTMLElement>("#settingsNav");
const menubarComponentList = document.querySelector<HTMLElement>("#menubarComponentList");
const scaleSelect = document.querySelector<HTMLSelectElement>("#scaleSelect");
const fontScaleSelect = document.querySelector<HTMLSelectElement>("#fontScaleSelect");
const launchOnStartupInput = document.querySelector<HTMLInputElement>("#launchOnStartupInput");
const silentStartupInput = document.querySelector<HTMLInputElement>("#silentStartupInput");
const proxyUrlInput = document.querySelector<HTMLInputElement>("#proxyUrlInput");
const updateCheckEnabledInput = document.querySelector<HTMLInputElement>("#updateCheckEnabledInput");
const updateStatusText = document.querySelector<HTMLElement>("#updateStatusText");
const checkUpdateButton = document.querySelector<HTMLButtonElement>("#checkUpdateButton");
const installUpdateButton = document.querySelector<HTMLButtonElement>("#installUpdateButton");
const updateNotesButton = document.querySelector<HTMLButtonElement>("#updateNotesButton");
const releasePageButton = document.querySelector<HTMLButtonElement>("#releasePageButton");
const languageSelect = document.querySelector<HTMLSelectElement>("#languageSelect");
const themeSwitcher = document.querySelector<HTMLElement>("#themeSwitcher");
const sourceSettings = document.querySelector<HTMLElement>("#sourceSettings");
const badgeFrontMetricSelect = document.querySelector<HTMLSelectElement>("#badgeFrontMetricSelect");
const badgeBackMetricSelect = document.querySelector<HTMLSelectElement>("#badgeBackMetricSelect");
const totalDisplayUnitSelect = document.querySelector<HTMLSelectElement>("#totalDisplayUnitSelect");
const codexSessionsDirInput = document.querySelector<HTMLInputElement>("#codexSessionsDirInput");
const claudeSessionsDirInput = document.querySelector<HTMLInputElement>("#claudeSessionsDirInput");
const openclawSessionsDirInput = document.querySelector<HTMLInputElement>("#openclawSessionsDirInput");
const piSessionsDirInput = document.querySelector<HTMLInputElement>("#piSessionsDirInput");
const opencodeSessionsDirInput = document.querySelector<HTMLInputElement>("#opencodeSessionsDirInput");
const geminiSessionsDirInput = document.querySelector<HTMLInputElement>("#geminiSessionsDirInput");
const hermesSessionsDirInput = document.querySelector<HTMLInputElement>("#hermesSessionsDirInput");
const leaderboardStatusText = document.querySelector<HTMLElement>("#leaderboardStatusText");
const leaderboardUserCard = document.querySelector<HTMLElement>("#leaderboardUserCard");
const leaderboardAutoSyncInput = document.querySelector<HTMLInputElement>("#leaderboardAutoSyncInput");
const leaderboardPreferencesPublicInput = document.querySelector<HTMLInputElement>("#leaderboardPreferencesPublicInput");
const socialProfilePrivacySettings = document.querySelector<HTMLElement>("#socialProfilePrivacySettings");
const socialProfileVisibilitySelect = document.querySelector<HTMLSelectElement>("#socialProfileVisibilitySelect");
const socialProfileShowLevelInput = document.querySelector<HTMLInputElement>("#socialProfileShowLevelInput");
const socialProfileShowTokenTotalInput = document.querySelector<HTMLInputElement>("#socialProfileShowTokenTotalInput");
const socialProfileShowActiveDaysInput = document.querySelector<HTMLInputElement>("#socialProfileShowActiveDaysInput");
const socialProfileShowAchievementsInput = document.querySelector<HTMLInputElement>("#socialProfileShowAchievementsInput");
const socialProfilePrivacyStatus = document.querySelector<HTMLElement>("#socialProfilePrivacyStatus");
const leaderboardPageRefreshButton = document.querySelector<HTMLButtonElement>("#leaderboardPageRefreshButton");
const leaderboardPageSyncButton = document.querySelector<HTMLButtonElement>("#leaderboardPageSyncButton");
const leaderboardRangeTabs = document.querySelector<HTMLElement>("#leaderboardRangeTabs");
const leaderboardSummary = document.querySelector<HTMLElement>("#leaderboardSummary");
const leaderboardRows = document.querySelector<HTMLElement>("#leaderboardRows");
const socialSettingsButton = document.querySelector<HTMLButtonElement>("#socialSettingsButton");
const socialSettingsModal = document.querySelector<HTMLElement>("#socialSettingsModal");
const socialSettingsBackdrop = document.querySelector<HTMLElement>("#socialSettingsBackdrop");
const socialSettingsCloseButton = document.querySelector<HTMLButtonElement>("#socialSettingsCloseButton");
const socialRefreshButton = document.querySelector<HTMLButtonElement>("#socialRefreshButton");
const socialModeTabs = document.querySelector<HTMLElement>("#socialModeTabs");
const socialFriendsPanel = document.querySelector<HTMLElement>("#socialFriendsPanel");
const socialGroupsPanel = document.querySelector<HTMLElement>("#socialGroupsPanel");
const socialGroupManageButton = document.querySelector<HTMLButtonElement>("#socialGroupManageButton");
const socialGroupActionsModal = document.querySelector<HTMLElement>("#socialGroupActionsModal");
const socialGroupActionsBackdrop = document.querySelector<HTMLElement>("#socialGroupActionsBackdrop");
const socialGroupActionsCloseButton = document.querySelector<HTMLButtonElement>("#socialGroupActionsCloseButton");
const socialGroupDetailPanel = document.querySelector<HTMLElement>("#socialGroupDetailPanel");
const socialAddFriendForm = document.querySelector<HTMLFormElement>("#socialAddFriendForm");
const socialFriendUsernameInput = document.querySelector<HTMLInputElement>("#socialFriendUsernameInput");
const socialGroupInbox = document.querySelector<HTMLElement>("#socialGroupInbox");
const socialFriendList = document.querySelector<HTMLElement>("#socialFriendList");
const socialCreateGroupForm = document.querySelector<HTMLFormElement>("#socialCreateGroupForm");
const socialGroupNameInput = document.querySelector<HTMLInputElement>("#socialGroupNameInput");
const socialJoinInviteForm = document.querySelector<HTMLFormElement>("#socialJoinInviteForm");
const socialInviteCodeInput = document.querySelector<HTMLInputElement>("#socialInviteCodeInput");
const socialSummary = document.querySelector<HTMLElement>("#socialSummary");
const socialGroupList = document.querySelector<HTMLElement>("#socialGroupList");
const socialGroupDetail = document.querySelector<HTMLElement>("#socialGroupDetail");
const socialGroupRangeTabs = document.querySelector<HTMLElement>("#socialGroupRangeTabs");
const socialGroupBasisTabs = document.querySelector<HTMLElement>("#socialGroupBasisTabs");
const socialGroupControls = document.querySelector<HTMLElement>("#socialGroupControls");
const socialInviteManager = document.querySelector<HTMLElement>("#socialInviteManager");
const socialInviteGroupSummary = document.querySelector<HTMLElement>("#socialInviteGroupSummary");
const socialGroupFriendInviteForm = document.querySelector<HTMLFormElement>("#socialGroupFriendInviteForm");
const socialGroupFriendInviteSelect = document.querySelector<HTMLSelectElement>("#socialGroupFriendInviteSelect");
const socialCreateInviteButton = document.querySelector<HTMLButtonElement>("#socialCreateInviteButton");
const socialInviteOutput = document.querySelector<HTMLElement>("#socialInviteOutput");
const socialGroupRequestList = document.querySelector<HTMLElement>("#socialGroupRequestList");
const socialGroupLeaderboardRows = document.querySelector<HTMLElement>("#socialGroupLeaderboardRows");
const socialProfileModal = document.querySelector<HTMLElement>("#socialProfileModal");
const socialProfileBackdrop = document.querySelector<HTMLElement>("#socialProfileBackdrop");
const socialProfileCloseButton = document.querySelector<HTMLButtonElement>("#socialProfileCloseButton");
const socialProfileBody = document.querySelector<HTMLElement>("#socialProfileBody");
const shareExportButton = document.querySelector<HTMLButtonElement>("#shareExportButton");
const treeStartModal = document.querySelector<HTMLElement>("#treeStartModal");
const treeStartNewButton = document.querySelector<HTMLButtonElement>("#treeStartNewButton");
const treeStartExistingButton = document.querySelector<HTMLButtonElement>("#treeStartExistingButton");
const treeStartCancelButton = document.querySelector<HTMLButtonElement>("#treeStartCancelButton");
const treeStartFeedback = document.querySelector<HTMLElement>("#treeStartFeedback");
const treeStartTreeImage = document.querySelector<HTMLImageElement>("#treeStartTreeImage");
const cloudSyncStatusText = document.querySelector<HTMLElement>("#cloudSyncStatusText");
const cloudSyncActionButton = document.querySelector<HTMLButtonElement>("#cloudSyncActionButton");
const SETTINGS_CATEGORY_IDS = ["basic", "menubar", "sync", "updates", "sources"] as const;
type SettingsCategory = (typeof SETTINGS_CATEGORY_IDS)[number];
let activeSettingsCategory: SettingsCategory = "basic";
const cloudSyncDeviceList = document.querySelector<HTMLElement>("#cloudSyncDeviceList");
const cloudSyncAutoSyncInput = document.querySelector<HTMLInputElement>("#cloudSyncAutoSyncInput");

if (viewMode === "manager") {
  setupHistoryCard();
}

const historyBars = document.querySelector<HTMLElement>("#historyBars");
const historyTabs = document.querySelector<HTMLElement>("#historyTabs");
const historyLegend = document.querySelector<HTMLElement>("#historyLegend");
const historySummary = document.querySelector<HTMLElement>("#historySummary");
const sourceScopeTabs = document.querySelector<HTMLElement>("#sourceScopeTabs");
const sourceBreakdownElement = document.querySelector<HTMLElement>("#sourceBreakdown");
const sideTabs = document.querySelector<HTMLElement>("#sideTabs");
const achievementSummaryElement = document.querySelector<HTMLElement>("#achievementSummary");
const achievementOverviewElement = document.querySelector<HTMLElement>("#achievementOverview");
const achievementRecentElement = document.querySelector<HTMLElement>("#achievementRecent");
const achievementGridElement = document.querySelector<HTMLElement>("#achievementGrid");
const achievementCategoryTabs = document.querySelector<HTMLElement>("#achievementCategoryTabs");
const achievementStatusTabs = document.querySelector<HTMLElement>("#achievementStatusTabs");
const achievementToastPreviewButton = document.querySelector<HTMLButtonElement>("#achievementToastPreviewButton");
const achievementToastLayer = document.querySelector<HTMLElement>("#achievementToastLayer");

function setupHistoryCard() {
  const card = document.querySelector<HTMLElement>(".chart-card");
  if (!card) return;
  card.innerHTML = `
    <div class="chart-top">
      <div>
        <h3 data-i18n="recentSevenDays">最近 7 天</h3>
        <span id="historySummary" data-i18n="historyAllSources">全部来源</span>
      </div>
      <div class="history-tabs" id="historyTabs" role="tablist" aria-label="最近 7 天来源" data-i18n-aria="historySourceAria">
        <button type="button" data-history-filter="all" data-i18n="all">全部</button>
        <button type="button" data-history-filter="codex">Codex</button>
        <button type="button" data-history-filter="openclaw">OpenClaw</button>
        <button type="button" data-history-filter="pi">Pi Agent</button>
        <button type="button" data-history-filter="opencode">OpenCode</button>
        <button type="button" data-history-filter="claude">Claude Code</button>
        <button type="button" data-history-filter="gemini">Gemini</button>
        <button type="button" data-history-filter="hermes">Hermes</button>
      </div>
    </div>
    <div class="history-legend" id="historyLegend" aria-label="token 类型" data-i18n-aria="historyTokenAria">
      <span><i class="legend-input"></i>input</span>
      <span><i class="legend-output"></i>output</span>
      <span><i class="legend-cache-read"></i>cache hit</span>
      <span><i class="legend-cache-write"></i>cache write</span>
    </div>
    <div class="history-bars" id="historyBars" aria-label="最近 7 天 Token" data-i18n-aria="recentSevenDays"></div>
  `;
}


function currentLanguage(): AppLanguage {
  return normalizeLanguage(ledger?.settings.language ?? appLanguage);
}

function languageLocale(): string {
  return currentLanguage();
}

function currentUiTheme(): UiTheme {
  if (viewMode === "toast") return "night";
  return normalizeUiTheme(ledger?.settings.uiTheme);
}

function normalizeUiTheme(value: unknown): UiTheme {
  return value === "day" || value === "soft" || value === "night" ? value : "night";
}

function readCachedUiTheme(): UiTheme {
  if (uiThemeParam) return normalizeUiTheme(uiThemeParam);
  try {
    return normalizeUiTheme(localStorage.getItem(UI_THEME_STORAGE_KEY));
  } catch {
    return "night";
  }
}

function cacheUiTheme(theme: UiTheme) {
  try {
    localStorage.setItem(UI_THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore private-mode or storage permission failures; the ledger remains the source of truth.
  }
}

function hydrateLeaderboardCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEADERBOARD_CACHE_STORAGE_KEY) || "{}") as {
      cachedAt?: unknown;
      ranges?: unknown;
    };
    const cachedAt = typeof parsed.cachedAt === "string" ? Date.parse(parsed.cachedAt) : Number(parsed.cachedAt);
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > LEADERBOARD_CACHE_DISPLAY_MAX_AGE_MS) return;
    if (!parsed.ranges || typeof parsed.ranges !== "object") return;

    const rawRanges = parsed.ranges as Record<string, unknown>;
    leaderboardDataCache.clear();
    for (const range of LEADERBOARD_RANGES) {
      const legacyToday = range === "24h" && rawRanges.today && typeof rawRanges.today === "object"
        ? { ...(rawRanges.today as Record<string, unknown>), range: "24h" }
        : undefined;
      const data = rawRanges[range] ?? legacyToday;
      if (isCacheableLeaderboardData(data, range)) leaderboardDataCache.set(range, data);
    }
    leaderboardDataCacheSavedAt = cachedAt;
    applyCachedLeaderboardRange();
  } catch {
    // Local cache is only a convenience. Bad or unavailable storage should not block the app.
  }
}

function persistLeaderboardCache() {
  const ranges: Partial<Record<LeaderboardRange, LeaderboardData>> = {};
  for (const range of LEADERBOARD_RANGES) {
    const data = leaderboardDataCache.get(range);
    if (isCacheableLeaderboardData(data, range)) ranges[range] = data;
  }
  if (!Object.keys(ranges).length) return;

  const cachedAt = new Date().toISOString();
  try {
    localStorage.setItem(
      LEADERBOARD_CACHE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        cachedAt,
        ranges,
      }),
    );
    leaderboardDataCacheSavedAt = Date.parse(cachedAt);
  } catch {
    // Ignore storage quota and permission failures; the in-memory cache still works for this window.
  }
}

function clearLeaderboardCache() {
  leaderboardDataCache.clear();
  leaderboardDataCacheSavedAt = null;
  try {
    localStorage.removeItem(LEADERBOARD_CACHE_STORAGE_KEY);
  } catch {
    // Ignore storage permission failures.
  }
}

function applyCachedLeaderboardRange() {
  const cached = leaderboardDataCache.get(leaderboardRange);
  if (!cached) return false;
  leaderboardData = cached;
  leaderboardLoadedRange = leaderboardRange;
  leaderboardRenderKey = "";
  return true;
}

function isLeaderboardCacheFresh() {
  return Boolean(
    leaderboardDataCacheSavedAt &&
      Date.now() - leaderboardDataCacheSavedAt <= LEADERBOARD_CACHE_TTL_MS &&
      leaderboardDataCache.has(leaderboardRange),
  );
}

function isCacheableLeaderboardData(data: unknown, range: LeaderboardRange): data is LeaderboardData {
  if (!data || typeof data !== "object") return false;
  const candidate = data as LeaderboardData;
  return (
    candidate.range === range &&
    !candidate.error &&
    Array.isArray(candidate.entries) &&
    candidate.entries.every(isCacheableLeaderboardEntry) &&
    (!candidate.updatedAt || Number.isFinite(Date.parse(candidate.updatedAt)))
  );
}

function isCacheableLeaderboardEntry(entry: unknown): entry is LeaderboardEntry {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as LeaderboardEntry;
  return (
    Number.isFinite(candidate.rank) &&
    typeof candidate.userId === "string" &&
    typeof candidate.username === "string" &&
    Number.isFinite(candidate.tokens)
  );
}

function applyUiTheme(theme: UiTheme) {
  if (viewMode === "pet") {
    delete root.dataset.uiTheme;
    delete document.documentElement.dataset.uiTheme;
    cacheUiTheme(theme);
    return;
  }
  root.dataset.uiTheme = theme;
  document.documentElement.dataset.uiTheme = theme;
  cacheUiTheme(theme);
}

function bindMenubarEvents() {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") void window.bonsai.hideMenuBarPopover();
  });
  if (menubarDots) {
    menubarDots.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      // Trailing "+" jumps to the dashboard settings where components are managed.
      if (target.closest("#menubarVizAdd")) {
        void window.bonsai.openMenubarComponentSettings();
        return;
      }
      const dot = target.closest<HTMLButtonElement>("[data-viz-index]");
      if (!dot) return;
      const index = Number(dot.dataset.vizIndex);
      if (Number.isInteger(index)) setMenubarViz(index);
    });
  }
  menubarSlot?.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    menubarDragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    menubarSlot.classList.add("is-dragging");
    menubarSlot.setPointerCapture(event.pointerId);
  });
  menubarSlot?.addEventListener("pointermove", (event) => {
    if (!menubarDragState || menubarDragState.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - menubarDragState.startX, event.clientY - menubarDragState.startY) > 8) {
      menubarSlot.classList.add("is-dragging");
    }
  });
  menubarSlot?.addEventListener("pointerup", (event) => {
    if (!menubarDragState || menubarDragState.pointerId !== event.pointerId) return;
    const dx = event.clientX - menubarDragState.startX;
    const dy = event.clientY - menubarDragState.startY;
    if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      pageMenubarViz(dx < 0 ? 1 : -1);
      lockMenubarWheel();
    }
    clearMenubarDrag();
  });
  menubarSlot?.addEventListener("pointercancel", clearMenubarDrag);
  menubarSlot?.addEventListener(
    "wheel",
    (event) => {
      const horizontal = Math.abs(event.deltaX);
      const vertical = Math.abs(event.deltaY);
      // Page only on a clearly horizontal gesture; let mostly-vertical scrolls through.
      if (horizontal < 24 || horizontal <= vertical * 1.5) return;
      // Inside a scrollable list, vertical scroll wins — only page on a near-pure horizontal swipe.
      if ((event.target as HTMLElement).closest(MENUBAR_SCROLLABLE_SELECTOR) && horizontal <= vertical * 2.5) return;
      event.preventDefault();
      if (menubarWheelLocked) {
        lockMenubarWheel();
        return;
      }
      if (pageMenubarViz(event.deltaX > 0 ? 1 : -1)) lockMenubarWheel();
    },
    { passive: false },
  );
  menubarSyncButton?.addEventListener("click", async () => {
    if (menubarSyncButton.disabled) return;
    menubarSyncButton.disabled = true;
    try {
      cloudSyncStatus = cloudSyncStatus.enabled
        ? await window.bonsai.syncCloudTree()
        : await window.bonsai.enableCloudSync();
      ledger = await window.bonsai.getLedger();
      achievementState = await window.bonsai.getAchievements();
      render();
    } finally {
      menubarSyncButton.disabled = false;
    }
  });
  menubarRankRefreshButton?.addEventListener("click", () => {
    void refreshLeaderboard({ syncFirst: leaderboardStatus.joined, forceSync: true, forceFetch: true }).then(render);
  });
  // Rhythm bars: hovering/focusing a bar reads out that hour's total + dominant source in the meta slot.
  if (menubarRhythmBars) {
    const readHour = (target: EventTarget | null) => {
      const col = (target as HTMLElement | null)?.closest<HTMLElement>(".menubar-rhythm-col");
      if (!col) return;
      const hour = Number(col.dataset.hour);
      if (Number.isInteger(hour)) showMenubarRhythmHour(hour);
    };
    menubarRhythmBars.addEventListener("pointermove", (event) => readHour(event.target));
    menubarRhythmBars.addEventListener("pointerleave", resetMenubarRhythmMeta);
    menubarRhythmBars.addEventListener("focusin", (event) => readHour(event.target));
    menubarRhythmBars.addEventListener("focusout", resetMenubarRhythmMeta);
  }
}

function clearMenubarDrag() {
  menubarDragState = null;
  menubarSlot?.classList.remove("is-dragging");
}

function pageMenubarViz(direction: 1 | -1) {
  const now = Date.now();
  if (now - menubarLastPageGestureAt < MENUBAR_PAGE_GESTURE_COOLDOWN_MS) return false;
  menubarLastPageGestureAt = now;
  setMenubarViz(menubarVizIndex + direction);
  return true;
}

function lockMenubarWheel() {
  menubarWheelLocked = true;
  if (menubarWheelUnlockTimer !== null) window.clearTimeout(menubarWheelUnlockTimer);
  menubarWheelUnlockTimer = window.setTimeout(() => {
    menubarWheelLocked = false;
    menubarWheelUnlockTimer = null;
  }, MENUBAR_PAGE_GESTURE_COOLDOWN_MS);
}

function rendererPlatform() {
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  if (platform.includes("mac") || userAgent.includes("mac os")) return "mac";
  if (platform.includes("win") || userAgent.includes("windows")) return "windows";
  return "linux";
}

function t(key: string): string {
  return UI_TEXT[currentLanguage()][key] ?? UI_TEXT["zh-CN"][key] ?? key;
}

function applyI18n() {
  updateStatusRenderKey = "";
  leaderboardSettingsRenderKey = "";
  leaderboardRenderKey = "";
  document.documentElement.lang = languageLocale();
  if (viewMode === "pet") {
    delete document.documentElement.dataset.uiTheme;
  } else {
    document.documentElement.dataset.uiTheme = currentUiTheme();
  }
  document.title = t("appTitle");
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (key) element.textContent = t(key);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((element) => {
    const key = element.dataset.i18nAria;
    if (key) element.setAttribute("aria-label", t(key));
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((element) => {
    const key = element.dataset.i18nTitle;
    if (key) element.setAttribute("title", t(key));
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((element) => {
    const key = element.dataset.i18nPlaceholder;
    if (key) element.setAttribute("placeholder", t(key));
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-tooltip]").forEach((element) => {
    const key = element.dataset.i18nTooltip;
    if (key) {
      const value = t(key);
      element.dataset.tooltip = value;
      element.setAttribute("aria-label", value);
    }
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-achievement-category]").forEach((element) => {
    const key = element.dataset.i18nAchievementCategory as AchievementCategory | undefined;
    if (key) element.textContent = achievementCategoryLabel(key);
  });
  renderUpdateStatus();
  renderLeaderboardSettings();
  renderSocialProfilePrivacySettings();
  renderLeaderboard();
}

function stageLabel(id: string, fallback: string) {
  const labels: Record<AppLanguage, Record<string, string>> = {
    "zh-CN": {
      sprout: t("stageSprout"),
      seedling: t("stageSeedling"),
      young: t("stageYoung"),
      medium: t("stageMedium"),
      lush: t("stageLush"),
      full: t("stageFull"),
    },
    "en-US": {
      sprout: t("stageSprout"),
      seedling: t("stageSeedling"),
      young: t("stageYoung"),
      medium: t("stageMedium"),
      lush: t("stageLush"),
      full: t("stageFull"),
    },
  };
  return labels[currentLanguage()][id] ?? fallback;
}

function weatherLabel(id: WeatherId, fallback: string) {
  const labels: Record<WeatherId, string> = {
    clear: t("weatherClear"),
    breeze: t("weatherBreeze"),
    drizzle: t("weatherDrizzle"),
    rain: t("weatherRain"),
    thunder: t("weatherThunder"),
    storm: t("weatherStorm"),
  };
  return labels[id] ?? fallback;
}

function activeSessionsText(count: number) {
  if (currentLanguage() === "zh-CN") return `${count} ${t("sessionsUnit")}`;
  return `${count} ${count === 1 ? "session" : t("sessionsUnit")}`;
}

function sourceActiveText(count: number) {
  if (currentLanguage() === "zh-CN") {
    return `${count} ${sourceScope === "today" ? t("sourceTodayActive") : t("sourceTotalActive")}`;
  }
  return `${count} ${sourceScope === "today" ? t("sourceTodayActive") : t("sourceTotalActive")}`;
}

function enabledStatsSourceIds(): HistorySourceId[] {
  return normalizeEnabledStatsSourceIds(ledger?.settings.enabledSourceIds);
}

function enabledStatsSourceSet() {
  return normalizedEnabledStatsSourceSet(ledger?.settings.enabledSourceIds);
}

function sourceMonitorStatus(sourceId: HistorySourceId) {
  return monitorStatusForSource(usageStatus, sourceId);
}

function sourceVisibility(): SourceVisibility {
  const visibility = buildSourceVisibility(usageStatus, ledger?.settings.enabledSourceIds);
  const sourcesWithEntries = new Set(
    (ledger?.entries ?? [])
      .map((entry) => historySourceId(entry))
      .filter((sourceId): sourceId is HistorySourceId => Boolean(sourceId && sourceId !== "cloud")),
  );
  const visible = AGENT_SOURCES.filter((source) => {
    if (source.id === "cloud" || !visibility.enabled.has(source.id)) return false;
    return visibility.visibleSet.has(source.id) || sourcesWithEntries.has(source.id);
  }).map((source) => source.id);
  return {
    ...visibility,
    visible,
    visibleSet: new Set(visible),
  };
}

function achievementText(def: AchievementDef): Pick<AchievementDef, "name" | "description" | "flavor"> {
  if (currentLanguage() === "en-US") return ACHIEVEMENT_TEXT_EN[def.id] ?? def;
  return def;
}

function achievementCategoryLabel(category: AchievementCategory) {
  return ACHIEVEMENT_CATEGORY_LABELS[currentLanguage()][category] ?? ACHIEVEMENT_CATEGORY_LABELS["zh-CN"][category];
}

function achievementRarityLabel(rarity: AchievementRarity) {
  return ACHIEVEMENT_RARITY_LABELS[currentLanguage()][rarity] ?? ACHIEVEMENT_RARITY_LABELS["zh-CN"][rarity];
}

function relativeTimeText(value: number, unitKey: "secondsAgo" | "minutesAgo" | "hoursAgo") {
  return currentLanguage() === "zh-CN" ? `${value} ${t(unitKey)}` : `${value} ${t(unitKey)}`;
}

async function boot() {
  if (viewMode === "toast") {
    const nextLedger = await window.bonsai.getLedger();
    ledger = nextLedger;
    appLanguage = normalizeLanguage(ledger.settings.language);
    applyUiTheme("night");
    applyI18n();
    window.bonsai.onLedger((nextLedger) => {
      ledger = nextLedger;
      appLanguage = normalizeLanguage(ledger.settings.language);
      applyUiTheme("night");
      applyI18n();
    });
    bindToastOverlayEvents();
    return;
  }
  tree = buildTreeAsset(DEFAULT_PURE_SVG_MANIFEST);
  gameBalance = DEFAULT_GAME_BALANCE;
  renderInitialTreePreview();

  const [nextLedger, nextUsageStatus, nextUpdateStatus, nextLeaderboardStatus, nextCloudSyncStatus, nextAchievementState] = await Promise.all([
    window.bonsai.getLedger(),
    window.bonsai.getUsageStatus(),
    window.bonsai.getUpdateStatus(),
    window.bonsai.getLeaderboardStatus(),
    window.bonsai.getCloudSyncStatus(),
    window.bonsai.getAchievements(),
  ]);
  ledger = nextLedger;
  appLanguage = normalizeLanguage(ledger.settings.language);
  usageStatus = nextUsageStatus;
  updateStatus = nextUpdateStatus;
  leaderboardStatus = nextLeaderboardStatus;
  cloudSyncStatus = nextCloudSyncStatus;
  achievementState = nextAchievementState;
  initializeSeenAchievements();
  hydrateLeaderboardCache();

  bindEvents();
  if (viewMode === "manager") {
    bindMenubarComponentSettings();
    window.bonsai.onOpenSettings((category) => {
      setSettingsOpen(true);
      if (category != null && isSettingsCategory(category)) {
        activateSettingsCategory(category);
      }
    });
    window.bonsai.onOpenDashboardTab((tab) => {
      dashboardTab = tab;
      setSettingsOpen(false);
      renderDashboardTabs();
      renderLeaderboard();
    });
  }
  if (viewMode === "menubar") {
    bindMenubarEvents();
    buildMenubarDots();
    void refreshLeaderboard({ forceFetch: true }).then(render);
  }
  applyI18n();
  render();
  if (viewMode === "manager") {
    window.bonsai.notifyManagerReady();
  }
  void refreshTreeConfig();
  setInterval(render, RENDER_INTERVAL_MS);
  startAutoBadgeFlipLoop();

  window.bonsai.onLedger((nextLedger) => {
    ledger = nextLedger;
    appLanguage = normalizeLanguage(ledger.settings.language);
    applyI18n();
    // The visible component set lives in settings; rebuild the pager when it changes.
    if (viewMode === "menubar") refreshMenubarViz();
    render();
  });
  window.bonsai.onUsageStatus((nextStatus) => {
    usageStatus = nextStatus;
    if (viewMode === "menubar") {
      scheduleMenubarRender();
    } else {
      renderUsageStatus();
    }
  });
  window.bonsai.onUpdateStatus((nextStatus) => {
    updateStatus = nextStatus;
    renderUpdateStatus();
  });
  window.bonsai.onLeaderboardStatus((nextStatus) => {
    const previousProfileId = leaderboardStatus.profile?.id;
    leaderboardStatus = nextStatus;
    if (!nextStatus.authenticated || nextStatus.profile?.id !== previousProfileId) {
      socialProfilePrivacy = null;
      socialProfilePrivacyError = "";
      socialProfilePrivacyMessage = "";
    }
    if (viewMode === "menubar") {
      scheduleMenubarRender();
    } else {
      renderLeaderboardSettings();
      renderSocialProfilePrivacySettings();
      renderLeaderboard();
    }
  });
  // Another window fetched fresh standings and shared them — adopt without refetching.
  window.bonsai.onLeaderboardData((collection) => {
    applyLeaderboardCollection(collection);
    if (viewMode === "menubar") {
      scheduleMenubarRender();
    } else {
      renderLeaderboard();
    }
  });
  window.bonsai.onAchievements((nextState, unlocked) => {
    achievementState = nextState;
    renderAchievements();
  });
}

function renderInitialTreePreview() {
  if (!tree) return;
  const stage = tree.stages[0];
  if (!stage) return;
  if (treeImage) {
    treeImage.src = assetUrl(stage.image);
    treeImage.alt = `${tree.displayName} ${stageLabel(stage.id, stage.label)}`;
  }
  if (previewTreeImage) {
    previewTreeImage.src = assetUrl(stage.image);
    previewTreeImage.alt = `${tree.displayName} ${stageLabel(stage.id, stage.label)}`;
  }
  if (treeStartTreeImage) {
    treeStartTreeImage.src = assetUrl(stage.image);
    treeStartTreeImage.alt = "";
  }
}

async function refreshTreeConfig() {
  try {
    const [manifest, balance] = await Promise.all([
      fetch(assetUrl("/assets/trees/vibe-bonsai/config/pure-svg-manifest.json")).then(
        (res) => res.json() as Promise<PureSvgManifest>,
      ),
      fetch(assetUrl("/assets/trees/vibe-bonsai/config/game-balance.json")).then(
        (res) => res.json() as Promise<GameBalance>,
      ),
    ]);
    tree = buildTreeAsset(manifest);
    gameBalance = balance;
    render();
  } catch (error) {
    console.warn("Failed to refresh tree config", error);
  }
}

function bindToastOverlayEvents() {
  window.bonsai.onAchievementToast((payload) => {
    root.dataset.placement = payload.placement;
    queueTreeToasts(payload.items ?? (payload.ids ?? []).map((id) => ({ type: "achievement", id })));
  });
  window.bonsai.onAchievementToastPlacement((placement) => {
    root.dataset.placement = placement;
  });
  window.bonsai.notifyAchievementToastReady();
}

function bindEvents() {
  if (viewMode === "pet") {
    const petStage = document.querySelector<HTMLElement>("#petStage")!;
    const petHitbox = document.querySelector<HTMLButtonElement>("#petHitbox")!;
    petLevelBadge?.addEventListener("pointerenter", () => {
      showLevelBadgeBack("#petLevelBadge");
    });
    petLevelBadge?.addEventListener("pointerleave", () => {
      hideLevelBadgeBack("#petLevelBadge");
    });
    petLevelBadge?.addEventListener("dblclick", () => {
      void window.bonsai.setExpanded(true);
    });

    petHitbox.addEventListener("click", (event) => {
      if (event.detail === 0) void window.bonsai.setExpanded(true);
    });

    petStage.addEventListener("pointerdown", async (event) => {
      if (event.button !== 0 || ledger?.settings.locked) return;
      if ((event.target as HTMLElement).closest("#petLevelBadge")) return;
      if (event.detail >= 2) {
        activePetPointer = null;
        void endPetDrag();
        void window.bonsai.setExpanded(true);
        return;
      }
      activePetPointer = {
        pointerId: event.pointerId,
        x: event.screenX,
        y: event.screenY,
        moved: false,
      };
      pendingDragPointerId = event.pointerId;
      petStage.setPointerCapture(event.pointerId);
      const startBounds = await window.bonsai.getWindowBounds();
      if (pendingDragPointerId !== event.pointerId || (event.buttons & 1) !== 1) return;
      if (!startBounds) return;
      dragState = {
        startMouse: { x: event.screenX, y: event.screenY },
        startBounds,
        pointerId: event.pointerId,
      };
    });

    petStage.addEventListener("pointermove", async (event) => {
      if (activePetPointer?.pointerId === event.pointerId && pointerDistance(activePetPointer, event) > 6) {
        activePetPointer.moved = true;
      }
      if (!dragState) return;
      if (dragState.pointerId !== event.pointerId || (event.buttons & 1) !== 1) {
        await endPetDrag();
        return;
      }
      const dx = event.screenX - dragState.startMouse.x;
      const dy = event.screenY - dragState.startMouse.y;
      await window.bonsai.setWindowPosition({
        x: dragState.startBounds.x + dx,
        y: dragState.startBounds.y + dy,
      });
    });

    petStage.addEventListener("pointerup", (event) => {
      const isTap = consumePetTap(event);
      void endPetDrag();
      if (isTap) void window.bonsai.setExpanded(true);
    });
    petStage.addEventListener("pointercancel", () => void resetPetPointer());
    petStage.addEventListener("lostpointercapture", () => void endPetDrag());
    window.addEventListener("blur", () => void resetPetPointer());
  } else {
    previewLevelBadge?.addEventListener("pointerenter", () => {
      showLevelBadgeBack("#previewLevelBadge");
    });
    previewLevelBadge?.addEventListener("pointerleave", () => {
      hideLevelBadgeBack("#previewLevelBadge");
    });
  }

  lockInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ locked: lockInput.checked });
    render();
  });

  settingsButton?.addEventListener("click", () => {
    setSettingsOpen(true);
  });

  settingsCloseButton?.addEventListener("click", () => {
    setSettingsOpen(false);
  });

  settingsBackdrop?.addEventListener("click", () => {
    setSettingsOpen(false);
  });

  socialSettingsButton?.addEventListener("click", () => {
    setSocialSettingsOpen(true);
  });

  socialSettingsCloseButton?.addEventListener("click", () => {
    setSocialSettingsOpen(false);
  });

  socialSettingsBackdrop?.addEventListener("click", () => {
    setSocialSettingsOpen(false);
  });

  socialGroupManageButton?.addEventListener("click", () => {
    setSocialGroupActionsOpen(true);
  });

  socialGroupActionsCloseButton?.addEventListener("click", () => {
    setSocialGroupActionsOpen(false);
  });

  socialGroupActionsBackdrop?.addEventListener("click", () => {
    setSocialGroupActionsOpen(false);
  });

  settingsNav?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-settings-category-button]");
    const category = button?.dataset.settingsCategoryButton;
    if (!button || !isSettingsCategory(category)) return;
    activateSettingsCategory(category);
    button.focus();
  });

  settingsNav?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowLeft") {
      return;
    }
    event.preventDefault();
    focusAdjacentSettingsCategory(event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (socialProfileOpen) {
        closeSocialProfile();
        return;
      }
      setSocialSettingsOpen(false);
      setSettingsOpen(false);
      setSocialGroupActionsOpen(false);
    }
  });

  scaleSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ scale: Number(scaleSelect.value) });
    render();
  });

  fontScaleSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    const scale = Number(fontScaleSelect.value);
    document.documentElement.style.setProperty("--font-scale", String(scale));
    ledger = await window.bonsai.updateSettings({ fontScale: scale });
  });

  languageSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ language: normalizeLanguage(languageSelect.value) });
    appLanguage = ledger.settings.language;
    lastHistoryChartKey = "";
    applyI18n();
    render();
  });

  themeSwitcher?.addEventListener("click", async (event) => {
    if (!ledger) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-ui-theme]");
    if (!button) return;
    const uiTheme = normalizeUiTheme(button.dataset.uiTheme);
    if (uiTheme === ledger.settings.uiTheme) return;
    ledger = await window.bonsai.updateSettings({ uiTheme });
    render();
  });

  sourceSettings?.addEventListener("change", async (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-stats-source]");
    if (!ledger || !input) return;
    const enabledSourceIds = selectedStatsSourceIds();
    ledger = await window.bonsai.updateSettings({ enabledSourceIds });
    if (historyFilter !== "all" && !sourceVisibility().visibleSet.has(historyFilter)) historyFilter = "all";
    expandedSourceKey = null;
    lastHistoryChartKey = "";
    render();
  });

  launchOnStartupInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ launchOnStartup: launchOnStartupInput.checked });
    render();
  });

  silentStartupInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ silentStartup: silentStartupInput.checked });
    render();
  });

  proxyUrlInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ proxyUrl: proxyUrlInput.value.trim() || undefined });
    render();
  });

  updateCheckEnabledInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ updateCheckEnabled: updateCheckEnabledInput.checked });
    render();
  });

  checkUpdateButton?.addEventListener("click", async () => {
    updateStatus = await window.bonsai.checkForUpdates();
    renderUpdateStatus();
  });

  installUpdateButton?.addEventListener("click", async () => {
    updateStatus = await window.bonsai.installUpdate();
    renderUpdateStatus();
  });

  updateNotesButton?.addEventListener("click", () => {
    showUpdateNotesModal();
  });

  releasePageButton?.addEventListener("click", () => {
    void window.bonsai.openUpdatePage();
  });

  treeStartNewButton?.addEventListener("click", async () => {
    setTreeStartFeedback(t("treeStartSaving"), "busy");
    const pendingVersion = setTreeStartPending("new");
    try {
      cloudSyncStatus = await window.bonsai.startNewTree();
      if (!isCurrentTreeStartPending(pendingVersion)) return;
      setTreeStartFeedback(t("treeStartSaved"), "success");
      await wait(TREE_START_FEEDBACK_HOLD_MS);
      if (!isCurrentTreeStartPending(pendingVersion)) return;
      ledger = await window.bonsai.getLedger();
    } catch (error) {
      if (!isCurrentTreeStartPending(pendingVersion)) return;
      setTreeStartFeedback(error instanceof Error ? error.message : t("treeStartCancelled"), "error");
    } finally {
      if (isCurrentTreeStartPending(pendingVersion)) {
        clearTreeStartPending(pendingVersion);
        render();
      }
    }
  });

  treeStartExistingButton?.addEventListener("click", async () => {
    setTreeStartFeedback(t("treeStartJoining"), "busy");
    const pendingVersion = setTreeStartPending("cloud");
    scheduleTreeStartCloudHelp();
    try {
      cloudSyncStatus = await window.bonsai.joinExistingTree();
      if (!isCurrentTreeStartPending(pendingVersion)) return;
      ledger = await window.bonsai.getLedger();
      achievementState = await window.bonsai.getAchievements();
      if (!ledger.settings.treeStartMode) {
        setTreeStartFeedback(cloudSyncStatus.error || cloudSyncStatusCopy(), "error");
      } else {
        setTreeStartFeedback(t("treeStartJoined"), "success");
        await wait(TREE_START_FEEDBACK_HOLD_MS);
      }
    } catch (error) {
      if (!isCurrentTreeStartPending(pendingVersion)) return;
      setTreeStartFeedback(error instanceof Error ? error.message : t("treeStartCancelled"), "error");
    } finally {
      if (isCurrentTreeStartPending(pendingVersion)) {
        clearTreeStartPending(pendingVersion);
        render();
      }
    }
  });

  treeStartCancelButton?.addEventListener("click", () => {
    if (treeStartPendingAction !== "cloud") return;
    clearTreeStartPending();
    setTreeStartFeedback(t("treeStartCancelled"), "error");
    render();
    void window.bonsai
      .cancelCloudAuth()
      .then((status) => {
        cloudSyncStatus = status;
        if (!ledger?.settings.treeStartMode) {
          setTreeStartFeedback(t("treeStartCancelled"), "error");
          render();
        }
      })
      .catch((error) => {
        if (!ledger?.settings.treeStartMode) {
          setTreeStartFeedback(error instanceof Error ? error.message : t("treeStartCancelled"), "error");
          render();
        }
      });
  });

  window.addEventListener("focus", remindTreeStartCloudPending);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) remindTreeStartCloudPending();
  });

  cloudSyncActionButton?.addEventListener("click", async () => {
    cloudSyncActionButton.disabled = true;
    cloudSyncStatus = cloudSyncStatus.enabled
      ? await window.bonsai.syncCloudTree()
      : await window.bonsai.enableCloudSync();
    ledger = await window.bonsai.getLedger();
    achievementState = await window.bonsai.getAchievements();
    cloudSyncActionButton.disabled = false;
    render();
  });

  cloudSyncAutoSyncInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({
      cloudSyncAutoSyncEnabled: cloudSyncAutoSyncInput.checked,
    });
    render();
  });

  leaderboardAutoSyncInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({
      leaderboardAutoSyncEnabled: leaderboardAutoSyncInput.checked,
    });
    render();
  });

  leaderboardPreferencesPublicInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({
      leaderboardPreferencesPublic: leaderboardPreferencesPublicInput.checked,
    });
    render();
    if (leaderboardStatus.joined) void syncLeaderboard({ force: true });
  });

  socialProfileVisibilitySelect?.addEventListener("change", () => {
    void updateSocialProfilePrivacy({
      profileVisibility: normalizeSocialProfileVisibility(socialProfileVisibilitySelect.value),
    });
  });

  socialProfileShowLevelInput?.addEventListener("change", () => {
    void updateSocialProfilePrivacy({ showLevel: socialProfileShowLevelInput.checked });
  });

  socialProfileShowTokenTotalInput?.addEventListener("change", () => {
    void updateSocialProfilePrivacy({ showTokenTotal: socialProfileShowTokenTotalInput.checked });
  });

  socialProfileShowActiveDaysInput?.addEventListener("change", () => {
    void updateSocialProfilePrivacy({ showActiveDays: socialProfileShowActiveDaysInput.checked });
  });

  socialProfileShowAchievementsInput?.addEventListener("change", () => {
    void updateSocialProfilePrivacy({ showAchievements: socialProfileShowAchievementsInput.checked });
  });

  leaderboardPageRefreshButton?.addEventListener("click", () => {
    void refreshLeaderboard({ syncFirst: leaderboardStatus.joined, forceSync: true, forceFetch: true });
  });

  leaderboardPageSyncButton?.addEventListener("click", async () => {
    if (leaderboardStatus.joined) {
      await leaveLeaderboard();
      return;
    }
    await joinLeaderboardWithPrompt();
  });

  badgeFrontMetricSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({
      badgeFrontMetric: normalizeBadgeMetric(badgeFrontMetricSelect.value, "level"),
    });
    render();
  });

  badgeBackMetricSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({
      badgeBackMetric: normalizeBadgeMetric(badgeBackMetricSelect.value, "total"),
    });
    render();
  });

  totalDisplayUnitSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({
      totalDisplayUnit: normalizeTotalDisplayUnit(totalDisplayUnitSelect.value),
    });
    render();
  });

  codexSessionsDirInput?.addEventListener("change", () => updatePathSetting("codexSessionsDir", codexSessionsDirInput));
  claudeSessionsDirInput?.addEventListener("change", () =>
    updatePathSetting("claudeSessionsDir", claudeSessionsDirInput),
  );
  openclawSessionsDirInput?.addEventListener("change", () =>
    updatePathSetting("openclawSessionsDir", openclawSessionsDirInput),
  );
  piSessionsDirInput?.addEventListener("change", () => updatePathSetting("piSessionsDir", piSessionsDirInput));
  opencodeSessionsDirInput?.addEventListener("change", () =>
    updatePathSetting("opencodeSessionsDir", opencodeSessionsDirInput),
  );
  geminiSessionsDirInput?.addEventListener("change", () =>
    updatePathSetting("geminiSessionsDir", geminiSessionsDirInput),
  );
  hermesSessionsDirInput?.addEventListener("change", () =>
    updatePathSetting("hermesSessionsDir", hermesSessionsDirInput),
  );

  historyTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-history-filter]");
    if (!button) return;
    const nextFilter = button.dataset.historyFilter as HistoryFilter | undefined;
    if (!nextFilter || nextFilter === historyFilter) return;
    historyFilter = nextFilter;
    render();
  });

  sourceBreakdownElement?.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-source-key]");
    if (!row || !ledger) return;
    if (row.dataset.compact === "true") return;
    const sourceKey = row.dataset.sourceKey;
    if (!sourceKey) return;
    expandedSourceKey = expandedSourceKey === sourceKey ? null : sourceKey;
    renderScopedSourceBreakdown();
  });

  sourceScopeTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-source-scope]");
    if (!button) return;
    const nextScope = button.dataset.sourceScope as SourceScope | undefined;
    if (!nextScope || nextScope === sourceScope) return;
    sourceScope = nextScope;
    expandedSourceKey = null;
    renderScopedSourceBreakdown();
  });

  sideTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-dashboard-tab]");
    if (!button) return;
    const nextTab = button.dataset.dashboardTab as DashboardTab | undefined;
    if (!nextTab || nextTab === dashboardTab) return;
    dashboardTab = nextTab;
    if (dashboardTab !== "social") {
      setSocialSettingsOpen(false);
      setSocialGroupActionsOpen(false);
    }
    renderDashboardTabs();
    if (dashboardTab === "leaderboard") {
      ensureLeaderboardLoaded();
      return;
    }
    if (dashboardTab === "social") {
      ensureSocialLoaded();
      return;
    }
    renderLeaderboard();
    renderSocial();
  });

  leaderboardRangeTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-leaderboard-range]");
    if (!button) return;
    const nextRange = normalizeLeaderboardRange(button.dataset.leaderboardRange);
    if (nextRange === leaderboardRange) return;
    leaderboardRange = nextRange;
    if (!applyCachedLeaderboardRange()) {
      leaderboardData = { range: leaderboardRange, entries: [] };
      leaderboardLoadedRange = null;
      leaderboardRenderKey = "";
    }
    renderLeaderboard();
    if (!isLeaderboardCacheFresh()) void refreshLeaderboard({ forceFetch: true });
  });

  socialRefreshButton?.addEventListener("click", () => {
    void refreshSocial({ syncFirst: true });
  });

  socialModeTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-social-panel]");
    if (!button) return;
    const nextPanel = button.dataset.socialPanel === "groups" ? "groups" : "friends";
    if (nextPanel === socialPanel) return;
    socialPanel = nextPanel;
    socialNotice = "";
    if (socialPanel !== "groups") setSocialGroupActionsOpen(false);
    socialRenderKey = "";
    renderSocial();
    if (socialPanel === "groups" && socialSelectedGroupId && !socialGroupLeaderboard) {
      socialGroupLeaderboard = cachedSocialGroupLeaderboard(socialSelectedGroupId, socialGroupRange, socialGroupBasis);
      socialRenderKey = "";
      renderSocial();
      if (!socialGroupLeaderboard) void refreshSocialGroupLeaderboard();
    }
  });

  socialAddFriendForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void requestSocialFriendFromInput();
  });

  socialFriendList?.addEventListener("click", (event) => {
    const profileTrigger = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-social-profile-id]");
    if (profileTrigger) {
      const profileUserId = profileTrigger.dataset.socialProfileId;
      if (profileUserId) void openSocialProfile(profileUserId);
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-social-friend-action]");
    if (!button) return;
    const userId = button.dataset.socialFriendId;
    if (!userId) return;
    const action = button.dataset.socialFriendAction;
    if (action === "accept") {
      void acceptSocialFriendRequest(userId);
    } else if (action === "remove") {
      void removeSocialFriendRelationship(userId);
    }
  });

  socialGroupInbox?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-social-group-inbox-action]");
    if (!button) return;
    const requestId = button.dataset.socialGroupRequestId;
    if (!requestId) return;
    if (button.dataset.socialGroupInboxAction === "accept") {
      void acceptIncomingSocialGroupInvite(requestId);
    } else if (button.dataset.socialGroupInboxAction === "decline") {
      void declineIncomingSocialGroupInvite(requestId);
    }
  });

  socialCreateGroupForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void createSocialGroupFromInput();
  });

  socialJoinInviteForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void acceptSocialInviteFromInput();
  });

  socialGroupList?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-social-group-id]");
    if (!button) return;
    const nextGroupId = button.dataset.socialGroupId;
    if (!nextGroupId || nextGroupId === socialSelectedGroupId) return;
    socialSelectedGroupId = nextGroupId;
    clearSocialInvite();
    socialGroupLeaderboard = cachedSocialGroupLeaderboard(nextGroupId, socialGroupRange, socialGroupBasis);
    socialGroupJoinRequests = [];
    socialRenderKey = "";
    renderSocial();
    if (!socialGroupLeaderboard) void refreshSocialGroupLeaderboard();
    void refreshSelectedSocialGroupRequests();
  });

  socialGroupDetailPanel?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-social-group-action]");
    if (!button) return;
    const groupId = button.dataset.groupId;
    if (!groupId) return;
    if (button.dataset.socialGroupAction === "leave") {
      void leaveSocialGroupRelationship(groupId);
    } else if (button.dataset.socialGroupAction === "toggle-share") {
      void toggleSocialGroupShareUsage(groupId);
    }
  });

  socialGroupLeaderboardRows?.addEventListener("click", (event) => {
    const trigger = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-social-profile-id]");
    if (!trigger) return;
    const profileUserId = trigger.dataset.socialProfileId;
    if (profileUserId) void openSocialProfile(profileUserId);
  });

  socialProfileCloseButton?.addEventListener("click", () => {
    closeSocialProfile();
  });

  socialProfileBackdrop?.addEventListener("click", () => {
    closeSocialProfile();
  });

  socialGroupRangeTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-social-group-range]");
    if (!button) return;
    const nextRange = normalizeLeaderboardRange(button.dataset.socialGroupRange);
    if (nextRange === socialGroupRange) return;
    socialGroupRange = nextRange;
    socialGroupLeaderboard = socialSelectedGroupId
      ? cachedSocialGroupLeaderboard(socialSelectedGroupId, socialGroupRange, socialGroupBasis)
      : null;
    socialRenderKey = "";
    renderSocial();
    if (!socialGroupLeaderboard) void refreshSocialGroupLeaderboard();
  });

  socialGroupBasisTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-social-group-basis]");
    if (!button) return;
    const nextBasis = normalizeSocialGroupBasis(button.dataset.socialGroupBasis);
    if (nextBasis === socialGroupBasis) return;
    socialGroupBasis = nextBasis;
    socialGroupLeaderboard = socialSelectedGroupId
      ? cachedSocialGroupLeaderboard(socialSelectedGroupId, socialGroupRange, socialGroupBasis)
      : null;
    socialRenderKey = "";
    renderSocial();
    if (!socialGroupLeaderboard) void refreshSocialGroupLeaderboard();
  });

  socialCreateInviteButton?.addEventListener("click", () => {
    void createOrCopySocialInviteForSelectedGroup();
  });

  socialGroupFriendInviteForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void inviteFriendToSelectedSocialGroup();
  });

  socialGroupRequestList?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-social-group-request-action]");
    if (!button) return;
    const requestId = button.dataset.socialGroupRequestId;
    if (!requestId) return;
    if (button.dataset.socialGroupRequestAction === "approve") {
      void approveSelectedSocialGroupRequest(requestId);
    } else if (button.dataset.socialGroupRequestAction === "decline") {
      void declineSelectedSocialGroupRequest(requestId);
    }
  });

  achievementCategoryTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-achievement-category]");
    if (!button) return;
    const nextCategory = button.dataset.achievementCategory as AchievementCategoryFilter | undefined;
    if (!nextCategory || nextCategory === achievementCategoryFilter) return;
    achievementCategoryFilter = nextCategory;
    renderAchievements();
  });

  achievementStatusTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-achievement-status]");
    if (!button) return;
    const nextStatus = button.dataset.achievementStatus as AchievementStatusFilter | undefined;
    if (!nextStatus || nextStatus === achievementStatusFilter) return;
    achievementStatusFilter = nextStatus;
    renderAchievements();
  });

  achievementGridElement?.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>("[data-achievement-id]");
    if (!item) return;
    const id = item.dataset.achievementId;
    const def = ACHIEVEMENTS.find((d) => d.id === id);
    if (!def) return;
    if (!achievementUnlockedIds().has(def.id)) {
      showLockedAchievementHint(item);
      return;
    }
    const isNew = !seenAchievementIds.has(def.id);
    showAchievementDetail(def, isNew);
    markAchievementSeen(def.id);
  });

  achievementRecentElement?.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>("[data-achievement-id]");
    if (!item) return;
    const id = item.dataset.achievementId;
    const def = ACHIEVEMENTS.find((d) => d.id === id);
    if (!def) return;
    const isNew = !seenAchievementIds.has(def.id);
    showAchievementDetail(def, isNew);
    markAchievementSeen(def.id);
  });

  achievementToastPreviewButton?.addEventListener("click", () => {
    previewAchievementToast();
  });

  shareExportButton?.addEventListener("click", () => {
    void exportShareImage();
  });

}

async function endPetDrag() {
  const shouldPersist = Boolean(dragState);
  pendingDragPointerId = null;
  dragState = null;
  if (shouldPersist) await window.bonsai.persistWindowPosition();
}

async function resetPetPointer() {
  activePetPointer = null;
  await endPetDrag();
}

function consumePetTap(event: PointerEvent) {
  const pointer = activePetPointer;
  activePetPointer = null;
  if (!pointer || pointer.pointerId !== event.pointerId || pointer.moved || pointerDistance(pointer, event) > 8) {
    return false;
  }
  return true;
}

function pointerDistance(start: { x: number; y: number }, event: PointerEvent) {
  return Math.hypot(event.screenX - start.x, event.screenY - start.y);
}

async function updatePathSetting(
  key:
    | "codexSessionsDir"
    | "claudeSessionsDir"
    | "openclawSessionsDir"
    | "piSessionsDir"
    | "opencodeSessionsDir"
    | "geminiSessionsDir"
    | "hermesSessionsDir",
  input: HTMLInputElement,
) {
  if (!ledger) return;
  const value = input.value.trim() || undefined;
  ledger = await window.bonsai.updateSettings({ [key]: value });
  render();
}

async function refreshLeaderboard(options: { syncFirst?: boolean; forceSync?: boolean; forceFetch?: boolean } = {}) {
  if (leaderboardLoading) return;
  if (!options.forceFetch && !options.syncFirst && isLeaderboardCacheFresh()) {
    applyCachedLeaderboardRange();
    renderLeaderboardSettings();
    renderLeaderboard();
    return;
  }
  leaderboardLoading = true;
  renderLeaderboardSettings();
  renderLeaderboard();
  try {
    leaderboardStatus = await window.bonsai.getLeaderboardStatus();
    if (options.syncFirst && leaderboardStatus.joined) {
      await runLeaderboardSync({ force: options.forceSync === true });
    }
    const collection = await window.bonsai.getLeaderboards();
    const results = LEADERBOARD_RANGES.map(
      (range) =>
        collection.ranges[range] ?? {
          range,
          entries: [],
          error: t("leaderboardLoadFailed"),
        },
    );
    let hasFreshResult = false;
    results.forEach((data) => {
      if (!data.error) hasFreshResult = true;
      if (!data.error || !leaderboardDataCache.has(data.range)) leaderboardDataCache.set(data.range, data);
    });
    if (hasFreshResult) {
      persistLeaderboardCache();
      // Share the fresh data with the other window (menu bar popover ↔ dashboard)
      // so its standings update without triggering its own network fetch.
      window.bonsai.publishLeaderboards(collection);
    }
    const cached = leaderboardDataCache.get(leaderboardRange);
    leaderboardData = cached ?? { range: leaderboardRange, entries: [], error: t("leaderboardLoadFailed") };
    leaderboardLoadedRange = cached ? leaderboardRange : null;
  } catch (error) {
    leaderboardData = {
      range: leaderboardRange,
      entries: [],
      error: error instanceof Error ? error.message : t("leaderboardLoadFailed"),
    };
    leaderboardDataCache.set(leaderboardRange, leaderboardData);
    leaderboardLoadedRange = leaderboardRange;
  } finally {
    leaderboardLoading = false;
    renderLeaderboardSettings();
    renderLeaderboard();
  }
}

// Fold a leaderboard collection (e.g. one another window just fetched and
// broadcast) into local cache + current range, without any network fetch.
function applyLeaderboardCollection(collection: LeaderboardCollection) {
  if (!collection?.ranges) return;
  let hasFreshResult = false;
  LEADERBOARD_RANGES.forEach((range) => {
    const data = collection.ranges[range];
    if (!data) return;
    if (!data.error) hasFreshResult = true;
    if (!data.error || !leaderboardDataCache.has(range)) leaderboardDataCache.set(range, data);
  });
  if (!hasFreshResult) return;
  persistLeaderboardCache();
  const cached = leaderboardDataCache.get(leaderboardRange);
  if (cached) {
    leaderboardData = cached;
    leaderboardLoadedRange = leaderboardRange;
  }
}

async function refreshLeaderboardIfVisible() {
  if (dashboardTab === "leaderboard") {
    await refreshLeaderboard({ forceFetch: true });
    return;
  }
  renderLeaderboardSettings();
  renderLeaderboard();
}

async function runLeaderboardSync(options: { force?: boolean } = {}) {
  if (!leaderboardStatus.configured || !leaderboardStatus.authenticated) {
    renderLeaderboardSettings();
    return false;
  }
  renderLeaderboardSettings();
  leaderboardStatus = await window.bonsai.syncLeaderboard({ force: options.force === true });
  if (!leaderboardStatus.error) clearLeaderboardCache();
  return !leaderboardStatus.error;
}

function ensureLeaderboardLoaded() {
  applyCachedLeaderboardRange();
  renderLeaderboardSettings();
  renderLeaderboard();
  if (!leaderboardStatus.configured || isLeaderboardCacheFresh()) return;
  void refreshLeaderboard({ forceFetch: true });
}

function ensureSocialLoaded() {
  renderSocial();
  if (socialFriends.length || socialGroups.length || socialLoading || socialGroupLeaderboardLoading || socialError) return;
  void refreshSocial();
}

async function refreshSocial(options: { syncFirst?: boolean } = {}) {
  if (socialLoading) return;
  socialLoading = true;
  socialError = "";
  socialRenderKey = "";
  renderSocial();
  try {
    leaderboardStatus = await window.bonsai.getLeaderboardStatus();
    if (!leaderboardStatus.configured || !leaderboardStatus.authenticated) {
      socialFriends = [];
      socialGroups = [];
      socialIncomingGroupInvites = [];
      socialOutgoingGroupRequests = [];
      socialGroupJoinRequests = [];
      socialFriendsUpdatedAt = undefined;
      socialGroupsUpdatedAt = undefined;
      socialSelectedGroupId = null;
      socialGroupLeaderboard = null;
      socialError = "";
      return;
    }
    if (options.syncFirst) {
      await runLeaderboardSync({ force: true });
    }
    const [friendList, groupList, requestList] = await Promise.all([
      window.bonsai.getSocialFriends(),
      window.bonsai.getSocialGroups(),
      window.bonsai.getMySocialGroupRequests(),
    ]);
    socialFriends = friendList.friends;
    socialFriendsUpdatedAt = friendList.updatedAt;
    socialGroups = groupList.groups;
    socialGroupsUpdatedAt = groupList.updatedAt;
    socialIncomingGroupInvites = requestList.incomingInvites;
    socialOutgoingGroupRequests = requestList.outgoingRequests;
    socialError = friendList.error ?? groupList.error ?? requestList.error ?? "";
    if (!socialSelectedGroupId || !socialGroups.some((group) => group.groupId === socialSelectedGroupId)) {
      socialSelectedGroupId = socialGroups[0]?.groupId ?? null;
    }
    if (!socialSelectedGroupId) {
      socialGroupLeaderboard = null;
    } else if (
      socialGroupLeaderboard?.groupId !== socialSelectedGroupId ||
      socialGroupLeaderboard?.range !== socialGroupRange ||
      socialGroupLeaderboard?.basis !== socialGroupBasis
    ) {
      socialGroupLeaderboard = cachedSocialGroupLeaderboard(socialSelectedGroupId, socialGroupRange, socialGroupBasis);
    }
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialGroupsLoadFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderLeaderboardSettings();
    renderSocial();
  }
  await refreshSelectedSocialGroupRequests();
  if (
    socialSelectedGroupId &&
    (options.syncFirst || !cachedSocialGroupLeaderboard(socialSelectedGroupId, socialGroupRange, socialGroupBasis))
  ) {
    await refreshSocialGroupLeaderboard({ force: options.syncFirst });
  }
}

async function refreshSocialGroupLeaderboard(options: { force?: boolean } = {}) {
  const groupId = socialSelectedGroupId;
  if (!groupId || socialLoading || socialGroupLeaderboardLoading) {
    renderSocial();
    return;
  }
  const cached = cachedSocialGroupLeaderboard(groupId, socialGroupRange, socialGroupBasis);
  if (cached && !options.force) {
    socialGroupLeaderboard = cached;
    socialError = cached.error ?? "";
    socialRenderKey = "";
    renderSocial();
    return;
  }
  socialGroupLeaderboardLoading = true;
  socialError = "";
  socialRenderKey = "";
  renderSocial();
  try {
    socialGroupLeaderboard = await window.bonsai.getSocialGroupLeaderboard(groupId, socialGroupRange, socialGroupBasis);
    cacheSocialGroupLeaderboard(socialGroupLeaderboard);
    socialError = socialGroupLeaderboard.error ?? "";
  } catch (error) {
    socialGroupLeaderboard = {
      groupId,
      range: socialGroupRange,
      basis: socialGroupBasis,
      entries: [],
      error: error instanceof Error ? error.message : t("socialGroupLeaderboardLoadFailed"),
    };
    cacheSocialGroupLeaderboard(socialGroupLeaderboard);
    socialError = socialGroupLeaderboard.error ?? "";
  } finally {
    socialGroupLeaderboardLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
}

async function refreshSelectedSocialGroupRequests() {
  const group = selectedSocialGroup();
  if (!group || (group.role !== "leader" && group.role !== "officer")) {
    socialGroupJoinRequests = [];
    socialRenderKey = "";
    renderSocial();
    return;
  }
  try {
    const requestList = await window.bonsai.getSocialGroupRequests(group.groupId);
    socialGroupJoinRequests = requestList.requests;
    if (requestList.error) socialError = requestList.error;
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialGroupRequestsLoadFailed");
  } finally {
    socialRenderKey = "";
    renderSocial();
  }
}

function socialGroupLeaderboardCacheKey(
  groupId: string,
  range: LeaderboardRange,
  basis: SocialGroupLeaderboardBasis,
) {
  return `${groupId}:${range}:${basis}`;
}

function cachedSocialGroupLeaderboard(
  groupId: string,
  range: LeaderboardRange,
  basis: SocialGroupLeaderboardBasis,
) {
  return socialGroupLeaderboardCache.get(socialGroupLeaderboardCacheKey(groupId, range, basis)) ?? null;
}

function cacheSocialGroupLeaderboard(board: SocialGroupLeaderboardData) {
  socialGroupLeaderboardCache.set(socialGroupLeaderboardCacheKey(board.groupId, board.range, board.basis), board);
}

function clearSocialGroupLeaderboardCache(groupId: string) {
  for (const key of socialGroupLeaderboardCache.keys()) {
    if (key.startsWith(`${groupId}:`)) socialGroupLeaderboardCache.delete(key);
  }
}

function normalizeSocialGroupBasis(value: unknown): SocialGroupLeaderboardBasis {
  return value === "since_join" || value === "joined" ? "since_join" : "total";
}

async function requestSocialFriendFromInput() {
  const username = socialFriendUsernameInput?.value.trim() ?? "";
  if (!username) {
    socialError = t("socialFriendTargetRequired");
    socialRenderKey = "";
    renderSocial();
    return;
  }
  socialLoading = true;
  socialError = "";
  socialNotice = "";
  socialRenderKey = "";
  renderSocial();
  try {
    const friend = await window.bonsai.requestSocialFriend({ username });
    socialFriendUsernameInput!.value = "";
    upsertSocialFriend(friend);
    // GitHub usernames can be renamed/reclaimed, so confirm the resolved identity.
    socialNotice = t("socialFriendRequestSent").replace("{name}", friend.username);
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialFriendRequestFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
}

async function acceptSocialFriendRequest(userId: string) {
  socialLoading = true;
  socialError = "";
  socialRenderKey = "";
  renderSocial();
  try {
    const friend = await window.bonsai.acceptSocialFriend(userId);
    upsertSocialFriend(friend);
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialFriendAcceptFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
}

async function removeSocialFriendRelationship(userId: string) {
  socialLoading = true;
  socialError = "";
  socialRenderKey = "";
  renderSocial();
  try {
    const list = await window.bonsai.removeSocialFriend(userId);
    socialFriends = list.friends;
    socialFriendsUpdatedAt = list.updatedAt;
    socialError = list.error ?? "";
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialFriendRemoveFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
}

async function createSocialGroupFromInput() {
  const name = socialGroupNameInput?.value.trim() ?? "";
  if (!name) {
    socialError = t("socialGroupNameRequired");
    socialRenderKey = "";
    renderSocial();
    return;
  }
  socialLoading = true;
  socialError = "";
  clearSocialInvite();
  socialRenderKey = "";
  renderSocial();
  let created = false;
  try {
    const group = await window.bonsai.createSocialGroup({ name, visibility: "invite" });
    socialGroupNameInput!.value = "";
    upsertSocialGroup(group);
    socialSelectedGroupId = group.groupId;
    socialGroupLeaderboard = null;
    created = true;
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialGroupCreateFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
  if (created) setSocialGroupActionsOpen(false);
  if (socialSelectedGroupId) await refreshSocialGroupLeaderboard();
}

async function acceptSocialInviteFromInput() {
  const code = socialInviteCodeInput?.value.trim() ?? "";
  if (!code) {
    socialError = t("socialInviteRequired");
    socialRenderKey = "";
    renderSocial();
    return;
  }
  socialLoading = true;
  socialError = "";
  clearSocialInvite();
  socialRenderKey = "";
  renderSocial();
  try {
    const joinRequest = await window.bonsai.requestSocialGroupJoin(code);
    socialInviteCodeInput!.value = "";
    upsertSocialGroupJoinRequest(joinRequest);
    socialNotice = t("socialGroupRequestSubmitted");
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialInviteAcceptFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
  if (!socialError) setSocialGroupActionsOpen(false);
}

async function leaveSocialGroupRelationship(groupId: string) {
  const group = socialGroups.find((item) => item.groupId === groupId);
  const confirmed = await showAppConfirm({
    title: t("socialGroupLeaveConfirmTitle"),
    body: group ? `${group.name}\n\n${t("socialGroupLeaveConfirmBody")}` : t("socialGroupLeaveConfirmBody"),
    confirmText: t("socialGroupLeaveConfirmAction"),
    tone: "danger",
  });
  if (!confirmed.confirmed) return;
  socialLoading = true;
  socialError = "";
  socialRenderKey = "";
  renderSocial();
  try {
    await window.bonsai.leaveSocialGroup(groupId);
    socialGroups = socialGroups.filter((item) => item.groupId !== groupId);
    clearSocialGroupLeaderboardCache(groupId);
    if (socialSelectedGroupId === groupId) {
      socialSelectedGroupId = socialGroups[0]?.groupId ?? null;
      socialGroupLeaderboard = socialSelectedGroupId
        ? cachedSocialGroupLeaderboard(socialSelectedGroupId, socialGroupRange, socialGroupBasis)
        : null;
      clearSocialInvite();
    }
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialGroupLeaveFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
  if (socialSelectedGroupId && !socialGroupLeaderboard) await refreshSocialGroupLeaderboard();
}

async function toggleSocialGroupShareUsage(groupId: string) {
  const group = socialGroups.find((item) => item.groupId === groupId);
  if (!group) return;
  socialLoading = true;
  socialError = "";
  socialRenderKey = "";
  renderSocial();
  try {
    const updated = await window.bonsai.setSocialGroupShareUsage(groupId, group.shareUsage === false);
    upsertSocialGroup(updated);
    clearSocialGroupLeaderboardCache(groupId);
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialGroupShareToggleFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
  await refreshSocialGroupLeaderboard({ force: true });
}

async function createSocialInviteForSelectedGroup() {
  const group = selectedSocialGroup();
  if (!group) {
    socialError = t("socialNoGroupSelected");
    socialRenderKey = "";
    renderSocial();
    return;
  }
  socialLoading = true;
  socialError = "";
  clearSocialInvite();
  socialRenderKey = "";
  renderSocial();
  try {
    socialInvite = await window.bonsai.createSocialGroupInvite(group.groupId, {
      role: "member",
      maxUses: 20,
      expiresInDays: 7,
    });
    socialInviteCopiedAt = 0;
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialInviteCreateFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
}

async function createOrCopySocialInviteForSelectedGroup() {
  const group = selectedSocialGroup();
  if (!group) {
    socialError = t("socialNoGroupSelected");
    socialRenderKey = "";
    renderSocial();
    return;
  }
  if (socialInvite?.groupId === group.groupId) {
    try {
      await copyTextToClipboard(socialInvite.code);
      socialInviteCopiedAt = Date.now();
      const copiedAt = socialInviteCopiedAt;
      window.setTimeout(() => {
        if (socialInviteCopiedAt !== copiedAt) return;
        socialRenderKey = "";
        renderSocial();
      }, 3_000);
      socialError = "";
    } catch {
      socialError = t("socialInviteCopyFailed");
    } finally {
      socialRenderKey = "";
      renderSocial();
    }
    return;
  }
  await createSocialInviteForSelectedGroup();
}

async function inviteFriendToSelectedSocialGroup() {
  const group = selectedSocialGroup();
  const userId = socialGroupFriendInviteSelect?.value ?? "";
  if (!group || !userId) {
    socialError = t("socialInviteFriendEmpty");
    socialRenderKey = "";
    renderSocial();
    return;
  }
  socialLoading = true;
  socialError = "";
  socialRenderKey = "";
  renderSocial();
  try {
    const joinRequest = await window.bonsai.createSocialGroupFriendInvite(group.groupId, { userId, role: "member" });
    upsertSocialGroupJoinRequest(joinRequest);
    socialNotice = t("socialGroupFriendInviteSent").replace("{name}", joinRequest.requesterUsername);
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialGroupFriendInviteFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
}

async function acceptIncomingSocialGroupInvite(requestId: string) {
  socialLoading = true;
  socialError = "";
  socialRenderKey = "";
  renderSocial();
  try {
    const group = await window.bonsai.acceptSocialGroupFriendInvite(requestId);
    removeSocialGroupJoinRequest(requestId);
    upsertSocialGroup(group);
    socialSelectedGroupId = group.groupId;
    socialPanel = "groups";
    socialGroupLeaderboard = null;
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialGroupRequestUpdateFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
  if (socialSelectedGroupId) await refreshSocialGroupLeaderboard({ force: true });
}

async function declineIncomingSocialGroupInvite(requestId: string) {
  socialLoading = true;
  socialError = "";
  socialRenderKey = "";
  renderSocial();
  try {
    await window.bonsai.declineSocialGroupFriendInvite(requestId);
    removeSocialGroupJoinRequest(requestId);
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialGroupRequestUpdateFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
}

async function approveSelectedSocialGroupRequest(requestId: string) {
  const group = selectedSocialGroup();
  if (!group) return;
  socialLoading = true;
  socialError = "";
  socialRenderKey = "";
  renderSocial();
  try {
    const updated = await window.bonsai.approveSocialGroupRequest(group.groupId, requestId);
    removeSocialGroupJoinRequest(requestId);
    upsertSocialGroup(updated);
    clearSocialGroupLeaderboardCache(group.groupId);
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialGroupRequestUpdateFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
  await refreshSocialGroupLeaderboard({ force: true });
}

async function declineSelectedSocialGroupRequest(requestId: string) {
  const group = selectedSocialGroup();
  if (!group) return;
  socialLoading = true;
  socialError = "";
  socialRenderKey = "";
  renderSocial();
  try {
    await window.bonsai.declineSocialGroupRequest(group.groupId, requestId);
    removeSocialGroupJoinRequest(requestId);
  } catch (error) {
    socialError = error instanceof Error ? error.message : t("socialGroupRequestUpdateFailed");
  } finally {
    socialLoading = false;
    socialRenderKey = "";
    renderSocial();
  }
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

function clearSocialInvite() {
  socialInvite = null;
  socialInviteCopiedAt = 0;
}

function upsertSocialFriend(friend: SocialFriend) {
  const index = socialFriends.findIndex((item) => item.userId === friend.userId);
  if (index >= 0) {
    socialFriends = socialFriends.map((item) => (item.userId === friend.userId ? friend : item));
  } else {
    socialFriends = [friend, ...socialFriends];
  }
  socialFriendsUpdatedAt = new Date().toISOString();
}

function upsertSocialGroup(group: SocialGroup) {
  const index = socialGroups.findIndex((item) => item.groupId === group.groupId);
  if (index >= 0) {
    socialGroups = socialGroups.map((item) => (item.groupId === group.groupId ? group : item));
  } else {
    socialGroups = [group, ...socialGroups];
  }
  socialGroupsUpdatedAt = new Date().toISOString();
}

function upsertSocialGroupJoinRequest(request: SocialGroupJoinRequest) {
  const update = (items: SocialGroupJoinRequest[]) => {
    const index = items.findIndex((item) => item.requestId === request.requestId);
    if (index >= 0) return items.map((item) => (item.requestId === request.requestId ? request : item));
    return [request, ...items];
  };
  if (request.status !== "pending") {
    removeSocialGroupJoinRequest(request.requestId);
    return;
  }
  if (request.type === "friend_invite" && request.requesterUserId === leaderboardStatus.profile?.id) {
    socialIncomingGroupInvites = update(socialIncomingGroupInvites);
  } else if (request.type === "invite_code" && request.requesterUserId === leaderboardStatus.profile?.id) {
    socialOutgoingGroupRequests = update(socialOutgoingGroupRequests);
  } else if (request.groupId === socialSelectedGroupId) {
    socialGroupJoinRequests = update(socialGroupJoinRequests);
  }
}

function removeSocialGroupJoinRequest(requestId: string) {
  socialIncomingGroupInvites = socialIncomingGroupInvites.filter((item) => item.requestId !== requestId);
  socialOutgoingGroupRequests = socialOutgoingGroupRequests.filter((item) => item.requestId !== requestId);
  socialGroupJoinRequests = socialGroupJoinRequests.filter((item) => item.requestId !== requestId);
}

function selectedSocialGroup() {
  return socialGroups.find((group) => group.groupId === socialSelectedGroupId) ?? null;
}

async function toggleLeaderboardMembership() {
  if (leaderboardStatus.joined) {
    await leaveLeaderboard();
    return;
  } else if (leaderboardStatus.authenticated) {
    leaderboardStatus = await window.bonsai.setLeaderboardEnabled(true);
  } else {
    leaderboardStatus = await window.bonsai.loginLeaderboard();
  }
  await refreshLeaderboardIfVisible();
}

async function joinLeaderboardWithPrompt() {
  const confirmed = await showAppConfirm({
    title: t("leaderboardJoinConfirmTitle"),
    body: t("leaderboardJoinConfirmBody"),
    confirmText: t("leaderboardJoinConfirmAction"),
    checkbox: {
      label: t("leaderboardJoinPreferenceTitle"),
      description: t("leaderboardJoinPreferenceCopy"),
      checked: ledger?.settings.leaderboardPreferencesPublic === true,
    },
  });
  if (!confirmed.confirmed) return;
  if (ledger && confirmed.checked !== ledger.settings.leaderboardPreferencesPublic) {
    ledger = await window.bonsai.updateSettings({
      leaderboardPreferencesPublic: confirmed.checked,
    });
    render();
  }
  await toggleLeaderboardMembership();
}

async function leaveLeaderboard() {
  const confirmed = await showAppConfirm({
    title: t("leaderboardLeaveConfirmTitle"),
    body: t("leaderboardLeaveConfirmBody"),
    confirmText: t("leaderboardLeaveConfirmAction"),
    tone: "danger",
  });
  if (!confirmed.confirmed) return;
  leaderboardStatus = await window.bonsai.logoutLeaderboard();
  leaderboardData = { range: leaderboardRange, entries: [] };
  clearLeaderboardCache();
  leaderboardLoadedRange = null;
  leaderboardRenderKey = "";
  renderLeaderboardSettings();
  renderLeaderboard();
}

function showAppConfirm(options: {
  title: string;
  body: string;
  confirmText: string;
  cancelText?: string;
  tone?: "normal" | "danger";
  checkbox?: {
    label: string;
    description?: string;
    checked?: boolean;
  };
}) {
  return new Promise<{ confirmed: false } | { confirmed: true; checked: boolean }>((resolve) => {
    const existing = document.querySelector(".app-confirm-modal");
    if (existing) existing.remove();

    const checkboxHtml = options.checkbox
      ? `
        <label class="app-confirm-check">
          <input class="app-confirm-checkbox" type="checkbox"${options.checkbox.checked ? " checked" : ""} />
          <span>
            <strong>${escapeHtml(options.checkbox.label)}</strong>
            ${options.checkbox.description ? `<small>${escapeHtml(options.checkbox.description)}</small>` : ""}
          </span>
        </label>
      `
      : "";
    const modal = document.createElement("section");
    modal.className = "app-confirm-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "appConfirmTitle");
    modal.innerHTML = `
      <div class="app-confirm-backdrop"></div>
      <article class="app-confirm-panel">
        <header>
          <p class="eyebrow">${escapeHtml(t("globalLeaderboard"))}</p>
          <h3 id="appConfirmTitle">${escapeHtml(options.title)}</h3>
          <button class="icon-button app-confirm-close" type="button" aria-label="${escapeHtml(t("close"))}">×</button>
        </header>
        <p>${escapeHtml(options.body)}</p>
        ${checkboxHtml}
        <footer>
          <button class="secondary-button app-confirm-cancel" type="button">${escapeHtml(options.cancelText ?? t("cancel"))}</button>
          <button class="${options.tone === "danger" ? "secondary-button danger-button" : "primary-button"} app-confirm-ok" type="button">${escapeHtml(options.confirmText)}</button>
        </footer>
      </article>
    `;
    document.body.append(modal);

    let settled = false;
    const settle = (value: { confirmed: false } | { confirmed: true; checked: boolean }) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown);
      modal.remove();
      resolve(value);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") settle({ confirmed: false });
    };
    document.addEventListener("keydown", onKeyDown);
    modal.querySelector(".app-confirm-backdrop")?.addEventListener("click", () => settle({ confirmed: false }));
    modal.querySelector(".app-confirm-close")?.addEventListener("click", () => settle({ confirmed: false }));
    modal.querySelector(".app-confirm-cancel")?.addEventListener("click", () => settle({ confirmed: false }));
    modal.querySelector(".app-confirm-ok")?.addEventListener("click", () => {
      settle({
        confirmed: true,
        checked: modal.querySelector<HTMLInputElement>(".app-confirm-checkbox")?.checked === true,
      });
    });
    modal.querySelector<HTMLButtonElement>(".app-confirm-ok")?.focus();
  });
}

async function syncLeaderboard(options: { force?: boolean } = {}) {
  const synced = await runLeaderboardSync(options);
  if (synced) leaderboardLoadedRange = null;
  await refreshLeaderboardIfVisible();
}

function setSettingsOpen(open: boolean) {
  if (!settingsModal) return;
  if (open) {
    activateSettingsCategory(activeSettingsCategory);
    renderMenubarComponentSettings();
  }
  settingsModal.classList.toggle("open", open);
  settingsModal.setAttribute("aria-hidden", String(!open));
}

function setSocialSettingsOpen(open: boolean) {
  if (!socialSettingsModal) return;
  socialSettingsModal.hidden = !open;
  socialSettingsModal.classList.toggle("open", open);
  socialSettingsModal.setAttribute("aria-hidden", String(!open));
  if (open) {
    void ensureSocialProfilePrivacyLoaded();
    window.setTimeout(() => {
      (socialProfileVisibilitySelect ?? socialSettingsCloseButton)?.focus();
    }, 0);
  }
}

function setSocialGroupActionsOpen(open: boolean) {
  if (!socialGroupActionsModal) return;
  socialGroupActionsModal.hidden = !open;
  socialGroupActionsModal.classList.toggle("open", open);
  socialGroupActionsModal.setAttribute("aria-hidden", String(!open));
  if (open) {
    window.setTimeout(() => {
      (socialGroups.length ? socialInviteCodeInput : socialGroupNameInput)?.focus();
    }, 0);
  }
}

async function openSocialProfile(userId: string) {
  const targetUserId = userId.trim();
  if (!targetUserId) return;
  socialProfileOpen = true;
  socialProfileUserId = targetUserId;
  socialProfileLoading = true;
  socialProfile = null;
  socialProfileError = "";
  setSocialProfileModalOpen(true);
  renderSocialProfile();

  const result = await window.bonsai.getSocialProfile(targetUserId);
  // A newer click may have superseded this fetch (or the modal was closed).
  if (!socialProfileOpen || socialProfileUserId !== targetUserId) return;
  socialProfileLoading = false;
  if (result.profile) {
    socialProfile = result.profile;
    socialProfileError = "";
  } else {
    socialProfile = null;
    socialProfileError = result.error || t("socialProfileLoadFailed");
  }
  renderSocialProfile();
}

function closeSocialProfile() {
  if (!socialProfileOpen) return;
  socialProfileOpen = false;
  socialProfileUserId = null;
  socialProfile = null;
  socialProfileError = "";
  socialProfileLoading = false;
  setSocialProfileModalOpen(false);
}

function setSocialProfileModalOpen(open: boolean) {
  if (!socialProfileModal) return;
  socialProfileModal.hidden = !open;
  socialProfileModal.classList.toggle("open", open);
  socialProfileModal.setAttribute("aria-hidden", String(!open));
  if (open) {
    window.setTimeout(() => socialProfileCloseButton?.focus(), 0);
  }
}

function renderSocialProfile() {
  if (!socialProfileBody) return;
  if (socialProfileLoading) {
    socialProfileBody.innerHTML = `<div class="social-profile-status">${escapeHtml(t("socialProfileLoading"))}</div>`;
    return;
  }
  if (socialProfileError) {
    socialProfileBody.innerHTML = `<div class="social-profile-status">${escapeHtml(socialProfileError)}</div>`;
    return;
  }
  const profile = socialProfile;
  if (!profile) {
    socialProfileBody.innerHTML = `<div class="social-profile-status">${escapeHtml(t("socialProfileLoadFailed"))}</div>`;
    return;
  }

  const joined = profile.joinedAt
    ? `${t("socialProfileJoined")} ${new Date(profile.joinedAt).toLocaleDateString(languageLocale(), { year: "numeric", month: "long" })}`
    : "";
  const relationLabel = profile.isSelf
    ? t("socialProfileRelationSelf")
    : profile.isFriend
      ? t("socialProfileRelationFriend")
      : profile.mutualGroupCount > 0
        ? t("socialProfileRelationGroup")
        : "";
  const relationChips = [
    relationLabel,
    profile.mutualGroupCount > 0 && !profile.isSelf ? `${formatNumber(profile.mutualGroupCount)} ${t("socialProfileMutualGroups")}` : "",
    profile.usageVisible ? t("socialProfileUsageShared") : t("socialProfileUsagePrivate"),
  ]
    .filter(Boolean)
    .map((label) => `<span>${escapeHtml(label)}</span>`)
    .join("");
  const headerHtml = `
    <section class="social-profile-hero">
      <div class="social-profile-hero-glow" aria-hidden="true"></div>
      <div class="social-profile-identity">
        ${leaderboardAvatar(profile.avatarUrl, profile.username)}
        <div class="social-profile-identity-copy">
          <span>${escapeHtml(t("socialProfilePlayerFile"))}</span>
          <strong>${escapeHtml(profile.username)}</strong>
          ${joined ? `<em>${escapeHtml(joined)}</em>` : ""}
        </div>
      </div>
      <div class="social-profile-chip-row">${relationChips}</div>
    </section>
    <div class="social-profile-relations">
      <article><strong>${formatNumber(profile.friendCount)}</strong><span>${escapeHtml(t("socialProfileFriends"))}</span></article>
      <article><strong>${formatNumber(profile.groupCount)}</strong><span>${escapeHtml(t("socialProfileGroups"))}</span></article>
      <article><strong>${formatNumber(profile.mutualGroupCount)}</strong><span>${escapeHtml(t("socialProfileMutualGroups"))}</span></article>
    </div>
  `;

  let bodyHtml = "";
  const balance = gameBalance ?? DEFAULT_GAME_BALANCE;
  const tokenTotalVisible = profile.tokenTotalVisible !== false && profile.totalTokens !== undefined;
  const activeDaysVisible = profile.activeDaysVisible !== false && profile.daysActive !== undefined;
  const achievementsVisible = profile.achievementsVisible !== false && profile.achievements !== undefined;
  const progression = tokenTotalVisible ? summarizeXpProgression(profile.totalTokens ?? 0, balance) : null;
  const level = profile.level ?? progression?.level;
  const levelVisible = profile.levelVisible !== false && level !== undefined;
  const hasVisibleGrowthData = levelVisible || tokenTotalVisible || activeDaysVisible || achievementsVisible;

  if (hasVisibleGrowthData) {
    const totalTokens = profile.totalTokens ?? 0;
    const daysActive = profile.daysActive ?? 0;
    const averagePerDay = daysActive > 0 ? Math.round(totalTokens / daysActive) : 0;
    const progressPercent = progression ? Math.round(progression.progress * 100) : 0;
    const stage = progression
      ? stageLabel(progression.stageId, progression.stageLabel)
      : stageLabelForLevel(level ?? 1, balance);
    const levelCard = levelVisible
      ? `
        <section class="social-profile-level-card">
          <div class="social-profile-level-head">
            <span>${escapeHtml(t("socialProfileLevel"))}</span>
            <strong>Lv.${level}</strong>
            <em>${escapeHtml(stage)}</em>
          </div>
          ${
            progression
              ? `
                <div class="progress-track xp-track" aria-label="${escapeHtml(t("socialProfileLevel"))}">
                  <span style="width:${progressPercent}%"></span>
                </div>
                <div class="social-profile-progress-copy">
                  <span>${formatCompact(progression.levelXp)} / ${formatCompact(progression.nextLevelXp)} token</span>
                  <strong>${progressPercent}%</strong>
                </div>
              `
              : `<div class="social-profile-progress-copy muted"><span>${escapeHtml(t("socialProfileLevelProgressHidden"))}</span></div>`
          }
        </section>
      `
      : "";
    const metricCards = [
      tokenTotalVisible
        ? `<article class="primary"><span>${escapeHtml(t("metricTotalTokens"))}</span><strong>${formatNumber(totalTokens)}</strong></article>`
        : "",
      activeDaysVisible
        ? `<article><span>${escapeHtml(t("leaderboardDaysActive"))}</span><strong>${formatNumber(daysActive)}</strong></article>`
        : "",
      tokenTotalVisible && activeDaysVisible
        ? `<article><span>${escapeHtml(t("socialProfileAveragePerDay"))}</span><strong>${formatCompact(averagePerDay)}</strong></article>`
        : "",
      achievementsVisible
        ? `<article><span>${escapeHtml(t("memorialAchievements"))}</span><strong>${formatNumber(profile.achievements?.length ?? 0)}</strong></article>`
        : "",
    ]
      .filter(Boolean)
      .join("");
    bodyHtml = `
      ${levelCard}
      ${metricCards ? `<div class="social-profile-metrics">${metricCards}</div>` : ""}
      ${achievementsVisible ? renderSocialProfileAchievements(profile.achievements ?? []) : ""}
    `;
  } else {
    bodyHtml = `
      <div class="social-profile-private">
        <strong>${escapeHtml(t("socialProfileUsagePrivate"))}</strong>
        <span>${escapeHtml(t("socialProfileUsageHidden"))}</span>
      </div>
    `;
  }

  socialProfileBody.innerHTML = headerHtml + bodyHtml;
}

function stageLabelForLevel(level: number, balance: GameBalance) {
  const stage =
    balance.stages.reduce((current, candidate) => (level >= candidate.minLevel ? candidate : current), balance.stages[0]) ??
    DEFAULT_GAME_BALANCE.stages[0];
  return stageLabel(stage.id, stage.label);
}

function renderSocialProfileAchievements(achievements: SocialProfile["achievements"]) {
  const unlocked = achievements ?? [];
  const heading = `<div class="social-profile-section-title"><strong>${escapeHtml(t("socialProfileShowcase"))}</strong><span>${formatNumber(unlocked.length)} ${escapeHtml(t("memorialAchievements"))}</span></div>`;
  if (!unlocked.length) {
    return `<section class="social-profile-achievements">${heading}<div class="social-profile-empty">${escapeHtml(t("socialProfileNoAchievements"))}</div></section>`;
  }
  const byId = new Map(unlocked.map((entry) => [entry.id, entry]));
  const defs = ACHIEVEMENTS.filter((def) => byId.has(def.id)).sort((a, b) => rarityOrder(a.rarity) - rarityOrder(b.rarity));
  const featured = defs.slice(0, 8);
  const badges = featured
    .map((def) => {
      const copy = achievementText(def);
      return `
        <span class="social-profile-badge rarity-${def.rarity}" title="${escapeHtml(copy.description)}">
          <strong>${escapeHtml(copy.name)}</strong>
          <em>${escapeHtml(achievementRarityLabel(def.rarity))}</em>
        </span>
      `;
    })
    .join("");
  const moreCount = Math.max(0, defs.length - featured.length);
  const more = moreCount > 0 ? `<span class="social-profile-badge more">${t("socialProfileMoreAchievements").replace("{count}", formatNumber(moreCount))}</span>` : "";
  return `<section class="social-profile-achievements">${heading}<div class="social-profile-badges">${badges}${more}</div></section>`;
}

function isSettingsCategory(value: string | undefined): value is SettingsCategory {
  return SETTINGS_CATEGORY_IDS.includes(value as SettingsCategory);
}

function activateSettingsCategory(category: SettingsCategory) {
  activeSettingsCategory = category;
  document.querySelectorAll<HTMLButtonElement>("[data-settings-category-button]").forEach((button) => {
    const active = button.dataset.settingsCategoryButton === category;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll<HTMLElement>("[data-settings-category-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.settingsCategoryPanel !== category;
  });
}

function focusAdjacentSettingsCategory(offset: 1 | -1) {
  const currentIndex = SETTINGS_CATEGORY_IDS.indexOf(activeSettingsCategory);
  const nextIndex = (currentIndex + offset + SETTINGS_CATEGORY_IDS.length) % SETTINGS_CATEGORY_IDS.length;
  const nextCategory = SETTINGS_CATEGORY_IDS[nextIndex];
  activateSettingsCategory(nextCategory);
  document.querySelector<HTMLButtonElement>(`[data-settings-category-button="${nextCategory}"]`)?.focus();
}

// Visible components first (in saved order), then the hidden ones in default order.
function orderedMenubarComponentsForSettings(): { id: MenubarVizId; visible: boolean }[] {
  const visible = menubarVisibleIds();
  const visibleSet = new Set(visible);
  const hidden = MENUBAR_VIZ_IDS.filter((id) => !visibleSet.has(id));
  return [
    ...visible.map((id) => ({ id, visible: true })),
    ...hidden.map((id) => ({ id, visible: false })),
  ];
}

function renderMenubarComponentSettings() {
  if (!menubarComponentList) return;
  const rows = orderedMenubarComponentsForSettings();
  const visibleCount = rows.filter((row) => row.visible).length;
  menubarComponentList.innerHTML = rows
    .map((row, index) => {
      const label = escapeHtml(t(MENUBAR_VIZ_LABEL_KEYS[row.id]));
      // Keep at least one: the last remaining visible component can't be unchecked.
      const lockOff = row.visible && visibleCount <= 1;
      // Reorder only applies within the visible block.
      const prevVisible = index > 0 && rows[index - 1].visible;
      const nextVisible = index + 1 < rows.length && rows[index + 1].visible;
      const canUp = row.visible && prevVisible;
      const canDown = row.visible && nextVisible;
      const lockTitle = lockOff ? ` title="${escapeHtml(t("settingsMenubarKeepOne"))}"` : "";
      return `
        <div class="menubar-component-row${row.visible ? "" : " is-hidden"}" data-viz-id="${row.id}">
          <label class="menubar-component-toggle"${lockTitle}>
            <input type="checkbox" data-menubar-toggle="${row.id}"${row.visible ? " checked" : ""}${lockOff ? " disabled" : ""} />
            <span>${label}</span>
          </label>
          <div class="menubar-component-actions">
            <button type="button" class="menubar-component-move" data-menubar-move="up" data-viz-id="${row.id}" aria-label="${escapeHtml(t("settingsMenubarMoveUp"))}"${canUp ? "" : " disabled"}>↑</button>
            <button type="button" class="menubar-component-move" data-menubar-move="down" data-viz-id="${row.id}" aria-label="${escapeHtml(t("settingsMenubarMoveDown"))}"${canDown ? "" : " disabled"}>↓</button>
          </div>
        </div>`;
    })
    .join("");
}

async function updateMenubarVizIds(next: MenubarVizId[]) {
  if (next.length === 0) return;
  ledger = await window.bonsai.updateSettings({ menubarVizIds: next });
  renderMenubarComponentSettings();
}

function toggleMenubarComponent(id: MenubarVizId, on: boolean) {
  const current = menubarVisibleIds();
  if (on) {
    if (current.includes(id)) return;
    void updateMenubarVizIds([...current, id]);
  } else {
    if (current.length <= 1) return;
    void updateMenubarVizIds(current.filter((vizId) => vizId !== id));
  }
}

function moveMenubarComponent(id: MenubarVizId, direction: "up" | "down") {
  const current = menubarVisibleIds();
  const index = current.indexOf(id);
  if (index < 0) return;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= current.length) return;
  const next = [...current];
  [next[index], next[target]] = [next[target], next[index]];
  void updateMenubarVizIds(next);
}

function bindMenubarComponentSettings() {
  if (!menubarComponentList) return;
  menubarComponentList.addEventListener("change", (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-menubar-toggle]");
    if (!input) return;
    const id = input.dataset.menubarToggle as MenubarVizId;
    toggleMenubarComponent(id, input.checked);
  });
  menubarComponentList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-menubar-move]");
    if (!button || button.disabled) return;
    const id = button.dataset.vizId as MenubarVizId;
    const direction = button.dataset.menubarMove === "up" ? "up" : "down";
    moveMenubarComponent(id, direction);
  });
}

async function exportShareImage() {
  if (!ledger || !tree || !gameBalance || !shareExportButton) return;

  const defaultTitle = t("exportShareImage");
  shareExportButton.disabled = true;
  shareExportButton.dataset.state = "exporting";
  shareExportButton.title = t("generatingPreview");

  try {
    const visibility = sourceVisibility();
    const stats = statsCache.calculateStats(ledger.entries, tree, gameBalance, visibility.enabled, ledgerEntriesSignature());
    const report = await buildShareReportData(ledger.entries, stats);
    openShareExportPreview(report);
    shareExportButton.title = defaultTitle;
  } catch (error) {
    console.error("Failed to export share image", error);
    shareExportButton.title = error instanceof Error ? error.message : String(error);
    window.setTimeout(() => {
      shareExportButton.title = defaultTitle;
    }, 2200);
  } finally {
    shareExportButton.disabled = false;
    delete shareExportButton.dataset.state;
  }
}

function openShareExportPreview(report: ShareReportData) {
  document.querySelector(".share-export-overlay")?.remove();

  const initialTemplateId = shareTemplateForUiTheme(ledger?.settings.uiTheme);
  let activeIndex = Math.max(
    0,
    SHARE_TEMPLATES.findIndex((template) => template.id === initialTemplateId),
  );
  const overlay = document.createElement("div");
  overlay.className = "share-export-overlay";
  overlay.innerHTML = `
    <div class="share-export-backdrop"></div>
    <section class="share-export-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(t("chooseShareTemplate"))}">
      <header class="share-export-head">
        <div>
          <p class="eyebrow">${escapeHtml(t("shareImage"))}</p>
          <h3>${escapeHtml(t("chooseShareTemplate"))}</h3>
        </div>
        <button class="icon-button share-export-close" type="button" aria-label="${escapeHtml(t("close"))}">×</button>
      </header>
      <div class="share-template-carousel" aria-live="polite">
        <button class="share-carousel-nav prev" type="button" aria-label="${escapeHtml(t("previousShareTemplate"))}">‹</button>
        <div class="share-carousel-stage">
        ${SHARE_TEMPLATES.map(
          (template, index) => `
            <article class="share-template-option" data-share-card data-template-index="${index}" data-share-template="${template.id}">
              <div class="share-template-preview">
                ${shareReportHtml(report, SHARE_PREVIEW_SIZE.width, SHARE_PREVIEW_SIZE.height, template.id)}
              </div>
            </article>
          `,
        ).join("")}
        </div>
        <button class="share-carousel-nav next" type="button" aria-label="${escapeHtml(t("nextShareTemplate"))}">›</button>
      </div>
      <footer class="share-carousel-footer">
        <div class="share-template-title">
          <strong id="shareSelectedTitle"></strong>
          <span id="shareSelectedNote"></span>
        </div>
        <div class="share-carousel-dots" aria-label="${escapeHtml(t("shareTemplates"))}">
          ${SHARE_TEMPLATES.map(
            (template, index) => `
              <button type="button" data-share-dot="${index}" aria-label="${escapeHtml(t(template.titleKey))}"></button>
            `,
          ).join("")}
        </div>
        <button class="primary-button share-template-export" id="shareTemplateExportButton" type="button">
          ${escapeHtml(t("exportSelectedShareTemplate"))}
        </button>
      </footer>
    </section>
  `;

  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".share-export-backdrop")?.addEventListener("click", close);
  overlay.querySelector(".share-export-close")?.addEventListener("click", close);
  const cards = Array.from(overlay.querySelectorAll<HTMLElement>("[data-share-card]"));
  const dots = Array.from(overlay.querySelectorAll<HTMLButtonElement>("[data-share-dot]"));
  const exportButton = overlay.querySelector<HTMLButtonElement>("#shareTemplateExportButton");
  const selectedTitle = overlay.querySelector<HTMLElement>("#shareSelectedTitle");
  const selectedNote = overlay.querySelector<HTMLElement>("#shareSelectedNote");

  const setActiveTemplate = (nextIndex: number) => {
    activeIndex = (nextIndex + SHARE_TEMPLATES.length) % SHARE_TEMPLATES.length;
    const activeTemplate = SHARE_TEMPLATES[activeIndex];
    cards.forEach((card, index) => {
      const offset = (index - activeIndex + SHARE_TEMPLATES.length) % SHARE_TEMPLATES.length;
      const position = offset === 0 ? "active" : offset === 1 ? "next" : "prev";
      card.dataset.position = position;
      card.setAttribute("aria-hidden", String(position !== "active"));
      card.tabIndex = position === "active" ? 0 : -1;
    });
    dots.forEach((dot, index) => {
      const active = index === activeIndex;
      dot.classList.toggle("active", active);
      dot.setAttribute("aria-current", active ? "true" : "false");
    });
    if (selectedTitle) selectedTitle.textContent = t(activeTemplate.titleKey);
    if (selectedNote) selectedNote.textContent = t(activeTemplate.noteKey);
    if (exportButton) exportButton.dataset.shareTemplate = activeTemplate.id;
  };

  const step = (direction: 1 | -1) => setActiveTemplate(activeIndex + direction);
  overlay.querySelector<HTMLButtonElement>(".share-carousel-nav.prev")?.addEventListener("click", () => step(-1));
  overlay.querySelector<HTMLButtonElement>(".share-carousel-nav.next")?.addEventListener("click", () => step(1));
  cards.forEach((card, index) => {
    card.addEventListener("click", () => {
      if (index !== activeIndex) setActiveTemplate(index);
    });
  });
  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const nextIndex = Number(dot.dataset.shareDot);
      if (Number.isFinite(nextIndex)) setActiveTemplate(nextIndex);
    });
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
  });
  exportButton?.addEventListener("click", () => {
    const templateId = exportButton.dataset.shareTemplate as ShareTemplateId | undefined;
    if (templateId) void exportSelectedShareImage(report, templateId, exportButton, close);
  });
  setActiveTemplate(activeIndex);
  exportButton?.focus();
}

async function exportSelectedShareImage(
  report: ShareReportData,
  templateId: ShareTemplateId,
  button: HTMLButtonElement,
  close: () => void,
) {
  const allButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".share-template-export"));
  const defaultLabel = button.textContent ?? t("exportSelectedShareTemplate");
  allButtons.forEach((item) => {
    item.disabled = true;
  });
  button.textContent = t("generating");

  try {
    const { width, height } = SHARE_EXPORT_SIZE;
    const pngBase64 = await renderShareReportPng(report, width, height, templateId);
    const result = await window.bonsai.saveShareImage({
      filename: `vibe-tree-share-${templateId}-${dateKey(report.generatedAt)}.png`,
      pngBase64,
    });
    if (result.canceled) {
      button.textContent = defaultLabel;
      allButtons.forEach((item) => {
        item.disabled = false;
      });
      return;
    }
    button.textContent = t("exported");
    window.setTimeout(close, 500);
  } catch (error) {
    console.error("Failed to export selected share image", error);
    button.title = error instanceof Error ? error.message : String(error);
    button.textContent = t("exportFailed");
    window.setTimeout(() => {
      button.textContent = defaultLabel;
      button.title = "";
      allButtons.forEach((item) => {
        item.disabled = false;
      });
    }, 2200);
  }
}

async function buildShareReportData(entries: LedgerEntry[], stats: Stats): Promise<ShareReportData> {
  const generatedAt = new Date();
  const enabledSources = sourceVisibility().enabled;
  const hourly = buildShareHourlyProfile(entries, generatedAt, enabledSources);
  const peakTokensPerMinute = Math.max(
    Math.round(hourly.maxHourTokens / 60),
    Math.round(peakStat("peakXpPerMinute", stats.weather.tokensPerMinute)),
  );
  const [treeImage, qrCodeImage] = await Promise.all([
    imageToDataUrl(stats.stage.image),
    qrCodeDataUrl(SHARE_QR_TARGET_URL),
  ]);

  return {
    generatedAt,
    totalTokens: stats.xp,
    todayTokens: stats.todayXp,
    peakTokensPerMinute,
    level: stats.level,
    stageLabel: stageLabel(stats.stage.id, stats.stage.label),
    treeImage,
    mostUsedAgent: mostUsedAgentLabel(entries, enabledSources),
    activeDays: hourly.activeDays,
    currentStreak: currentActiveDayStreak(entries, generatedAt, enabledSources),
    heatLevels: hourly.heatLevels,
    qrCodeImage,
    favoritePeriod: hourly.favoritePeriod,
  };
}

function buildShareHourlyProfile(entries: LedgerEntry[], now: Date, enabledSources: Set<HistorySourceId>) {
  const start = startOfLocalDay(now);
  start.setDate(start.getDate() - 6);
  const end = startOfLocalDay(now);
  end.setDate(end.getDate() + 1);
  const dayMs = 24 * 60 * 60 * 1000;
  const hourTotals = Array.from({ length: 7 * 24 }, () => 0);
  const activeDays = new Set<string>();

  for (const entry of entries) {
    const xp = xpForEntry(entry, enabledSources);
    if (xp <= 0) continue;
    const createdAt = new Date(entry.createdAt);
    const timestamp = createdAt.getTime();
    if (!Number.isFinite(timestamp) || timestamp < start.getTime() || timestamp >= end.getTime()) continue;
    const dayIndex = Math.floor((startOfLocalDay(createdAt).getTime() - start.getTime()) / dayMs);
    if (dayIndex < 0 || dayIndex >= 7) continue;
    const index = dayIndex * 24 + createdAt.getHours();
    hourTotals[index] += xp;
    activeDays.add(dateKey(createdAt));
  }

  const maxHourTokens = Math.max(0, ...hourTotals);
  const heatLevels = hourTotals.map((value) => heatLevel(value, maxHourTokens));
  return {
    activeDays: activeDays.size,
    favoritePeriod: favoriteCodingPeriod(hourTotals),
    heatLevels,
    maxHourTokens,
  };
}

function heatLevel(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0;
  const ratio = Math.sqrt(value / max);
  return clamp(Math.ceil(ratio * 4), 1, 4);
}

function favoriteCodingPeriod(hourTotals: number[]): ShareReportData["favoritePeriod"] {
  const periods = [
    { label: "凌晨", range: "0-5 点", hours: [0, 1, 2, 3, 4, 5] },
    { label: "上午", range: "6-11 点", hours: [6, 7, 8, 9, 10, 11] },
    { label: "中午", range: "12-1 点", hours: [12, 13] },
    { label: "午后", range: "2-5 点", hours: [14, 15, 16, 17] },
    { label: "晚上", range: "6-9 点", hours: [18, 19, 20, 21] },
    { label: "深夜", range: "10-11 点", hours: [22, 23] },
  ];
  let best = periods[0];
  let bestValue = 0;
  for (const period of periods) {
    const value = period.hours.reduce((sum, hour) => {
      let total = 0;
      for (let day = 0; day < 7; day += 1) total += hourTotals[day * 24 + hour] ?? 0;
      return sum + total;
    }, 0);
    if (value > bestValue) {
      best = period;
      bestValue = value;
    }
  }
  if (bestValue <= 0) return { label: "待观察", range: "待解锁" };
  return { label: best.label, range: best.range };
}

function currentActiveDayStreak(entries: LedgerEntry[], now: Date, enabledSources: Set<HistorySourceId>) {
  const activeDayKeys = new Set<string>();
  for (const entry of entries) {
    if (xpForEntry(entry, enabledSources) <= 0) continue;
    const createdAt = new Date(entry.createdAt);
    if (Number.isFinite(createdAt.getTime())) activeDayKeys.add(dateKey(createdAt));
  }

  let streak = 0;
  const cursor = startOfLocalDay(now);
  while (activeDayKeys.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function mostUsedAgentLabel(entries: LedgerEntry[], enabledSources: Set<HistorySourceId>) {
  const top = getSourceBreakdown(entries, enabledSources, sourceLabel).find((row) => row.xp > 0);
  return top?.label ?? "待解锁";
}

async function imageToDataUrl(path: string) {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`Failed to load share image asset: ${response.status}`);
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

async function qrCodeDataUrl(value: string) {
  const svg = await QRCode.toString(value, {
    type: "svg",
    margin: 1,
    width: 512,
    errorCorrectionLevel: "H",
    color: {
      dark: "#11120eff",
      light: "#ffffff00",
    },
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function renderShareReportPng(report: ShareReportData, width: number, height: number, templateId: ShareTemplateId) {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.left = "-9999px";
  host.style.top = "0";
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";
  host.innerHTML = shareReportHtml(report, width, height, templateId);
  document.body.appendChild(host);

  try {
    const card = host.firstElementChild;
    if (!(card instanceof HTMLElement)) throw new Error("Share card render failed");
    await waitForShareReportAssets(card);
    const blob = await toBlob(card, {
      backgroundColor: shareTemplateBackground(templateId),
      cacheBust: true,
      pixelRatio: 1,
    });
    if (!blob) throw new Error("Share image conversion failed");
    const dataUrl = await blobToDataUrl(blob);
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  } finally {
    host.remove();
  }
}

async function waitForShareReportAssets(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
  await document.fonts?.ready;
  await new Promise((resolve) => window.setTimeout(resolve, 160));
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read share image blob"));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Failed to read share image blob")));
    reader.readAsDataURL(blob);
  });
}

function shareTemplateBackground(templateId: ShareTemplateId) {
  if (templateId === "mono") return "#f8f8f5";
  if (templateId === "receipt") return "#fbf7ec";
  return "#161922";
}

function shareReportHtml(report: ShareReportData, width: number, height: number, templateId: ShareTemplateId) {
  const baseWidth = 430;
  const baseHeight = 668;
  const scaleX = width / baseWidth;
  const scaleY = height / baseHeight;
  const scopeClass = `share-card-${templateId}-${width}x${height}`;
  const scope = `.share-card.${scopeClass}`;
  const themeBackground = shareTemplateBackground(templateId);
  const heatCells = report.heatLevels.map((level) => `<i style="--c:var(--heat${level})"></i>`).join("");
  const heatScale = [0, 1, 2, 3, 4].map((level) => `<i style="--c:var(--heat${level})"></i>`).join("");
  const periodStory =
    report.favoritePeriod.label === "待观察"
      ? `这 7 天，<mark>还没有明显时段</mark>，小树在等下一次生长。`
      : `这 7 天，你最常在<mark>${escapeHtml(report.favoritePeriod.label)}</mark>进入 coding 状态。`;

  return `
    <div xmlns="http://www.w3.org/1999/xhtml" class="share-card ${scopeClass}" style="width:${width}px;height:${height}px">
      <style>
        ${scope},
        ${scope} * { box-sizing: border-box; }
        ${scope} {
          position: relative;
          overflow: hidden;
          background: ${themeBackground};
          border-radius: ${Math.round(22 * scaleX)}px;
          font-family: "Cascadia Mono", "Fira Code", Consolas, "Microsoft YaHei", monospace;
        }
        ${scope} .poster {
          --bg: #fbf7ec;
          --panel: rgba(28, 32, 25, 0.05);
          --line: rgba(28, 32, 25, 0.18);
          --ink: #171a14;
          --muted: rgba(45, 52, 42, 0.6);
          --leaf: #2c9c52;
          --accent: #c58a24;
          --qr-bg: #fbf7ec;
          --qr-size: 52px;
          --qr-padding: 5px;
          --heat0: #ebe5d8;
          --heat1: #d2dfbd;
          --heat2: #9bd27f;
          --heat3: #4fb665;
          --heat4: #1f7445;
          position: absolute;
          left: 0;
          top: 0;
          width: ${baseWidth}px;
          height: ${baseHeight}px;
          overflow: hidden;
          padding: 26px;
          border: 1px solid var(--line);
          border-radius: 22px;
          color: var(--ink);
          background: var(--bg);
          box-shadow: 0 24px 70px rgba(30, 38, 36, 0.2);
          transform: scale(${scaleX}, ${scaleY});
          transform-origin: 0 0;
        }
        ${scope} .poster.glass {
          --bg: #161922;
          --panel: rgba(255, 255, 255, 0.1);
          --line: rgba(255, 255, 255, 0.2);
          --ink: #f4f1e9;
          --muted: rgba(244, 241, 233, 0.56);
          --leaf: #c7f66c;
          --accent: #ffcf7a;
          --qr-bg: #f4f1e9;
          --qr-size: 48px;
          --qr-padding: 3px;
          --heat0: #2b2d32;
          --heat1: #4a5832;
          --heat2: #7a9d44;
          --heat3: #c7f66c;
          --heat4: #fff07a;
          background:
            radial-gradient(circle at 50% 30%, rgba(199, 246, 108, 0.12), transparent 30%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 48%),
            var(--bg);
        }
        ${scope} .poster.mono {
          --bg: #f8f8f5;
          --panel: rgba(20, 20, 16, 0.04);
          --line: rgba(20, 20, 16, 0.14);
          --ink: #11120e;
          --muted: rgba(17, 18, 14, 0.56);
          --leaf: #11120e;
          --accent: #4f8f55;
          --qr-bg: #ffffff;
          --qr-size: 52px;
          --qr-padding: 5px;
          --heat0: #e3e3dd;
          --heat1: #b8c5b4;
          --heat2: #8aaa84;
          --heat3: #4f8f55;
          --heat4: #11120e;
        }
        ${scope} .poster::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0.06;
          background-image:
            linear-gradient(currentColor 1px, transparent 1px),
            linear-gradient(90deg, currentColor 1px, transparent 1px);
          background-size: 28px 28px;
          mask-image: radial-gradient(circle at 50% 32%, black, transparent 74%);
        }
        ${scope} .top,
        ${scope} .hero,
        ${scope} .metrics,
        ${scope} .heat-card,
        ${scope} .cta {
          position: relative;
          z-index: 1;
        }
        ${scope} .top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        ${scope} .brand {
          display: grid;
          gap: 5px;
        }
        ${scope} .eyebrow {
          color: var(--leaf);
          font-size: 12px;
          font-weight: 1000;
          letter-spacing: 1.7px;
        }
        ${scope} .brand b {
          font-size: 21px;
        }
        ${scope} .weather {
          display: grid;
          gap: 6px;
          justify-items: end;
          color: var(--accent);
        }
        ${scope} .weather b {
          font-size: 21px;
        }
        ${scope} .weather span {
          color: var(--muted);
          font-size: 11px;
        }
        ${scope} .hero {
          display: grid;
          grid-template-columns: 166px 1fr;
          gap: 18px;
          align-items: center;
          margin-top: 18px;
        }
        ${scope} .tree-frame {
          position: relative;
          display: grid;
          place-items: center;
          height: 166px;
          border: 1px solid var(--line);
          border-radius: 20px;
          background: var(--panel);
        }
        ${scope} .tree-frame::before {
          content: "";
          position: absolute;
          width: 126px;
          height: 126px;
          border-radius: 50%;
          background: color-mix(in srgb, var(--leaf) 20%, transparent);
          filter: blur(18px);
        }
        ${scope} .tree {
          position: relative;
          width: 134px;
          height: 134px;
          object-fit: contain;
          image-rendering: pixelated;
          filter: drop-shadow(0 16px 22px rgba(0, 0, 0, 0.24));
        }
        ${scope} h2 {
          margin: 0;
          font-size: 32px;
          line-height: 1.04;
        }
        ${scope} h2 span {
          color: var(--leaf);
        }
        ${scope} .level {
          margin-top: 12px;
          color: var(--accent);
          font-size: 31px;
          font-weight: 1000;
          line-height: 1;
        }
        ${scope} .metrics {
          display: grid;
          grid-template-columns: 0.92fr 1.16fr 0.92fr;
          gap: 10px;
          margin-top: 12px;
        }
        ${scope} .metric {
          display: grid;
          gap: 5px;
          min-height: 72px;
          padding: 12px;
          border: 1px solid var(--line);
          border-radius: 16px;
          background: var(--panel);
        }
        ${scope} .metric small {
          color: var(--muted);
          font-size: 11px;
          line-height: 1.25;
        }
        ${scope} .metric b {
          font-size: 18px;
          white-space: nowrap;
        }
        ${scope} .metric.featured {
          min-height: 82px;
          padding: 13px;
          border-color: color-mix(in srgb, var(--leaf) 36%, var(--line));
          background: color-mix(in srgb, var(--panel) 72%, var(--leaf) 10%);
        }
        ${scope} .metric.featured small {
          color: var(--leaf);
          font-weight: 900;
        }
        ${scope} .metric.featured b {
          font-size: 24px;
        }
        ${scope} .heat-card {
          margin-top: 12px;
          padding: 14px;
          border: 1px solid var(--line);
          border-radius: 18px;
          background: color-mix(in srgb, var(--bg) 76%, #000 24%);
        }
        ${scope} .heat-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 8px;
        }
        ${scope} .heat-head strong {
          display: block;
          font-size: 16px;
        }
        ${scope} .heat-head mark {
          color: var(--leaf);
          background: transparent;
        }
        ${scope} .heat-meta {
          display: grid;
          grid-template-columns: repeat(2, auto);
          gap: 8px;
          color: var(--muted);
          font-size: 9px;
          text-align: right;
        }
        ${scope} .heat-meta b {
          color: var(--ink);
          font-size: 10px;
        }
        ${scope} .heat-meta span {
          display: grid;
          gap: 2px;
        }
        ${scope} .heat-foot {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 10px;
          margin-top: 8px;
          padding-top: 7px;
          border-top: 1px dashed color-mix(in srgb, var(--line) 72%, transparent);
          color: var(--muted);
          font-size: 9.5px;
          line-height: 1.45;
        }
        ${scope} .heat-foot b {
          color: var(--accent);
          font-size: 10px;
        }
        ${scope} .heat-foot mark {
          color: var(--accent);
          background: transparent;
          font-weight: 900;
        }
        ${scope} .heat-story {
          display: grid;
          gap: 2px;
        }
        ${scope} .heat-scale {
          display: flex;
          align-items: center;
          gap: 4px;
          min-width: 86px;
          text-align: right;
        }
        ${scope} .heat-scale span {
          white-space: nowrap;
        }
        ${scope} .scale-row {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 3px;
        }
        ${scope} .scale-row i {
          width: 9px;
          height: 9px;
          border-radius: 2px;
          background: var(--c);
        }
        ${scope} .heat {
          display: grid;
          grid-template-columns: repeat(24, 1fr);
          gap: 2px;
        }
        ${scope} .heat i {
          display: block;
          aspect-ratio: 1 / 1;
          border-radius: 3px;
          background: var(--c);
        }
        ${scope} .cta {
          position: absolute;
          left: 26px;
          right: 26px;
          bottom: 26px;
          display: flex;
          align-items: flex-end;
          gap: 30px;
          justify-content: space-between;
          color: var(--muted);
          font-size: 13px;
        }
        ${scope} .pill {
          display: grid;
          gap: 10px;
          color: var(--muted);
        }
        ${scope} .pill b {
          color: var(--muted);
          font-size: 13px;
          font-weight: 500;
          line-height: 1.4;
        }
        ${scope} .pill span {
          display: inline-flex;
          align-items: center;
          gap: 7px;
        }
        ${scope} .pill span::before {
          content: "";
          width: 10px;
          height: 10px;
          border-radius: 3px;
          background: var(--leaf);
        }
        ${scope} .qr {
          position: relative;
          width: var(--qr-size);
          height: var(--qr-size);
          display: grid;
          place-items: center;
          padding: var(--qr-padding);
          border: 2px dashed currentColor;
          border-radius: 11px;
          background: var(--qr-bg);
        }
        ${scope} .qr img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          image-rendering: pixelated;
        }
        ${scope} .qr-github {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 15px;
          height: 15px;
          padding: 2px;
          border-radius: 50%;
          color: #11120e;
          background: var(--qr-bg);
          box-shadow: 0 0 0 1px var(--qr-bg);
          transform: translate(-50%, -50%);
        }
      </style>
      <section class="poster ${templateId}">
        <div class="top">
          <div class="brand">
            <span class="eyebrow">VIBE TREE</span>
            <b>Token 天气树</b>
          </div>
          <div class="weather">
            <b>${escapeHtml(formatShareNumber(report.peakTokensPerMinute))}/min</b>
            <span>coding 峰值</span>
          </div>
        </div>
        <div class="hero">
          <div class="tree-frame">
            <img class="tree" src="${escapeHtml(report.treeImage)}" alt="" />
          </div>
          <div>
            <h2>我的<br /><span>成长档案</span></h2>
            <div class="level">Lv.${report.level}</div>
          </div>
        </div>
        <div class="metrics">
          <div class="metric"><small>今日成长</small><b>+${escapeHtml(formatShareNumber(report.todayTokens))}</b></div>
          <div class="metric featured"><small>累计 Token</small><b>${escapeHtml(formatShareNumber(report.totalTokens))}</b></div>
          <div class="metric"><small>最常用 Agent</small><b>${escapeHtml(report.mostUsedAgent)}</b></div>
        </div>
        <div class="heat-card">
          <div class="heat-head">
            <div>
              <strong>最近 <mark>7 天</mark> / 24 小时</strong>
            </div>
            <div class="heat-meta">
              <span>活跃天数<b>${report.activeDays}</b></span>
              <span>当前连续<b>${report.currentStreak}</b></span>
            </div>
          </div>
          <div class="heat">${heatCells}</div>
          <div class="heat-foot">
            <div class="heat-story">
              <span>偏爱时段 <b>${escapeHtml(report.favoritePeriod.range)}</b></span>
              <span>${periodStory}</span>
            </div>
            <div class="heat-scale">
              <span>少</span>
              <div class="scale-row">${heatScale}</div>
              <span>多</span>
            </div>
          </div>
        </div>
        <div class="cta">
          <div class="pill">
            <b>这一周，我把 AI coding 养成了一棵树。</b>
            <span>扫码领取桌面小树</span>
          </div>
          <div class="qr">
            <img src="${escapeHtml(report.qrCodeImage)}" alt="GitHub QR" />
            <svg class="qr-github" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M12 0.7C5.8 0.7 0.8 5.7 0.8 11.9c0 4.9 3.2 9.1 7.6 10.6 0.6 0.1 0.8-0.2 0.8-0.5v-2c-3.1 0.7-3.8-1.3-3.8-1.3-0.5-1.3-1.2-1.6-1.2-1.6-1-0.7 0.1-0.7 0.1-0.7 1.1 0.1 1.7 1.2 1.7 1.2 1 1.7 2.6 1.2 3.2 0.9 0.1-0.7 0.4-1.2 0.7-1.5-2.5-0.3-5.1-1.2-5.1-5.5 0-1.2 0.4-2.2 1.1-3-0.1-0.3-0.5-1.4 0.1-3 0 0 0.9-0.3 3.1 1.1 0.9-0.2 1.8-0.4 2.8-0.4s1.9 0.1 2.8 0.4c2.1-1.4 3.1-1.1 3.1-1.1 0.6 1.5 0.2 2.7 0.1 3 0.7 0.8 1.1 1.8 1.1 3 0 4.3-2.6 5.2-5.1 5.5 0.4 0.3 0.8 1 0.8 2.1V22c0 0.3 0.2 0.6 0.8 0.5 4.4-1.5 7.6-5.7 7.6-10.6C23.2 5.7 18.2 0.7 12 0.7Z"/>
            </svg>
          </div>
        </div>
      </section>
    </div>
  `;
}

function formatShareNumber(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute < 1_000) return `${Math.round(value)}`;
  const units = [
    { value: 1_000_000_000, suffix: "B" },
    { value: 1_000_000, suffix: "M" },
    { value: 1_000, suffix: "K" },
  ];
  const unit = units.find((item) => absolute >= item.value);
  if (!unit) return `${Math.round(value)}`;
  const scaled = absolute / unit.value;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const formatted = scaled.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");
  return `${sign}${formatted}${unit.suffix}`;
}

function render() {
  if (!ledger || !tree || !gameBalance) return;
  const visibility = sourceVisibility();
  const stats = statsCache.calculateStats(ledger.entries, tree, gameBalance, visibility.enabled, ledgerEntriesSignature());
  const leveledUp = lastRenderedLevel !== null && stats.level > lastRenderedLevel;
  if (leveledUp && lastRenderedLevel !== null) {
    pendingLevelUp = { from: lastRenderedLevel, to: stats.level };
  }
  lastRenderedLevel = stats.level;

  root.dataset.weather = stats.weather.id;
  root.dataset.locked = String(ledger.settings.locked);
  root.dataset.active = String(stats.recentXp > 0 || stats.weather.tokensPerMinute > 0);
  root.dataset.scale = String(ledger.settings.scale).replace(".", "-");
  root.dataset.stage = stats.stage.id;
  root.dataset.tab = dashboardTab;
  applyUiTheme(ledger.settings.uiTheme);

  if (treeImage) {
    treeImage.src = assetUrl(stats.stage.image);
    treeImage.alt = `${tree.displayName} ${stageLabel(stats.stage.id, stats.stage.label)}`;
  }
  if (previewTreeImage) {
    previewTreeImage.src = assetUrl(stats.stage.image);
    previewTreeImage.alt = `${tree.displayName} ${stageLabel(stats.stage.id, stats.stage.label)}`;
  }

  renderLevelBadge(
    "#petLevelBadge",
    stats,
    ledger.settings.badgeFrontMetric,
    ledger.settings.badgeBackMetric,
    ledger.settings.totalDisplayUnit,
  );
  renderLevelBadge(
    "#previewLevelBadge",
    stats,
    ledger.settings.badgeFrontMetric,
    ledger.settings.badgeBackMetric,
    ledger.settings.totalDisplayUnit,
  );
  text("#levelTitle", `Lv.${stats.level} ${stageLabel(stats.stage.id, stats.stage.label)}`);
  text("#weatherLabel", weatherLabel(stats.weather.id, stats.weather.label));
  text("#weatherRateText", `${formatNumber(stats.weather.tokensPerMinute)} token/min`);
  text("#totalText", formatNumber(stats.xp));
  text("#todayText", `+${formatNumber(stats.todayXp)}`);
  text("#activeSessionsText", stats.activeSessions ? activeSessionsText(stats.activeSessions) : "0");
  text("#peakText", `${t("fiveMinutePeak")} +${formatNumber(stats.lastFiveMinuteXp)} token`);
  text("#nextLevelText", `${t("nextLevel")}${stats.level + 1}`);
  text("#progressText", `${formatNumber(stats.levelXp)} / ${formatNumber(stats.nextLevelXp)} token`);

  if (lastWeatherId !== stats.weather.id) {
    lastWeatherId = stats.weather.id;
    renderWeatherLayers(stats.weather.id);
  }
  if (pendingLevelUp) triggerLevelUpAnimation(pendingLevelUp);

  const achievementContext = viewMode === "toast" ? undefined : getAchievementContext(stats, visibility.enabled);
  if (achievementContext) reconcileAchievementsIfNeeded(achievementContext);

  if (viewMode === "manager") {
    renderScopedSourceBreakdown(visibility);

    const progressBar = document.querySelector<HTMLElement>("#progressBar");
    if (progressBar) progressBar.style.width = `${stats.levelProgress * 100}%`;
    if (lockInput) lockInput.checked = ledger.settings.locked;
    if (scaleSelect) scaleSelect.value = String(ledger.settings.scale);
    if (fontScaleSelect) {
      const fs = ledger.settings.fontScale ?? 1;
      fontScaleSelect.value = String(fs);
      document.documentElement.style.setProperty("--font-scale", String(fs));
    }
    if (languageSelect) languageSelect.value = ledger.settings.language;
    themeSwitcher?.querySelectorAll<HTMLButtonElement>("[data-ui-theme]").forEach((button) => {
      const active = button.dataset.uiTheme === ledger?.settings.uiTheme;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    syncStatsSourceInputs();
    if (launchOnStartupInput) launchOnStartupInput.checked = ledger.settings.launchOnStartup;
    if (silentStartupInput) silentStartupInput.checked = ledger.settings.silentStartup;
    syncInputValue(proxyUrlInput, ledger.settings.proxyUrl ?? "");
    if (updateCheckEnabledInput) updateCheckEnabledInput.checked = ledger.settings.updateCheckEnabled;
    if (leaderboardAutoSyncInput) leaderboardAutoSyncInput.checked = ledger.settings.leaderboardAutoSyncEnabled;
    if (cloudSyncAutoSyncInput) cloudSyncAutoSyncInput.checked = ledger.settings.cloudSyncAutoSyncEnabled;
    if (leaderboardPreferencesPublicInput) {
      leaderboardPreferencesPublicInput.checked = ledger.settings.leaderboardPreferencesPublic;
    }
    if (badgeFrontMetricSelect) badgeFrontMetricSelect.value = ledger.settings.badgeFrontMetric;
    if (badgeBackMetricSelect) badgeBackMetricSelect.value = ledger.settings.badgeBackMetric;
    if (totalDisplayUnitSelect) totalDisplayUnitSelect.value = ledger.settings.totalDisplayUnit;
    syncInputValue(codexSessionsDirInput, ledger.settings.codexSessionsDir ?? "");
    syncInputValue(claudeSessionsDirInput, ledger.settings.claudeSessionsDir ?? "");
    syncInputValue(openclawSessionsDirInput, ledger.settings.openclawSessionsDir ?? "");
    syncInputValue(piSessionsDirInput, ledger.settings.piSessionsDir ?? "");
    syncInputValue(opencodeSessionsDirInput, ledger.settings.opencodeSessionsDir ?? "");
    syncInputValue(geminiSessionsDirInput, ledger.settings.geminiSessionsDir ?? "");
    syncInputValue(hermesSessionsDirInput, ledger.settings.hermesSessionsDir ?? "");

    renderUpdateStatus();
    renderCloudSyncSettings();
    renderTreeStartModal();
    renderLeaderboardSettings();
    renderSocialProfilePrivacySettings();
    renderLeaderboard();
    if (historyFilter !== "all" && !visibility.visibleSet.has(historyFilter)) {
      historyFilter = "all";
      lastHistoryChartKey = "";
    }
    lastHistoryChartKey = renderHistoryChart({
      rows: statsCache.getSevenDayRows(ledger.entries, historyFilter, visibility, ledgerEntriesSignature()),
      filter: historyFilter,
      visibility,
      lastHistoryChartKey,
      historySummary,
      historyLegend,
      historyTabs,
      historyBars,
      t,
      escapeHtml,
    });
    renderAchievements(stats, achievementContext);
    renderDashboardTabs();
    renderSocial();
    if (achievementContext) syncAchievementsIfNeeded(stats, achievementContext);
  } else if (viewMode === "menubar") {
    renderMenubarPopover(stats, visibility);
  }
}

const MENUBAR_VIZ_IDS = ["rhythm", "sync", "activity", "rank", "sources", "speed"] as const;
type MenubarVizId = (typeof MENUBAR_VIZ_IDS)[number];
// Map each component id to its existing display-name i18n key (reused from the popover headers).
const MENUBAR_VIZ_LABEL_KEYS: Record<MenubarVizId, string> = {
  rhythm: "menubarRhythmTitle",
  sync: "menubarSyncTitle",
  activity: "menubarActivityTitle",
  rank: "leaderboard",
  sources: "menubarTodaySources",
  speed: "menubarSpeedTitle",
};

// Visible components in display order, from settings, validated against the
// known ids. Falls back to the full set so the popover is never blank.
function menubarVisibleIds(): MenubarVizId[] {
  const allowed = new Set<string>(MENUBAR_VIZ_IDS);
  const stored = ledger?.settings.menubarVizIds;
  const ids = Array.isArray(stored)
    ? [...new Set(stored.filter((id): id is MenubarVizId => allowed.has(id)))]
    : [];
  return ids.length > 0 ? ids : [...MENUBAR_VIZ_IDS];
}
const MENUBAR_SCROLLABLE_SELECTOR = ".menubar-rank-list, .menubar-sync-list, .menubar-activity-list";
const MENUBAR_LEADERBOARD_RANGE: LeaderboardRange = "24h";
const MENUBAR_PAGE_GESTURE_COOLDOWN_MS = 620;
let menubarVizIndex = 0;
let menubarDragState: { pointerId: number; startX: number; startY: number } | null = null;
let menubarWheelLocked = false;
let menubarWheelUnlockTimer: number | null = null;
let menubarLastPageGestureAt = 0;
let menubarRenderHandle: number | null = null;

// Usage pushes fire on every session-file change — frequent while coding. Collapse bursts into one
// render per frame so the rebuilt lists (rank/sync/activity) don't thrash mid-scroll.
function scheduleMenubarRender() {
  if (menubarRenderHandle !== null) return;
  menubarRenderHandle = window.requestAnimationFrame(() => {
    menubarRenderHandle = null;
    render();
  });
}

function buildMenubarDots() {
  if (!menubarDots) return;
  const visible = menubarVisibleIds();
  const dots = visible
    .map((_id, index) => {
      const active = index === menubarVizIndex ? " active" : "";
      return `<button type="button" class="menubar-dot${active}" role="tab" data-viz-index="${index}" aria-label="${index + 1}"></button>`;
    })
    .join("");
  // Trailing "+" opens the dashboard settings where components are managed.
  const add = `<button type="button" class="menubar-dot-add" id="menubarVizAdd" aria-label="${escapeHtml(t("menubarManageComponents"))}" title="${escapeHtml(t("menubarManageComponents"))}">+</button>`;
  menubarDots.innerHTML = dots + add;
}

function setMenubarViz(index: number) {
  const visible = menubarVisibleIds();
  const count = visible.length;
  menubarVizIndex = ((index % count) + count) % count;
  const activeId = visible[menubarVizIndex];
  // DOM keeps all panels in fixed order; show the one whose id is active in the
  // visible list, hide the rest (including components turned off in settings).
  document.querySelectorAll<HTMLElement>(".menubar-viz").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viz === activeId);
  });
  menubarDots?.querySelectorAll<HTMLElement>(".menubar-dot").forEach((dot, dotIndex) => {
    dot.classList.toggle("active", dotIndex === menubarVizIndex);
  });
}

// Rebuild dots and re-clamp the active page after the visible component set
// changes (e.g. the user toggled/reordered components in settings).
function refreshMenubarViz() {
  buildMenubarDots();
  setMenubarViz(menubarVizIndex);
}

function menubarDayTotal(dayKey: string) {
  const enabled = sourceVisibility().enabled;
  let total = 0;
  for (const entry of ledger?.entries ?? []) {
    if (dateKey(new Date(entry.createdAt)) === dayKey) total += xpForEntry(entry, enabled);
  }
  return total;
}

// Per-hour totals for today, each split by source so the rhythm bars can be tinted by their
// dominant agent and hovering a bar can read out that hour's breakdown.
function menubarTodayHourRows(): { total: number; dominant: string | null }[] {
  const enabled = sourceVisibility().enabled;
  const totals = Array.from({ length: 24 }, () => 0);
  const perSource = Array.from({ length: 24 }, () => new Map<string, number>());
  const todayKey = dateKey(new Date());
  for (const entry of ledger?.entries ?? []) {
    const when = new Date(entry.createdAt);
    if (dateKey(when) !== todayKey) continue;
    const xp = xpForEntry(entry, enabled);
    if (xp <= 0) continue;
    const hour = when.getHours();
    totals[hour] += xp;
    const source = historySourceId(entry) ?? "cloud";
    const bucket = perSource[hour];
    bucket.set(source, (bucket.get(source) ?? 0) + xp);
  }
  return totals.map((total, hour) => {
    let dominant: string | null = null;
    let best = 0;
    for (const [source, value] of perSource[hour]) {
      if (value > best) {
        best = value;
        dominant = source;
      }
    }
    return { total, dominant };
  });
}

// Source id -> display name, matching the dashboard's history chart.
function menubarSourceName(sourceId: string): string {
  if (sourceId === "cloud") return t("cloudSource");
  return AGENT_SOURCES.find((source) => source.id === sourceId)?.label ?? sourceId;
}

function renderMenubarPopover(stats: Stats, visibility: SourceVisibility) {
  const isGrowing = stats.weather.tokensPerMinute > 0 || stats.activeSessions > 0;

  text("#menubarLevelChip", `Lv.${stats.level} ${stageLabel(stats.stage.id, stats.stage.label)}`);
  text(
    "#menubarWeatherText",
    `${weatherLabel(stats.weather.id, stats.weather.label)} · ${isGrowing ? t("menubarGrowing") : t("waitingNewToken")}`,
  );
  if (menubarLiveDot) menubarLiveDot.dataset.on = String(isGrowing);

  text("#menubarTodayText", `+${formatCompact(stats.todayXp)}`);
  if (menubarTodayCtx) menubarTodayCtx.textContent = menubarTodayContext(stats);

  text("#menubarNextLevelText", `${t("nextLevel")}${stats.level + 1}`);
  text("#menubarProgressPercent", `${Math.round(stats.levelProgress * 100)}%`);
  text("#menubarProgressText", `${formatCompact(stats.levelXp)} / ${formatCompact(stats.nextLevelXp)} token`);
  if (menubarProgressBar) menubarProgressBar.style.width = `${stats.levelProgress * 100}%`;

  renderMenubarRhythm();
  renderMenubarSync();
  renderMenubarActivity();
  renderMenubarRank();
  renderMenubarSources(visibility);
  renderMenubarSpeed(stats);
}

function menubarTodayContext(stats: Stats): string {
  if (stats.activeSessions > 0) {
    return `${stats.activeSessions} ${t("menubarSessionsWriting")}`;
  }
  const today = stats.todayXp;
  const yesterdayKey = dateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const yesterday = menubarDayTotal(yesterdayKey);
  if (yesterday <= 0) {
    return today > 0 ? "" : t("menubarTodayFirstDay");
  }
  const deltaPct = Math.round(((today - yesterday) / yesterday) * 100);
  if (deltaPct >= 0) return `${t("menubarTodayVsYesterday")} +${deltaPct}%`;
  return `${t("menubarTodayBelowYesterday")} ${deltaPct}%`;
}

function renderMenubarRhythm() {
  if (!menubarRhythmBars) return;
  const rows = menubarTodayHourRows();
  const max = Math.max(0, ...rows.map((row) => row.total));
  const nowHour = new Date().getHours();
  if (max <= 0) {
    menubarRhythmBars.innerHTML = `<div class="menubar-viz-empty">${escapeHtml(t("menubarRhythmQuiet"))}</div>`;
    if (menubarRhythmMeta) menubarRhythmMeta.textContent = "";
    return;
  }
  let peakHour = 0;
  rows.forEach((row, hour) => {
    if (row.total > rows[peakHour].total) peakHour = hour;
  });
  // Each hour is a full-height column so the whole column (not just the short/empty bar)
  // is the hover/focus/click target. The bar inside is purely the visual fill.
  menubarRhythmBars.innerHTML = rows
    .map((row, hour) => {
      const heightPct = row.total <= 0 ? 0 : Math.max(6, Math.round((row.total / max) * 100));
      const lit = row.total >= max * 0.85 ? " lit" : "";
      const now = hour === nowHour ? " now" : "";
      const quiet = row.total <= 0 ? " quiet" : "";
      // Tint each bar by its dominant source, reusing the dashboard chart's colour classes.
      const tone = row.dominant && row.total > 0 ? ` src-${row.dominant}` : "";
      const label = row.total > 0 ? `${hour}:00 · +${formatCompact(row.total)}` : `${hour}:00`;
      return `<button type="button" class="menubar-rhythm-col${now}" data-hour="${hour}" data-total="${row.total}" data-source="${row.dominant ?? ""}" title="${label}" aria-label="${label}"><span class="menubar-rhythm-bar${lit}${now}${quiet}${tone}" style="--bar-height:${heightPct}%"></span></button>`;
    })
    .join("");
  setMenubarRhythmMeta(peakHour, rows);
}

// Default meta = peak hour; hovering/focusing a bar swaps in that hour's readout (handled in
// bindMenubarEvents). Stored so the hover handler can restore the default on mouseleave.
let menubarRhythmPeakHour = 0;
let menubarRhythmRows: { total: number; dominant: string | null }[] = [];

function setMenubarRhythmMeta(peakHour: number, rows: { total: number; dominant: string | null }[]) {
  menubarRhythmPeakHour = peakHour;
  menubarRhythmRows = rows;
  if (menubarRhythmMeta) {
    menubarRhythmMeta.textContent = `${t("menubarRhythmPeak")} ${String(peakHour).padStart(2, "0")}:00`;
    menubarRhythmMeta.classList.remove("is-hover");
  }
}

function showMenubarRhythmHour(hour: number) {
  if (!menubarRhythmMeta) return;
  const row = menubarRhythmRows[hour];
  const hourLabel = `${String(hour).padStart(2, "0")}:00`;
  if (!row || row.total <= 0) {
    menubarRhythmMeta.textContent = `${hourLabel} · ${t("menubarRhythmQuietHour")}`;
  } else {
    const name = row.dominant ? menubarSourceName(row.dominant) : "";
    menubarRhythmMeta.textContent = `${hourLabel} · +${formatCompact(row.total)}${name ? ` · ${name}` : ""}`;
  }
  menubarRhythmMeta.classList.add("is-hover");
}

function resetMenubarRhythmMeta() {
  if (!menubarRhythmMeta) return;
  menubarRhythmMeta.textContent = `${t("menubarRhythmPeak")} ${String(menubarRhythmPeakHour).padStart(2, "0")}:00`;
  menubarRhythmMeta.classList.remove("is-hover");
}

function renderMenubarSync() {
  if (menubarSyncButton) {
    menubarSyncButton.disabled = cloudSyncStatus.syncing || !cloudSyncStatus.configured;
    menubarSyncButton.textContent = cloudSyncStatus.syncing
      ? t("cloudSyncSyncing")
      : cloudSyncStatus.enabled
        ? t("menubarSyncAction")
        : t("cloudSyncEnable");
  }
  if (!menubarSyncList) return;
  if (!cloudSyncStatus.configured) {
    menubarSyncList.innerHTML = `<div class="menubar-viz-empty">${escapeHtml(t("cloudSyncNotConfigured"))}</div>`;
    return;
  }
  if (!cloudSyncStatus.enabled) {
    menubarSyncList.innerHTML = `
      <article class="menubar-row">
        <span class="menubar-row-icon">云</span>
        <div class="menubar-row-copy"><strong>${escapeHtml(t("cloudSyncJoin"))}</strong><span>${escapeHtml(t("cloudSyncLoginRequired"))}</span></div>
        <b>${cloudSyncStatus.authenticated ? escapeHtml(t("cloudSyncEnable")) : "GitHub"}</b>
      </article>
    `;
    return;
  }

  // Two clear layers: a cloud-link summary on top, then every participating device below it.
  // "Cloud" is the aggregate of all devices syncing — not a sibling row next to them — so showing
  // it as a header (rather than a peer of "this Mac" / "that Win") removes the win-vs-cloud overlap.
  const devices = visibleCloudDevices(cloudSyncStatus.devices ?? []);
  const transfer =
    cloudSyncStatus.lastUploadedCount || cloudSyncStatus.lastDownloadedCount
      ? `↑${cloudSyncStatus.lastUploadedCount ?? 0} ↓${cloudSyncStatus.lastDownloadedCount ?? 0}`
      : "";
  const cloudFresh = cloudSyncStatus.lastSyncedAt ? formatRelativeTime(cloudSyncStatus.lastSyncedAt) : t("neverSynced");
  const cloudState = cloudSyncStatus.syncing
    ? "active"
    : cloudSyncStatus.error
      ? "stuck"
      : "done";
  const cloudStateLabel = cloudSyncStatus.syncing
    ? t("cloudSyncSyncing")
    : cloudSyncStatus.error
      ? t("needsAttention")
      : t("healthy");

  const header = `
    <article class="menubar-row menubar-sync-cloud">
      <span class="menubar-row-icon">☁</span>
      <div class="menubar-row-copy">
        <strong>${escapeHtml(t("cloudSource"))}</strong>
        <span>${escapeHtml(cloudFresh)}${transfer ? ` · ${escapeHtml(transfer)}` : ""}</span>
      </div>
      <em class="menubar-status-pill ${cloudState}">${escapeHtml(cloudStateLabel)}</em>
    </article>
  `;

  const deviceRows = devices.length
    ? devices
        .map((device) => {
          const isCurrent = device.deviceId === cloudSyncStatus.deviceId;
          const platform = menubarPlatformLabel(device.platform);
          const name = isCurrent
            ? t("cloudDeviceCurrent")
            : device.alias || platform || `${t("device")} ${device.deviceId.slice(-4)}`;
          const fresh = device.lastSyncedAt ? formatRelativeTime(device.lastSyncedAt) : t("neverSynced");
          const meta = `${fresh}${platform && !isCurrent && device.alias ? ` · ${escapeHtml(platform)}` : ""}`;
          return `
        <article class="menubar-row${isCurrent ? " is-me" : ""}">
          <span class="menubar-row-icon">${escapeHtml(menubarDeviceIcon(device.platform))}</span>
          <div class="menubar-row-copy">
            <strong>${escapeHtml(name)}</strong>
            <span>${meta}</span>
          </div>
          <b>${formatCompact(device.tokens)}</b>
        </article>
      `;
        })
        .join("")
    : "";

  menubarSyncList.innerHTML = header + deviceRows;
}

// Short platform tag for the device icon chip.
function menubarDeviceIcon(platform: string | undefined) {
  const normalized = (platform ?? "").toLowerCase();
  if (normalized.includes("mac") || normalized.includes("darwin")) return "Mac";
  if (normalized.includes("win")) return "Win";
  if (normalized.includes("linux")) return "Lin";
  return "PC";
}

// Human-readable platform name for the device subtitle.
function menubarPlatformLabel(platform: string | undefined) {
  const normalized = (platform ?? "").toLowerCase();
  if (normalized.includes("mac") || normalized.includes("darwin")) return "macOS";
  if (normalized.includes("win")) return "Windows";
  if (normalized.includes("linux")) return "Linux";
  return platform ?? "";
}

function renderMenubarActivity() {
  if (!menubarActivityList) return;
  const rows = menubarAgentRows();
  const activeCount = rows.filter((row) => row.stateClass === "active").length;
  if (menubarActivityMeta) {
    menubarActivityMeta.textContent = activeCount
      ? `${activeCount} ${t("menubarSessionsWriting")}`
      : `${rows.length} ${t("sourceTotalActive")}`;
  }
  const prevScroll = menubarActivityList.scrollTop;
  menubarActivityList.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
        <article class="menubar-row">
          <span class="menubar-row-icon src-${row.sourceId}">${escapeHtml(row.shortLabel)}</span>
          <div class="menubar-row-copy">
            <strong>${escapeHtml(row.label)}</strong>
            <span>${escapeHtml(row.meta)}</span>
          </div>
          <em class="menubar-status-pill ${row.stateClass}">${escapeHtml(row.state)}</em>
        </article>
      `,
        )
        .join("")
    : `<div class="menubar-viz-empty">${escapeHtml(t("waitingTodayTokens"))}</div>`;
  menubarActivityList.scrollTop = prevScroll;
}

function menubarAgentRows() {
  return AGENT_SOURCES.filter((source) => source.id !== "cloud" && sourceVisibility().enabled.has(source.id))
    .map((source) => {
      const status = sourceMonitorStatus(source.id);
      const view = menubarAgentStatusView(status);
      return {
        sourceId: source.id,
        label: source.label,
        shortLabel: source.label.slice(0, 1),
        ...view,
      };
    })
    .filter((row) => row.installed || row.lastSeenAt)
    .sort((left, right) => {
      const leftTime = left.lastSeenAt ? Date.parse(left.lastSeenAt) : 0;
      const rightTime = right.lastSeenAt ? Date.parse(right.lastSeenAt) : 0;
      if (left.stateClass !== right.stateClass) {
        const order = ["active", "waiting", "stuck", "done", "idle"];
        return order.indexOf(left.stateClass) - order.indexOf(right.stateClass);
      }
      return rightTime - leftTime;
    });
}

function menubarAgentStatusView(status: SessionMonitorStatus | undefined) {
  if (!status || !status.exists || status.filesWatched <= 0) {
    return {
      installed: false,
      state: t("sourceNotInstalled"),
      stateClass: "idle",
      meta: t("sourceNotInstalled"),
      freshness: t("waitingNewToken"),
      lastSeenAt: undefined,
    };
  }
  const lastSeenAt = status.lastEventAt ?? status.lastScanAt;
  const ageMs = lastSeenAt ? Date.now() - new Date(lastSeenAt).getTime() : Number.POSITIVE_INFINITY;
  const meta = `${status.filesWatched} ${t("files")} · ${lastSeenAt ? formatRelativeTime(lastSeenAt) : t("waitingNewToken")}`;
  if (status.lastEventAt && ageMs < 5 * 60 * 1000) {
    return { installed: true, state: t("menubarSpeedActive"), stateClass: "active", meta, freshness: formatRelativeTime(status.lastEventAt), lastSeenAt };
  }
  if (status.running && ageMs > 30 * 60 * 1000) {
    return {
      installed: true,
      state: t("needsAttention"),
      stateClass: "stuck",
      meta,
      freshness: lastSeenAt ? formatRelativeTime(lastSeenAt) : t("waitingNewToken"),
      lastSeenAt,
    };
  }
  if (status.running) {
    return { installed: true, state: t("pending"), stateClass: "waiting", meta, freshness: lastSeenAt ? formatRelativeTime(lastSeenAt) : t("waitingNewToken"), lastSeenAt };
  }
  return { installed: true, state: t("done"), stateClass: "done", meta, freshness: lastSeenAt ? formatRelativeTime(lastSeenAt) : t("waitingNewToken"), lastSeenAt };
}

function renderMenubarRank() {
  if (menubarRankRefreshButton) {
    menubarRankRefreshButton.disabled = leaderboardLoading || !leaderboardStatus.configured;
    menubarRankRefreshButton.textContent = leaderboardLoading ? t("leaderboardRefreshing") : t("refreshLeaderboard");
  }
  if (!menubarRankList) return;
  if (!leaderboardStatus.configured) {
    menubarRankList.innerHTML = `<div class="menubar-viz-empty">${escapeHtml(t("leaderboardNoService"))}</div>`;
    return;
  }
  if (leaderboardLoading) {
    menubarRankList.innerHTML = `<div class="menubar-viz-empty">${escapeHtml(t("leaderboardRefreshing"))}</div>`;
    return;
  }
  const data = leaderboardDataCache.get(MENUBAR_LEADERBOARD_RANGE) ?? (leaderboardData.range === MENUBAR_LEADERBOARD_RANGE ? leaderboardData : undefined);
  if (!data) {
    menubarRankList.innerHTML = `<div class="menubar-viz-empty">${escapeHtml(t("leaderboardClickRefresh"))}</div>`;
    return;
  }
  if (data.error) {
    menubarRankList.innerHTML = `<div class="menubar-viz-empty">${escapeHtml(data.error)}</div>`;
    return;
  }
  const myUserId = leaderboardStatus.profile?.id;
  const rows = menubarRankRows(data);
  if (!rows.length) {
    menubarRankList.innerHTML = `<div class="menubar-viz-empty">${escapeHtml(t("leaderboardEmpty"))}</div>`;
    return;
  }
  // Preserve scroll position: render() can fire on every usage push while the user is scrolling.
  const prevRankScroll = menubarRankList.scrollTop;
  menubarRankList.innerHTML = rows
    .map((entry, index) => {
      const isMe = entry.userId === myUserId;
      // Mark a break in rank continuity (e.g. self at #50 appended after top 10).
      const detached = index > 0 && entry.rank > rows[index - 1].rank + 1;
      const classes = `menubar-row${isMe ? " is-me" : ""}${detached ? " is-gap" : ""}`;
      const meTag = isMe ? ` <em>${escapeHtml(t("leaderboardMe"))}</em>` : "";
      return `
        <article class="${classes}">
          <span class="menubar-row-icon">#${entry.rank}</span>
          <div class="menubar-row-copy">
            <strong>${escapeHtml(entry.username || t("unknownUser"))}${meTag}</strong>
            <span>${entry.daysActive ? `${entry.daysActive} ${t("leaderboardDaysActive")}` : escapeHtml(leaderboardRangeLabel(MENUBAR_LEADERBOARD_RANGE))}</span>
          </div>
          <b>${formatCompact(entry.tokens)}</b>
        </article>
      `;
    })
    .join("");
  menubarRankList.scrollTop = prevRankScroll;
}

function menubarRankRows(data: LeaderboardData) {
  const rows = data.entries.slice(0, 10);
  if (data.me && !rows.some((entry) => entry.userId === data.me?.userId)) rows.push(data.me);
  return rows.sort((left, right) => left.rank - right.rank);
}

function renderMenubarSources(visibility: SourceVisibility) {
  const todayKey = dateKey(new Date());
  const todayEntries = (ledger?.entries ?? []).filter((entry) => dateKey(new Date(entry.createdAt)) === todayKey);
  const sourceRows = getMonitorSourceRows(getSourceBreakdown(todayEntries, visibility.enabled, sourceLabel), visibility);
  const activeRows = sourceRows.filter((row) => row.xp > 0).sort((left, right) => right.xp - left.xp);
  const totalSourceXp = activeRows.reduce((total, row) => total + row.xp, 0);
  if (menubarSourceSummary) {
    menubarSourceSummary.textContent = activeRows.length
      ? `${activeRows.length} · ${formatCompact(totalSourceXp)}`
      : "";
  }
  if (!menubarSourceList) return;
  const topRows = activeRows.slice(0, 3);
  const stackSegments = topRows
    .map((row, index) => {
      const percent = totalSourceXp > 0 ? clamp((row.xp / totalSourceXp) * 100, 0, 100) : 0;
      return `<span class="menubar-source-stack-segment" data-source="${escapeHtml(row.sourceKey)}" style="width:${Math.max(percent, 4)}%; --segment-index:${index}"></span>`;
    })
    .join("");
  menubarSourceList.innerHTML = activeRows.length
    ? `
        <div class="menubar-source-stack" aria-hidden="true">${stackSegments}</div>
        ${topRows
        .map((row) => {
          const percent = totalSourceXp > 0 ? clamp((row.xp / totalSourceXp) * 100, 0, 100) : 0;
          return `
            <article class="menubar-source-row" data-source="${escapeHtml(row.sourceKey)}">
              <span class="menubar-source-name"><i class="menubar-source-dot" data-source="${escapeHtml(row.sourceKey)}"></i>${escapeHtml(row.label)}</span>
              <span class="source-meter" aria-hidden="true"><span style="width:${percent}%"></span></span>
              <b class="menubar-source-val">${formatCompact(row.xp)}</b>
            </article>
          `;
        })
        .join("")}
      `
    : `<div class="menubar-viz-empty">${escapeHtml(t("waitingTodayTokens"))}</div>`;
}

function renderMenubarSpeed(stats: Stats) {
  const rateWindowSeconds = gameBalance?.weather.rateWindowSeconds ?? 60;
  const trend = menubarRollingRateSnapshot(300, 10, rateWindowSeconds);
  const samples = trend.samples;
  const rate = samples[samples.length - 1] ?? stats.weather.tokensPerMinute;
  if (menubarSpeedMeta) {
    menubarSpeedMeta.textContent = `${t("menubarSpeedWindow1m")} · ${formatCompact(rate)}/min`;
  }
  if (menubarSpeedWindow) menubarSpeedWindow.textContent = t("menubarSpeedWindow5m");
  if (menubarSpeedTotal) menubarSpeedTotal.textContent = `+${formatCompact(trend.windowTotal)}`;
  if (!menubarWave) return;
  const waveBounds = menubarWave.getBoundingClientRect();
  const width = Math.max(Math.round(waveBounds.width || 0), 320);
  const height = Math.max(Math.round(waveBounds.height || 0), 82);
  const padX = 14;
  const top = 8;
  const bottom = height - 14;
  const max = Math.max(rate, ...samples, 1);
  if (menubarSpeedPeak) {
    menubarSpeedPeak.textContent = "";
    menubarSpeedPeak.hidden = true;
  }
  const coords = samples.map((value, index) => {
    const x = padX + (index / (samples.length - 1)) * (width - padX * 2);
    const y = bottom - clamp(value / max, 0, 1) * (bottom - top);
    return { x, y };
  });
  const linePath = coords.reduce((path, point, index) => {
    if (index === 0) return `M${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    if (index === coords.length - 1) return `${path} L${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    const next = coords[index + 1];
    const midX = (point.x + next.x) / 2;
    const midY = (point.y + next.y) / 2;
    return `${path} Q${point.x.toFixed(1)},${point.y.toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)}`;
  }, "");
  const areaPath = `${linePath} L${width - padX},${bottom} L${padX},${bottom} Z`;
  const lastPoint = coords[coords.length - 1] ?? { x: width - padX, y: bottom };
  // Approximate the drawn path length so the flowing highlight is exactly one
  // coherent streak (dash gap === path length) instead of several broken dashes.
  let waveLen = 0;
  for (let index = 1; index < coords.length; index += 1) {
    waveLen += Math.hypot(coords[index].x - coords[index - 1].x, coords[index].y - coords[index - 1].y);
  }
  waveLen = Math.max(waveLen, 1);
  const markerStyle = `left: ${((lastPoint.x / width) * 100).toFixed(2)}%; top: ${((lastPoint.y / height) * 100).toFixed(2)}%;`;
  menubarWave.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
      <defs>
        <linearGradient id="menubarWaveGradient" x1="0" y1="${top}" x2="0" y2="${bottom}" gradientUnits="userSpaceOnUse">
          <stop offset="0" style="stop-color: var(--leaf); stop-opacity: ${rate > 0 ? "0.32" : "0.12"};" />
          <stop offset="0.7" style="stop-color: var(--leaf); stop-opacity: ${rate > 0 ? "0.14" : "0.05"};" />
          <stop offset="1" style="stop-color: var(--leaf); stop-opacity: 0;" />
        </linearGradient>
      </defs>
      <path d="${areaPath}" class="menubar-wave-area${rate > 0 ? " active" : ""}" fill="url(#menubarWaveGradient)" />
      <path d="${linePath}" class="menubar-wave-glow${rate > 0 ? " active" : ""}" fill="none" />
      <path d="${linePath}" class="menubar-wave-line${rate > 0 ? " active" : ""}" fill="none" />
      <path d="${linePath}" class="menubar-wave-flow${rate > 0 ? " active" : ""}" style="stroke-dasharray: 30 ${waveLen.toFixed(1)}; --menubar-flow-from: ${(waveLen + 30).toFixed(1)};" />
      <line x1="${padX}" y1="${bottom}" x2="${width - padX}" y2="${bottom}" class="menubar-wave-base" />
    </svg>
    <span class="menubar-wave-halo${rate > 0 ? " active" : ""}" style="${markerStyle}"></span>
    <span class="menubar-wave-dot${rate > 0 ? " active" : ""}" style="${markerStyle}"></span>
  `;
}

function menubarRollingRateSnapshot(windowSeconds: number, stepSeconds: number, rateWindowSeconds: number) {
  const now = Date.now();
  const enabled = sourceVisibility().enabled;
  const sampleCount = Math.max(2, Math.floor(windowSeconds / stepSeconds) + 1);
  const stepMs = stepSeconds * 1000;
  const end = Math.floor(now / stepMs) * stepMs;
  const start = end - windowSeconds * 1000;
  const rateWindowMs = rateWindowSeconds * 1000;
  const entries: { createdAtMs: number; xp: number }[] = [];
  let windowTotal = 0;
  for (const entry of ledger?.entries ?? []) {
    const createdAtMs = Date.parse(entry.createdAt);
    if (!Number.isFinite(createdAtMs)) continue;
    if (createdAtMs < start - rateWindowMs || createdAtMs > end) continue;
    const xp = xpForEntry(entry, enabled);
    if (xp <= 0) continue;
    entries.push({ createdAtMs, xp });
    if (createdAtMs > start) windowTotal += xp;
  }
  const samples: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const sampleAt = start + index * stepMs;
    const sampleStart = sampleAt - rateWindowMs;
    let total = 0;
    for (const entry of entries) {
      if (entry.createdAtMs > sampleStart && entry.createdAtMs <= sampleAt) total += entry.xp;
    }
    samples.push((total / rateWindowSeconds) * 60);
  }
  return { samples, windowTotal, end };
}

function renderDashboardTabs() {
  root.dataset.tab = dashboardTab;
  const unseenAchievementCount = achievementState.unlocked.filter((item) => !seenAchievementIds.has(item.id)).length;
  sideTabs?.querySelectorAll<HTMLButtonElement>("[data-dashboard-tab]").forEach((button) => {
    const active = button.dataset.dashboardTab === dashboardTab;
    const hasNewAchievements = button.dataset.dashboardTab === "achievements" && unseenAchievementCount > 0;
    button.classList.toggle("active", active);
    button.classList.toggle("has-new-achievements", hasNewAchievements);
    button.setAttribute("aria-selected", String(active));
    if (hasNewAchievements) {
      button.dataset.newCount = String(Math.min(unseenAchievementCount, 99));
    } else {
      delete button.dataset.newCount;
    }
  });
}

function triggerLevelUpAnimation(levels: { from: number; to: number }) {
  window.bonsai.showLevelToast(levels);
  pendingLevelUp = null;
  root.classList.remove("level-up");
  void root.offsetWidth;
  root.classList.add("level-up");
  if (levelUpTimer) window.clearTimeout(levelUpTimer);
  levelUpTimer = window.setTimeout(() => {
    root.classList.remove("level-up");
    levelUpTimer = undefined;
  }, 2200);
}

function renderAchievements(stats?: Stats, context?: AchievementContext) {
  if (!achievementSummaryElement || !achievementGridElement) return;
  const visibility = sourceVisibility();
  if (!stats && ledger && tree && gameBalance) {
    stats = statsCache.calculateStats(ledger.entries, tree, gameBalance, visibility.enabled, ledgerEntriesSignature());
  }
  if (!context && stats) context = getAchievementContext(stats, visibility.enabled);
  const key = achievementsRenderSignature(stats, context);
  if (key === achievementRenderKey) return;
  achievementRenderKey = key;
  const unlockedIds = achievementUnlockedIds();
  const unseenIds = new Set([...unlockedIds].filter((id) => !seenAchievementIds.has(id)));
  renderDashboardTabs();
  const visibleDefs = ACHIEVEMENTS.filter((def) => !def.planned || unlockedIds.has(def.id));
  const unlockedCount = visibleDefs.filter((def) => unlockedIds.has(def.id)).length;
  const completion = visibleDefs.length ? Math.round((unlockedCount / visibleDefs.length) * 100) : 0;
  const legendaryCount = visibleDefs.filter((def) => unlockedIds.has(def.id) && def.rarity === "legendary").length;
  const hiddenCount = visibleDefs.filter((def) => unlockedIds.has(def.id) && def.hidden).length;
  const filteredDefs = visibleDefs.filter((def) => matchesAchievementFilters(def, unlockedIds));

  achievementSummaryElement.textContent = `${unlockedCount} / ${visibleDefs.length}`;

  achievementCategoryTabs?.querySelectorAll<HTMLButtonElement>("[data-achievement-category]").forEach((button) => {
    const active = button.dataset.achievementCategory === achievementCategoryFilter;
    const category = button.dataset.achievementCategory;
    const newCount =
      typeof category === "string"
        ? ACHIEVEMENTS.filter((def) => def.category === category && unseenIds.has(def.id)).length
        : 0;
    button.classList.toggle("active", active);
    button.classList.toggle("has-new-achievements", newCount > 0);
    button.setAttribute("aria-selected", String(active));
    if (newCount > 0) button.dataset.newCount = String(Math.min(newCount, 99));
    else delete button.dataset.newCount;
  });

  achievementStatusTabs?.querySelectorAll<HTMLButtonElement>("[data-achievement-status]").forEach((button) => {
    const active = button.dataset.achievementStatus === achievementStatusFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (achievementOverviewElement) {
    achievementOverviewElement.innerHTML = `
      <article>
        <span>${escapeHtml(t("completionRate"))}</span>
        <strong>${completion}%</strong>
      </article>
      <article>
        <span>${escapeHtml(t("unlockedCount"))}</span>
        <strong>${unlockedCount}</strong>
      </article>
      <article>
        <span>${escapeHtml(t("legendary"))}</span>
        <strong>${legendaryCount}</strong>
      </article>
      <article>
        <span>${escapeHtml(t("hidden"))}</span>
        <strong>${hiddenCount}</strong>
      </article>
    `;
  }

  if (achievementRecentElement) {
    const showcase = visibleDefs
      .filter((def) => unlockedIds.has(def.id) && (def.rarity === "legendary" || def.rarity === "epic"))
      .sort((a, b) => rarityOrder(a.rarity) - rarityOrder(b.rarity));
    achievementRecentElement.innerHTML = showcase.length
      ? showcase
          .map(
            (def) => {
              const copy = achievementText(def);
              return `<button type="button" class="rarity-${def.rarity}" data-achievement-id="${escapeHtml(def.id)}">${escapeHtml(copy.name)}</button>`;
            },
          )
          .join("")
      : `<span>${escapeHtml(t("noHighTierAchievements"))}</span>`;
  }

  if (!filteredDefs.length) {
    achievementGridElement.innerHTML = `<div class="achievement-empty">${escapeHtml(t("noAchievementsForFilter"))}</div>`;
    return;
  }

  achievementGridElement.innerHTML = CATEGORY_ORDER
    .map((cat) => {
      const defs = filteredDefs.filter((def) => def.category === cat);
      if (!defs.length) return "";
      const sorted = [...defs].sort((a, b) => {
        const aNew = unlockedIds.has(a.id) && unseenIds.has(a.id) ? 0 : 1;
        const bNew = unlockedIds.has(b.id) && unseenIds.has(b.id) ? 0 : 1;
        if (aNew !== bNew) return aNew - bNew;
        const aUnlocked = unlockedIds.has(a.id) ? 0 : 1;
        const bUnlocked = unlockedIds.has(b.id) ? 0 : 1;
        if (aUnlocked !== bUnlocked) return aUnlocked - bUnlocked;
        return rarityOrder(a.rarity) - rarityOrder(b.rarity);
      });
      return `
        <section class="achievement-category">
          <div class="achievement-category-title">
            <strong>${escapeHtml(achievementCategoryLabel(cat))}</strong>
            <span>${defs.filter((def) => unlockedIds.has(def.id)).length}/${defs.length}</span>
          </div>
          <div class="achievement-items">
            ${sorted.map((def) => achievementItemHtml(def, unlockedIds, unseenIds, stats, context)).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function matchesAchievementFilters(def: AchievementDef, unlockedIds: Set<string>) {
  if (def.category !== achievementCategoryFilter) return false;
  const unlocked = unlockedIds.has(def.id);
  if (achievementStatusFilter === "unlocked") return unlocked;
  if (achievementStatusFilter === "locked") return !unlocked;
  if (achievementStatusFilter === "hidden") return def.hidden;
  return true;
}

function achievementItemHtml(
  def: AchievementDef,
  unlockedIds: Set<string>,
  unseenIds: Set<string>,
  stats?: Stats,
  context?: AchievementContext,
) {
  const unlocked = unlockedIds.has(def.id);
  const isNew = unlocked && unseenIds.has(def.id);
  const reveal = unlocked || !def.hidden;
  const lockedHidden = def.hidden && !unlocked;
  const progress = achievementProgress(def, stats, context);
  const copy = achievementText(def);
  const rarityLabel = escapeHtml(achievementRarityLabel(def.rarity));
  const meta = def.planned ? t("planned") : rarityLabel;
  const markIcon = unlocked ? "✦" : lockedHidden ? "?" : "·";
  const conditionText = reveal ? copy.description : t("lockedReveal");
  return `
    <article class="achievement-item ${unlocked ? "unlocked" : "locked"} ${isNew ? "new" : ""} rarity-${def.rarity}" data-achievement-id="${def.id}">
      <div class="achievement-mark">${markIcon}</div>
      <div class="achievement-copy">
        <div>
          <strong>${escapeHtml(reveal ? copy.name : "???")}</strong>
          <span>${meta}</span>
        </div>
        <p>${escapeHtml(conditionText)}</p>
        <div class="achievement-progress ${progress ? "" : "empty"}"><span style="width:${progress?.percent ?? 0}%"></span></div>
        <em>${escapeHtml(progress?.label ?? " ")}</em>
      </div>
      ${isNew ? `<span class="achievement-new-badge">${escapeHtml(t("newBadge"))}</span>` : ""}
    </article>
  `;
}

function showAchievementDetail(def: AchievementDef, isNew = false) {
  const unlockedIds = achievementUnlockedIds();
  const unlocked = unlockedIds.has(def.id);
  const reveal = unlocked || !def.hidden;
  const unlock = achievementState.unlocked.find((u) => u.id === def.id);
  const unlockDate = unlock ? new Date(unlock.unlockedAt).toLocaleDateString(languageLocale(), { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  const rarityLabel = achievementRarityLabel(def.rarity);
  const categoryLabel = achievementCategoryLabel(def.category);
  const markIcon = unlocked ? "✦" : def.hidden && !unlocked ? "?" : "·";
  const copy = achievementText(def);

  const visibility = sourceVisibility();
  const stats =
    ledger && tree && gameBalance
      ? statsCache.calculateStats(ledger.entries, tree, gameBalance, visibility.enabled, ledgerEntriesSignature())
      : undefined;
  const context = stats ? getAchievementContext(stats, visibility.enabled) : undefined;
  const progress = achievementProgress(def, stats, context);

  const existing = document.querySelector(".achievement-detail-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "achievement-detail-overlay";
  overlay.innerHTML = `
    <div class="achievement-detail-backdrop"></div>
    <div class="achievement-detail rarity-${def.rarity} ${unlocked ? "unlocked" : "locked"}">
      <button class="achievement-detail-close" type="button" aria-label="${escapeHtml(t("closeSettings"))}">×</button>
      <div class="achievement-detail-mark">${markIcon}</div>
      <h3>${escapeHtml(reveal ? copy.name : "???")}</h3>
      <div class="achievement-detail-tags">
        <span class="achievement-detail-rarity">${escapeHtml(rarityLabel)}</span>
        ${isNew ? `<span class="achievement-detail-new">${escapeHtml(t("newBadge"))}</span>` : ""}
      </div>
      <p class="achievement-detail-condition">${escapeHtml(reveal ? copy.description : t("lockedReveal"))}</p>
      ${reveal && copy.flavor ? `<p class="achievement-detail-flavor">${escapeHtml(copy.flavor)}</p>` : ""}
      <div class="achievement-detail-meta">
        <span>${escapeHtml(categoryLabel)}</span>
        ${unlockDate ? `<span>${escapeHtml(t("unlockedAt"))} ${escapeHtml(unlockDate)}</span>` : `<span>${escapeHtml(t("notUnlocked"))}</span>`}
      </div>
      ${progress ? `
        <div class="achievement-detail-progress">
          <div class="achievement-progress"><span style="width:${progress.percent}%"></span></div>
          <em>${escapeHtml(progress.label)}</em>
        </div>
      ` : ""}
    </div>
  `;

  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".achievement-detail-backdrop")?.addEventListener("click", close);
  overlay.querySelector(".achievement-detail-close")?.addEventListener("click", close);
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

function showLockedAchievementHint(target: HTMLElement) {
  const existing = document.querySelector(".locked-achievement-hint");
  if (existing) existing.remove();
  if (lockedAchievementHintTimer) window.clearTimeout(lockedAchievementHintTimer);

  const hint = document.createElement("div");
  hint.className = "locked-achievement-hint";
  hint.textContent = t("lockedHint");
  document.body.appendChild(hint);

  const itemRect = target.getBoundingClientRect();
  const hintRect = hint.getBoundingClientRect();
  const left = itemRect.left + itemRect.width / 2 - hintRect.width / 2;
  const top = itemRect.top - hintRect.height - 8;
  hint.style.left = `${clamp(left, 12, window.innerWidth - hintRect.width - 12)}px`;
  hint.style.top = `${Math.max(12, top)}px`;

  lockedAchievementHintTimer = window.setTimeout(() => {
    hint.remove();
    lockedAchievementHintTimer = undefined;
  }, 1200);
}

function achievementProgress(def: AchievementDef, stats?: Stats, context?: AchievementContext) {
  if (!stats) return undefined;
  const xpMatch = def.id.match(/^xp_(10k|100k|1m|10m|100m|1b)$/);
  const dailyMatch = def.id.match(/^daily_(1k|10k|50k|1m|10m|100m)$/);
  const burstMatch = def.id.match(/^burst_(60|10k|100k|1m)$/);
  const targetByKey: Record<string, number> = {
    "60": 60,
    "1k": 1_000,
    "10k": 10_000,
    "50k": 50_000,
    "100k": 100_000,
    "1m": 1_000_000,
    "10m": 10_000_000,
    "100m": 100_000_000,
    "1b": 1_000_000_000,
  };
  if (xpMatch) {
    const target = targetByKey[xpMatch[1]];
    return { percent: clamp((stats.xp / target) * 100, 0, 100), label: `${formatCompact(stats.xp)} / ${formatCompact(target)} token` };
  }
  if (dailyMatch && context) {
    const target = targetByKey[dailyMatch[1]];
    return {
      percent: clamp((context.maxDailyXp / target) * 100, 0, 100),
      label: `${formatCompact(context.maxDailyXp)} / ${formatCompact(target)} token`,
    };
  }
  if (burstMatch) {
    const target = targetByKey[burstMatch[1]];
    const peak = context?.peakTokensPerMinute ?? peakStat("peakXpPerMinute", stats.weather.tokensPerMinute);
    return {
      percent: clamp((peak / target) * 100, 0, 100),
      label: `${formatCompact(peak)} / ${formatCompact(target)} token/min`,
    };
  }
  if (context) {
    const progressMap: Record<string, { current: number; target: number; unit: string }> = {
      explorer_10d: { current: context.totalActiveDays, target: 10, unit: "d" },
      explorer_50d: { current: context.totalActiveDays, target: 50, unit: "d" },
      explorer_100d: { current: context.totalActiveDays, target: 100, unit: "d" },
      explorer_365d: { current: context.totalActiveDays, target: 365, unit: "d" },
      model_collector_3: { current: context.uniqueModels, target: 3, unit: "" },
      model_collector_10: { current: context.uniqueModels, target: 10, unit: "" },
      model_collector_20: { current: context.uniqueModels, target: 20, unit: "" },
      streak_100: { current: context.consecutiveDays, target: 100, unit: "d" },
      thousand_cuts: { current: context.totalEntries, target: 1_000, unit: "" },
      ten_thousand_cuts: { current: context.totalEntries, target: 10_000, unit: "" },
      session_grinder: { current: context.maxEntriesOneDay, target: 100, unit: "" },
      session_marathon: { current: context.maxEntriesOneDay, target: 500, unit: "" },
    };
    const prog = progressMap[def.id];
    if (prog) {
      return {
        percent: clamp((prog.current / prog.target) * 100, 0, 100),
        label: `${prog.current} / ${prog.target}${prog.unit ? " " + prog.unit : ""}`,
      };
    }
  }
  return undefined;
}

function peakStat(key: string, current: number): number {
  const stored = achievementState.stats?.[key];
  const prev = typeof stored === "number" ? stored : 0;
  return Math.max(prev, current);
}

let statsSyncInFlight = false;

function syncPeakStats(stats: Stats, context: AchievementContext) {
  if (statsSyncInFlight) return;
  const peaks: Record<string, number> = {
    peakXpPerMinute: Math.max(stats.weather.tokensPerMinute, context.peakTokensPerMinute),
    peakDailyXp: context.maxDailyXp,
  };
  const existing = achievementState.stats ?? {};
  const needsUpdate = Object.entries(peaks).some(
    ([key, value]) => value > (typeof existing[key] === "number" ? (existing[key] as number) : 0),
  );
  if (!needsUpdate) return;
  const merged: Record<string, number> = {};
  for (const [key, value] of Object.entries(peaks)) {
    merged[key] = Math.max(value, typeof existing[key] === "number" ? (existing[key] as number) : 0);
  }
  statsSyncInFlight = true;
  void window.bonsai
    .updateAchievementStats(merged)
    .then((state) => {
      achievementState = state;
    })
    .finally(() => {
      statsSyncInFlight = false;
    });
}

function reconcileAchievementsIfNeeded(context: AchievementContext) {
  if (achievementReconcileInFlight || (achievementState.version ?? 0) >= ACHIEVEMENT_STATE_VERSION) return;
  const unlockedIds = achievementState.unlocked
    .filter((item) => {
      if (!ACCOUNTING_RECONCILED_ACHIEVEMENTS.has(item.id)) return true;
      const def = ACHIEVEMENTS.find((achievement) => achievement.id === item.id);
      return Boolean(def && def.condition(context));
    })
    .map((item) => item.id);
  achievementReconcileInFlight = true;
  void window.bonsai
    .reconcileAchievements({
      version: ACHIEVEMENT_STATE_VERSION,
      unlockedIds,
      stats: {
        peakXpPerMinute: Math.max(context.stats.weather.tokensPerMinute, context.peakTokensPerMinute),
        peakDailyXp: context.maxDailyXp,
      },
    })
    .then((state) => {
      achievementState = state;
      const unlocked = achievementUnlockedIds();
      seenAchievementIds = new Set([...seenAchievementIds].filter((id) => unlocked.has(id)));
      persistSeenAchievements();
      achievementRenderKey = "";
    })
    .finally(() => {
      achievementReconcileInFlight = false;
    });
}

function syncAchievements(stats: Stats, context: AchievementContext) {
  if (!ledger || !tree || achievementSyncInFlight) return;
  reconcileAchievementsIfNeeded(context);
  syncPeakStats(stats, context);
  const unlockedIds = achievementUnlockedIds();
  const items = ACHIEVEMENTS.filter((def) => !def.planned && !unlockedIds.has(def.id) && def.condition(context)).map(
    (def) => ({
      id: def.id,
      trigger: def.trigger?.(context) ?? {
        xp: stats.xp,
        level: stats.level,
        at: new Date().toISOString(),
      },
    }),
  );
  if (!items.length) return;

  achievementSyncInFlight = true;
  void window.bonsai
    .unlockAchievements(items)
    .then((result) => {
      achievementState = result.state;
      renderAchievements(stats, context);
    })
    .finally(() => {
      achievementSyncInFlight = false;
    });
}

function syncAchievementsIfNeeded(stats: Stats, context: AchievementContext) {
  if (achievementSyncInFlight) return;
  const key = [
    ledgerEntriesSignature(),
    stats.xp,
    stats.level,
    Math.floor(stats.weather.tokensPerMinute),
    achievementState.unlocked.map((item) => item.id).join(","),
  ].join("|");
  if (key === achievementSyncKey) return;
  achievementSyncKey = key;
  syncAchievements(stats, context);
}

function getAchievementContext(stats: Stats, enabledSources = enabledStatsSourceSet()): AchievementContext {
  const key = [
    ledgerEntriesSignature(),
    [...enabledSources].join(","),
    stats.xp,
    stats.level,
    stats.stage.id,
  ].join("|");
  if (cachedAchievementContext && key === achievementContextCacheKey) {
    return { ...cachedAchievementContext, stats };
  }
  cachedAchievementContext = buildAchievementContext(stats, enabledSources);
  achievementContextCacheKey = key;
  return cachedAchievementContext;
}

function buildAchievementContext(stats: Stats, enabledSources = enabledStatsSourceSet()): AchievementContext {
  const entries = ledger?.entries ?? [];
  const countedEntries: LedgerEntry[] = [];
  const dayXp = new Map<string, number>();
  const daySources = new Map<string, Set<HistorySourceId>>();
  const activeSources = new Set<HistorySourceId>();
  const sourceXp: Record<HistorySourceId, number> = emptySourceTotals();
  const hourSet = new Set<number>();
  const weekendDays = new Map<string, Set<number>>();
  const hourKeys = new Set<number>();
  const dayEntries = new Map<string, number>();
  const dayHours = new Map<string, Set<number>>();
  const peakEvents: Array<{ time: number; xp: number }> = [];
  let hasFibonacciSession = false;

  for (const entry of entries) {
    const xp = xpForEntry(entry, enabledSources);
    if (xp <= 0) continue;
    const createdAt = new Date(entry.createdAt);
    const createdAtMs = createdAt.getTime();
    if (!Number.isFinite(createdAtMs)) continue;
    countedEntries.push(entry);
    peakEvents.push({ time: createdAtMs, xp });
    const key = dateKey(createdAt);
    const hour = createdAt.getHours();
    dayXp.set(key, (dayXp.get(key) ?? 0) + xp);
    dayEntries.set(key, (dayEntries.get(key) ?? 0) + 1);
    const hours = dayHours.get(key) ?? new Set<number>();
    hours.add(hour);
    dayHours.set(key, hours);
    hourSet.add(hour);
    hourKeys.add(Math.floor(createdAt.getTime() / 3_600_000));
    if (isFibonacci(xp)) hasFibonacciSession = true;

    const source = historySourceId(entry);
    if (source && source !== "cloud") {
      activeSources.add(source);
      sourceXp[source] += xp;
      const sources = daySources.get(key) ?? new Set<HistorySourceId>();
      sources.add(source);
      daySources.set(key, sources);
    }

    if (createdAt.getDay() === 0 || createdAt.getDay() === 6) {
      const saturday = new Date(createdAt);
      const day = saturday.getDay();
      saturday.setDate(saturday.getDate() - (day === 0 ? 1 : 0));
      const weekendKey = dateKey(saturday);
      const days = weekendDays.get(weekendKey) ?? new Set<number>();
      days.add(day);
      weekendDays.set(weekendKey, days);
    }
  }

  const activeDayKeys = [...dayXp.keys()].sort();
  const maxDailyXp = Math.max(0, ...dayXp.values());
  const peakTokensPerMinute = maxTokensPerMinute(peakEvents, gameBalance?.weather.rateWindowSeconds ?? 60);
  const maxSourcesOneDay = Math.max(0, ...[...daySources.values()].map((sources) => sources.size));
  const stageIndex = tree ? tree.stages.findIndex((stage) => stage.id === stats.stage.id) : 0;

  const uniqueModels = new Set(
    countedEntries
      .map((entry) => entry.model?.trim())
      .filter((model): model is string => typeof model === "string" && model.length > 0),
  ).size;
  const totalSourceXp = Object.values(sourceXp).reduce((a, b) => a + b, 0);
  const dominantSourceRatio = totalSourceXp > 0 ? Math.max(...Object.values(sourceXp)) / totalSourceXp : 0;
  const maxEntriesOneDay = Math.max(0, ...dayEntries.values());

  let longestInactiveDays = 0;
  for (let i = 1; i < activeDayKeys.length; i++) {
    const prev = Date.parse(`${activeDayKeys[i - 1]}T00:00:00`);
    const curr = Date.parse(`${activeDayKeys[i]}T00:00:00`);
    if (Number.isFinite(prev) && Number.isFinite(curr)) {
      const dayGap = Math.round((curr - prev) / 86_400_000);
      longestInactiveDays = Math.max(longestInactiveDays, Math.max(0, dayGap - 1));
    }
  }

  const hasHolidayCoding = activeDayKeys.some(isNewYearOrLunarNewYearPeriod);
  const has5amTo9amStreak = [...dayHours.values()].some((hours) => [5, 6, 7, 8].every((hour) => hours.has(hour)));

  return {
    stats,
    entries: countedEntries,
    stageIndex,
    peakTokensPerMinute,
    maxDailyXp,
    consecutiveDays: longestConsecutiveDays(activeDayKeys),
    activeSources,
    maxSourcesOneDay,
    hasAgentSwitchWithinTenMinutes: hasAgentSwitchWithin(countedEntries, 10 * 60 * 1000),
    sourceXp,
    hourSet,
    weekendWarrior: [...weekendDays.values()].some((days) => days.has(0) && days.has(6)),
    touchGrassReturn: hasReturnAfterInactiveGap(activeDayKeys, 7),
    coffeeOverdose: hasConsecutiveHourActivity(hourKeys, 8),
    hasFibonacciSession,
    totalActiveDays: activeDayKeys.length,
    uniqueModels,
    dominantSourceRatio,
    hasNoonPeak: hourSet.has(12),
    has5amTo9amStreak,
    longestInactiveDays,
    totalEntries: countedEntries.length,
    maxEntriesOneDay,
    hasHolidayCoding,
  };
}

function achievementUnlockedIds() {
  return new Set(achievementState.unlocked.map((item) => item.id));
}

function initializeSeenAchievements() {
  const unlockedIds = [...achievementUnlockedIds()];
  const stored = localStorage.getItem("vibe-tree:seen-achievements");
  if (!stored) {
    seenAchievementIds = new Set(unlockedIds);
    persistSeenAchievements();
    return;
  }

  try {
    const parsed = JSON.parse(stored);
    seenAchievementIds = new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    seenAchievementIds = new Set(unlockedIds);
    persistSeenAchievements();
  }
}

function persistSeenAchievements() {
  localStorage.setItem("vibe-tree:seen-achievements", JSON.stringify([...seenAchievementIds]));
}

function markAchievementSeen(id: string) {
  if (seenAchievementIds.has(id)) return;
  seenAchievementIds.add(id);
  persistSeenAchievements();
  renderAchievements();
  renderDashboardTabs();
}

function queueTreeToasts(items: TreeToastItem[]) {
  const cleanItems = items.filter(isRenderableToastItem);
  if (!cleanItems.length) return;
  achievementToastQueue.push(...cleanItems);
  showNextAchievementToast();
}

function previewAchievementToast() {
  const id = TOAST_PREVIEW_IDS[toastPreviewIndex % TOAST_PREVIEW_IDS.length];
  toastPreviewIndex += 1;
  void window.bonsai.previewAchievementToast(id);
}

function showNextAchievementToast() {
  if (!achievementToastLayer || achievementToastTimer) return;
  if (!achievementToastQueue.length) {
    if (viewMode === "toast") window.bonsai.notifyAchievementToastDrained();
    return;
  }
  const item = achievementToastQueue.shift()!;
  achievementToastLayer.innerHTML = toastItemHtml(item);
  achievementToastTimer = window.setTimeout(() => {
    achievementToastLayer.innerHTML = "";
    achievementToastTimer = undefined;
    showNextAchievementToast();
  }, ACHIEVEMENT_TOAST_DURATION_MS);
}

function isRenderableToastItem(item: TreeToastItem) {
  if (item.type === "achievement") return ACHIEVEMENTS.some((def) => def.id === item.id);
  return Number.isFinite(item.from) && Number.isFinite(item.to) && item.to > item.from;
}

function toastItemHtml(item: TreeToastItem) {
  if (item.type === "level") return levelToastHtml(item);
  const def = ACHIEVEMENTS.find((achievement) => achievement.id === item.id);
  if (!def) return "";
  const copy = achievementText(def);
  return `
    <div class="achievement-toast rarity-${def.rarity}">
      <div class="achievement-toast-head">
        <span class="achievement-toast-meta">${escapeHtml(achievementRarityLabel(def.rarity))} · ${escapeHtml(t("achievementUnlocked"))}</span>
      </div>
      <strong>${escapeHtml(copy.name)}</strong>
      <p>${escapeHtml(copy.description)}</p>
    </div>
  `;
}

function levelToastHtml(item: Extract<TreeToastItem, { type: "level" }>) {
  return `
    <div class="achievement-toast level-toast">
      <div class="achievement-toast-head">
        <span class="achievement-toast-meta">${escapeHtml(t("levelUpToastMeta"))}</span>
      </div>
      <strong>Lv.${item.from} -> Lv.${item.to}</strong>
      <p>${escapeHtml(t("levelUpToastCopy"))}</p>
    </div>
  `;
}

function longestConsecutiveDays(keys: string[]) {
  let best = 0;
  let current = 0;
  let previous = 0;
  for (const key of keys) {
    const time = Date.parse(`${key}T00:00:00`);
    if (!Number.isFinite(time)) continue;
    current = previous && time - previous === 86_400_000 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = time;
  }
  return best;
}

function hasReturnAfterInactiveGap(keys: string[], gapDays: number) {
  for (let index = 1; index < keys.length; index += 1) {
    const previous = Date.parse(`${keys[index - 1]}T00:00:00`);
    const current = Date.parse(`${keys[index]}T00:00:00`);
    if (Number.isFinite(previous) && Number.isFinite(current) && current - previous >= (gapDays + 1) * 86_400_000) {
      return true;
    }
  }
  return false;
}

function isNewYearOrLunarNewYearPeriod(key: string) {
  if (key.slice(5) === "01-01") return true;

  const year = Number(key.slice(0, 4));
  const lunarNewYear = LUNAR_NEW_YEAR_DATES[year];
  if (!lunarNewYear) return false;

  const current = Date.parse(`${key}T00:00:00`);
  const start = Date.parse(`${lunarNewYear}T00:00:00`);
  if (!Number.isFinite(current) || !Number.isFinite(start)) return false;

  return current >= start && current < start + LUNAR_NEW_YEAR_PERIOD_DAYS * 86_400_000;
}

function hasConsecutiveHourActivity(hourKeys: Set<number>, target: number) {
  const sorted = [...hourKeys].sort((a, b) => a - b);
  let streak = 0;
  let previous: number | undefined;
  for (const key of sorted) {
    streak = previous !== undefined && key - previous === 1 ? streak + 1 : 1;
    if (streak >= target) return true;
    previous = key;
  }
  return false;
}

function maxTokensPerMinute(events: Array<{ time: number; xp: number }>, windowSeconds: number) {
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const windowMs = Math.max(1, windowSeconds) * 1000;
  let left = 0;
  let windowXp = 0;
  let peak = 0;
  for (let right = 0; right < sorted.length; right += 1) {
    windowXp += sorted[right].xp;
    while (sorted[left] && sorted[left].time < sorted[right].time - windowMs) {
      windowXp -= sorted[left].xp;
      left += 1;
    }
    peak = Math.max(peak, (windowXp / Math.max(1, windowSeconds)) * 60);
  }
  return peak;
}

function hasAgentSwitchWithin(entries: LedgerEntry[], windowMs: number) {
  const sorted = entries
    .map((entry) => ({ time: new Date(entry.createdAt).getTime(), source: historySourceId(entry) }))
    .filter(
      (item): item is { time: number; source: HistorySourceId } =>
        Boolean(item.source) && item.source !== "cloud" && Number.isFinite(item.time),
    )
    .sort((a, b) => a.time - b.time);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].source !== sorted[index - 1].source && sorted[index].time - sorted[index - 1].time <= windowMs) {
      return true;
    }
  }
  return false;
}

function isFibonacci(value: number) {
  const rounded = Math.round(value);
  if (rounded < 2 || rounded > 10_000_000) return false;
  let a = 1;
  let b = 1;
  while (b < rounded) {
    const next = a + b;
    a = b;
    b = next;
  }
  return b === rounded;
}

function renderLevelBadge(
  selector: string,
  stats: Stats,
  frontMetric: BadgeMetric,
  backMetric: BadgeMetric,
  totalUnit: TotalDisplayUnit,
) {
  const badge = document.querySelector<HTMLElement>(selector);
  if (!badge) return;
  const front = badge.querySelector<HTMLElement>(".badge-front");
  const back = badge.querySelector<HTMLElement>(".badge-back");
  if (!front || !back) return;

  const frontText = badgeMetricText(frontMetric, stats, totalUnit);
  const backText = badgeMetricText(backMetric, stats, totalUnit);
  front.textContent = frontText;
  back.textContent = backText;
  badge.style.setProperty("--badge-front-width", `${badgeWidthForText(frontText)}px`);
  badge.style.setProperty("--badge-back-width", `${badgeWidthForText(backText)}px`);
  front.style.fontSize = badgeFontSizeForText(frontText);
  back.style.fontSize = badgeFontSizeForText(backText);
}

function badgeMetricText(metric: BadgeMetric, stats: Stats, totalUnit: TotalDisplayUnit) {
  if (metric === "level") return `Lv.${stats.level}`;
  if (metric === "rate") return `${formatIntegerWithCommas(stats.weather.tokensPerMinute / 60)}/s`;
  return formatByUnit(stats.xp, totalUnit);
}

function badgeWidthForText(...values: string[]) {
  const longest = Math.max(...values.map((value) => value.length));
  return clamp(54 + Math.max(0, longest - 5) * 5.25, 54, 96);
}

function badgeFontSizeForText(value: string) {
  if (value.length >= 15) return "0.5rem";
  if (value.length >= 13) return "0.58rem";
  if (value.length >= 11) return "0.64rem";
  if (value.length >= 9) return "0.68rem";
  return "";
}

function startAutoBadgeFlipLoop() {
  if (badgeAutoFlipTimer) return;
  const selector = viewMode === "pet" ? "#petLevelBadge" : "#previewLevelBadge";
  badgeAutoFlipTimer = window.setInterval(() => {
    flipLevelBadgeTemporarily(selector);
  }, AUTO_BADGE_FLIP_MS);
}

function flipLevelBadgeTemporarily(selector: string) {
  const badge = document.querySelector<HTMLElement>(selector);
  if (!badge) return;

  clearBadgeFlipTimer(selector);
  badge.classList.add("level-badge-show-total");
  const timer = window.setTimeout(() => {
    badge.classList.remove("level-badge-show-total");
    badgeFlipTimers.delete(selector);
  }, BADGE_TOKEN_HOLD_MS);
  badgeFlipTimers.set(selector, timer);
}

function showLevelBadgeBack(selector: string) {
  const badge = document.querySelector<HTMLElement>(selector);
  if (!badge) return;
  clearBadgeFlipTimer(selector);
  badge.classList.add("level-badge-show-total");
}

function hideLevelBadgeBack(selector: string) {
  const badge = document.querySelector<HTMLElement>(selector);
  if (!badge) return;
  clearBadgeFlipTimer(selector);
  badge.classList.remove("level-badge-show-total");
}

function clearBadgeFlipTimer(selector: string) {
  const timer = badgeFlipTimers.get(selector);
  if (!timer) return;
  window.clearTimeout(timer);
  badgeFlipTimers.delete(selector);
}

function renderWeatherLayers(weather: WeatherId) {
  const back = weatherBackHtml(weather);
  const front = weatherFrontHtml(weather);
  if (weatherBack) weatherBack.innerHTML = back;
  if (weatherFront) weatherFront.innerHTML = front;
  if (previewWeatherBack) previewWeatherBack.innerHTML = back;
  if (previewWeatherFront) previewWeatherFront.innerHTML = front;
}

function renderUsageStatus() {
  if (!usageStatus) return;
  if (ledger) {
    renderScopedSourceBreakdown();
  }
}

function renderUpdateStatus() {
  const renderKey = updateStatusRenderSignature();
  if (renderKey === updateStatusRenderKey) return;
  updateStatusRenderKey = renderKey;
  if (settingsButton) {
    settingsButton.classList.toggle("has-update", updateStatus.available);
    settingsButton.setAttribute("data-update-available", String(updateStatus.available));
    settingsButton.querySelector<HTMLElement>(".settings-update-badge")?.replaceChildren(t("updateBadge"));
  }
  if (!updateStatusText) return;
  const currentVersion = updateStatus.currentVersion ? `v${updateStatus.currentVersion}` : t("unknownVersion");
  let title = `${t("currentVersion")} ${currentVersion}`;
  let detail = updateStatus.checkedAt ? `${t("lastChecked")} ${formatRelativeTime(updateStatus.checkedAt)}` : t("neverChecked");
  if (updateStatus.installing) {
    title = t("terminalUpdating");
    detail = updateStatus.installLog ?? t("terminalRunning");
  } else if (updateStatus.installError) {
    title = t("terminalFailed");
    detail = updateStatus.installError;
  } else if (updateStatus.needsRestart) {
    title = t("updateComplete");
    detail = t("restartToApply");
  } else if (updateStatus.checking) {
    title = t("checkingUpdate");
    detail = `${t("currentVersion")} ${currentVersion}`;
  } else if (updateStatus.available && updateStatus.latestVersion) {
    title = `${t("updateAvailable")} v${updateStatus.latestVersion}`;
    detail = updateStatus.canTerminalUpdate ? `${currentVersion} · ${t("canTerminalUpdate")}` : `${currentVersion} · ${t("cannotTerminalUpdate")}`;
  } else if (updateStatus.error) {
    title = t("updateCheckFailed");
    detail = updateStatus.error;
  } else if (updateStatus.checkedAt) {
    title = t("alreadyLatest");
    detail = `${currentVersion} · ${detail}`;
  }

  updateStatusText.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(detail)}</span>
  `;
  if (checkUpdateButton) {
    checkUpdateButton.disabled = updateStatus.checking || updateStatus.installing;
    checkUpdateButton.textContent = updateStatus.checking ? t("checking") : t("checkUpdate");
  }
  if (installUpdateButton) {
    installUpdateButton.disabled =
      updateStatus.checking || updateStatus.installing || !updateStatus.available || !updateStatus.canTerminalUpdate;
    installUpdateButton.textContent = updateStatus.installing ? t("updating") : t("terminalUpdate");
  }
  if (updateNotesButton) {
    const canViewNotes = Boolean(updateStatus.latestVersion && updateStatus.checkedAt && !updateStatus.error);
    updateNotesButton.hidden = !canViewNotes;
    updateNotesButton.disabled = !canViewNotes || updateStatus.checking || updateStatus.installing;
    updateNotesButton.textContent = updateStatus.available ? t("viewUpdateNotes") : t("viewCurrentVersionNotes");
  }
}

function showUpdateNotesModal() {
  if (viewMode !== "manager") return;
  if (!updateStatus.latestVersion) return;
  if (document.querySelector(".update-notice-modal")) return;

  const releaseNotes = formatUpdateNoticeNotes(updateStatus.releaseNotes);
  const currentVersion = updateStatus.currentVersion || t("unknownVersion");
  const latestVersion = updateStatus.latestVersion;
  const modalTitle = updateStatus.available ? t("updateNoticeTitle") : t("currentVersionNoticeTitle");
  const versionHtml = updateStatus.available
    ? `<span>v${escapeHtml(currentVersion)}</span><strong>v${escapeHtml(latestVersion)}</strong>`
    : `<strong>v${escapeHtml(latestVersion)}</strong>`;
  const modal = document.createElement("section");
  modal.className = "update-notice-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", modalTitle);
  modal.innerHTML = `
    <div class="update-notice-backdrop"></div>
    <article class="update-notice-panel">
      <header>
        <p class="eyebrow">${escapeHtml(t("updateNoticeEyebrow"))}</p>
        <h3>${escapeHtml(modalTitle)}</h3>
        <button class="icon-button update-notice-close" type="button" aria-label="${escapeHtml(t("close"))}">×</button>
      </header>
      <div class="update-notice-version">
        ${versionHtml}
      </div>
      <pre>${escapeHtml(releaseNotes)}</pre>
      <footer>
        <button class="secondary-button update-notice-release" type="button">${escapeHtml(t("openReleasePage"))}</button>
        <button class="primary-button update-notice-done" type="button">${escapeHtml(t("updateNoticeDone"))}</button>
      </footer>
    </article>
  `;
  document.body.append(modal);

  const dismiss = () => {
    modal.remove();
  };
  modal.querySelector(".update-notice-backdrop")?.addEventListener("click", dismiss);
  modal.querySelector(".update-notice-close")?.addEventListener("click", dismiss);
  modal.querySelector(".update-notice-done")?.addEventListener("click", dismiss);
  modal.querySelector(".update-notice-release")?.addEventListener("click", () => {
    void window.bonsai.openUpdatePage(updateStatus.releaseUrl);
  });
}

function formatUpdateNoticeNotes(notes: string | undefined) {
  const normalized = notes?.replace(/\r\n/g, "\n").trim();
  if (!normalized) return t("updateNoticeNoNotes");
  return normalized
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s+/, "").trimEnd())
    .filter((line, index, lines) => line.trim() || (index > 0 && index < lines.length - 1))
    .join("\n")
    .slice(0, 4_000);
}

function renderTreeStartModal() {
  if (!treeStartModal || !ledger) return;
  const visible = !ledger.settings.treeStartMode;
  treeStartModal.hidden = !visible;
  if (!visible) {
    clearTreeStartCloudHelp();
    setTreeStartFeedback("");
  }
  if (visible && treeStartTreeImage && tree) {
    const stage = tree.stages[0];
    if (stage) treeStartTreeImage.src = assetUrl(stage.image);
  }
  if (visible && treeStartNewButton) {
    treeStartNewButton.disabled = treeStartPendingAction !== null;
    treeStartNewButton.classList.toggle("is-pending", treeStartPendingAction === "new");
  }
  if (visible && treeStartExistingButton) {
    const unavailable = !cloudSyncStatus.configured || cloudSyncStatus.syncing;
    treeStartExistingButton.disabled = treeStartPendingAction !== null || unavailable;
    treeStartExistingButton.classList.toggle("is-disabled", !cloudSyncStatus.configured);
    treeStartExistingButton.classList.toggle("is-pending", treeStartPendingAction === "cloud");
  }
  if (treeStartCancelButton) {
    treeStartCancelButton.hidden = treeStartPendingAction !== "cloud";
  }
}

function setTreeStartFeedback(message: string, tone: "busy" | "success" | "error" | "" = "") {
  if (!treeStartFeedback) return;
  treeStartFeedback.textContent = message;
  treeStartFeedback.dataset.tone = tone;
}

function scheduleTreeStartCloudHelp() {
  clearTreeStartCloudHelp();
  treeStartCloudHelpTimer = window.setTimeout(() => {
    showTreeStartCloudHelp();
  }, TREE_START_CLOUD_HELP_MS);
}

function clearTreeStartCloudHelp() {
  if (treeStartCloudHelpTimer === undefined) return;
  window.clearTimeout(treeStartCloudHelpTimer);
  treeStartCloudHelpTimer = undefined;
}

function remindTreeStartCloudPending() {
  if (treeStartPendingAction !== "cloud") return;
  showTreeStartCloudHelp();
}

function showTreeStartCloudHelp() {
  if (treeStartPendingAction !== "cloud") return;
  setTreeStartFeedback(t("treeStartStillWaiting"), "busy");
}

function setTreeStartPending(action: "new" | "cloud") {
  treeStartPendingVersion += 1;
  const pendingVersion = treeStartPendingVersion;
  treeStartPendingAction = action;
  [treeStartNewButton, treeStartExistingButton].forEach((button) => {
    if (!button) return;
    button.disabled = true;
    button.classList.toggle(
      "is-pending",
      (action === "new" && button === treeStartNewButton) || (action === "cloud" && button === treeStartExistingButton),
    );
  });
  if (treeStartCancelButton) treeStartCancelButton.hidden = action !== "cloud";
  return pendingVersion;
}

function isCurrentTreeStartPending(pendingVersion: number) {
  return treeStartPendingVersion === pendingVersion;
}

function clearTreeStartPending(pendingVersion?: number) {
  if (pendingVersion !== undefined && pendingVersion !== treeStartPendingVersion) return;
  treeStartPendingVersion += 1;
  clearTreeStartCloudHelp();
  treeStartPendingAction = null;
  [treeStartNewButton, treeStartExistingButton].forEach((button) => {
    if (!button) return;
    button.disabled = false;
    button.classList.remove("is-pending");
  });
  if (treeStartCancelButton) treeStartCancelButton.hidden = true;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function renderCloudSyncSettings() {
  if (cloudSyncStatusText) {
    const lines = [
      `<strong>${escapeHtml(cloudSyncStatus.enabled ? t("cloudSyncEnabled") : t("cloudSyncDisabled"))}</strong>`,
      `<span>${escapeHtml(cloudSyncStatusCopy())}</span>`,
    ];
    cloudSyncStatusText.innerHTML = lines.join("");
  }
  const showAdvancedSync = cloudSyncStatus.enabled;
  const cloudSyncSettings = cloudSyncStatusText?.closest<HTMLElement>(".cloud-sync-settings");
  if (cloudSyncSettings) cloudSyncSettings.dataset.connected = String(showAdvancedSync);
  if (cloudSyncAutoSyncInput) {
    cloudSyncAutoSyncInput.disabled = !cloudSyncStatus.enabled || cloudSyncStatus.syncing;
  }
  if (cloudSyncActionButton) {
    cloudSyncActionButton.disabled = cloudSyncStatus.syncing || !cloudSyncStatus.configured;
    cloudSyncActionButton.textContent = cloudSyncStatus.syncing
      ? t("cloudSyncSyncing")
      : cloudSyncStatus.enabled
        ? t("cloudSyncSyncTree")
        : t("cloudSyncConnectAndSync");
  }
  if (cloudSyncDeviceList) {
    const devices = showAdvancedSync ? (cloudSyncStatus.devices ?? []) : [];
    const visibleDevices = visibleCloudDevices(devices);
    cloudSyncDeviceList.innerHTML = visibleDevices.length
      ? `
        ${renderCloudDeviceShare(devices)}
        ${visibleDevices
          .slice(0, 6)
          .map((device) => {
            const isCurrent = device.deviceId === cloudSyncStatus.deviceId;
            const name = device.alias || device.platform || `${t("device")} ${device.deviceId.slice(-6)}`;
            const parts = [
              device.lastSyncedAt ? `${t("cloudDeviceLastSynced")} ${formatRelativeTime(device.lastSyncedAt)}` : "",
            ].filter(Boolean);
            return `
              <div class="cloud-device-row">
                <div>
                  <strong>${escapeHtml(name)}${isCurrent ? ` · ${escapeHtml(t("cloudDeviceCurrent"))}` : ""}</strong>
                  <span>${escapeHtml(parts.join(" · ") || device.deviceId.slice(-6))}</span>
                </div>
                <strong>${formatCompact(device.tokens)} token</strong>
              </div>
            `;
          })
          .join("")}
      `
      : "";
  }
}

function visibleCloudDevices(devices: NonNullable<CloudSyncStatus["devices"]>) {
  return [...devices]
    .filter((device) => device.deviceId === cloudSyncStatus.deviceId || Math.max(0, device.tokens) > 0)
    .sort((left, right) => {
      const leftCurrent = left.deviceId === cloudSyncStatus.deviceId;
      const rightCurrent = right.deviceId === cloudSyncStatus.deviceId;
      if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
      return Math.max(0, right.tokens) - Math.max(0, left.tokens);
    });
}

function renderCloudDeviceShare(devices: NonNullable<CloudSyncStatus["devices"]>) {
  const totalTokens = devices.reduce((sum, device) => sum + Math.max(0, device.tokens), 0);
  const currentDeviceTokens = devices
    .filter((device) => device.deviceId === cloudSyncStatus.deviceId)
    .reduce((sum, device) => sum + Math.max(0, device.tokens), 0);
  const remoteDeviceTokens = Math.max(0, totalTokens - currentDeviceTokens);
  const localPercent = totalTokens > 0 ? Math.round(clamp((currentDeviceTokens / totalTokens) * 100, 0, 100)) : 0;
  const remotePercent = totalTokens > 0 ? 100 - localPercent : 0;
  return `
    <div class="cloud-device-share">
      <div class="cloud-device-share-header">
        <span>${escapeHtml(t("cloudDeviceShareTitle"))}</span>
        <strong>${escapeHtml(t("cloudDeviceLocalShare"))} ${localPercent}% · ${escapeHtml(t("cloudDeviceRemoteShare"))} ${remotePercent}%</strong>
      </div>
      <div class="cloud-device-share-meter source-meter" aria-hidden="true">
        <span style="width:${localPercent}%"></span>
      </div>
      <div class="cloud-device-share-values">
        <span>${escapeHtml(t("cloudDeviceLocalShare"))} ${formatCompact(currentDeviceTokens)} token</span>
        <span>${escapeHtml(t("cloudDeviceRemoteShare"))} ${formatCompact(remoteDeviceTokens)} token</span>
      </div>
    </div>
  `;
}

function cloudSyncStatusCopy() {
  if (!cloudSyncStatus.configured) return t("cloudSyncNotConfigured");
  if (cloudSyncStatus.error) return cloudSyncStatus.error;
  if (!cloudSyncStatus.authenticated) return t("cloudSyncLoginRequired");
  if (!cloudSyncStatus.enabled) return t("cloudSyncOffHint");
  if (cloudSyncStatus.syncing) return t("cloudSyncSyncing");
  const pieces = [];
  if (cloudSyncStatus.lastSyncedAt) pieces.push(`${t("leaderboardLastSynced")} ${formatRelativeTime(cloudSyncStatus.lastSyncedAt)}`);
  if (cloudSyncStatus.deviceId) pieces.push(`${t("device")} ${cloudSyncStatus.deviceId.slice(-6)}`);
  return pieces.join(" · ") || t("cloudSyncReady");
}

function defaultSocialProfilePrivacy(): SocialProfilePrivacy {
  return {
    profileVisibility: "relations",
    showLevel: true,
    showTokenTotal: true,
    showActiveDays: true,
    showAchievements: true,
  };
}

function normalizeSocialProfileVisibility(value: unknown): SocialProfilePrivacy["profileVisibility"] {
  return value === "friends" || value === "private" ? value : "relations";
}

async function ensureSocialProfilePrivacyLoaded() {
  if (
    socialProfilePrivacy ||
    socialProfilePrivacyLoading ||
    (socialProfilePrivacyError && !socialProfilePrivacy) ||
    !leaderboardStatus.configured ||
    !leaderboardStatus.authenticated
  ) {
    renderSocialProfilePrivacySettings();
    return;
  }
  socialProfilePrivacyLoading = true;
  socialProfilePrivacyError = "";
  socialProfilePrivacyMessage = "";
  renderSocialProfilePrivacySettings();
  try {
    socialProfilePrivacy = await window.bonsai.getSocialProfilePrivacy();
  } catch (error) {
    socialProfilePrivacyError = t("socialProfilePrivacyLoadFailed");
  } finally {
    socialProfilePrivacyLoading = false;
    renderSocialProfilePrivacySettings();
  }
}

async function updateSocialProfilePrivacy(partial: Partial<SocialProfilePrivacy>) {
  if (!leaderboardStatus.configured || !leaderboardStatus.authenticated) {
    renderSocialProfilePrivacySettings();
    return;
  }
  const current = socialProfilePrivacy ?? defaultSocialProfilePrivacy();
  const previous = socialProfilePrivacy;
  const optimistic = {
    ...current,
    ...partial,
    profileVisibility:
      partial.profileVisibility !== undefined
        ? normalizeSocialProfileVisibility(partial.profileVisibility)
        : current.profileVisibility,
  };
  socialProfilePrivacy = optimistic;
  socialProfilePrivacyError = "";
  socialProfilePrivacyMessage = "";
  renderSocialProfilePrivacySettings();
  try {
    socialProfilePrivacy = await window.bonsai.updateSocialProfilePrivacy(optimistic);
    socialProfilePrivacyMessage = t("socialProfilePrivacySaved");
  } catch (error) {
    socialProfilePrivacy = previous;
    socialProfilePrivacyError = t("socialProfilePrivacySaveFailed");
  } finally {
    renderSocialProfilePrivacySettings();
  }
}

function renderSocialProfilePrivacySettings() {
  if (!socialProfilePrivacySettings) return;
  const privacy = socialProfilePrivacy ?? defaultSocialProfilePrivacy();
  const loadBlocked = Boolean(socialProfilePrivacyError && !socialProfilePrivacy);
  const enabled = leaderboardStatus.configured && leaderboardStatus.authenticated && !socialProfilePrivacyLoading && !loadBlocked;

  if (socialProfileVisibilitySelect) {
    socialProfileVisibilitySelect.value = privacy.profileVisibility;
    socialProfileVisibilitySelect.disabled = !enabled;
  }
  if (socialProfileShowLevelInput) {
    socialProfileShowLevelInput.checked = privacy.showLevel;
    socialProfileShowLevelInput.disabled = !enabled;
  }
  if (socialProfileShowTokenTotalInput) {
    socialProfileShowTokenTotalInput.checked = privacy.showTokenTotal;
    socialProfileShowTokenTotalInput.disabled = !enabled;
  }
  if (socialProfileShowActiveDaysInput) {
    socialProfileShowActiveDaysInput.checked = privacy.showActiveDays;
    socialProfileShowActiveDaysInput.disabled = !enabled;
  }
  if (socialProfileShowAchievementsInput) {
    socialProfileShowAchievementsInput.checked = privacy.showAchievements;
    socialProfileShowAchievementsInput.disabled = !enabled;
  }
  if (!socialProfilePrivacyStatus) return;

  let message = "";
  let tone = "";
  if (!leaderboardStatus.configured) {
    message = t("leaderboardNoService");
  } else if (!leaderboardStatus.authenticated) {
    message = t("leaderboardLoginRequired");
  } else if (socialProfilePrivacyLoading) {
    message = t("leaderboardRefreshing");
  } else if (socialProfilePrivacyError) {
    message = socialProfilePrivacyError;
    tone = "error";
  } else if (socialProfilePrivacyMessage) {
    message = socialProfilePrivacyMessage;
    tone = "success";
  } else {
    message = t("socialProfilePrivacyHint");
  }
  socialProfilePrivacyStatus.textContent = message;
  socialProfilePrivacyStatus.dataset.tone = tone;
}

function renderLeaderboardSettings() {
  const renderKey = leaderboardSettingsSignature();
  if (renderKey === leaderboardSettingsRenderKey) return;
  leaderboardSettingsRenderKey = renderKey;
  const leaderboardOptionsEnabled =
    leaderboardStatus.configured && leaderboardStatus.authenticated && leaderboardStatus.joined && !leaderboardStatus.syncing;
  if (leaderboardPageRefreshButton) {
    leaderboardPageRefreshButton.disabled = leaderboardLoading || !leaderboardStatus.configured;
    leaderboardPageRefreshButton.textContent = leaderboardLoading
      ? leaderboardStatus.joined
        ? t("leaderboardSyncingAndRefreshing")
        : t("leaderboardRefreshing")
      : leaderboardStatus.joined
        ? t("refreshAndSyncLeaderboard")
        : t("refreshLeaderboard");
  }
  if (leaderboardPageSyncButton) {
    leaderboardPageSyncButton.disabled =
      leaderboardStatus.syncing ||
      !leaderboardStatus.configured ||
      (leaderboardStatus.joined && !leaderboardStatus.authenticated);
    leaderboardPageSyncButton.textContent = leaderboardStatus.joined ? t("leaveLeaderboard") : t("joinLeaderboard");
    leaderboardPageSyncButton.classList.toggle("danger-button", leaderboardStatus.joined);
  }
  if (leaderboardAutoSyncInput) {
    leaderboardAutoSyncInput.disabled = !leaderboardOptionsEnabled;
  }
  if (leaderboardPreferencesPublicInput) {
    leaderboardPreferencesPublicInput.disabled = !leaderboardOptionsEnabled;
  }

  if (leaderboardUserCard) {
    const profile = leaderboardStatus.profile;
    leaderboardUserCard.innerHTML = profile
      ? `
        ${leaderboardAvatar(profile.avatarUrl, profile.username)}
        <div>
          <strong>${escapeHtml(profile.username)}</strong>
          <span>${leaderboardStatus.joined ? leaderboardPreferenceStatusLabel() : t("leaderboardSignedInNotJoined")}</span>
        </div>
      `
      : `
        <span class="leaderboard-avatar placeholder" aria-hidden="true">GH</span>
        <div>
          <strong>${t("leaderboardNotSignedIn")}</strong>
          <span>${t("leaderboardLoginRequired")}</span>
        </div>
      `;
  }

  if (!leaderboardStatusText) return;
  const { title, detail } = leaderboardStatusCopy();
  leaderboardStatusText.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(detail)}</span>
  `;
}

function renderLeaderboard() {
  if (!leaderboardRows || !leaderboardSummary) return;
  const renderKey = leaderboardRenderSignature();
  if (renderKey === leaderboardRenderKey) return;
  leaderboardRenderKey = renderKey;

  leaderboardRangeTabs?.querySelectorAll<HTMLButtonElement>("[data-leaderboard-range]").forEach((button) => {
    const active = button.dataset.leaderboardRange === leaderboardRange;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (!leaderboardStatus.configured) {
    leaderboardSummary.innerHTML = `<strong>${t("leaderboardServiceNotConfigured")}</strong><span>${t("leaderboardNoService")}</span>`;
    leaderboardRows.innerHTML = `<div class="leaderboard-empty">${t("leaderboardNoService")}</div>`;
    return;
  }

  if (leaderboardLoading) {
    leaderboardSummary.innerHTML = `<strong>${t("leaderboardRefreshing")}</strong><span>${leaderboardRangeLabel(leaderboardRange)}</span>`;
    leaderboardRows.innerHTML = `<div class="leaderboard-empty">${t("leaderboardRefreshing")}</div>`;
    return;
  }

  if (leaderboardLoadedRange !== leaderboardRange) {
    leaderboardSummary.innerHTML = `<strong>${leaderboardRangeLabel(leaderboardRange)}</strong><span>${t("leaderboardClickRefresh")}</span>`;
    leaderboardRows.innerHTML = `<div class="leaderboard-empty">${t("leaderboardClickRefresh")}</div>`;
    return;
  }

  if (leaderboardData.error) {
    leaderboardSummary.innerHTML = `<strong>${escapeHtml(leaderboardData.error)}</strong><span>${leaderboardRangeLabel(leaderboardRange)}</span>`;
    leaderboardRows.innerHTML = `<div class="leaderboard-empty">${escapeHtml(leaderboardData.error)}</div>`;
    return;
  }

  const updated = leaderboardData.updatedAt
    ? `${t("leaderboardUpdated")} ${formatRelativeTime(leaderboardData.updatedAt)}`
    : leaderboardRangeLabel(leaderboardRange);
  leaderboardSummary.innerHTML = `
    <strong>${leaderboardRangeLabel(leaderboardRange)}</strong>
    <span>${escapeHtml(updated)}</span>
  `;

  const entries = leaderboardData.entries;
  if (!entries.length) {
    leaderboardRows.innerHTML = `<div class="leaderboard-empty">${t("leaderboardEmpty")}</div>`;
    return;
  }

  const myUserId = leaderboardStatus.profile?.id;
  leaderboardRows.innerHTML = entries
    .map((entry) => {
      const isMe = myUserId === entry.userId;
      const days = entry.daysActive ? `<span>${entry.daysActive} ${t("leaderboardDaysActive")}</span>` : "";
      const preference = leaderboardPreferenceHtml(entry);
      return `
        <article class="leaderboard-row${isMe ? " is-me" : ""}">
          <strong class="leaderboard-rank">#${entry.rank}</strong>
          ${leaderboardAvatar(entry.avatarUrl, entry.username)}
          <div class="leaderboard-person">
            <strong>${escapeHtml(entry.username || t("unknownUser"))}${isMe ? ` <em>${t("leaderboardMe")}</em>` : ""}</strong>
            ${days}
            ${preference}
          </div>
          <strong class="leaderboard-tokens">${formatNumber(entry.tokens)} token</strong>
        </article>
      `;
    })
    .join("");
}

function renderSocial() {
  if (
    !socialSummary ||
    !socialFriendsPanel ||
    !socialGroupsPanel ||
    !socialGroupDetailPanel ||
    !socialGroupInbox ||
    !socialFriendList ||
    !socialGroupList ||
    !socialGroupDetail ||
    !socialGroupBasisTabs ||
    !socialGroupLeaderboardRows ||
    !socialGroupControls ||
    !socialGroupFriendInviteSelect ||
    !socialGroupRequestList ||
    !socialInviteOutput
  ) {
    return;
  }
  const renderKey = socialRenderSignature();
  if (renderKey === socialRenderKey) return;
  socialRenderKey = renderKey;

  const group = selectedSocialGroup();
  const canManageGroup = group?.role === "leader" || group?.role === "officer";
  const groupsEmpty = socialPanel === "groups" && !socialGroups.length;
  const hasActiveInvite = Boolean(group && socialInvite?.groupId === group.groupId);

  socialRefreshButton && (socialRefreshButton.disabled = socialLoading || socialGroupLeaderboardLoading);
  socialModeTabs?.querySelectorAll<HTMLButtonElement>("[data-social-panel]").forEach((button) => {
    const active = button.dataset.socialPanel === socialPanel;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  socialFriendsPanel.hidden = socialPanel !== "friends";
  socialGroupsPanel.hidden = socialPanel !== "groups";
  socialGroupsPanel.classList.toggle("is-empty", groupsEmpty);
  socialGroupDetailPanel.hidden = groupsEmpty;
  if (socialGroupManageButton) {
    socialGroupManageButton.disabled = socialLoading;
    socialGroupManageButton.textContent = groupsEmpty ? t("socialGroupActions") : t("socialGroupManage");
  }
  socialAddFriendForm?.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button,input").forEach((element) => {
    element.disabled = socialLoading;
  });
  socialCreateGroupForm?.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button,input").forEach((element) => {
    element.disabled = socialLoading;
  });
  socialJoinInviteForm?.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button,input").forEach((element) => {
    element.disabled = socialLoading;
  });
  socialGroupFriendInviteForm?.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button,select").forEach((element) => {
    element.disabled = socialLoading || !canManageGroup;
  });
  if (socialInviteManager) {
    socialInviteManager.hidden = !group;
  }
  if (socialInviteGroupSummary) {
    socialInviteGroupSummary.innerHTML = group
      ? `
        <strong>${escapeHtml(group.name)}</strong>
        <span>${formatNumber(group.memberCount)} ${t("socialMembers")} · ${socialRoleLabel(group.role)}</span>
      `
      : `<span>${t("socialNoGroupSelected")}</span>`;
  }
  if (socialCreateInviteButton) {
    socialCreateInviteButton.disabled = socialLoading || !canManageGroup;
    socialCreateInviteButton.textContent = hasActiveInvite ? t("socialCopyInvite") : t("socialCreateInvite");
    socialCreateInviteButton.title = canManageGroup
      ? hasActiveInvite
        ? t("socialCopyInvite")
        : t("socialCreateInvite")
      : t("socialInviteOfficerOnly");
  }

  socialGroupRangeTabs?.querySelectorAll<HTMLButtonElement>("[data-social-group-range]").forEach((button) => {
    const active = button.dataset.socialGroupRange === socialGroupRange;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  socialGroupBasisTabs?.querySelectorAll<HTMLButtonElement>("[data-social-group-basis]").forEach((button) => {
    const active = normalizeSocialGroupBasis(button.dataset.socialGroupBasis) === socialGroupBasis;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  let summaryHtml = "";
  if (!leaderboardStatus.configured) {
    summaryHtml = `<strong>${t("leaderboardServiceNotConfigured")}</strong><span>${t("socialNoService")}</span>`;
  } else if (socialLoading) {
    summaryHtml = `<strong>${t("socialLoading")}</strong><span>${socialPanel === "groups" ? leaderboardRangeLabel(socialGroupRange) : t("socialPanelFriends")}</span>`;
  } else if (socialError) {
    summaryHtml = `<strong>${escapeHtml(socialError)}</strong><span>${t("socialRefresh")}</span>`;
  } else if (socialNotice) {
    const detail = socialPanel === "friends" ? t("socialFriendRequestSentHint") : t("socialRefresh");
    summaryHtml = `<strong>${escapeHtml(socialNotice)}</strong><span>${escapeHtml(detail)}</span>`;
  } else if (socialPanel === "friends" && socialFriends.length) {
    const updatedAt = socialFriendsUpdatedAt;
    const updated = updatedAt ? `${t("socialUpdated")} ${formatRelativeTime(updatedAt)}` : "";
    summaryHtml = `<strong>${socialFriends.length} ${t("socialFriendsCount")}</strong><span>${escapeHtml(updated)}</span>`;
  } else if (socialPanel === "groups" && socialGroups.length) {
    const updated = socialGroupsUpdatedAt ? `${t("socialUpdated")} ${formatRelativeTime(socialGroupsUpdatedAt)}` : "";
    summaryHtml = `<strong>${socialGroups.length} ${t("socialGroupsCount")}</strong><span>${escapeHtml(updated)}</span>`;
  } else if (!leaderboardStatus.authenticated) {
    summaryHtml = `<strong>${t("socialLoginRequired")}</strong><span>${t("socialLoginHint")}</span>`;
  }
  socialSummary.hidden = !summaryHtml;
  socialSummary.innerHTML = summaryHtml;

  socialGroupInbox.innerHTML = renderSocialGroupInbox();

  socialFriendList.innerHTML = socialFriends.length
    ? socialFriends
        .map((friend) => {
          const pending = friend.status === "pending";
          const canAccept = pending && friend.direction === "incoming";
          const removeLabel = pending && friend.direction === "outgoing" ? t("socialFriendCancel") : t("socialFriendRemove");
          return `
            <article class="social-friend-item${pending ? " pending" : ""}">
              <button class="social-profile-trigger" type="button" data-social-profile-id="${escapeHtml(friend.userId)}" title="${escapeHtml(t("socialProfileOpenHint"))}">
                ${socialFriendAvatar(friend)}
                <span class="social-friend-copy">
                  <strong>${escapeHtml(friend.username)}</strong>
                  <span>${socialFriendStatusLabel(friend)}</span>
                </span>
              </button>
              <span class="social-friend-actions">
                ${
                  canAccept
                    ? `<button class="secondary-button" type="button" data-social-friend-action="accept" data-social-friend-id="${escapeHtml(friend.userId)}">${t("socialFriendAccept")}</button>`
                    : ""
                }
                <button class="secondary-button" type="button" data-social-friend-action="remove" data-social-friend-id="${escapeHtml(friend.userId)}">${removeLabel}</button>
              </span>
            </article>
          `;
        })
        .join("")
    : `<div class="leaderboard-empty social-empty">${t("socialFriendsEmpty")}</div>`;

  socialGroupList.innerHTML = socialGroups.length
    ? socialGroups
        .map((item) => {
          const active = item.groupId === socialSelectedGroupId;
          return `
            <button class="social-group-item${active ? " active" : ""}" type="button" data-social-group-id="${escapeHtml(item.groupId)}">
              <span class="social-group-icon" aria-hidden="true">${escapeHtml(item.iconEmoji || "VT")}</span>
              <span class="social-group-copy">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${formatNumber(item.memberCount)} ${t("socialMembers")} · ${socialRoleLabel(item.role)}</span>
              </span>
            </button>
          `;
        })
        .join("")
    : `<div class="leaderboard-empty social-empty">${t("socialGroupsEmpty")}</div>`;

  if (!group) {
    socialGroupDetail.innerHTML = `
      <strong>${t("socialNoGroupSelected")}</strong>
      <span>${t("socialCreateOrJoin")}</span>
    `;
    socialGroupControls.innerHTML = "";
    socialGroupFriendInviteSelect.innerHTML = `<option value="">${escapeHtml(t("socialInviteFriendEmpty"))}</option>`;
    socialGroupRequestList.innerHTML = "";
    socialInviteOutput.innerHTML = "";
    socialGroupLeaderboardRows.innerHTML = groupsEmpty ? "" : `<div class="leaderboard-empty">${t("socialNoGroupSelected")}</div>`;
    return;
  }

  const isOwner = group.ownerUserId === leaderboardStatus.profile?.id;
  const sharing = group.shareUsage !== false;
  const friendInviteOptions = socialFriends
    .filter((friend) => friend.status === "accepted")
    .filter((friend) => !group.members?.some((member) => member.userId === friend.userId))
    .filter((friend) => !socialGroupJoinRequests.some((request) => request.requesterUserId === friend.userId))
    .sort((a, b) => a.username.localeCompare(b.username));
  socialGroupFriendInviteSelect.innerHTML = friendInviteOptions.length
    ? friendInviteOptions
        .map((friend) => `<option value="${escapeHtml(friend.userId)}">${escapeHtml(friend.username)}</option>`)
        .join("")
    : `<option value="">${escapeHtml(t("socialInviteFriendEmpty"))}</option>`;
  socialGroupDetail.innerHTML = `
    <div class="social-group-title">
      <span class="social-group-icon large" aria-hidden="true">${escapeHtml(group.iconEmoji || "VT")}</span>
      <div>
        <strong>${escapeHtml(group.name)}</strong>
        <span>${formatNumber(group.memberCount)} ${t("socialMembers")} · ${socialRoleLabel(group.role)}</span>
      </div>
    </div>
    ${group.description ? `<p>${escapeHtml(group.description)}</p>` : ""}
  `;
  socialGroupControls.innerHTML = `
    <div class="social-share-control">
      <span class="social-share-label">${t("socialGroupShareLabel")}</span>
      <button class="secondary-button social-share-toggle" type="button" data-social-group-action="toggle-share" data-group-id="${escapeHtml(group.groupId)}" aria-pressed="${sharing ? "true" : "false"}">
        ${sharing ? t("socialGroupShareEnabled") : t("socialGroupShareDisabled")}
      </button>
    </div>
    ${
      isOwner
        ? ""
        : `<button class="secondary-button danger-button" type="button" data-social-group-action="leave" data-group-id="${escapeHtml(group.groupId)}">${t("socialGroupLeave")}</button>`
    }
  `;

  socialInviteOutput.innerHTML = socialInvite
    ? `
      <strong>${t("socialInviteReady")}</strong>
      <code>${escapeHtml(socialInvite.code)}</code>
      <span>${Date.now() - socialInviteCopiedAt < 3_000 ? t("socialInviteCopied") : t("socialInviteHint")}</span>
    `
    : "";

  socialGroupRequestList.innerHTML = canManageGroup ? renderSocialGroupRequests() : "";

  const board = socialGroupLeaderboard;
  if (
    socialGroupLeaderboardLoading &&
    (!board || board.groupId !== group.groupId || board.range !== socialGroupRange || board.basis !== socialGroupBasis)
  ) {
    socialGroupLeaderboardRows.innerHTML = `<div class="leaderboard-empty">${t("socialLeaderboardLoading")}</div>`;
    return;
  }

  if (!board || board.groupId !== group.groupId || board.range !== socialGroupRange || board.basis !== socialGroupBasis) {
    socialGroupLeaderboardRows.innerHTML = `<div class="leaderboard-empty">${t("leaderboardClickRefresh")}</div>`;
    return;
  }

  if (board.error) {
    socialGroupLeaderboardRows.innerHTML = `<div class="leaderboard-empty">${escapeHtml(board.error)}</div>`;
    return;
  }

  if (!board.entries.length) {
    socialGroupLeaderboardRows.innerHTML = `<div class="leaderboard-empty">${t("socialLeaderboardEmpty")}</div>`;
    return;
  }

  const myUserId = leaderboardStatus.profile?.id;
  socialGroupLeaderboardRows.innerHTML = board.entries
    .map((entry) => {
      const isMe = myUserId === entry.userId;
      const days = entry.daysActive ? `<span>${entry.daysActive} ${t("leaderboardDaysActive")}</span>` : "";
      return `
        <article class="leaderboard-row social-leaderboard-row${isMe ? " is-me" : ""}">
          <strong class="leaderboard-rank">#${entry.rank}</strong>
          <button class="social-profile-trigger leaderboard-person-trigger" type="button" data-social-profile-id="${escapeHtml(entry.userId)}" title="${escapeHtml(t("socialProfileOpenHint"))}">
            ${leaderboardAvatar(entry.avatarUrl, entry.username)}
            <div class="leaderboard-person">
              <strong>${escapeHtml(entry.username || t("unknownUser"))}${isMe ? ` <em>${t("leaderboardMe")}</em>` : ""}</strong>
              <span>${socialRoleLabel(entry.role)}</span>
              ${days}
              <span class="social-profile-open-copy">${t("socialProfileOpenHint")}</span>
            </div>
          </button>
          <strong class="leaderboard-tokens">${formatNumber(entry.tokens)} token</strong>
        </article>
      `;
    })
    .join("");
}

function renderSocialGroupInbox() {
  const requests = [...socialIncomingGroupInvites, ...socialOutgoingGroupRequests];
  if (!requests.length) return "";
  return `
    <section class="social-request-section">
      ${requests
        .map((request) => {
          const incoming = request.type === "friend_invite";
          const secondary = incoming
            ? t("socialGroupInviteFrom").replace("{name}", request.invitedByUsername || t("unknownUser"))
            : t("socialGroupInvitePending");
          return `
            <article class="social-request-item">
              ${socialGroupRequestAvatar(request)}
              <span class="social-request-copy">
                <strong>${escapeHtml(request.groupName)}</strong>
                <span>${escapeHtml(secondary)}</span>
              </span>
              <span class="social-request-actions">
                ${
                  incoming
                    ? `<button class="secondary-button" type="button" data-social-group-inbox-action="accept" data-social-group-request-id="${escapeHtml(request.requestId)}">${t("socialGroupInviteAccept")}</button>`
                    : ""
                }
                <button class="secondary-button" type="button" data-social-group-inbox-action="decline" data-social-group-request-id="${escapeHtml(request.requestId)}">${incoming ? t("socialGroupInviteDecline") : t("socialGroupInviteCancel")}</button>
              </span>
            </article>
          `;
        })
        .join("")}
    </section>
  `;
}

function renderSocialGroupRequests() {
  const groupRequests = socialGroupJoinRequests.filter((request) => request.groupId === socialSelectedGroupId);
  if (!groupRequests.length) {
    return `<div class="leaderboard-empty social-empty compact">${t("socialGroupRequestsEmpty")}</div>`;
  }
  return `
    <section class="social-request-section">
      <strong class="social-request-section-title">${t("socialGroupRequests")}</strong>
      ${groupRequests
        .map((request) => {
          const isCodeRequest = request.type === "invite_code";
          const meta = isCodeRequest
            ? t("socialGroupInviteFrom").replace("{name}", request.requesterUsername)
            : t("socialGroupInviteTo").replace("{name}", request.requesterUsername);
          return `
            <article class="social-request-item">
              ${socialGroupRequestAvatar(request)}
              <span class="social-request-copy">
                <strong>${escapeHtml(request.requesterUsername)}</strong>
                <span>${escapeHtml(meta)}</span>
              </span>
              <span class="social-request-actions">
                ${
                  isCodeRequest
                    ? `<button class="secondary-button" type="button" data-social-group-request-action="approve" data-social-group-request-id="${escapeHtml(request.requestId)}">${t("socialGroupInviteApprove")}</button>`
                    : `<span class="social-request-pill">${t("socialGroupInvitePending")}</span>`
                }
                <button class="secondary-button" type="button" data-social-group-request-action="decline" data-social-group-request-id="${escapeHtml(request.requestId)}">${t("socialGroupInviteDecline")}</button>
              </span>
            </article>
          `;
        })
        .join("")}
    </section>
  `;
}

function socialGroupRequestAvatar(request: SocialGroupJoinRequest) {
  const label = request.requesterUsername || request.groupName || "VT";
  const avatar = request.groupIconEmoji
    ? `<span class="leaderboard-avatar placeholder" aria-hidden="true">${escapeHtml(request.groupIconEmoji)}</span>`
    : leaderboardAvatar(request.requesterAvatarUrl, label);
  return avatar;
}

function leaderboardStatusCopy() {
  if (!leaderboardStatus.configured) {
    return {
      title: t("leaderboardServiceNotConfigured"),
      detail: t("leaderboardNoService"),
    };
  }
  if (leaderboardStatus.syncing) {
    return {
      title: t("leaderboardSyncing"),
      detail: leaderboardStatus.lastSyncedAt
        ? `${t("leaderboardLastSynced")} ${formatRelativeTime(leaderboardStatus.lastSyncedAt)}`
        : t("leaderboardOnlyDailyTokens"),
    };
  }
  if (leaderboardStatus.error) {
    return {
      title: leaderboardStatus.joined ? t("leaderboardJoined") : t("leaderboardLoginRequired"),
      detail: leaderboardStatus.error,
    };
  }
  if (leaderboardStatus.joined) {
    return {
      title: t("leaderboardJoined"),
      detail: leaderboardStatus.lastSyncedAt
        ? `${t("leaderboardLastSynced")} ${formatRelativeTime(leaderboardStatus.lastSyncedAt)}`
        : t("leaderboardOnlyDailyTokens"),
    };
  }
  if (leaderboardStatus.authenticated) {
    return {
      title: t("leaderboardSignedInNotJoined"),
      detail: t("leaderboardOnlyDailyTokens"),
    };
  }
  return {
    title: t("leaderboardNotSignedIn"),
    detail: t("leaderboardLoginRequired"),
  };
}

function leaderboardPreferenceStatusLabel() {
  return ledger?.settings.leaderboardPreferencesPublic
    ? t("leaderboardPreferencesPublicOn")
    : t("leaderboardOnlyDailyTokens");
}

function leaderboardPreferenceHtml(entry: LeaderboardEntry) {
  const preference = entry.usagePreference;
  if (!preference) {
    return `<div class="leaderboard-preferences is-private">${escapeHtml(t("leaderboardPreferencePrivate"))}</div>`;
  }
  const labels = leaderboardPreferenceCompactLabels();
  const rows = [
    preference.favoriteAgent
      ? `${labels.agent}: <b>${escapeHtml(preference.favoriteAgent.label)} ${preference.favoriteAgent.percent}%</b>`
      : "",
    preference.favoriteModel ? `${labels.model}: <b>${escapeHtml(preference.favoriteModel)}</b>` : "",
    preference.favoritePeriod
      ? `${labels.period}: <b>${escapeHtml(leaderboardPeriodText(preference.favoritePeriod))}</b>`
      : "",
    preference.peakTokensPerMinute !== undefined
      ? `${labels.peak}: <b>${formatCompact(preference.peakTokensPerMinute)}/min</b>`
      : "",
  ].filter(Boolean);
  if (!rows.length) {
    return `<div class="leaderboard-preferences is-private">${escapeHtml(t("leaderboardPreferencePrivate"))}</div>`;
  }
  return `<div class="leaderboard-preferences">${rows.map((row) => `<span>${row}</span>`).join("")}</div>`;
}

function leaderboardPreferenceCompactLabels() {
  return currentLanguage() === "zh-CN"
    ? { agent: "Agent", model: "模型", period: "时段", peak: "峰值" }
    : { agent: "Agent", model: "Model", period: "Time", peak: "Peak" };
}

function leaderboardPeriodText(period: NonNullable<LeaderboardEntry["usagePreference"]>["favoritePeriod"]) {
  if (!period) return "";
  const labels: Record<string, string> = {
    early: t("leaderboardPeriodEarly"),
    morning: t("leaderboardPeriodMorning"),
    afternoon: t("leaderboardPeriodAfternoon"),
    evening: t("leaderboardPeriodEvening"),
    night: t("leaderboardPeriodNight"),
  };
  return `${labels[period.id] ?? period.id} ${period.startHour}-${period.endHour} ${t("hourUnit")}`;
}

function leaderboardRangeLabel(range: LeaderboardRange) {
  const labels: Record<LeaderboardRange, string> = {
    "24h": t("leaderboard24h"),
    "7d": t("leaderboard7d"),
    "30d": t("leaderboard30d"),
    all: t("leaderboardAllTime"),
  };
  return labels[range];
}

function socialRoleLabel(role: SocialGroupRole | undefined) {
  if (role === "leader") return t("socialRoleLeader");
  if (role === "officer") return t("socialRoleOfficer");
  return t("socialRoleMember");
}

function socialFriendStatusLabel(friend: SocialFriend) {
  if (friend.status === "accepted") return t("socialFriendAccepted");
  if (friend.direction === "incoming") return t("socialFriendIncoming");
  return t("socialFriendOutgoing");
}

function socialFriendAvatar(friend: SocialFriend) {
  const initial = (friend.username || "?").trim().slice(0, 2).toUpperCase();
  if (!friend.avatarUrl) return `<span class="social-friend-avatar" aria-hidden="true">${escapeHtml(initial)}</span>`;
  return `<span class="social-friend-avatar" aria-hidden="true"><img src="${escapeHtml(friend.avatarUrl)}" alt="" loading="lazy" /></span>`;
}

function leaderboardAvatar(avatarUrl: string | undefined, username: string) {
  const initial = (username || "?").trim().slice(0, 2).toUpperCase();
  if (!avatarUrl) return `<span class="leaderboard-avatar placeholder" aria-hidden="true">${escapeHtml(initial)}</span>`;
  return `<img class="leaderboard-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />`;
}

function renderScopedSourceBreakdown(visibility = sourceVisibility()) {
  if (!ledger || !sourceBreakdownElement) return;
  const key = [
    ledgerEntriesSignature(),
    sourceScope,
    currentLanguage(),
    expandedSourceKey ?? "",
    [...visibility.enabled].join(","),
    visibility.visible.join(","),
    usageStatusSignature(),
    cloudModelStatsSignature(),
    relativeRenderBucket(15_000),
  ].join("|");
  if (key === sourceBreakdownCacheKey) return;
  sourceBreakdownCacheKey = key;
  renderSourceBreakdown(
    getSourceBreakdown(getSourceScopeEntries(ledger.entries), visibility.enabled, sourceLabel),
    visibility,
  );
}

function renderSourceBreakdown(rows: SourceBreakdown[], visibility = sourceVisibility()) {
  const element = document.querySelector<HTMLElement>("#sourceBreakdown");
  if (!element) return;
  syncSourceScopeTabs();
  const sourceRows = getMonitorSourceRows(rows, visibility);
  const totalXp = sourceRows.reduce((total, row) => total + row.xp, 0);
  const activeSources = sourceRows.filter((row) => row.xp > 0).length;
  text(
    "#sourceSummary",
    activeSources
      ? sourceActiveText(activeSources)
      : sourceScope === "today"
        ? t("waitingTodayTokens")
        : t("waitingTokens"),
  );
  if (!sourceRows.length) {
    element.innerHTML = `<div class="source-empty">${escapeHtml(t("statsSourceEmpty"))}</div>`;
    return;
  }
  element.innerHTML = sourceRows
    .map((row) => {
      const percent = row.xp > 0 && totalXp > 0 ? Math.max(3, Math.round((row.xp / totalXp) * 100)) : 0;
      const expanded = !row.compact && expandedSourceKey === row.sourceKey;
      if (row.compact) {
        return `
          <article class="source-row compact ${row.statusClass}" data-source-key="${escapeHtml(row.sourceKey)}" data-compact="true">
            <div class="source-main">
              <strong>${escapeHtml(row.label)}</strong>
              <span class="source-status ${row.statusClass}">${escapeHtml(row.status)}</span>
            </div>
          </article>
        `;
      }
      return `
        <article class="source-row ${expanded ? "expanded" : ""}" data-source-key="${escapeHtml(row.sourceKey)}" aria-expanded="${expanded}">
          <div class="source-main">
            <div>
              <strong>${escapeHtml(row.label)}</strong>
              <span class="source-meta">${escapeHtml(row.meta)}</span>
            </div>
            <span class="source-status ${row.statusClass}">${escapeHtml(row.status)}</span>
          </div>
          <div class="source-usage">
            <div>
              <strong>${formatCompact(row.xp)} token</strong>
              <span>${row.xp > 0 ? `${percent}%` : escapeHtml(t("noRecords"))}</span>
            </div>
            <div class="source-meter"><span style="width:${percent}%"></span></div>
            <p>${tokenBreakdownSummary(row)}</p>
          </div>
          ${expanded ? renderModelBreakdown(row.sourceKey, visibility.enabled) : ""}
        </article>
      `;
    })
    .join("");
}

function syncSourceScopeTabs() {
  sourceScopeTabs?.querySelectorAll<HTMLButtonElement>("[data-source-scope]").forEach((button) => {
    button.classList.toggle("active", button.dataset.sourceScope === sourceScope);
  });
}

type SourceRowView = SourceBreakdown & {
  sourceKey: string;
  status: string;
  statusClass: string;
  meta: string;
  compact: boolean;
};

function getMonitorSourceRows(rows: SourceBreakdown[], visibility = sourceVisibility()): SourceRowView[] {
  return AGENT_SOURCES.filter((source) => visibility.visibleSet.has(source.id)).map((monitor) => {
    const matches = rows.filter((row) => sourceMatchesBreakdownRow(row, monitor.id));
    const combined = combineSourceRows(monitor.id === "cloud" ? t("cloudSource") : monitor.label, matches);
    const hasCloudRecords = sourceHasCloudRecords(monitor.id);
    const hasLocalRecords = sourceHasLocalRecords(monitor.id);
    if (monitor.id === "cloud") {
      return {
        ...combined,
        sourceKey: monitor.id,
        status: t("sourceSynced"),
        statusClass: "running",
        meta: t("readingCloudRecords"),
        compact: false,
      };
    }
    const status = monitorStatusView(sourceMonitorStatus(monitor.id));
    if (hasCloudRecords && !hasLocalRecords && status.compact) {
      return {
        ...combined,
        sourceKey: monitor.id,
        status: t("sourceSynced"),
        statusClass: "running",
        meta: t("readingOtherDeviceRecords"),
        compact: false,
      };
    }
    if (combined.xp > 0 && status.compact) {
      return {
        ...combined,
        sourceKey: monitor.id,
        status: t("sourceRecorded"),
        statusClass: "running",
        meta: hasCloudRecords ? t("readingMixedRecords") : t("readingLocalRecords"),
        compact: false,
      };
    }
    return {
      ...combined,
      sourceKey: monitor.id,
      ...status,
    };
  });
}

function sourceHasCloudRecords(sourceId: HistorySourceId) {
  if (!ledger || sourceId === "cloud") return false;
  return ledger.entries.some(
    (entry) =>
      entryMatchesSourceKey(entry, sourceId) &&
      (entry.syncedFromCloud || entry.source === "cloud-sync") &&
      entry.deviceId !== undefined &&
      entry.deviceId !== cloudSyncStatus.deviceId,
  );
}

function sourceHasLocalRecords(sourceId: HistorySourceId) {
  if (!ledger || sourceId === "cloud") return false;
  return ledger.entries.some(
    (entry) => entryMatchesSourceKey(entry, sourceId) && !entry.syncedFromCloud && entry.source !== "cloud-sync",
  );
}

function monitorStatusView(status: UsageStatus["codexSession"] | undefined) {
  if (!status) {
    return { status: t("sourceChecking"), statusClass: "pending", meta: t("readingLocalRecords"), compact: false };
  }
  const installed = status.exists && status.filesWatched > 0;
  if (!installed) {
    return { status: t("sourceNotInstalled"), statusClass: "missing", meta: t("sourceNotInstalled"), compact: true };
  }
  const running = status.exists && status.running;
  return {
    status: running ? t("sourceOnline") : t("sourceOffline"),
    statusClass: running ? "running" : "missing",
    meta: `${status.filesWatched} ${t("files")} · ${status.lastEventAt ? formatRelativeTime(status.lastEventAt) : t("waitingNewToken")}`,
    compact: false,
  };
}

function renderModelBreakdown(sourceKey: string, enabledSources = enabledStatsSourceSet()) {
  const rows = getModelBreakdown(sourceKey, enabledSources);
  if (!rows.length) {
    return `<div class="model-breakdown empty">${escapeHtml(t("modelEmpty"))}</div>`;
  }
  const totalXp = rows.reduce((total, row) => total + row.xp, 0);
  return `
    <div class="model-breakdown">
      <div class="model-breakdown-title">${escapeHtml(t("modelShare"))}</div>
      ${rows
        .map((row) => {
          const percent = row.xp > 0 && totalXp > 0 ? Math.max(3, Math.round((row.xp / totalXp) * 100)) : 0;
          return `
            <div class="model-row">
              <div>
                <strong>${escapeHtml(row.label)}</strong>
                <span>${formatCompact(row.xp)} token · ${percent}%</span>
              </div>
              <div class="source-meter"><span style="width:${percent}%"></span></div>
              <p>${tokenBreakdownSummary(row)}</p>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function getModelBreakdown(sourceKey: string, enabledSources = enabledStatsSourceSet()) {
  if (!ledger) return [];
  const rows = new Map<string, SourceBreakdown>();
  const unresolvedCloudRows = new Map<string, SourceBreakdown>();
  for (const entry of getSourceScopeEntries(ledger.entries)) {
    if (!entryMatchesSourceKey(entry, sourceKey)) continue;
    const model = entry.model || entry.provider;
    const breakdown = breakdownForEntry(entry, enabledSources);
    if (!model && (entry.syncedFromCloud || entry.source === "cloud-sync") && entry.deviceId) {
      const key = cloudModelStatKey(entry.deviceId, dateKey(new Date(entry.createdAt)), mirrorSourceForModelStats(entry));
      addBreakdown(unresolvedCloudRows, key, key, breakdown);
      continue;
    }
    addBreakdown(rows, model ?? "unknown", model ?? t("modelUncategorized"), breakdown);
  }
  resolveCloudModelBreakdown(rows, unresolvedCloudRows, sourceKey);
  return [...rows.values()].filter((row) => row.xp > 0).sort((a, b) => b.xp - a.xp);
}

function resolveCloudModelBreakdown(
  rows: Map<string, SourceBreakdown>,
  unresolvedCloudRows: Map<string, SourceBreakdown>,
  sourceKey: string,
) {
  if (!cloudSyncStatus.modelStats?.length || !unresolvedCloudRows.size) {
    for (const row of unresolvedCloudRows.values()) addBreakdown(rows, "unknown", t("modelUncategorized"), row);
    return;
  }

  const statsByKey = new Map<string, NonNullable<CloudSyncStatus["modelStats"]>>();
  for (const stat of cloudSyncStatus.modelStats) {
    if (!cloudModelStatMatchesSourceKey(stat, sourceKey)) continue;
    if (sourceScope !== "total" && stat.date !== dateKey(new Date())) continue;
    const key = cloudModelStatKey(stat.deviceId, stat.date, stat.source);
    const stats = statsByKey.get(key) ?? [];
    stats.push(stat);
    statsByKey.set(key, stats);
  }

  for (const [key, unknown] of unresolvedCloudRows) {
    const stats = statsByKey.get(key) ?? [];
    const statsTotal = stats.reduce((total, stat) => total + safeTokens(stat.tokens), 0);
    if (statsTotal <= 0) {
      addBreakdown(rows, "unknown", t("modelUncategorized"), unknown);
      continue;
    }
    const scale = unknown.xp > 0 && statsTotal > unknown.xp ? unknown.xp / statsTotal : 1;
    let resolvedXp = 0;
    for (const stat of stats) {
      const scaled = scaleBreakdown(
        {
          id: stat.model,
          label: stat.model,
          xp: safeTokens(stat.tokens),
          inputTokens: safeTokens(stat.inputTokens ?? 0),
          outputTokens: safeTokens(stat.outputTokens ?? 0),
          cacheReadTokens: safeTokens(stat.cacheReadTokens ?? 0),
          cacheWriteTokens: safeTokens(stat.cacheWriteTokens ?? 0),
        },
        scale,
      );
      resolvedXp += scaled.xp;
      addBreakdown(rows, stat.model, stat.model, scaled);
    }
    const leftover = unknown.xp - resolvedXp;
    if (leftover > 0) {
      const ratio = unknown.xp > 0 ? leftover / unknown.xp : 0;
      addBreakdown(rows, "unknown", t("modelUncategorized"), scaleBreakdown(unknown, ratio));
    }
  }
}

function breakdownForEntry(entry: LedgerEntry, enabledSources: Set<HistorySourceId>): SourceBreakdown {
  const breakdown = countedTokenBreakdownForEntry(entry);
  return {
    id: "",
    label: "",
    xp: xpForEntry(entry, enabledSources),
    inputTokens: breakdown.inputTokens,
    outputTokens: breakdown.outputTokens,
    cacheReadTokens: breakdown.cacheReadTokens,
    cacheWriteTokens: breakdown.cacheWriteTokens,
  };
}

function tokenBreakdownSummary(row: Pick<SourceBreakdown, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">) {
  const parts = [
    `in ${formatCompact(row.inputTokens)}`,
    `out ${formatCompact(row.outputTokens)}`,
    `cache ${formatCompact(row.cacheReadTokens)}`,
  ];
  if (row.cacheWriteTokens > 0) parts.push(`write ${formatCompact(row.cacheWriteTokens)}`);
  return parts.join(" · ");
}

function addBreakdown(rows: Map<string, SourceBreakdown>, id: string, label: string, item: SourceBreakdown) {
  const existing =
    rows.get(id) ??
    {
      id,
      label,
      xp: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
  existing.xp += item.xp;
  existing.inputTokens += item.inputTokens;
  existing.outputTokens += item.outputTokens;
  existing.cacheReadTokens += item.cacheReadTokens;
  existing.cacheWriteTokens += item.cacheWriteTokens;
  rows.set(id, existing);
}

function scaleBreakdown(item: SourceBreakdown, scale: number): SourceBreakdown {
  return {
    ...item,
    xp: Math.round(item.xp * scale),
    inputTokens: Math.round(item.inputTokens * scale),
    outputTokens: Math.round(item.outputTokens * scale),
    cacheReadTokens: Math.round(item.cacheReadTokens * scale),
    cacheWriteTokens: Math.round(item.cacheWriteTokens * scale),
  };
}

function cloudModelStatMatchesSourceKey(stat: NonNullable<CloudSyncStatus["modelStats"]>[number], sourceKey: string) {
  return entryMatchesSourceKey(
    {
      id: `${stat.source}:model-stat:${stat.deviceId}:${stat.date}:${stat.model}`,
      createdAt: `${stat.date}T00:00:00.000`,
      source: stat.source,
      tokens: stat.tokens,
    },
    sourceKey,
  );
}

function cloudModelStatKey(deviceId: string, date: string, source: string) {
  return `${deviceId}|${date}|${source}`;
}

function mirrorSourceForModelStats(entry: LedgerEntry) {
  if (entry.source !== "cloud-sync") return entry.source;
  const delimiter = entry.id.indexOf(":");
  return delimiter > 0 ? entry.id.slice(0, delimiter) : entry.source;
}

function getSourceScopeEntries(entries: LedgerEntry[]) {
  if (sourceScope === "total") return entries;
  const todayKey = dateKey(new Date());
  return entries.filter((entry) => dateKey(new Date(entry.createdAt)) === todayKey);
}

function sourceLabel(id: string, source: string) {
  return defaultSourceLabel(id, source, t("manualFeed"));
}

function normalizeBadgeMetric(value: string, fallback: BadgeMetric): BadgeMetric {
  return value === "level" || value === "total" || value === "rate" ? value : fallback;
}

function normalizeTotalDisplayUnit(value: string): TotalDisplayUnit {
  return value === "raw" || value === "k" || value === "m" || value === "wan" || value === "yi" ? value : "m";
}

function normalizeLeaderboardRange(value: unknown): LeaderboardRange {
  if (value === "today" || value === "24h") return "24h";
  return value === "30d" || value === "all" ? value : "7d";
}

function formatByUnit(value: number, unit: TotalDisplayUnit) {
  return formatValueByUnit(value, unit, languageLocale());
}

function formatNumber(value: number) {
  return formatLocaleNumber(value, languageLocale());
}

function assetUrl(path: string) {
  if (location.protocol !== "file:" || !path.startsWith("/")) return path;
  return path.slice(1);
}

function formatRelativeTime(isoTime: string) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(isoTime).getTime()) / 1000));
  if (elapsedSeconds < 5) return t("justNow");
  if (elapsedSeconds < 60) return relativeTimeText(elapsedSeconds, "secondsAgo");
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return relativeTimeText(elapsedMinutes, "minutesAgo");
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return relativeTimeText(elapsedHours, "hoursAgo");
}

function text(selector: string, value: string) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function ledgerEntriesSignature() {
  if (!ledger) return "no-ledger";
  const first = ledger.entries[0];
  const last = ledger.entries[ledger.entries.length - 1];
  const totals = ledger.entries.reduce(
    (acc, entry) => {
      acc.tokens += entry.tokens;
      acc.input += entry.inputTokens ?? 0;
      acc.output += entry.outputTokens ?? 0;
      acc.cacheRead += entry.cacheReadTokens ?? 0;
      acc.cacheWrite += entry.cacheWriteTokens ?? 0;
      const sourceKey = `${entry.source}:${entry.syncedFromCloud ? "1" : "0"}`;
      acc.sources.set(sourceKey, (acc.sources.get(sourceKey) ?? 0) + 1);
      return acc;
    },
    {
      tokens: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      sources: new Map<string, number>(),
    },
  );
  return [
    ledger.entries.length,
    ledger.installedAt,
    totals.tokens,
    totals.input,
    totals.output,
    totals.cacheRead,
    totals.cacheWrite,
    [...totals.sources.entries()].sort(([left], [right]) => left.localeCompare(right)).join(","),
    first?.id ?? "",
    first?.createdAt ?? "",
    first?.tokens ?? "",
    last?.id ?? "",
    last?.createdAt ?? "",
    last?.tokens ?? "",
  ].join(":");
}

function cloudModelStatsSignature() {
  return (cloudSyncStatus.modelStats ?? [])
    .map((stat) =>
      [
        stat.deviceId,
        stat.date,
        stat.source,
        stat.model,
        stat.tokens,
        stat.inputTokens ?? 0,
        stat.outputTokens ?? 0,
        stat.cacheReadTokens ?? 0,
        stat.cacheWriteTokens ?? 0,
      ].join(":"),
    )
    .join(",");
}

function usageStatusSignature() {
  if (!usageStatus) return "no-usage-status";
  return AGENT_SOURCES.map((source) => {
    const status = source.statusKey ? usageStatus?.[source.statusKey] : undefined;
    return [
      source.id,
      status?.exists ? "1" : "0",
      status?.running ? "1" : "0",
      status?.filesWatched ?? 0,
      status?.eventsImported ?? 0,
      status?.lastEventAt ?? "",
      status?.sessionsRoot ?? "",
    ].join(":");
  }).join("|");
}

function updateStatusRenderSignature() {
  return JSON.stringify({
    language: currentLanguage(),
    bucket: relativeRenderBucket(30_000),
    status: updateStatus,
  });
}

function leaderboardSettingsSignature() {
  return JSON.stringify({
    language: currentLanguage(),
    bucket: relativeRenderBucket(30_000),
    status: leaderboardStatus,
    loading: leaderboardLoading,
    preferencesPublic: ledger?.settings.leaderboardPreferencesPublic,
  });
}

function leaderboardRenderSignature() {
  return JSON.stringify({
    language: currentLanguage(),
    bucket: relativeRenderBucket(30_000),
    range: leaderboardRange,
    loadedRange: leaderboardLoadedRange,
    loading: leaderboardLoading,
    status: {
      configured: leaderboardStatus.configured,
      authenticated: leaderboardStatus.authenticated,
      joined: leaderboardStatus.joined,
      syncing: leaderboardStatus.syncing,
      profileId: leaderboardStatus.profile?.id,
    },
    data: {
      range: leaderboardData.range,
      updatedAt: leaderboardData.updatedAt,
      error: leaderboardData.error,
      me: leaderboardData.me?.rank,
      entries: leaderboardData.entries.map((entry) => [
        entry.rank,
        entry.userId,
        entry.username,
        entry.tokens,
        entry.daysActive ?? 0,
        entry.usagePreference?.favoriteAgent?.label ?? "",
        entry.usagePreference?.favoriteAgent?.percent ?? 0,
        entry.usagePreference?.favoriteModel ?? "",
        entry.usagePreference?.favoritePeriod?.id ?? "",
        entry.usagePreference?.favoritePeriod?.startHour ?? 0,
        entry.usagePreference?.favoritePeriod?.endHour ?? 0,
        entry.usagePreference?.peakTokensPerMinute ?? 0,
      ]),
    },
  });
}

function socialRenderSignature() {
  return JSON.stringify({
    language: currentLanguage(),
    bucket: relativeRenderBucket(30_000),
    panel: socialPanel,
    loading: socialLoading,
    boardLoading: socialGroupLeaderboardLoading,
    error: socialError,
    notice: socialNotice,
    selectedGroupId: socialSelectedGroupId,
    range: socialGroupRange,
    basis: socialGroupBasis,
    friendsUpdatedAt: socialFriendsUpdatedAt,
    updatedAt: socialGroupsUpdatedAt,
    incomingGroupInvites: socialIncomingGroupInvites.map((request) => [
      request.requestId,
      request.groupId,
      request.groupName,
      request.invitedByUsername ?? "",
      request.updatedAt ?? "",
    ]),
    outgoingGroupRequests: socialOutgoingGroupRequests.map((request) => [
      request.requestId,
      request.groupId,
      request.groupName,
      request.updatedAt ?? "",
    ]),
    groupJoinRequests: socialGroupJoinRequests.map((request) => [
      request.requestId,
      request.groupId,
      request.type,
      request.requesterUserId,
      request.requesterUsername,
      request.updatedAt ?? "",
    ]),
    status: {
      configured: leaderboardStatus.configured,
      authenticated: leaderboardStatus.authenticated,
      profileId: leaderboardStatus.profile?.id,
    },
    invite: socialInvite
      ? {
          code: socialInvite.code,
          groupId: socialInvite.groupId,
          role: socialInvite.role,
          maxUses: socialInvite.maxUses,
          expiresAt: socialInvite.expiresAt,
          copiedAt: socialInviteCopiedAt,
        }
      : null,
    friends: socialFriends.map((friend) => [
      friend.userId,
      friend.username,
      friend.status,
      friend.direction ?? "",
      friend.updatedAt ?? "",
    ]),
    groups: socialGroups.map((group) => [
      group.groupId,
      group.name,
      group.description ?? "",
      group.iconEmoji ?? "",
      group.memberCount,
      group.role ?? "",
      group.updatedAt ?? "",
      group.members?.map((member) => member.userId).join(",") ?? "",
      group.shareUsage === false ? 0 : 1,
    ]),
    board: socialGroupLeaderboard
      ? {
          groupId: socialGroupLeaderboard.groupId,
          range: socialGroupLeaderboard.range,
          basis: socialGroupLeaderboard.basis,
          updatedAt: socialGroupLeaderboard.updatedAt,
          error: socialGroupLeaderboard.error,
          me: socialGroupLeaderboard.me?.rank,
          entries: socialGroupLeaderboard.entries.map((entry) => [
            entry.rank,
            entry.userId,
            entry.username,
            entry.tokens,
            entry.role ?? "",
            entry.daysActive ?? 0,
          ]),
        }
      : null,
  });
}

function achievementsRenderSignature(stats?: Stats, context?: AchievementContext) {
  return JSON.stringify({
    language: currentLanguage(),
    entries: ledgerEntriesSignature(),
    enabled: enabledStatsSourceIds(),
    category: achievementCategoryFilter,
    status: achievementStatusFilter,
    bucket: relativeRenderBucket(15_000),
    stats: stats
      ? {
          xp: stats.xp,
          todayXp: stats.todayXp,
          level: stats.level,
          stage: stats.stage.id,
          weatherRate: Math.floor(stats.weather.tokensPerMinute),
        }
      : undefined,
    context: context
      ? {
          maxDailyXp: context.maxDailyXp,
          peakTokensPerMinute: Math.floor(context.peakTokensPerMinute),
          consecutiveDays: context.consecutiveDays,
          activeSources: [...context.activeSources].sort(),
          maxSourcesOneDay: context.maxSourcesOneDay,
          hasAgentSwitchWithinTenMinutes: context.hasAgentSwitchWithinTenMinutes,
          weekendWarrior: context.weekendWarrior,
          touchGrassReturn: context.touchGrassReturn,
          coffeeOverdose: context.coffeeOverdose,
          hasFibonacciSession: context.hasFibonacciSession,
          totalActiveDays: context.totalActiveDays,
          uniqueModels: context.uniqueModels,
          dominantSourceRatio: context.dominantSourceRatio,
          hasNoonPeak: context.hasNoonPeak,
          has5amTo9amStreak: context.has5amTo9amStreak,
          longestInactiveDays: context.longestInactiveDays,
          totalEntries: context.totalEntries,
          maxEntriesOneDay: context.maxEntriesOneDay,
          hasHolidayCoding: context.hasHolidayCoding,
        }
      : undefined,
    unlocked: achievementState.unlocked.map((item) => [item.id, item.unlockedAt]),
    achievementVersion: achievementState.version ?? 0,
    achievementStats: achievementState.stats ?? {},
    seen: [...seenAchievementIds].sort(),
  });
}

function relativeRenderBucket(intervalMs: number) {
  return Math.floor(Date.now() / intervalMs);
}

function selectedStatsSourceIds(): string[] {
  if (!sourceSettings) return enabledStatsSourceIds();
  return [...sourceSettings.querySelectorAll<HTMLInputElement>("[data-stats-source]")]
    .filter((input) => input.checked)
    .map((input) => input.dataset.statsSource)
    .filter(isHistorySourceId);
}

function syncStatsSourceInputs() {
  const enabled = new Set(enabledStatsSourceIds());
  sourceSettings?.querySelectorAll<HTMLInputElement>("[data-stats-source]").forEach((input) => {
    const sourceId = input.dataset.statsSource;
    input.checked = Boolean(isHistorySourceId(sourceId) && enabled.has(sourceId));
  });
}

function syncInputValue(input: HTMLInputElement | null, value: string) {
  if (!input || document.activeElement === input) return;
  input.value = value;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char] ?? char;
  });
}

boot().catch((error) => {
  console.error(error);
  app.innerHTML = `<pre class="fatal">${String(error)}</pre>`;
});
