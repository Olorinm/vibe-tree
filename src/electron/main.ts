import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, Notification, screen, session, shell, Tray } from "electron";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import * as https from "node:https";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import type {
  AchievementState,
  AchievementUnlock,
  AchievementUnlockResult,
  AppLanguage,
  CloudModelStat,
  CloudSyncStatus,
  LedgerEntry,
  LedgerFile,
  LeaderboardCollection,
  LeaderboardProfile,
  Settings,
  ToastPlacement,
  TreeToastItem,
  UpdateStatus,
  UsageEvent,
  UsageStatus,
  WindowBounds,
} from "../shared/types.js";
import {
  startClaudeSessionWatcher,
  startGeminiSessionWatcher,
  startHermesSessionWatcher,
  startOpenClawSessionWatcher,
  startOpenCodeSessionWatcher,
  startPiSessionWatcher,
} from "./agentSessionWatchers.js";
import { startCodexSessionWatcher } from "./codexSessionWatcher.js";
import { MAIN_TEXT, WEATHER_LABELS } from "./i18n.js";
import type { WeatherId } from "./i18n.js";
import { createLeaderboardService } from "./leaderboard.js";
import type { LeaderboardRequestJsonOptions } from "./leaderboard.js";
import { countedInputTokensForEntry, countedTokensForEntry } from "../shared/tokenAccounting.js";

const PET_BASE = { width: 192, height: 208 };
const PET_STAGE_OFFSET = { x: 28, y: 0 };
const ACHIEVEMENT_TOAST_SIZE = { width: 236, height: 104 };
const ACHIEVEMENT_TOAST_OVERLAP_PER_SCALE = 48;
const ACHIEVEMENT_TOAST_DOWN_OFFSET_PER_SCALE = 18;
const ACHIEVEMENT_TOAST_DURATION_MS = 5_000;
const ACHIEVEMENT_TOAST_WINDOW_PADDING_MS = 600;
const LEVEL_TOAST_DEDUPE_MS = 4_000;
const HOURLY_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_REMINDER_DELAY_MS = 3_000;
const UPDATE_RELAUNCH_DELAY_MS = 1_200;
const UPDATE_GIT_TIMEOUT_MS = 2 * 60 * 1000;
const UPDATE_NPM_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const UPDATE_BUILD_TIMEOUT_MS = 3 * 60 * 1000;
const UPDATE_SMOKE_TIMEOUT_MS = 45_000;
const UPDATE_LATEST_RELEASE_URL = "https://api.github.com/repos/Olorinm/vibe-tree/releases/latest";
const UPDATE_TAGS_URL = "https://api.github.com/repos/Olorinm/vibe-tree/tags?per_page=20";
const UPDATE_PAGE_URL = "https://github.com/Olorinm/vibe-tree/releases";
const DEFAULT_UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/Olorinm/vibe-tree/main/updates/manifest.json";
const UPDATE_MANIFEST_URL = (process.env.VIBE_TREE_UPDATE_MANIFEST_URL ?? DEFAULT_UPDATE_MANIFEST_URL).trim();
const DEFAULT_ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
const DEFAULT_LEADERBOARD_API_URL = "https://vibe-tree-leaderboard.melanthascherffmugutubu.workers.dev";
const LEADERBOARD_API_URL = (process.env.VIBE_TREE_LEADERBOARD_API_URL ?? DEFAULT_LEADERBOARD_API_URL).replace(/\/+$/, "");
const LEADERBOARD_SYNC_INTERVAL_MS = HOURLY_SYNC_INTERVAL_MS;
const CLOUD_SYNC_INTERVAL_MS = HOURLY_SYNC_INTERVAL_MS;
const LEADERBOARD_AUTH_TIMEOUT_MS = 2 * 60 * 1000;
const LEADERBOARD_CALLBACK_PATH = "/leaderboard/auth/callback";
const MENU_BAR_POPOVER_SIZE = { width: 390, height: 500 };
const MANAGER_SIZE = { width: 1120, height: 760 };
const MANAGER_MIN_SIZE = { width: 860, height: 620 };
const APP_NAME = "Vibe Tree";
const APP_ID = "com.vibetree.app";
const SMOKE_TEST = process.env.VIBE_TREE_SMOKE_TEST === "1";
const USER_DATA_DIR_OVERRIDE = process.env.VIBE_TREE_USER_DATA_DIR?.trim();
if (USER_DATA_DIR_OVERRIDE) app.setPath("userData", USER_DATA_DIR_OVERRIDE);
const STAT_SOURCE_IDS = ["codex", "openclaw", "pi", "opencode", "claude", "gemini", "hermes", "cloud"] as const;
const LOCAL_STAT_SOURCE_IDS = ["codex", "openclaw", "pi", "opencode", "claude", "gemini", "hermes"] as const;
// Menu bar popover components, in their canonical default order. Must mirror
// MENUBAR_VIZ_IDS in the renderer.
const MENUBAR_VIZ_IDS = ["rhythm", "sync", "activity", "rank", "sources", "speed"] as const;
const APP_ICON_PATHS = [
  join(__dirname, "../renderer/assets/app-icon.png"),
  join(__dirname, "../renderer/assets/app-icon.ico"),
  join(__dirname, "../../public/assets/app-icon.png"),
  join(__dirname, "../../public/assets/app-icon.ico"),
];
const MAC_MENU_BAR_ICON_PATHS = [
  join(__dirname, "../renderer/assets/menu-bar-sprout.png"),
  join(__dirname, "../../public/assets/menu-bar-sprout.png"),
];

const DEFAULT_SETTINGS: Settings = {
  locked: false,
  alwaysOnTop: true,
  language: "zh-CN",
  uiTheme: "night",
  scale: 0.5,
  badgeFrontMetric: "level",
  badgeBackMetric: "total",
  totalDisplayUnit: "m",
  updateCheckEnabled: true,
  lastUpdateCheckedAt: undefined,
  leaderboardEnabled: false,
  leaderboardProfile: undefined,
  leaderboardLastSyncedAt: undefined,
  leaderboardAutoSyncEnabled: true,
  leaderboardPreferencesPublic: false,
  socialGroupCount: 0,
  cloudSyncEnabled: false,
  cloudSyncDeviceId: undefined,
  cloudSyncLastSyncedAt: undefined,
  cloudSyncLastPulledAt: undefined,
  cloudSyncAutoSyncEnabled: true,
  treeStartMode: undefined,
  launchOnStartup: false,
  silentStartup: false,
  proxyUrl: undefined,
  enabledSourceIds: [...STAT_SOURCE_IDS],
  menubarVizIds: [...MENUBAR_VIZ_IDS],
  windowPosition: undefined,
};



const WEATHER_THRESHOLDS = [
  { id: "clear", label: "晴朗", minXpPerMinute: 0 },
  { id: "breeze", label: "微风", minXpPerMinute: 10_000 },
  { id: "drizzle", label: "细雨", minXpPerMinute: 50_000 },
  { id: "rain", label: "大雨", minXpPerMinute: 150_000 },
  { id: "thunder", label: "雷雨", minXpPerMinute: 500_000 },
  { id: "storm", label: "风暴", minXpPerMinute: 1_000_000 },
] as const;
const LEVEL_BASE = 100_000;
const LEVEL_EXPONENT = 1.65;
const MAX_LEVEL = 120;

let petWindow: BrowserWindow | null = null;
let managerWindow: BrowserWindow | null = null;
let managerRendererReady = false;
let pendingOpenSettings = false;
let pendingSettingsCategory: string | null = null;
let pendingDashboardTab: "home" | "achievements" | "leaderboard" | null = null;
let menuBarWindow: BrowserWindow | null = null;
let achievementToastWindow: BrowserWindow | null = null;
let achievementToastHideTimer: ReturnType<typeof setTimeout> | null = null;
let achievementToastFallbackHideAt = 0;
let achievementToastRendererReady = false;
let achievementToastPendingItems: TreeToastItem[] = [];
let lastLevelToastKey = "";
let lastLevelToastAt = 0;
let updateCheckTimer: ReturnType<typeof setTimeout> | null = null;
let updateStatus: UpdateStatus = {
  checking: false,
  installing: false,
  available: false,
  canTerminalUpdate: canTerminalUpdate(),
  currentVersion: currentAppVersion(),
};
let tray: Tray | null = null;
let trayContextMenu: ReturnType<typeof Menu.buildFromTemplate> | null = null;
let trayMenuReopenTimer: ReturnType<typeof setTimeout> | null = null;
let ledger: LedgerFile = { entries: [], settings: DEFAULT_SETTINGS, installedAt: startOfLocalDayIso(new Date()) };
let achievementState: AchievementState = { unlocked: [] };
let codexSessionWatcher: ReturnType<typeof startCodexSessionWatcher> | null = null;
let claudeSessionWatcher: ReturnType<typeof startClaudeSessionWatcher> | null = null;
let openclawSessionWatcher: ReturnType<typeof startOpenClawSessionWatcher> | null = null;
let piSessionWatcher: ReturnType<typeof startPiSessionWatcher> | null = null;
let opencodeSessionWatcher: ReturnType<typeof startOpenCodeSessionWatcher> | null = null;
let geminiSessionWatcher: ReturnType<typeof startGeminiSessionWatcher> | null = null;
let hermesSessionWatcher: ReturnType<typeof startHermesSessionWatcher> | null = null;
let codexSessionStatus: UsageStatus["codexSession"] = {
  running: false,
  sessionsRoot: "",
  exists: false,
  filesWatched: 0,
  eventsImported: 0,
  importHistory: false,
};
let claudeSessionStatus: UsageStatus["claudeSession"] = {
  running: false,
  sessionsRoot: "",
  exists: false,
  filesWatched: 0,
  eventsImported: 0,
  importHistory: false,
};
let openclawSessionStatus: UsageStatus["openclawSession"] = {
  running: false,
  sessionsRoot: "",
  exists: false,
  filesWatched: 0,
  eventsImported: 0,
  importHistory: false,
};
let piSessionStatus: UsageStatus["piSession"] = {
  running: false,
  sessionsRoot: "",
  exists: false,
  filesWatched: 0,
  eventsImported: 0,
  importHistory: false,
};
let opencodeSessionStatus: UsageStatus["opencodeSession"] = {
  running: false,
  sessionsRoot: "",
  exists: false,
  filesWatched: 0,
  eventsImported: 0,
  importHistory: false,
};
let geminiSessionStatus: UsageStatus["geminiSession"] = {
  running: false,
  sessionsRoot: "",
  exists: false,
  filesWatched: 0,
  eventsImported: 0,
  importHistory: false,
};
let hermesSessionStatus: UsageStatus["hermesSession"] = {
  running: false,
  sessionsRoot: "",
  exists: false,
  filesWatched: 0,
  eventsImported: 0,
  importHistory: false,
};

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const rendererFile = join(__dirname, "../renderer/index.html");
const preloadFile = join(__dirname, "preload.cjs");
const leaderboardService = createLeaderboardService({
  apiUrl: LEADERBOARD_API_URL,
  appName: APP_NAME,
  syncIntervalMs: LEADERBOARD_SYNC_INTERVAL_MS,
  cloudSyncIntervalMs: CLOUD_SYNC_INTERVAL_MS,
  authTimeoutMs: LEADERBOARD_AUTH_TIMEOUT_MS,
  callbackPath: LEADERBOARD_CALLBACK_PATH,
  authPath: leaderboardAuthPath,
  cloudSyncPath,
  deviceId: () => ensureCloudSyncDeviceId(),
  deviceInfo: () => cloudSyncDeviceInfo(),
  cloudModelStats: () => cloudModelStats(),
  getLedger: () => ledger,
  updateSettings,
  appendRemoteEntries,
  getAchievements: () => achievementState,
  mergeRemoteAchievements,
  xpForEntry,
  dateKey,
  currentAppVersion,
  mainText,
  openExternal: (url) => shell.openExternal(url),
  readJsonFile,
  writeJsonAtomic,
  broadcastStatus: (status) => broadcast("bonsai:leaderboard-status", status),
  requestJson: requestJsonWithElectronNet,
});

function ledgerPath() {
  return join(app.getPath("userData"), "ledger.json");
}

function usageEventsPath() {
  return join(app.getPath("userData"), "usage-events.jsonl");
}

function usageMetaPath() {
  return join(app.getPath("userData"), "usage-meta.json");
}

function deviceSettingsPath() {
  return join(app.getPath("userData"), "device-settings.json");
}

function achievementsPath() {
  return join(app.getPath("userData"), "achievements.json");
}

function leaderboardAuthPath() {
  return join(app.getPath("userData"), "leaderboard-auth.json");
}

function cloudSyncPath() {
  return join(app.getPath("userData"), "cloud-sync.json");
}

function sanitizeShareImageFilename(value: unknown) {
  const fallback = `vibe-tree-share-${new Date().toISOString().slice(0, 10)}.png`;
  if (typeof value !== "string") return fallback;
  const name = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").trim();
  if (!name) return fallback;
  return name.toLowerCase().endsWith(".png") ? name : `${name}.png`;
}

function currentAppVersion() {
  for (const path of appPackageJsonCandidates()) {
    const pkg = readJsonFile<{ name?: string; version?: string }>(path);
    if (pkg?.name === "vibe-tree" && typeof pkg.version === "string") {
      return normalizeVersion(pkg.version);
    }
  }
  return normalizeVersion(app.getVersion());
}

function appPackageJsonCandidates() {
  const candidates = [
    join(__dirname, "package.json"),
    join(app.getAppPath(), "package.json"),
    join(__dirname, "../../package.json"),
    join(process.cwd(), "package.json"),
  ];
  return [...new Set(candidates)];
}

function canTerminalUpdate() {
  return Boolean(terminalUpdateRoot());
}

function terminalUpdateRoot() {
  const candidates = [process.cwd(), join(__dirname, "../.."), app.getAppPath()];
  for (const cwd of [...new Set(candidates)]) {
    const pkg = readJsonFile<{ name?: string }>(join(cwd, "package.json"));
    if (pkg?.name === "vibe-tree" && existsSync(join(cwd, ".git"))) {
      return cwd;
    }
  }
  return undefined;
}

async function configureNetworkProxy(proxyUrl?: string) {
  const proxyRules = proxyRulesFromValue(proxyUrl) ?? proxyRulesFromEnvironment();
  if (!proxyRules) {
    await session.defaultSession.setProxy({ mode: "system" });
    return;
  }
  await session.defaultSession.setProxy({
    mode: "fixed_servers",
    proxyRules,
    proxyBypassRules: "<local>;127.0.0.1;localhost",
  });
}

function proxyRulesFromEnvironment() {
  const rawProxy =
    process.env.VIBE_TREE_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  return proxyRulesFromValue(rawProxy);
}

function proxyRulesFromValue(rawProxy: string | undefined) {
  if (!rawProxy?.trim()) return undefined;
  try {
    const proxy = new URL(rawProxy.trim());
    if (!proxy.hostname || !proxy.port) return undefined;
    if (proxy.protocol === "http:" || proxy.protocol === "https:") {
      const host = `${proxy.hostname}:${proxy.port}`;
      return `http=${host};https=${host}`;
    }
    if (proxy.protocol === "socks:" || proxy.protocol === "socks4:" || proxy.protocol === "socks5:") {
      return `${proxy.protocol}//${proxy.hostname}:${proxy.port}`;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function readLedger(): LedgerFile {
  const legacy = readLegacyLedger();
  const installedAt = readInstalledAt(legacy);
  let entries = readUsageEntries();

  if (!entries.length && legacy?.entries?.length) {
    entries = legacy.entries.filter(isEntry);
    for (const entry of entries.slice().reverse()) {
      appendUsageEntryToStore(entry);
    }
  }
  const deduped = dedupeCloudMirroredEntries(entries);
  const dedupedEntries = deduped.entries;
  if (deduped.removedCount) rewriteUsageEntriesStore(dedupedEntries);
  const filteredEntries = dedupedEntries.filter((entry) => entryBelongsToCurrentTree(entry, installedAt));
  const settings = readDeviceSettings(legacy?.settings, filteredEntries.length > 0);

  return {
    entries: filteredEntries,
    settings,
    installedAt,
  };
}

function entryBelongsToCurrentTree(entry: LedgerEntry, installedAt: string) {
  const startedAt = Date.parse(installedAt);
  if (!Number.isFinite(startedAt)) return true;
  if (entry.deviceId) return true;
  return entryTime(entry) >= startedAt;
}

function setTreeStartMode(mode: "new" | "cloud") {
  const installedAt = new Date().toISOString();
  ledger.installedAt = installedAt;
  writeJsonAtomic(usageMetaPath(), { version: 1, installedAt });
  ledger.entries = ledger.entries.filter((entry) =>
    mode === "cloud" ? entryBelongsToCurrentTree(entry, installedAt) : entryTime(entry) >= Date.parse(installedAt),
  );
  updateSettings({ treeStartMode: mode });
}

function readLegacyLedger(): Partial<LedgerFile> | undefined {
  try {
    const raw = readFileSync(ledgerPath(), "utf8");
    return JSON.parse(raw) as Partial<LedgerFile>;
  } catch {
    return undefined;
  }
}

function readInstalledAt(legacy: Partial<LedgerFile> | undefined) {
  const existing = readJsonFile<{ installedAt?: string }>(usageMetaPath());
  if (typeof existing?.installedAt === "string" && Number.isFinite(Date.parse(existing.installedAt))) {
    return existing.installedAt;
  }

  const legacyInstalledAt =
    typeof legacy?.installedAt === "string" && Number.isFinite(Date.parse(legacy.installedAt))
      ? legacy.installedAt
      : legacyInstallDate();
  const installedAt = startOfLocalDayIso(new Date(legacyInstalledAt));
  writeJsonAtomic(usageMetaPath(), { version: 1, installedAt });
  return installedAt;
}

function legacyInstallDate() {
  try {
    if (existsSync(ledgerPath())) {
      const stats = statSync(ledgerPath());
      return new Date(stats.birthtimeMs || stats.mtimeMs).toISOString();
    }
  } catch {
    // Fall back to first run time below.
  }
  return new Date().toISOString();
}

function readDeviceSettings(legacySettings: Partial<Settings> | undefined, hasLocalTreeData = false): Settings {
  const stored = readJsonFile<Partial<Settings>>(deviceSettingsPath());
  const language = normalizeLanguage(stored?.language ?? legacySettings?.language ?? detectSystemLanguage());
  let migratedTreeStartMode = false;
  let settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    language,
    ...(legacySettings ?? {}),
    ...(stored ?? {}),
  });
  if (!settings.treeStartMode && hasLocalTreeData) {
    settings = normalizeSettings({ ...settings, treeStartMode: "new" });
    migratedTreeStartMode = true;
  }
  if (
    !stored ||
    stored.language === undefined ||
    stored.enabledSourceIds === undefined ||
    stored.menubarVizIds === undefined ||
    migratedTreeStartMode
  ) {
    writeDeviceSettings(settings);
  }
  return settings;
}

function writeDeviceSettings(settings = ledger.settings) {
  writeJsonAtomic(deviceSettingsPath(), normalizeSettings(settings));
}

function readAchievementState(): AchievementState {
  return normalizeAchievementState(readJsonFile<AchievementState>(achievementsPath()));
}

function writeAchievementState(state = achievementState) {
  writeJsonAtomic(achievementsPath(), normalizeAchievementState(state));
}

function normalizeAchievementState(state: Partial<AchievementState> | undefined): AchievementState {
  const seen = new Set<string>();
  const unlocked = Array.isArray(state?.unlocked)
    ? state.unlocked.filter((item): item is AchievementUnlock => {
        if (typeof item?.id !== "string" || seen.has(item.id)) return false;
        if (typeof item.unlockedAt !== "string" || !Number.isFinite(Date.parse(item.unlockedAt))) return false;
        seen.add(item.id);
        return true;
      })
    : [];
  return {
    version:
      typeof state?.version === "number" && Number.isFinite(state.version) ? Math.max(0, Math.round(state.version)) : undefined,
    unlocked,
    stats: state?.stats && typeof state.stats === "object" ? state.stats : undefined,
  };
}

function unlockAchievements(items: Array<{ id: string; trigger?: Record<string, unknown> }>): AchievementUnlockResult {
  const existing = new Set(achievementState.unlocked.map((item) => item.id));
  const unlocked: AchievementUnlock[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    if (!item?.id || existing.has(item.id)) continue;
    existing.add(item.id);
    unlocked.push({
      id: item.id,
      unlockedAt: now,
      trigger: item.trigger,
    });
  }

  if (!unlocked.length) {
    return { state: achievementState, unlocked };
  }

  achievementState = normalizeAchievementState({
    ...achievementState,
    unlocked: [...achievementState.unlocked, ...unlocked],
  });
  writeAchievementState();
  broadcast("bonsai:achievements", achievementState, unlocked);
  showAchievementToastOverlay(unlocked.map((item) => item.id));
  return { state: achievementState, unlocked };
}

function reconcileAchievementState(input: {
  version?: unknown;
  unlockedIds?: unknown;
  stats?: Record<string, unknown>;
}): AchievementState {
  const version = typeof input?.version === "number" && Number.isFinite(input.version)
    ? Math.max(0, Math.round(input.version))
    : achievementState.version;
  const unlockedIds = new Set(
    Array.isArray(input?.unlockedIds) ? input.unlockedIds.filter((id): id is string => typeof id === "string") : [],
  );
  const stats = input?.stats && typeof input.stats === "object" ? input.stats : achievementState.stats;
  const nextState = normalizeAchievementState({
    version,
    unlocked: achievementState.unlocked.filter((item) => unlockedIds.has(item.id)),
    stats,
  });
  const changed = JSON.stringify(nextState) !== JSON.stringify(achievementState);
  if (!changed) return achievementState;

  achievementState = nextState;
  writeAchievementState();
  broadcast("bonsai:achievements", achievementState, []);
  return achievementState;
}

function normalizeSettings(settings: Partial<Settings>): Settings {
  const scale = typeof settings.scale === "number" && [0.5, 1, 1.5, 2].includes(settings.scale) ? settings.scale : 0.5;
  const leaderboardProfile = normalizeLeaderboardProfile(settings.leaderboardProfile);
  const leaderboardLastSyncedAt =
    typeof settings.leaderboardLastSyncedAt === "string" && Number.isFinite(Date.parse(settings.leaderboardLastSyncedAt))
      ? settings.leaderboardLastSyncedAt
      : undefined;
  const cloudSyncLastSyncedAt =
    typeof settings.cloudSyncLastSyncedAt === "string" && Number.isFinite(Date.parse(settings.cloudSyncLastSyncedAt))
      ? settings.cloudSyncLastSyncedAt
      : undefined;
  const cloudSyncLastPulledAt =
    typeof settings.cloudSyncLastPulledAt === "string" && Number.isFinite(Date.parse(settings.cloudSyncLastPulledAt))
      ? settings.cloudSyncLastPulledAt
      : undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    locked: Boolean(settings.locked),
    alwaysOnTop: settings.alwaysOnTop !== false,
    language: normalizeLanguage(settings.language),
    uiTheme: normalizeUiTheme(settings.uiTheme),
    updateCheckEnabled: settings.updateCheckEnabled !== false,
    lastUpdateCheckedAt:
      typeof settings.lastUpdateCheckedAt === "string" && Number.isFinite(Date.parse(settings.lastUpdateCheckedAt))
        ? settings.lastUpdateCheckedAt
        : undefined,
    lastUpdateReminderVersion:
      typeof settings.lastUpdateReminderVersion === "string" ? settings.lastUpdateReminderVersion : undefined,
    leaderboardEnabled: Boolean(settings.leaderboardEnabled && leaderboardProfile),
    leaderboardProfile,
    leaderboardLastSyncedAt,
    leaderboardAutoSyncEnabled: settings.leaderboardAutoSyncEnabled !== false,
    leaderboardPreferencesPublic: Boolean(settings.leaderboardPreferencesPublic),
    socialGroupCount: Number.isFinite(Number(settings.socialGroupCount))
      ? Math.max(0, Math.round(Number(settings.socialGroupCount)))
      : 0,
    cloudSyncEnabled: Boolean(settings.cloudSyncEnabled && leaderboardProfile),
    cloudSyncDeviceId: cleanDeviceId(settings.cloudSyncDeviceId),
    cloudSyncLastSyncedAt,
    cloudSyncLastPulledAt,
    cloudSyncAutoSyncEnabled: settings.cloudSyncAutoSyncEnabled !== false,
    treeStartMode: settings.treeStartMode === "new" || settings.treeStartMode === "cloud" ? settings.treeStartMode : undefined,
    launchOnStartup: Boolean(settings.launchOnStartup),
    silentStartup: Boolean(settings.silentStartup),
    proxyUrl: cleanProxyUrl(settings.proxyUrl),
    enabledSourceIds: normalizeEnabledSourceIds(settings.enabledSourceIds),
    menubarVizIds: normalizeMenubarVizIds(settings.menubarVizIds),
    scale,
    badgeFrontMetric: normalizeBadgeMetric(settings.badgeFrontMetric, "level"),
    badgeBackMetric: normalizeBadgeMetric(settings.badgeBackMetric, "total"),
    totalDisplayUnit: normalizeTotalDisplayUnit(settings.totalDisplayUnit),
    fontScale: typeof settings.fontScale === "number" && [1, 1.15, 1.3, 1.5].includes(settings.fontScale) ? settings.fontScale : undefined,
    codexSessionsDir: cleanPath(settings.codexSessionsDir),
    claudeSessionsDir: cleanPath(settings.claudeSessionsDir),
    openclawSessionsDir: cleanPath(settings.openclawSessionsDir),
    piSessionsDir: cleanPath(settings.piSessionsDir),
    opencodeSessionsDir: cleanPath(settings.opencodeSessionsDir),
    geminiSessionsDir: cleanPath(settings.geminiSessionsDir),
    hermesSessionsDir: cleanPath(settings.hermesSessionsDir),
  };
}

function cleanDeviceId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : undefined;
}

function normalizeUiTheme(value: unknown): Settings["uiTheme"] {
  return value === "day" || value === "soft" || value === "night" ? value : DEFAULT_SETTINGS.uiTheme;
}

function managerChromeTheme(theme: Settings["uiTheme"]) {
  const height = process.platform === "darwin" ? 38 : 36;
  if (theme === "night") return { color: "#161922", symbolColor: "#f4f1e9", height };
  if (theme === "soft") return { color: "#fbf7ec", symbolColor: "#171a14", height };
  return { color: "#ffffff", symbolColor: "#11120e", height };
}

function applyManagerWindowChrome() {
  if (!managerWindow || managerWindow.isDestroyed()) return;
  const chrome = managerChromeTheme(ledger.settings.uiTheme);
  managerWindow.setBackgroundColor(chrome.color);
  if (process.platform !== "darwin") {
    managerWindow.setTitleBarOverlay(chrome);
  }
}

function normalizeLeaderboardProfile(value: unknown): LeaderboardProfile | undefined {
  const profile = value as Partial<LeaderboardProfile> | undefined;
  const id = typeof profile?.id === "string" && profile.id.trim() ? profile.id.trim() : undefined;
  const username =
    typeof profile?.username === "string" && profile.username.trim() ? profile.username.trim() : undefined;
  if (!id || !username) return undefined;
  const avatarUrl =
    typeof profile?.avatarUrl === "string" && profile.avatarUrl.trim() ? profile.avatarUrl.trim() : undefined;
  return { id, username, avatarUrl };
}

function normalizeBadgeMetric(value: unknown, fallback: Settings["badgeFrontMetric"]) {
  return value === "level" || value === "total" || value === "rate" ? value : fallback;
}

function normalizeTotalDisplayUnit(value: unknown): Settings["totalDisplayUnit"] {
  return value === "raw" || value === "k" || value === "m" || value === "wan" || value === "yi" ? value : "m";
}

function normalizeEnabledSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [...STAT_SOURCE_IDS];
  const allowed = new Set<string>(STAT_SOURCE_IDS);
  const normalized = [...new Set(value.filter((item): item is string => typeof item === "string" && allowed.has(item)))];
  const hadAllLegacySources = LOCAL_STAT_SOURCE_IDS.filter((source) => source !== "pi").every((source) =>
    normalized.includes(source),
  );
  if (hadAllLegacySources && !normalized.includes("pi")) normalized.splice(2, 0, "pi");
  if (!normalized.includes("cloud")) normalized.push("cloud");
  return normalized;
}

// Visible menu bar components, in order. Drops unknown ids, de-dupes, and
// falls back to the full default set when the result would be empty so the
// popover is never blank.
function normalizeMenubarVizIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [...MENUBAR_VIZ_IDS];
  const allowed = new Set<string>(MENUBAR_VIZ_IDS);
  const normalized = [...new Set(value.filter((item): item is string => typeof item === "string" && allowed.has(item)))];
  return normalized.length > 0 ? normalized : [...MENUBAR_VIZ_IDS];
}

function cleanProxyUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return proxyRulesFromValue(trimmed) ? trimmed : undefined;
}

function normalizeLanguage(value: unknown): AppLanguage {
  return value === "en-US" ? "en-US" : "zh-CN";
}

function detectSystemLanguage(): AppLanguage {
  const languages =
    typeof app.getPreferredSystemLanguages === "function" ? app.getPreferredSystemLanguages() : [app.getLocale()];
  return languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en-US";
}

function currentLanguage(): AppLanguage {
  return normalizeLanguage(ledger.settings.language);
}

function mainText(key: string) {
  return MAIN_TEXT[currentLanguage()][key] ?? MAIN_TEXT["zh-CN"][key] ?? key;
}

function weatherLabel(id: WeatherId) {
  return WEATHER_LABELS[currentLanguage()][id] ?? WEATHER_LABELS["zh-CN"][id];
}

function cleanPath(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readUsageEntries() {
  if (!existsSync(usageEventsPath())) return [];
  const byId = new Map<string, LedgerEntry>();
  let parsedCount = 0;
  const raw = readFileSync(usageEventsPath(), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = parseJson(line);
    if (isEntry(parsed)) {
      parsedCount += 1;
      byId.set(parsed.id, parsed);
    }
  }
  const entries = [...byId.values()].sort((a, b) => entryTime(b) - entryTime(a));
  if (parsedCount > entries.length) rewriteUsageEntriesStore(entries);
  return entries;
}

function appendUsageEntryToStore(entry: LedgerEntry) {
  const path = usageEventsPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

function rewriteUsageEntriesStore(entries: LedgerEntry[]) {
  const path = usageEventsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
  writeFileSync(tempPath, content ? `${content}\n` : "", "utf8");
  renameSync(tempPath, path);
}

function writeJsonAtomic(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  renameSync(tempPath, path);
}

function readJsonFile<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function isEntry(value: unknown): value is LedgerEntry {
  const entry = value as LedgerEntry;
  return (
    typeof entry?.id === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.source === "string" &&
    typeof entry.tokens === "number" &&
    Number.isFinite(entry.tokens)
  );
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function entryTime(entry: LedgerEntry) {
  const time = Date.parse(entry.createdAt);
  return Number.isFinite(time) ? time : 0;
}

function startOfLocalDayIso(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

function petSize(scale = ledger.settings.scale) {
  const safeScale = [0.5, 1, 1.5, 2].includes(scale) ? scale : DEFAULT_SETTINGS.scale;
  return {
    width: Math.round(PET_BASE.width * safeScale + PET_STAGE_OFFSET.x),
    height: Math.round(PET_BASE.height * safeScale + PET_STAGE_OFFSET.y),
  };
}

function defaultPetPosition(width: number, height: number) {
  const display = screen.getPrimaryDisplay().workArea;
  return {
    x: display.x + display.width - width - 40,
    y: display.y + display.height - height - 56,
  };
}

function clampPetPosition(position: { x: number; y: number }, size = petSize()) {
  const display = screen.getDisplayNearestPoint(position).workArea;
  const stageWidth = size.width - PET_STAGE_OFFSET.x;
  const stageHeight = size.height - PET_STAGE_OFFSET.y;
  return {
    x: Math.min(
      Math.max(position.x, display.x - PET_STAGE_OFFSET.x),
      display.x + display.width - PET_STAGE_OFFSET.x - stageWidth,
    ),
    y: Math.min(
      Math.max(position.y, display.y - PET_STAGE_OFFSET.y),
      display.y + display.height - PET_STAGE_OFFSET.y - stageHeight,
    ),
  };
}

function setPetBounds(position: { x: number; y: number }) {
  if (!petWindow) return;
  const size = petSize();
  const clamped = clampPetPosition(
    {
      x: Math.round(position.x),
      y: Math.round(position.y),
    },
    size,
  );
  petWindow.setBounds({ ...clamped, width: size.width, height: size.height }, false);
  syncAchievementToastPosition();
}

async function loadRenderer(window: BrowserWindow, view: "pet" | "manager" | "toast" | "menubar") {
  const query = { view, uiTheme: view === "toast" ? "night" : ledger.settings.uiTheme };
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${new URLSearchParams(query).toString()}`);
    return;
  }
  await window.loadFile(rendererFile, { query });
}

function createPetWindow() {
  if (petWindow) return petWindow;

  const size = petSize();
  const position = clampPetPosition(ledger.settings.windowPosition ?? defaultPetPosition(size.width, size.height), size);
  petWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: position.x,
    y: position.y,
    title: `${APP_NAME} Pet`,
    icon: createAppIcon(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: ledger.settings.alwaysOnTop,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.setAlwaysOnTop(ledger.settings.alwaysOnTop, "floating");
  petWindow.webContents.setZoomFactor(1);
  petWindow.webContents.on("zoom-changed", (event) => event.preventDefault());
  petWindow.webContents.on("context-menu", () => {
    showPetContextMenu();
  });
  void petWindow.webContents.setVisualZoomLevelLimits(1, 1);
  petWindow.on("moved", () => {
    syncAchievementToastPosition();
    persistPetPosition();
  });
  petWindow.on("resize", () => setPetBounds(petWindowPosition()));
  petWindow.on("closed", () => {
    petWindow = null;
  });
  void loadRenderer(petWindow, "pet");
  return petWindow;
}

function createManagerWindow() {
  if (managerWindow) return managerWindow;
  const chrome = managerChromeTheme(ledger.settings.uiTheme);

  managerWindow = new BrowserWindow({
    width: MANAGER_SIZE.width,
    height: MANAGER_SIZE.height,
    minWidth: MANAGER_MIN_SIZE.width,
    minHeight: MANAGER_MIN_SIZE.height,
    title: APP_NAME,
    icon: createAppIcon(),
    frame: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 14, y: 10 } }
      : { titleBarOverlay: chrome }),
    transparent: false,
    resizable: true,
    show: true,
    backgroundColor: chrome.color,
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  applyManagerWindowChrome();

  managerWindow.on("closed", () => {
    managerWindow = null;
    managerRendererReady = false;
    pendingOpenSettings = false;
    refreshTrayMenu();
  });
  managerWindow.webContents.setZoomFactor(1);
  managerWindow.webContents.on("did-start-loading", () => {
    managerRendererReady = false;
  });
  managerWindow.webContents.on("zoom-changed", (event) => event.preventDefault());
  void managerWindow.webContents.setVisualZoomLevelLimits(1, 1);
  void loadRenderer(managerWindow, "manager");
  return managerWindow;
}

function createMenuBarWindow() {
  if (menuBarWindow && !menuBarWindow.isDestroyed()) return menuBarWindow;
  menuBarWindow = new BrowserWindow({
    width: MENU_BAR_POPOVER_SIZE.width,
    height: MENU_BAR_POPOVER_SIZE.height,
    title: `${APP_NAME} Menu`,
    icon: createAppIcon(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  menuBarWindow.webContents.setZoomFactor(1);
  menuBarWindow.webContents.on("zoom-changed", (event) => event.preventDefault());
  void menuBarWindow.webContents.setVisualZoomLevelLimits(1, 1);
  menuBarWindow.on("blur", () => {
    if (!menuBarWindow || menuBarWindow.isDestroyed()) return;
    menuBarWindow.hide();
  });
  menuBarWindow.on("closed", () => {
    menuBarWindow = null;
  });
  void loadRenderer(menuBarWindow, "menubar");
  return menuBarWindow;
}

function createAchievementToastWindow() {
  if (achievementToastWindow && !achievementToastWindow.isDestroyed()) return achievementToastWindow;

  achievementToastRendererReady = false;
  achievementToastWindow = new BrowserWindow({
    width: ACHIEVEMENT_TOAST_SIZE.width,
    height: ACHIEVEMENT_TOAST_SIZE.height,
    title: `${APP_NAME} Achievement`,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  achievementToastWindow.setIgnoreMouseEvents(true);
  achievementToastWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  achievementToastWindow.setAlwaysOnTop(true, "floating");
  achievementToastWindow.webContents.setZoomFactor(1);
  achievementToastWindow.webContents.on("did-start-loading", () => {
    achievementToastRendererReady = false;
  });
  achievementToastWindow.webContents.on("zoom-changed", (event) => event.preventDefault());
  void achievementToastWindow.webContents.setVisualZoomLevelLimits(1, 1);
  achievementToastWindow.on("closed", () => {
    achievementToastWindow = null;
    achievementToastRendererReady = false;
    achievementToastFallbackHideAt = 0;
    if (achievementToastHideTimer) {
      clearTimeout(achievementToastHideTimer);
      achievementToastHideTimer = null;
    }
  });
  void loadRenderer(achievementToastWindow, "toast");
  return achievementToastWindow;
}

function achievementToastPlacement() {
  const size = ACHIEVEMENT_TOAST_SIZE;
  const fallbackPetSize = petSize();
  const fallbackPetPosition = defaultPetPosition(fallbackPetSize.width, fallbackPetSize.height);
  const petBounds = petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : {
    ...fallbackPetPosition,
    ...fallbackPetSize,
  };
  const display = screen.getDisplayMatching(petBounds).workArea;
  const minX = display.x + 8;
  const maxX = display.x + display.width - size.width - 8;
  const minY = display.y + 8;
  const maxY = display.y + display.height - size.height - 8;
  const overlap = Math.round(ACHIEVEMENT_TOAST_OVERLAP_PER_SCALE * ledger.settings.scale);
  const rightX = petBounds.x + petBounds.width - overlap;
  const leftX = petBounds.x - size.width + overlap;
  const canUseRight = rightX <= maxX;
  const canUseLeft = leftX >= minX;
  const placement: ToastPlacement = canUseRight || !canUseLeft ? "right" : "left";
  const rawX = placement === "right" ? rightX : leftX;
  const downOffset = Math.round(ACHIEVEMENT_TOAST_DOWN_OFFSET_PER_SCALE * ledger.settings.scale);
  const rawY = petBounds.y - size.height + overlap + downOffset;

  return {
    placement,
    bounds: {
      x: Math.min(Math.max(rawX, minX), maxX),
      y: Math.min(Math.max(rawY, minY), maxY),
      width: size.width,
      height: size.height,
    },
  };
}

function syncAchievementToastPosition() {
  if (!achievementToastWindow || achievementToastWindow.isDestroyed() || !achievementToastWindow.isVisible()) return;
  const { bounds, placement } = achievementToastPlacement();
  achievementToastWindow.setBounds(bounds, false);
  achievementToastWindow.webContents.send("bonsai:achievement-toast-placement", placement);
}

function clearAchievementToastHideTimer() {
  if (!achievementToastHideTimer) return;
  clearTimeout(achievementToastHideTimer);
  achievementToastHideTimer = null;
}

function scheduleAchievementToastFallbackHide(count: number) {
  const now = Date.now();
  achievementToastFallbackHideAt =
    Math.max(achievementToastFallbackHideAt, now) + count * (ACHIEVEMENT_TOAST_DURATION_MS + 200);
  clearAchievementToastHideTimer();
  achievementToastHideTimer = setTimeout(() => {
    if (achievementToastWindow && !achievementToastWindow.isDestroyed()) achievementToastWindow.hide();
    achievementToastHideTimer = null;
    achievementToastFallbackHideAt = 0;
  }, Math.max(0, achievementToastFallbackHideAt - now) + ACHIEVEMENT_TOAST_WINDOW_PADDING_MS);
}

function scheduleAchievementToastDrainedHide() {
  clearAchievementToastHideTimer();
  achievementToastHideTimer = setTimeout(() => {
    if (achievementToastWindow && !achievementToastWindow.isDestroyed()) achievementToastWindow.hide();
    achievementToastHideTimer = null;
    achievementToastFallbackHideAt = 0;
  }, ACHIEVEMENT_TOAST_WINDOW_PADDING_MS);
}

function flushAchievementToastOverlay() {
  if (
    !achievementToastWindow ||
    achievementToastWindow.isDestroyed() ||
    !achievementToastRendererReady ||
    !achievementToastPendingItems.length
  ) {
    return;
  }

  const items = achievementToastPendingItems;
  achievementToastPendingItems = [];
  const { bounds, placement } = achievementToastPlacement();
  achievementToastWindow.setBounds(bounds, false);
  achievementToastWindow.setAlwaysOnTop(true, "floating");
  achievementToastWindow.webContents.send("bonsai:achievement-toast", toastPayload(items, placement));
  achievementToastWindow.showInactive();
  scheduleAchievementToastFallbackHide(items.length);
}

function showTreeToastOverlay(items: TreeToastItem[]) {
  const cleanItems = items.filter(isTreeToastItem);
  if (!cleanItems.length) return;

  achievementToastPendingItems.push(...cleanItems);
  const window = createAchievementToastWindow();
  const { bounds, placement } = achievementToastPlacement();
  window.setBounds(bounds, false);
  window.setAlwaysOnTop(true, "floating");
  window.webContents.send("bonsai:achievement-toast-placement", placement);
  flushAchievementToastOverlay();
}

function showAchievementToastOverlay(ids: string[]) {
  showTreeToastOverlay(
    ids
      .filter((id) => typeof id === "string" && id.length)
      .map((id) => ({ type: "achievement", id })),
  );
}

function showLevelToastOverlay(input: { from?: unknown; to?: unknown }) {
  const from = Math.max(1, Math.round(Number(input?.from)));
  const to = Math.max(1, Math.round(Number(input?.to)));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
  const key = String(to);
  const now = Date.now();
  if (lastLevelToastKey === key && now - lastLevelToastAt < LEVEL_TOAST_DEDUPE_MS) return;
  lastLevelToastKey = key;
  lastLevelToastAt = now;
  showTreeToastOverlay([{ type: "level", from, to }]);
}

function toastPayload(items: TreeToastItem[], placement: ToastPlacement) {
  return {
    items,
    ids: items.flatMap((item) => (item.type === "achievement" ? [item.id] : [])),
    placement,
  };
}

function isTreeToastItem(item: TreeToastItem): item is TreeToastItem {
  if (item.type === "achievement") return typeof item.id === "string" && item.id.length > 0;
  return Number.isFinite(item.from) && Number.isFinite(item.to) && item.to > item.from;
}

function showManager() {
  const window = createManagerWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (process.platform === "darwin") app.dock?.show();
  refreshTrayMenu();
}

function openManagerSettings(category?: string) {
  pendingOpenSettings = true;
  pendingSettingsCategory = category ?? null;
  showManager();
  flushManagerCommands();
}

function openManagerTab(tab: "home" | "achievements" | "leaderboard") {
  pendingDashboardTab = tab;
  showManager();
  flushManagerCommands();
}

function flushManagerCommands() {
  if (!managerWindow || managerWindow.isDestroyed() || !managerRendererReady) return;
  if (pendingDashboardTab) {
    managerWindow.webContents.send("bonsai:open-dashboard-tab", pendingDashboardTab);
    pendingDashboardTab = null;
  }
  if (pendingOpenSettings) {
    managerWindow.webContents.send("bonsai:open-settings", pendingSettingsCategory);
    pendingOpenSettings = false;
    pendingSettingsCategory = null;
  }
}

function persistPetPosition() {
  if (!petWindow) return;
  const [x, y] = petWindow.getPosition();
  ledger.settings.windowPosition = clampPetPosition({ x, y });
  writeDeviceSettings();
}

function petWindowPosition() {
  if (!petWindow) {
    const size = petSize();
    return defaultPetPosition(size.width, size.height);
  }
  const [x, y] = petWindow.getPosition();
  return { x, y };
}

function resizePetWindow() {
  if (!petWindow) return;
  const [x, y] = petWindow.getPosition();
  setPetBounds({ x, y });
  persistPetPosition();
}

function recoverPetWindow() {
  const size = petSize();
  const position = defaultPetPosition(size.width, size.height);
  if (!petWindow) createPetWindow();
  petWindow?.show();
  petWindow?.setBounds({ ...position, width: size.width, height: size.height }, false);
  persistPetPosition();
  refreshTrayMenu();
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip(APP_NAME);
  tray.on("click", toggleMenuBarPopover);
  tray.on("right-click", () => {
    refreshTrayMenu();
    if (trayContextMenu) tray?.popUpContextMenu(trayContextMenu);
  });
  refreshTrayMenu();
}

function createTrayIcon() {
  if (process.platform === "darwin") return createMacTrayIcon();
  return createAppIcon();
}

function createMacTrayIcon() {
  for (const iconPath of MAC_MENU_BAR_ICON_PATHS) {
    try {
      if (!existsSync(iconPath)) continue;
      const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
      if (icon.isEmpty()) continue;
      icon.setTemplateImage(true);
      return icon;
    } catch {
      // Fall back to the bundled app icon if the menu bar asset is missing or unreadable.
    }
  }
  const fallback = createAppIcon().resize({ width: 16, height: 16 });
  fallback.setTemplateImage(true);
  return fallback;
}

function toggleMenuBarPopover() {
  if (process.platform !== "darwin") {
    showManager();
    return;
  }
  const window = createMenuBarWindow();
  if (window.isVisible()) {
    window.hide();
    return;
  }
  positionMenuBarWindow(window);
  window.show();
  window.focus();
}

function hideMenuBarPopover() {
  if (!menuBarWindow || menuBarWindow.isDestroyed()) return;
  menuBarWindow.hide();
}

function positionMenuBarWindow(window: BrowserWindow) {
  const anchorBounds = tray?.getBounds();
  if (!anchorBounds) return;
  const display = screen.getDisplayMatching(anchorBounds);
  const workArea = display.workArea;
  const x = Math.round(
    Math.min(
      Math.max(anchorBounds.x + anchorBounds.width / 2 - MENU_BAR_POPOVER_SIZE.width / 2, workArea.x + 8),
      workArea.x + workArea.width - MENU_BAR_POPOVER_SIZE.width - 8,
    ),
  );
  const y = Math.round(
    Math.min(
      anchorBounds.y + anchorBounds.height + 8,
      workArea.y + workArea.height - MENU_BAR_POPOVER_SIZE.height - 8,
    ),
  );
  window.setBounds({ x, y, ...MENU_BAR_POPOVER_SIZE }, false);
}

function createAppIcon() {
  for (const iconPath of APP_ICON_PATHS) {
    try {
      if (!existsSync(iconPath)) continue;
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) return icon;
    } catch {
      // Fall back to the embedded icon below.
    }
  }

  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" fill="none"/>
      <rect x="10" y="25" width="13" height="3" fill="#0a0c09"/>
      <rect x="8" y="22" width="17" height="4" fill="#5a3824"/>
      <rect x="7" y="20" width="19" height="3" fill="#a7ea3e"/>
      <rect x="12" y="14" width="4" height="8" fill="#6f4425"/>
      <rect x="15" y="12" width="3" height="10" fill="#9a602f"/>
      <rect x="8" y="12" width="8" height="6" fill="#0a0c09"/>
      <rect x="10" y="10" width="8" height="6" fill="#a7ea3e"/>
      <rect x="12" y="9" width="5" height="3" fill="#d7ff57"/>
      <rect x="17" y="8" width="8" height="7" fill="#0a0c09"/>
      <rect x="16" y="6" width="8" height="7" fill="#a7ea3e"/>
      <rect x="18" y="5" width="5" height="3" fill="#d7ff57"/>
      <rect x="21" y="13" width="7" height="6" fill="#0a0c09"/>
      <rect x="20" y="11" width="7" height="6" fill="#94db3d"/>
      <rect x="22" y="10" width="4" height="2" fill="#d7ff57"/>
    </svg>
  `);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

function showPetContextMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: mainText("openSettings"),
      click: () => openManagerSettings(),
    },
    {
      label: ledger.settings.locked ? mainText("unlockPet") : mainText("lockPet"),
      type: "checkbox" as const,
      checked: ledger.settings.locked,
      click: () => updateSettings({ locked: !ledger.settings.locked }),
    },
    {
      label: mainText("petSize"),
      submenu: scaleMenuItems(),
    },
    { type: "separator" as const },
    {
      label: mainText("badgeFront"),
      submenu: badgeMetricMenuItems("badgeFrontMetric"),
    },
    {
      label: mainText("badgeBack"),
      submenu: badgeMetricMenuItems("badgeBackMetric"),
    },
    {
      label: mainText("totalUnit"),
      submenu: totalUnitMenuItems(),
    },
    { type: "separator" as const },
    {
      label: mainText("hidePet"),
      click: () => {
        petWindow?.hide();
        refreshTrayMenu();
      },
    },
  ]);
  menu.popup({ window: petWindow ?? undefined });
}

function scaleMenuItems(): MenuItemConstructorOptions[] {
  return [0.5, 1, 1.5, 2].map((scale) => ({
    label: `${scale}x`,
    type: "radio" as const,
    checked: ledger.settings.scale === scale,
    click: () => updateSettings({ scale }),
  }));
}

function badgeMetricMenuItems(key: "badgeFrontMetric" | "badgeBackMetric"): MenuItemConstructorOptions[] {
  const labels: Record<Settings["badgeFrontMetric"], string> = {
    level: mainText("metricLevel"),
    total: mainText("metricTotal"),
    rate: "token/s",
  };
  return (Object.keys(labels) as Settings["badgeFrontMetric"][]).map((metric) => ({
    label: labels[metric],
    type: "radio" as const,
    checked: ledger.settings[key] === metric,
    click: () => updateSettings({ [key]: metric } as Partial<Settings>),
  }));
}

function totalUnitMenuItems(): MenuItemConstructorOptions[] {
  const labels: Record<Settings["totalDisplayUnit"], string> = {
    raw: mainText("unitRaw"),
    k: "k",
    m: "m",
    wan: mainText("unitWan"),
    yi: mainText("unitYi"),
  };
  return (Object.keys(labels) as Settings["totalDisplayUnit"][]).map((unit) => ({
    label: labels[unit],
    type: "radio" as const,
    checked: ledger.settings.totalDisplayUnit === unit,
    click: () => updateSettings({ totalDisplayUnit: unit }),
  }));
}

function refreshTrayMenu() {
  if (!tray) return;
  const trayStats = getTrayStats();
  trayContextMenu = Menu.buildFromTemplate([
    {
      label: `${APP_NAME} · Lv.${trayStats.level} · ${trayStats.weatherLabel}`,
      enabled: false,
    },
    {
      label: `${formatCompact(trayStats.totalXp)} token · ${mainText("today")} +${formatCompact(trayStats.todayXp)} · ${formatCompact(
        trayStats.xpPerMinute,
      )} token/min`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: mainText("openSettings"),
      click: () => openManagerSettings(),
    },
    {
      label: mainText("recoverPet"),
      click: recoverPetWindow,
    },
    {
      label: updateTrayMenuLabel(),
      enabled: !updateStatus.checking,
      click: () => {
        void checkForUpdates({ manual: true, reopenTrayMenu: true });
      },
    },
    ...(updateStatus.available && updateStatus.releaseUrl
      ? [
          {
            label: updateStatus.canTerminalUpdate ? mainText("terminalUpdate") : mainText("openUpdatePage"),
            enabled: !updateStatus.installing,
            click: () => {
              if (updateStatus.canTerminalUpdate) {
                void installUpdate();
              } else {
                void openUpdatePage(updateStatus.releaseUrl);
              }
            },
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    { type: "separator" },
    {
      label: sourceStatusLabel("Codex", codexSessionStatus, "codex-session"),
      enabled: false,
    },
    {
      label: sourceStatusLabel("Claude Code", claudeSessionStatus, "claude-session"),
      enabled: false,
    },
    {
      label: sourceStatusLabel("OpenClaw", openclawSessionStatus, "openclaw-session"),
      enabled: false,
    },
    {
      label: sourceStatusLabel("Pi Agent", piSessionStatus, "pi-session"),
      enabled: false,
    },
    {
      label: sourceStatusLabel("OpenCode", opencodeSessionStatus, "opencode-session"),
      enabled: false,
    },
    {
      label: sourceStatusLabel("Gemini", geminiSessionStatus, "gemini-session"),
      enabled: false,
    },
    {
      label: sourceStatusLabel("Hermes", hermesSessionStatus, "hermes-session"),
      enabled: false,
    },
    { type: "separator" },
    {
      label: mainText("petSize"),
      submenu: scaleMenuItems(),
    },
    {
      label: mainText("lockPet"),
      type: "checkbox",
      checked: ledger.settings.locked,
      click: () => updateSettings({ locked: !ledger.settings.locked }),
    },
    {
      label: mainText("hidePet"),
      type: "checkbox",
      checked: !petWindow?.isVisible(),
      click: (item) => {
        if (!petWindow) createPetWindow();
        if (item.checked) {
          petWindow?.hide();
        } else {
          petWindow?.show();
        }
        refreshTrayMenu();
      },
    },
    {
      label: mainText("alwaysOnTop"),
      type: "checkbox",
      checked: ledger.settings.alwaysOnTop,
      click: () => updateSettings({ alwaysOnTop: !ledger.settings.alwaysOnTop }),
    },
    {
      label: mainText("launchOnStartup"),
      type: "checkbox",
      checked: ledger.settings.launchOnStartup,
      click: () => updateSettings({ launchOnStartup: !ledger.settings.launchOnStartup }),
    },
    {
      label: mainText("silentStartup"),
      type: "checkbox",
      checked: ledger.settings.silentStartup,
      click: () => updateSettings({ silentStartup: !ledger.settings.silentStartup }),
    },
    { type: "separator" },
    {
      label: mainText("quit"),
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(process.platform === "darwin" ? null : trayContextMenu);
  tray.setToolTip(`${APP_NAME} · Lv.${trayStats.level} · ${trayStats.weatherLabel}`);
}

function updateTrayMenuLabel() {
  if (updateStatus.checking) return mainText("checkingUpdate");
  if (updateStatus.available && updateStatus.latestVersion) return `${mainText("updateFound")} v${updateStatus.latestVersion}`;
  if (updateStatus.error) return mainText("updateCheckFailed");
  if (updateStatus.checkedAt) return `${mainText("updateAlreadyLatestTitle")} v${updateStatus.currentVersion}`;
  return mainText("checkUpdate");
}

function reopenTrayMenuSoon(delayMs = 120) {
  if (!tray) return;
  if (trayMenuReopenTimer) clearTimeout(trayMenuReopenTimer);
  trayMenuReopenTimer = setTimeout(() => {
    trayMenuReopenTimer = null;
    if (!tray) return;
    refreshTrayMenu();
    if (trayContextMenu) tray.popUpContextMenu(trayContextMenu);
  }, delayMs);
}

function getTrayStats() {
  const now = Date.now();
  const totalXp = ledger.entries.reduce((total, entry) => total + xpForEntry(entry), 0);
  const todayKey = dateKey(new Date());
  const todayXp = ledger.entries
    .filter((entry) => dateKey(new Date(entry.createdAt)) === todayKey)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const recentXp = ledger.entries
    .filter((entry) => now - entryTime(entry) <= 60_000)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const xpPerMinute = recentXp;
  const weather = WEATHER_THRESHOLDS.reduce((current, candidate) => {
    return xpPerMinute >= candidate.minXpPerMinute ? candidate : current;
  }, WEATHER_THRESHOLDS[0]);

  return {
    level: getLevel(totalXp),
    totalXp,
    todayXp,
    xpPerMinute,
    weatherLabel: weatherLabel(weather.id),
  };
}

function sourceStatusLabel(label: string, status: UsageStatus["codexSession"], source: string) {
  const entries = ledger.entries.filter((entry) => entry.source === source);
  const state =
    status.exists && status.running
      ? mainText("sourceWatching")
      : status.running
        ? mainText("sourceReading")
        : mainText("sourceStopped");
  const eventText = status.lastEventAt ? ` · ${formatRelativeTime(status.lastEventAt)}` : "";
  const entriesUnit = currentLanguage() === "zh-CN" ? "条" : "entries";
  return `${label}: ${state} · ${status.filesWatched} ${mainText("files")} · ${entries.length} ${entriesUnit}${eventText}`;
}

function xpForEntry(entry: LedgerEntry) {
  const sourceId = statSourceIdForEntry(entry);
  if (sourceId && !ledger.settings.enabledSourceIds.includes(sourceId)) return 0;
  return countedTokensForEntry(entry);
}

function statSourceIdForEntry(entry: LedgerEntry): string | undefined {
  if (entry.source === "cloud-sync") {
    const inferred = sourceFromEventId(entry.id);
    if (inferred) return statSourceIdForSource(inferred, entry.agent);
    return "cloud";
  }
  return statSourceIdForSource(entry.source, entry.agent);
}

function statSourceIdForSource(source: string, agent?: string): string | undefined {
  if (source === "codex-session" || agent === "codex-desktop") return "codex";
  if (source === "openclaw-session" || agent === "openclaw") return "openclaw";
  if (source === "pi-session" || agent === "pi-agent") return "pi";
  if (source === "opencode-session" || agent === "opencode" || Boolean(agent?.startsWith("opencode:"))) {
    return "opencode";
  }
  if (source === "claude-session" || Boolean(agent?.startsWith("claude-code"))) return "claude";
  if (source === "gemini-session" || agent === "gemini") return "gemini";
  if (source === "hermes-session" || agent === "hermes") return "hermes";
  return undefined;
}

function safeTokens(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getLevel(totalXp: number) {
  let level = 1;
  let remaining = totalXp;
  let needed = xpForNextLevel(level);
  while (remaining >= needed && level < MAX_LEVEL) {
    remaining -= needed;
    level += 1;
    needed = xpForNextLevel(level);
  }
  return level;
}

function xpForNextLevel(level: number) {
  return Math.round(LEVEL_BASE * level ** LEVEL_EXPONENT);
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCompact(value: number) {
  const absolute = Math.abs(value);
  if (absolute < 1_000) return `${Math.round(value)}`;
  if (absolute < 1_000_000) return `${trimNumber(absolute / 1_000)}k`;
  return `${trimNumber(absolute / 1_000_000)}m`;
}

function trimNumber(value: number) {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(2).replace(/\.?0+$/, "");
}

function formatRelativeTime(isoTime: string) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(isoTime)) / 1000));
  if (elapsedSeconds < 60) return mainText("justNow");
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return currentLanguage() === "zh-CN" ? `${elapsedMinutes} ${mainText("minutesAgo")}` : `${elapsedMinutes} ${mainText("minutesAgo")}`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return currentLanguage() === "zh-CN" ? `${elapsedHours} ${mainText("hoursAgo")}` : `${elapsedHours} ${mainText("hoursAgo")}`;
}

function updateSettings(partial: Partial<Settings>) {
  const previous = ledger.settings;
  ledger.settings = normalizeSettings({ ...ledger.settings, ...partial });
  petWindow?.setAlwaysOnTop(ledger.settings.alwaysOnTop, "floating");
  if (previous.uiTheme !== ledger.settings.uiTheme) applyManagerWindowChrome();
  if (partial.scale !== undefined) resizePetWindow();
  writeDeviceSettings();
  if (partial.launchOnStartup !== undefined || partial.silentStartup !== undefined) {
    applyLoginItemSettings();
  }
  if (partial.proxyUrl !== undefined) {
    void configureNetworkProxy(ledger.settings.proxyUrl);
  }
  if (partial.updateCheckEnabled !== undefined) {
    startUpdateChecks();
  }
  if (
    previous.leaderboardEnabled !== ledger.settings.leaderboardEnabled ||
    previous.cloudSyncEnabled !== ledger.settings.cloudSyncEnabled ||
    previous.leaderboardAutoSyncEnabled !== ledger.settings.leaderboardAutoSyncEnabled ||
    previous.cloudSyncAutoSyncEnabled !== ledger.settings.cloudSyncAutoSyncEnabled ||
    previous.leaderboardProfile?.id !== ledger.settings.leaderboardProfile?.id ||
    (previous.socialGroupCount > 0) !== (ledger.settings.socialGroupCount > 0)
  ) {
    leaderboardService.startSync();
  } else if (
    partial.leaderboardEnabled !== undefined ||
    partial.leaderboardAutoSyncEnabled !== undefined ||
    partial.leaderboardProfile !== undefined ||
    partial.leaderboardLastSyncedAt !== undefined ||
    partial.cloudSyncEnabled !== undefined ||
    partial.cloudSyncAutoSyncEnabled !== undefined ||
    partial.cloudSyncLastSyncedAt !== undefined ||
    partial.cloudSyncLastPulledAt !== undefined
  ) {
    leaderboardService.broadcast();
  }
  if (
    previous.codexSessionsDir !== ledger.settings.codexSessionsDir ||
    previous.claudeSessionsDir !== ledger.settings.claudeSessionsDir ||
    previous.openclawSessionsDir !== ledger.settings.openclawSessionsDir ||
    previous.piSessionsDir !== ledger.settings.piSessionsDir ||
    previous.opencodeSessionsDir !== ledger.settings.opencodeSessionsDir ||
    previous.geminiSessionsDir !== ledger.settings.geminiSessionsDir ||
    previous.hermesSessionsDir !== ledger.settings.hermesSessionsDir
  ) {
    restartUsageWatchers();
  }
  refreshTrayMenu();
  broadcast("bonsai:ledger", ledger);
}

function ensureCloudSyncDeviceId() {
  if (ledger.settings.cloudSyncDeviceId) return ledger.settings.cloudSyncDeviceId;
  const deviceId = `device_${randomUUID().replace(/-/g, "")}`;
  ledger.settings = normalizeSettings({ ...ledger.settings, cloudSyncDeviceId: deviceId });
  writeDeviceSettings();
  return ledger.settings.cloudSyncDeviceId ?? deviceId;
}

function cloudSyncDeviceInfo() {
  return {
    deviceId: ensureCloudSyncDeviceId(),
    alias: cloudDevicePlatformLabel(),
    platform: cloudDevicePlatform(),
  };
}

function cloudDevicePlatform() {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  return "unknown";
}

function cloudDevicePlatformLabel() {
  if (process.platform === "darwin") return "Mac";
  if (process.platform === "win32") return "Windows";
  if (process.platform === "linux") return "Linux";
  return "Device";
}

function cloudModelStats(): CloudModelStat[] {
  const deviceId = ensureCloudSyncDeviceId();
  const rows = new Map<string, CloudModelStat>();
  for (const entry of ledger.entries) {
    const model = cleanCloudModelLabel(entry.model) ?? cleanCloudModelLabel(entry.provider);
    if (!model) continue;
    if (entryIsKnownRemoteCloudMirror(entry, deviceId)) continue;
    const createdAt = new Date(entry.createdAt);
    if (!Number.isFinite(createdAt.getTime())) continue;
    const source = normalizeCloudEventSource(entry.source, entry.id);
    if (source === "cloud-sync") continue;
    const date = dateKey(createdAt);
    const key = `${deviceId}|${date}|${source}|${model}`;
    const existing =
      rows.get(key) ??
      {
        deviceId,
        date,
        source,
        model,
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
    existing.tokens += countedTokensForEntry(entry);
    existing.inputTokens = (existing.inputTokens ?? 0) + countedInputTokensForEntry(entry);
    existing.outputTokens = (existing.outputTokens ?? 0) + safeTokens(entry.outputTokens ?? 0);
    existing.cacheReadTokens = (existing.cacheReadTokens ?? 0) + safeTokens(entry.cacheReadTokens ?? 0);
    existing.cacheWriteTokens = (existing.cacheWriteTokens ?? 0) + safeTokens(entry.cacheWriteTokens ?? 0);
    rows.set(key, existing);
  }
  return [...rows.values()].filter((row) => row.tokens > 0).sort((a, b) => {
    const dateOrder = a.date.localeCompare(b.date);
    if (dateOrder) return dateOrder;
    const sourceOrder = a.source.localeCompare(b.source);
    return sourceOrder || a.model.localeCompare(b.model);
  });
}

function entryIsKnownRemoteCloudMirror(entry: LedgerEntry, currentDeviceId: string) {
  if (!entry.syncedFromCloud && entry.source !== "cloud-sync") return false;
  return Boolean(entry.deviceId && entry.deviceId !== currentDeviceId);
}

function cleanCloudModelLabel(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : undefined;
}

function appendUsageEvent(event: UsageEvent) {
  if (ledger.entries.some((entry) => entry.id === event.id)) return;

  const entry: LedgerEntry = {
    id: event.id,
    createdAt: event.createdAt,
    source: event.source,
    tokens: event.totalTokens,
    note: `${event.agent}${event.model ? ` · ${event.model}` : ""}`,
    agent: event.agent,
    provider: event.provider,
    model: event.model,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheWriteTokens: event.cacheWriteTokens,
    deviceId: ensureCloudSyncDeviceId(),
  };
  entry.tokens = countedTokensForEntry(entry);
  ledger.entries.unshift(entry);
  appendUsageEntryToStore(entry);
  broadcast("bonsai:ledger", ledger);
  refreshTrayMenu();
  leaderboardService.scheduleCloudSyncSoon();
}

function appendRemoteEntries(entries: LedgerEntry[]) {
  const existingById = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  const existingByFingerprint = new Map<string, LedgerEntry>();
  for (const entry of ledger.entries) {
    const fingerprint = cloudMirrorDedupeKey(entry);
    if (fingerprint && !existingByFingerprint.has(fingerprint)) existingByFingerprint.set(fingerprint, entry);
  }
  const accepted: LedgerEntry[] = [];
  const repaired: LedgerEntry[] = [];
  for (const entry of entries) {
    if (!isEntry(entry)) continue;
    const normalized = normalizeRemoteEntry(entry);
    const existing = existingById.get(normalized.id);
    if (existing) {
      const merged = mergeRemoteEntry(existing, normalized);
      if (!entriesEquivalent(existing, merged)) {
        existingById.set(merged.id, merged);
        repaired.push(merged);
        appendUsageEntryToStore(merged);
      }
      continue;
    }
    const fingerprint = cloudMirrorDedupeKey(normalized);
    const mirrored = fingerprint ? existingByFingerprint.get(fingerprint) : undefined;
    if (fingerprint && mirrored) {
      const eventFingerprint = normalized.eventFingerprint ?? mirrored.eventFingerprint ?? cloudEventFingerprint(normalized) ?? fingerprint;
      const preferred = preferCloudMirrorDuplicate(mirrored, normalized);
      const secondary = preferred === mirrored ? normalized : mirrored;
      const merged = mergeCloudMirrorDuplicate(preferred, secondary, eventFingerprint);
      if (!entriesEquivalent(mirrored, merged)) {
        existingById.set(merged.id, merged);
        existingByFingerprint.set(fingerprint, merged);
        repaired.push(merged);
        appendUsageEntryToStore(merged);
      }
      continue;
    }
    existingById.set(normalized.id, normalized);
    if (fingerprint) existingByFingerprint.set(fingerprint, normalized);
    accepted.push(normalized);
    appendUsageEntryToStore(normalized);
  }
  if (!accepted.length && !repaired.length) {
    const deduped = dedupeCloudMirroredEntries(ledger.entries);
    if (!deduped.removedCount) return 0;
    ledger.entries = deduped.entries;
    rewriteUsageEntriesStore(ledger.entries);
    broadcast("bonsai:ledger", ledger);
    refreshTrayMenu();
    return deduped.removedCount;
  }
  const repairedIds = new Set(repaired.map((entry) => entry.id));
  const kept = ledger.entries.filter((entry) => !repairedIds.has(entry.id));
  const deduped = dedupeCloudMirroredEntries([...accepted, ...repaired, ...kept]);
  ledger.entries = deduped.entries;
  if (repaired.length || deduped.removedCount) rewriteUsageEntriesStore(ledger.entries);
  broadcast("bonsai:ledger", ledger);
  refreshTrayMenu();
  return accepted.length + repaired.length + deduped.removedCount;
}

function normalizeRemoteEntry(entry: LedgerEntry): LedgerEntry {
  const source = normalizeCloudEventSource(entry.source, entry.id);
  return {
    ...entry,
    source,
    tokens: safeTokens(entry.tokens),
    syncedFromCloud: true,
    eventFingerprint: entry.eventFingerprint ?? cloudEventFingerprint({ ...entry, source }),
  };
}

function mergeRemoteEntry(existing: LedgerEntry, remote: LedgerEntry): LedgerEntry {
  if (existing.syncedFromCloud || existing.source === "cloud-sync") {
    return mergeLocalOnlyUsageFields(remote, existing);
  }
  return {
    ...existing,
    source: existing.source === "cloud-sync" ? remote.source : existing.source,
    tokens: remote.tokens,
    inputTokens: remote.inputTokens ?? existing.inputTokens,
    outputTokens: remote.outputTokens ?? existing.outputTokens,
    cacheReadTokens: remote.cacheReadTokens ?? existing.cacheReadTokens,
    cacheWriteTokens: remote.cacheWriteTokens ?? existing.cacheWriteTokens,
    deviceId: existing.deviceId ?? remote.deviceId,
    eventFingerprint: existing.eventFingerprint ?? remote.eventFingerprint,
  };
}

function mergeLocalOnlyUsageFields(base: LedgerEntry, fallback: LedgerEntry): LedgerEntry {
  return {
    ...base,
    agent: base.agent ?? fallback.agent,
    provider: base.provider ?? fallback.provider,
    model: base.model ?? fallback.model,
    note: base.note ?? fallback.note,
  };
}

function entriesEquivalent(left: LedgerEntry, right: LedgerEntry) {
  return (
    left.source === right.source &&
    left.tokens === right.tokens &&
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.cacheReadTokens === right.cacheReadTokens &&
    left.cacheWriteTokens === right.cacheWriteTokens &&
    left.deviceId === right.deviceId &&
    left.syncedFromCloud === right.syncedFromCloud &&
    left.eventFingerprint === right.eventFingerprint &&
    left.agent === right.agent &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.note === right.note
  );
}

function dedupeCloudMirroredEntries(entries: LedgerEntry[]) {
  const byFingerprint = new Map<string, LedgerEntry>();
  const withoutFingerprint: LedgerEntry[] = [];
  let removedCount = 0;

  for (const entry of entries) {
    const fingerprint = cloudMirrorDedupeKey(entry);
    if (!fingerprint) {
      withoutFingerprint.push(entry);
      continue;
    }

    const existing = byFingerprint.get(fingerprint);
    if (!existing) {
      byFingerprint.set(fingerprint, withCloudEventFingerprint(entry));
      continue;
    }

    removedCount += 1;
    const preferred = preferCloudMirrorDuplicate(existing, entry);
    const secondary = preferred === existing ? entry : existing;
    byFingerprint.set(
      fingerprint,
      mergeCloudMirrorDuplicate(preferred, secondary, cloudMirrorMergeEventFingerprint(preferred, secondary) ?? fingerprint),
    );
  }

  return {
    entries: [...withoutFingerprint, ...byFingerprint.values()].sort((a, b) => entryTime(b) - entryTime(a)),
    removedCount,
  };
}

function withCloudEventFingerprint(entry: LedgerEntry): LedgerEntry {
  const eventFingerprint = entry.eventFingerprint ?? cloudEventFingerprint(entry);
  if (!eventFingerprint) return entry;
  return entry.eventFingerprint === eventFingerprint ? entry : { ...entry, eventFingerprint };
}

function preferCloudMirrorDuplicate(left: LedgerEntry, right: LedgerEntry) {
  return cloudMirrorPreferenceScore(right) > cloudMirrorPreferenceScore(left) ? right : left;
}

function cloudMirrorPreferenceScore(entry: LedgerEntry) {
  let score = 0;
  if (!entry.syncedFromCloud && entry.source !== "cloud-sync") score += 100;
  if (entry.source !== "cloud-sync") score += 20;
  if (entry.deviceId) score += 4;
  if (entry.eventFingerprint) score += 2;
  return score;
}

function mergeCloudMirrorDuplicate(preferred: LedgerEntry, secondary: LedgerEntry, eventFingerprint: string): LedgerEntry {
  return {
    ...preferred,
    agent: preferred.agent ?? secondary.agent,
    provider: preferred.provider ?? secondary.provider,
    model: preferred.model ?? secondary.model,
    note: preferred.note ?? secondary.note,
    tokens: syncedAuthoritativeTokens(preferred, secondary),
    inputTokens: preferred.inputTokens ?? secondary.inputTokens,
    outputTokens: preferred.outputTokens ?? secondary.outputTokens,
    cacheReadTokens: preferred.cacheReadTokens ?? secondary.cacheReadTokens,
    cacheWriteTokens: preferred.cacheWriteTokens ?? secondary.cacheWriteTokens,
    deviceId: preferred.deviceId ?? secondary.deviceId,
    syncedFromCloud: preferred.syncedFromCloud || secondary.syncedFromCloud || secondary.source === "cloud-sync" || undefined,
    eventFingerprint,
  };
}

function cloudMirrorMergeEventFingerprint(preferred: LedgerEntry, secondary: LedgerEntry) {
  if (secondary.syncedFromCloud || secondary.source === "cloud-sync") {
    return secondary.eventFingerprint ?? cloudEventFingerprint(secondary);
  }
  if (preferred.syncedFromCloud || preferred.source === "cloud-sync") {
    return preferred.eventFingerprint ?? cloudEventFingerprint(preferred);
  }
  return (
    preferred.eventFingerprint ??
    secondary.eventFingerprint ??
    cloudEventFingerprint(preferred) ??
    cloudEventFingerprint(secondary)
  );
}

function cloudMirrorDedupeKey(entry: Partial<LedgerEntry>) {
  if (!entry.createdAt) return undefined;
  const hasBreakdown =
    entry.inputTokens !== undefined ||
    entry.outputTokens !== undefined ||
    entry.cacheReadTokens !== undefined ||
    entry.cacheWriteTokens !== undefined;
  if (!hasBreakdown) return entry.eventFingerprint ?? cloudEventFingerprint(entry);
  return [
    "v1",
    mirrorSourceForEntry(entry),
    entry.createdAt,
    safeTokens(entry.inputTokens ?? 0),
    safeTokens(entry.outputTokens ?? 0),
    safeTokens(entry.cacheReadTokens ?? 0),
    safeTokens(entry.cacheWriteTokens ?? 0),
  ].join("|");
}

function mirrorSourceForEntry(entry: Partial<LedgerEntry>) {
  if (entry.source === "cloud-sync") return sourceFromEventId(entry.id) ?? "cloud-sync";
  return normalizeCloudEventSource(entry.source, entry.id);
}

function syncedAuthoritativeTokens(preferred: LedgerEntry, secondary: LedgerEntry) {
  if (secondary.syncedFromCloud || secondary.source === "cloud-sync") return safeTokens(secondary.tokens);
  if (preferred.syncedFromCloud || preferred.source === "cloud-sync") return safeTokens(preferred.tokens);
  return safeTokens(preferred.tokens);
}

function normalizeCloudEventSource(value: unknown, eventId?: unknown) {
  const source = typeof value === "string" ? value.trim() : "";
  if (source === "cloud-sync") return sourceFromEventId(eventId) ?? source;
  if (SAFE_CLOUD_EVENT_SOURCES.has(source)) return source;
  const inferred = sourceFromEventId(eventId);
  return inferred ?? "cloud-sync";
}

function sourceFromEventId(eventId: unknown) {
  if (typeof eventId !== "string") return undefined;
  const prefix = eventId.includes(":") ? eventId.slice(0, eventId.indexOf(":")) : "";
  return SAFE_CLOUD_EVENT_SOURCES.has(prefix) ? prefix : undefined;
}

function cloudEventFingerprint(entry: Partial<LedgerEntry>) {
  if (!entry.createdAt) return undefined;
  const source = normalizeCloudEventSource(entry.source, entry.id);
  return [
    "v1",
    source,
    entry.createdAt,
    safeTokens(entry.tokens ?? 0),
    safeTokens(entry.inputTokens ?? 0),
    safeTokens(entry.outputTokens ?? 0),
    safeTokens(entry.cacheReadTokens ?? 0),
    safeTokens(entry.cacheWriteTokens ?? 0),
  ].join("|");
}

const SAFE_CLOUD_EVENT_SOURCES = new Set([
  "manual",
  "codex-session",
  "claude-session",
  "openclaw-session",
  "pi-session",
  "opencode-session",
  "gemini-session",
  "hermes-session",
  "cloud-sync",
]);

function mergeRemoteAchievements(unlocked: AchievementUnlock[]) {
  const existing = new Set(achievementState.unlocked.map((item) => item.id));
  const merged = [...achievementState.unlocked];
  for (const item of unlocked) {
    if (existing.has(item.id)) continue;
    existing.add(item.id);
    merged.push(item);
  }
  const added = merged.length - achievementState.unlocked.length;
  if (!added) return 0;
  achievementState = normalizeAchievementState({
    ...achievementState,
    unlocked: merged,
  });
  writeAchievementState();
  broadcast("bonsai:achievements", achievementState, []);
  return added;
}

function broadcast(channel: string, ...args: unknown[]) {
  for (const window of [petWindow, managerWindow, menuBarWindow, achievementToastWindow]) {
    if (!window || window.isDestroyed()) continue;
    window.webContents.send(channel, ...args);
  }
}

function getUsageStatus(): UsageStatus {
  return {
    codexSession: codexSessionStatus,
    claudeSession: claudeSessionStatus,
    openclawSession: openclawSessionStatus,
    piSession: piSessionStatus,
    opencodeSession: opencodeSessionStatus,
    geminiSession: geminiSessionStatus,
    hermesSession: hermesSessionStatus,
  };
}

function startUpdateChecks() {
  if (updateCheckTimer) {
    clearTimeout(updateCheckTimer);
    updateCheckTimer = null;
  }
  if (!ledger.settings.updateCheckEnabled) {
    updateStatus = {
      ...updateStatus,
      checking: false,
      currentVersion: currentAppVersion(),
      canTerminalUpdate: canTerminalUpdate(),
    };
    broadcastUpdateStatus();
    refreshTrayMenu();
    return;
  }

  scheduleNextUpdateCheck();
}

function scheduleNextUpdateCheck() {
  if (updateCheckTimer) {
    clearTimeout(updateCheckTimer);
    updateCheckTimer = null;
  }
  if (!ledger.settings.updateCheckEnabled) return;

  updateCheckTimer = setTimeout(() => {
    void checkForUpdates({ remind: true }).finally(scheduleNextUpdateCheck);
  }, nextDailyDelay(ledger.settings.lastUpdateCheckedAt, UPDATE_CHECK_INTERVAL_MS, UPDATE_REMINDER_DELAY_MS));
}

async function checkForUpdates(options: { manual?: boolean; remind?: boolean; reopenTrayMenu?: boolean } = {}): Promise<UpdateStatus> {
  if (updateStatus.checking) return updateStatus;
  if (!options.manual && !ledger.settings.updateCheckEnabled) return updateStatus;

  updateStatus = {
    ...updateStatus,
    checking: true,
    canTerminalUpdate: canTerminalUpdate(),
    currentVersion: currentAppVersion(),
    error: undefined,
  };
  broadcastUpdateStatus();
  refreshTrayMenu();
  if (options.reopenTrayMenu) reopenTrayMenuSoon();

  try {
    const latest = await fetchLatestUpdate();
    const currentVersion = currentAppVersion();
    const available = compareVersions(latest.version, currentVersion) > 0;
    const checkedAt = new Date().toISOString();
    updateStatus = {
      ...updateStatus,
      checking: false,
      installing: false,
      available,
      canTerminalUpdate: canTerminalUpdate(),
      currentVersion,
      latestVersion: latest.version,
      releaseUrl: latest.releaseUrl,
      releaseNotes: latest.releaseNotes,
      checkedAt,
      error: undefined,
    };
    updateSettings({ lastUpdateCheckedAt: checkedAt });
    if (available && options.remind) {
      remindUpdateAvailable(updateStatus);
    }
  } catch (error) {
    const checkedAt = new Date().toISOString();
    updateStatus = {
      ...updateStatus,
      checking: false,
      available: false,
      canTerminalUpdate: canTerminalUpdate(),
      checkedAt,
      error: error instanceof Error ? error.message : mainText("updateCheckFailed"),
    };
    updateSettings({ lastUpdateCheckedAt: checkedAt });
  }

  broadcastUpdateStatus();
  refreshTrayMenu();
  if (options.manual) scheduleNextUpdateCheck();
  if (options.reopenTrayMenu) reopenTrayMenuSoon(80);
  return updateStatus;
}

function nextDailyDelay(lastRunAt: string | undefined, intervalMs: number, dueDelayMs: number) {
  if (!lastRunAt) return dueDelayMs;
  const lastRunTime = Date.parse(lastRunAt);
  if (!Number.isFinite(lastRunTime)) return dueDelayMs;
  const nextRunTime = lastRunTime + intervalMs;
  return Math.max(dueDelayMs, nextRunTime - Date.now());
}

async function fetchLatestUpdate() {
  try {
    const release = await fetchJson(UPDATE_LATEST_RELEASE_URL);
    const releaseVersion = normalizeVersion(
      typeof (release as { tag_name?: unknown })?.tag_name === "string" ? (release as { tag_name: string }).tag_name : "",
    );
    if (releaseVersion && isSemver(releaseVersion)) {
      const manifestEntry = await fetchUpdateManifestEntry(releaseVersion);
      const releaseUrl =
        manifestReleaseUrl(manifestEntry) ??
        (typeof (release as { html_url?: unknown })?.html_url === "string"
          ? (release as { html_url: string }).html_url
          : UPDATE_PAGE_URL);
      return {
        version: releaseVersion,
        releaseUrl,
        releaseNotes: updateNoticeFromManifest(manifestEntry) ?? normalizeReleaseNotes((release as { body?: unknown })?.body),
      };
    }
  } catch {
    // Older repos or temporary API issues can still fall back to tags.
  }

  const tags = await fetchJson(UPDATE_TAGS_URL);
  if (!Array.isArray(tags)) throw new Error(mainText("updateSourceBadShape"));
  const versions = tags
    .map((tag) => {
      const name = typeof (tag as { name?: unknown }).name === "string" ? (tag as { name: string }).name : "";
      const version = normalizeVersion(name);
      return version && isSemver(version) ? { name, version } : null;
    })
    .filter((item): item is { name: string; version: string } => Boolean(item))
    .sort((a, b) => compareVersions(b.version, a.version));

  const latest = versions[0];
  if (!latest) throw new Error(mainText("updateSourceNoVersion"));
  const manifestEntry = await fetchUpdateManifestEntry(latest.version);
  return {
    version: latest.version,
    releaseUrl: manifestReleaseUrl(manifestEntry) ?? UPDATE_PAGE_URL,
    releaseNotes: updateNoticeFromManifest(manifestEntry) ?? releaseNotesFromChangelog(latest.version),
  };
}

type UpdateManifestEntry = Record<string, unknown>;

async function fetchUpdateManifestEntry(version: string): Promise<UpdateManifestEntry | undefined> {
  const remoteEntry = await fetchRemoteUpdateManifestEntry(version);
  return remoteEntry ?? readLocalUpdateManifestEntry(version);
}

async function fetchRemoteUpdateManifestEntry(version: string): Promise<UpdateManifestEntry | undefined> {
  if (!UPDATE_MANIFEST_URL) return undefined;
  try {
    const manifest = await fetchJson(UPDATE_MANIFEST_URL);
    return updateManifestEntryFromManifest(manifest, version);
  } catch {
    return undefined;
  }
}

function readLocalUpdateManifestEntry(version: string): UpdateManifestEntry | undefined {
  for (const path of localUpdateManifestCandidates()) {
    const manifest = readJsonFile<Record<string, unknown>>(path);
    const entry = updateManifestEntryFromManifest(manifest, version);
    if (entry) return entry;
  }
  return undefined;
}

function localUpdateManifestCandidates() {
  const candidates = [
    join(terminalUpdateRoot() ?? "", "updates/manifest.json"),
    join(process.cwd(), "updates/manifest.json"),
    join(__dirname, "../../updates/manifest.json"),
    join(app.getAppPath(), "updates/manifest.json"),
    join(process.resourcesPath, "updates/manifest.json"),
  ].filter(Boolean);
  return [...new Set(candidates)];
}

function updateManifestEntryFromManifest(manifest: unknown, version: string): UpdateManifestEntry | undefined {
  const versions = Array.isArray((manifest as { versions?: unknown })?.versions)
    ? (manifest as { versions: unknown[] }).versions
    : [];
  return versions.find((entry): entry is UpdateManifestEntry => {
    if (!entry || typeof entry !== "object") return false;
    const rawVersion = (entry as { version?: unknown }).version;
    return typeof rawVersion === "string" && normalizeVersion(rawVersion) === version;
  });
}

function manifestReleaseUrl(entry: UpdateManifestEntry | undefined) {
  const url = typeof entry?.fullReleaseUrl === "string" ? entry.fullReleaseUrl.trim() : "";
  return /^https?:\/\//.test(url) ? url : undefined;
}

function updateNoticeFromManifest(entry: UpdateManifestEntry | undefined) {
  if (!entry) return undefined;
  const language = currentLanguage();
  const labels =
    language === "zh-CN"
      ? {
          highlights: "主要变化",
          fixes: "体验改进",
          privacy: "隐私说明",
          upgradeNotes: "升级说明",
        }
      : {
          highlights: "Highlights",
          fixes: "Improvements",
          privacy: "Privacy",
          upgradeNotes: "Upgrade Notes",
        };
  const lines: string[] = [];
  const title = localizedManifestString(entry.title, language);
  const summary = localizedManifestString(entry.summary, language);
  if (title) lines.push(title, "");
  if (summary) lines.push(summary, "");
  appendManifestSection(lines, labels.highlights, localizedManifestList(entry.highlights, language));
  appendManifestSection(lines, labels.fixes, localizedManifestList(entry.fixes, language));
  appendManifestSection(lines, labels.privacy, localizedManifestList(entry.privacy, language));
  appendManifestSection(lines, labels.upgradeNotes, localizedManifestList(entry.upgradeNotes, language));
  return normalizeReleaseNotes(lines.join("\n"));
}

function appendManifestSection(lines: string[], title: string, items: string[] | undefined) {
  if (!items?.length) return;
  if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  lines.push(title);
  for (const item of items) lines.push(`- ${item}`);
  lines.push("");
}

function localizedManifestString(value: unknown, language: AppLanguage) {
  if (typeof value === "string") return cleanManifestText(value);
  if (!value || typeof value !== "object") return undefined;
  const localized = value as Record<string, unknown>;
  return cleanManifestText(localized[language] ?? localized["zh-CN"] ?? localized["en-US"]);
}

function localizedManifestList(value: unknown, language: AppLanguage) {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? ((value as Record<string, unknown>)[language] ??
        (value as Record<string, unknown>)["zh-CN"] ??
        (value as Record<string, unknown>)["en-US"])
      : undefined;
  if (!Array.isArray(raw)) return undefined;
  const items = raw.map(cleanManifestText).filter((item): item is string => Boolean(item));
  return items.length ? items : undefined;
}

function cleanManifestText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 280) : undefined;
}

function normalizeReleaseNotes(value: unknown) {
  if (typeof value !== "string") return undefined;
  const notes = value
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return notes ? notes.slice(0, 8_000) : undefined;
}

function releaseNotesFromChangelog(version: string) {
  try {
    const changelog = readFileSync(join(terminalUpdateRoot() ?? process.cwd(), "CHANGELOG.md"), "utf8");
    const lines = changelog.split(/\r?\n/);
    const start = lines.findIndex((line) => /^##\s+/.test(line) && line.includes(`v${version}`));
    if (start < 0) return undefined;
    const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
    return normalizeReleaseNotes(lines.slice(start + 1, end > start ? end : undefined).join("\n"));
  } catch {
    return undefined;
  }
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          "User-Agent": `${APP_NAME} Update Checker`,
        },
        timeout: 8_000,
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          fetchJson(new URL(response.headers.location, url).toString()).then(resolve, reject);
          return;
        }

        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error(`${mainText("updateSourceRequestFailed")} (${response.statusCode ?? "unknown"})`));
          return;
        }

        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
          if (raw.length > 512_000) {
            request.destroy(new Error(mainText("updateSourceTooLarge")));
          }
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(mainText("updateSourceParseFailed")));
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error(mainText("updateSourceTimeout"))));
    request.on("error", reject);
  });
}

async function requestJsonWithElectronNet<T = unknown>(
  urlString: string,
  options: LeaderboardRequestJsonOptions = {},
): Promise<T> {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), options.timeoutMs ?? 10_000);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": `${APP_NAME}/${currentAppVersion()}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Awaited<ReturnType<typeof net.fetch>>;
  try {
    response = await net.fetch(urlString, {
      method,
      headers,
      body,
      signal: abort.signal,
    });
  } catch (error) {
    throw normalizeLeaderboardRequestError(error);
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let parsed: unknown = {};
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(mainText("leaderboardResponseParseFailed"));
    }
  }

  if (!response.ok) {
    const message =
      typeof (parsed as { error?: unknown })?.error === "string"
        ? (parsed as { error: string }).error
        : `${mainText("leaderboardRequestFailed")} (${response.status})`;
    throw new Error(message);
  }

  return parsed as T;
}

function normalizeLeaderboardRequestError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout|timed out|ERR_CONNECTION_TIMED_OUT/i.test(message)) {
    return new Error(mainText("leaderboardRequestTimedOut"));
  }
  return new Error(message || mainText("leaderboardRequestFailed"));
}

async function installUpdate(): Promise<UpdateStatus> {
  if (updateStatus.installing) return updateStatus;
  const cwd = terminalUpdateRoot();

  if (!cwd) {
    updateStatus = {
      ...updateStatus,
      canTerminalUpdate: false,
      installError: mainText("terminalUpdateUnavailable"),
    };
    broadcastUpdateStatus();
    return updateStatus;
  }

  updateStatus = {
    ...updateStatus,
    installing: true,
    canTerminalUpdate: true,
    installError: undefined,
    installLog: mainText("preparingTerminalUpdate"),
    needsRestart: false,
  };
  broadcastUpdateStatus();
  refreshTrayMenu();

  try {
    const dirty = (await runTerminalCommand("git", ["status", "--porcelain", "--untracked-files=no"], cwd, { timeoutMs: 15_000 })).trim();
    if (dirty) {
      throw new Error(mainText("dirtyWorkspace"));
    }

    await runUpdateStep(mainText("fetchUpdates"), "git", ["fetch", "--tags", "--prune", "origin"], cwd, UPDATE_GIT_TIMEOUT_MS);
    await runUpdateStep(mainText("pullMain"), "git", ["pull", "--ff-only", "origin", "main"], cwd, UPDATE_GIT_TIMEOUT_MS);
    await syncUpdateDependencies(cwd);
    await runUpdateStep(mainText("buildApp"), npmCommand(), ["run", "build"], cwd, UPDATE_BUILD_TIMEOUT_MS);
    await runUpdateStep(mainText("verifyUpdate"), npmCommand(), ["run", "smoke:electron"], cwd, UPDATE_SMOKE_TIMEOUT_MS);

    const installedVersion = currentAppVersion();
    const installedAt = new Date().toISOString();

    updateStatus = {
      ...updateStatus,
      installing: false,
      available: false,
      currentVersion: installedVersion,
      checkedAt: new Date().toISOString(),
      installedAt,
      installLog: mainText("updateDone"),
      installError: undefined,
      needsRestart: true,
    };
    scheduleUpdateRelaunch();
  } catch (error) {
    updateStatus = {
      ...updateStatus,
      installing: false,
      installError: error instanceof Error ? error.message : mainText("terminalUpdateFailed"),
      installLog: mainText("updateIncomplete"),
    };
  }

  broadcastUpdateStatus();
  refreshTrayMenu();
  return updateStatus;
}

function scheduleUpdateRelaunch() {
  setTimeout(() => {
    app.relaunch({ args: process.argv.slice(1), execPath: process.execPath });
    app.exit(0);
  }, UPDATE_RELAUNCH_DELAY_MS);
}

async function syncUpdateDependencies(cwd: string) {
  cleanupNpmInstallArtifacts(cwd);
  try {
    await runUpdateStep(mainText("syncDependencies"), npmCommand(), ["install"], cwd, UPDATE_NPM_INSTALL_TIMEOUT_MS);
  } catch (error) {
    if (!isRecoverableNpmInstallError(error)) throw error;
    cleanupNpmInstallArtifacts(cwd);
    await runUpdateStep(mainText("syncDependenciesRetry"), npmCommand(), ["install"], cwd, UPDATE_NPM_INSTALL_TIMEOUT_MS);
  }
}

function cleanupNpmInstallArtifacts(cwd: string) {
  const nodeModulesDir = join(cwd, "node_modules");
  if (!existsSync(nodeModulesDir)) return;

  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".node_modules-")) {
      rmSync(join(nodeModulesDir, entry.name), { recursive: true, force: true });
    }
  }

  rmSync(join(nodeModulesDir, "node_modules"), { recursive: true, force: true });
}

function isRecoverableNpmInstallError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /ENOTEMPTY|EEXIST|node_modules[\\/]\.node_modules-|node_modules[\\/]node_modules/i.test(message);
}

async function runUpdateStep(label: string, command: string, args: string[], cwd: string, timeoutMs?: number) {
  updateStatus = {
    ...updateStatus,
    installLog: label,
  };
  broadcastUpdateStatus();
  await runTerminalCommand(command, args, cwd, { timeoutMs });
}

function runTerminalCommand(
  command: string,
  args: string[],
  cwd: string,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, cwd);
    let output = "";
    let timedOut = false;
    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            terminateChildProcess(child);
          }, options.timeoutMs)
        : undefined;
    const collect = (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-12_000);
    };

    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `${command} ${args.join(" ")} ${mainText("commandTimedOut")}${output ? `\n${output.trim()}` : ""}`,
          ),
        );
        return;
      }
      if (code === 0) {
        resolve(output.trim());
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} ${mainText("commandFailed")} (${code ?? "unknown"})${output ? `\n${output.trim()}` : ""}`));
    });
  });
}

function spawnCommand(command: string, args: string[], cwd: string) {
  const env = terminalCommandEnv();
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", [command, ...args].map(quoteWindowsCmdArg).join(" ")], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    });
  }
  return spawn(command, args, {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
  });
}

function terminalCommandEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const proxyUrl = ledger.settings.proxyUrl?.trim();
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    env.ALL_PROXY = proxyUrl;
    env.http_proxy = proxyUrl;
    env.https_proxy = proxyUrl;
    env.all_proxy = proxyUrl;
  }

  env.NO_PROXY ??= "localhost,127.0.0.1,::1";
  env.no_proxy ??= env.NO_PROXY;
  env.ELECTRON_MIRROR ??= DEFAULT_ELECTRON_MIRROR;
  env.npm_config_electron_mirror ??= env.ELECTRON_MIRROR;
  return env;
}

function terminateChildProcess(child: ReturnType<typeof spawn>) {
  if (child.killed) return;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }

  if (child.pid) {
    const pid = child.pid;
    try {
      process.kill(-pid, "SIGTERM");
      setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // The process group already exited.
        }
      }, 2_000).unref();
      return;
    } catch {
      // Fall back to killing the direct child below.
    }
  }

  child.kill("SIGTERM");
}

function quoteWindowsCmdArg(value: string) {
  if (!/[()\s"%^&|<>]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function remindUpdateAvailable(status: UpdateStatus) {
  if (!status.latestVersion || ledger.settings.lastUpdateReminderVersion === status.latestVersion) return;
  updateSettings({ lastUpdateReminderVersion: status.latestVersion });
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: mainText("updateNotificationTitle"),
    body:
      currentLanguage() === "zh-CN"
        ? `v${status.latestVersion} ${mainText("updateNotificationBody")} v${status.currentVersion}`
        : `v${status.latestVersion} ${mainText("updateNotificationBody")} v${status.currentVersion}`,
    silent: false,
  });
  notification.on("click", () => {
    void openUpdatePage(status.releaseUrl);
  });
  notification.show();
}

async function openUpdatePage(url = updateStatus.releaseUrl ?? UPDATE_PAGE_URL) {
  await shell.openExternal(url);
}

function broadcastUpdateStatus() {
  broadcast("bonsai:update-status", updateStatus);
}

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "");
}

function isSemver(version: string) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersion(left).split(/[-+]/)[0].split(".").map((part) => Number(part));
  const rightParts = normalizeVersion(right).split(/[-+]/)[0].split(".").map((part) => Number(part));
  for (let index = 0; index < 3; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function startUsageWatchers() {
  stopUsageWatchers();
  if (!ledger.settings.treeStartMode) {
    broadcast("bonsai:usage-status", getUsageStatus());
    return;
  }

  const common = {
    userDataPath: app.getPath("userData"),
    historyStartAt: ledger.installedAt,
  };

  codexSessionWatcher = startCodexSessionWatcher({
    ...common,
    sessionsRoot: ledger.settings.codexSessionsDir,
    onUsage: appendUsageEvent,
    onStatus: (status) => {
      codexSessionStatus = status;
      refreshTrayMenu();
      broadcast("bonsai:usage-status", getUsageStatus());
    },
  });
  claudeSessionWatcher = startClaudeSessionWatcher({
    ...common,
    sessionsRoot: ledger.settings.claudeSessionsDir,
    onUsage: appendUsageEvent,
    onStatus: (status) => {
      claudeSessionStatus = status;
      refreshTrayMenu();
      broadcast("bonsai:usage-status", getUsageStatus());
    },
  });
  openclawSessionWatcher = startOpenClawSessionWatcher({
    ...common,
    sessionsRoot: ledger.settings.openclawSessionsDir,
    onUsage: appendUsageEvent,
    onStatus: (status) => {
      openclawSessionStatus = status;
      refreshTrayMenu();
      broadcast("bonsai:usage-status", getUsageStatus());
    },
  });
  piSessionWatcher = startPiSessionWatcher({
    ...common,
    sessionsRoot: ledger.settings.piSessionsDir,
    onUsage: appendUsageEvent,
    onStatus: (status) => {
      piSessionStatus = status;
      refreshTrayMenu();
      broadcast("bonsai:usage-status", getUsageStatus());
    },
  });
  opencodeSessionWatcher = startOpenCodeSessionWatcher({
    ...common,
    sessionsRoot: ledger.settings.opencodeSessionsDir,
    onUsage: appendUsageEvent,
    onStatus: (status) => {
      opencodeSessionStatus = status;
      refreshTrayMenu();
      broadcast("bonsai:usage-status", getUsageStatus());
    },
  });
  geminiSessionWatcher = startGeminiSessionWatcher({
    ...common,
    sessionsRoot: ledger.settings.geminiSessionsDir,
    onUsage: appendUsageEvent,
    onStatus: (status) => {
      geminiSessionStatus = status;
      refreshTrayMenu();
      broadcast("bonsai:usage-status", getUsageStatus());
    },
  });
  hermesSessionWatcher = startHermesSessionWatcher({
    ...common,
    sessionsRoot: ledger.settings.hermesSessionsDir,
    onUsage: appendUsageEvent,
    onStatus: (status) => {
      hermesSessionStatus = status;
      refreshTrayMenu();
      broadcast("bonsai:usage-status", getUsageStatus());
    },
  });
}

function stopUsageWatchers() {
  codexSessionWatcher?.close();
  claudeSessionWatcher?.close();
  openclawSessionWatcher?.close();
  piSessionWatcher?.close();
  opencodeSessionWatcher?.close();
  geminiSessionWatcher?.close();
  hermesSessionWatcher?.close();
  codexSessionWatcher = null;
  claudeSessionWatcher = null;
  openclawSessionWatcher = null;
  piSessionWatcher = null;
  opencodeSessionWatcher = null;
  geminiSessionWatcher = null;
  hermesSessionWatcher = null;
}

function restartUsageWatchers() {
  if (!app.isReady()) return;
  startUsageWatchers();
}

function applyLoginItemSettings() {
  if (!app.isReady()) return;
  if (!ledger.settings.launchOnStartup) {
    app.setLoginItemSettings({ openAtLogin: false });
    return;
  }
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: false,
    path: process.execPath,
    args: loginItemArgs(),
  });
}

function loginItemArgs() {
  if (app.isPackaged) return [];
  const entry = process.argv.find((arg, index) => index > 0 && /dist[\\/]electron[\\/]main\.js$/.test(arg));
  return entry ? [entry] : [];
}

app.whenReady().then(async () => {
  app.setName(APP_NAME);
  app.setAppUserModelId(APP_ID);
  if (process.platform === "darwin") {
    app.setActivationPolicy("regular");
    app.dock?.show();
    const dockIcon = createAppIcon();
    if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon);
  }
  if (SMOKE_TEST) {
    app.quit();
    return;
  }
  Menu.setApplicationMenu(null);
  ledger = readLedger();
  updateStatus = {
    ...updateStatus,
    currentVersion: currentAppVersion(),
  };
  await configureNetworkProxy(ledger.settings.proxyUrl);
  achievementState = readAchievementState();
  leaderboardService.readAuth();
  applyLoginItemSettings();
  createPetWindow();
  if (!ledger.settings.silentStartup) {
    createManagerWindow();
  }
  createTray();
  setTimeout(startUsageWatchers, 500);
  startUpdateChecks();
  leaderboardService.startSync();

  app.on("activate", () => {
    createPetWindow();
    showManager();
  });
});

app.on("window-all-closed", () => {
  // Keep the pet and tray process alive until the user exits from the tray menu.
});

app.on("before-quit", () => {
  stopUsageWatchers();
  if (updateCheckTimer) clearTimeout(updateCheckTimer);
  leaderboardService.stop();
});

ipcMain.handle("ledger:get", () => ledger);
ipcMain.handle("usage:get-status", getUsageStatus);
ipcMain.handle("updates:get-status", () => updateStatus);
ipcMain.handle("updates:check", () => checkForUpdates({ manual: true }));
ipcMain.handle("updates:install", () => installUpdate());
ipcMain.handle("updates:open", (_event, url?: string) => openUpdatePage(typeof url === "string" ? url : undefined));
ipcMain.handle("leaderboard:get-status", () => leaderboardService.status());
ipcMain.handle("leaderboard:login", () => leaderboardService.login());
ipcMain.handle("leaderboard:logout", () => leaderboardService.logout());
ipcMain.handle("leaderboard:set-enabled", (_event, enabled: boolean) => leaderboardService.setEnabled(Boolean(enabled)));
ipcMain.handle("leaderboard:sync", (_event, options?: { force?: boolean }) =>
  leaderboardService.syncUsage({ force: options?.force === true }),
);
ipcMain.handle("leaderboard:get", (_event, range?: unknown) => leaderboardService.getLeaderboard(range));
ipcMain.handle("leaderboard:get-all", () => leaderboardService.getLeaderboards());
// A renderer that just fetched fresh leaderboard data publishes it so the
// other window (menu bar popover ↔ dashboard) updates without its own fetch.
ipcMain.on("leaderboard:publish", (event, collection: LeaderboardCollection) => {
  if (!collection || typeof collection !== "object" || !collection.ranges) return;
  for (const window of [petWindow, managerWindow, menuBarWindow]) {
    if (!window || window.isDestroyed()) continue;
    if (window.webContents === event.sender) continue;
    window.webContents.send("bonsai:leaderboard-data", collection);
  }
});
ipcMain.handle("social:friends", () => leaderboardService.getSocialFriends());
ipcMain.handle("social:request-friend", (_event, input) => leaderboardService.requestSocialFriend(input));
ipcMain.handle("social:accept-friend", (_event, userId: string) => leaderboardService.acceptSocialFriend(userId));
ipcMain.handle("social:remove-friend", (_event, userId: string) => leaderboardService.removeSocialFriend(userId));
ipcMain.handle("social:groups", () => leaderboardService.getSocialGroups());
ipcMain.handle("social:create-group", (_event, input) => leaderboardService.createSocialGroup(input));
ipcMain.handle("social:create-invite", (_event, groupId: string, input) =>
  leaderboardService.createSocialGroupInvite(groupId, input),
);
ipcMain.handle("social:create-friend-invite", (_event, groupId: string, input) =>
  leaderboardService.createSocialGroupFriendInvite(groupId, input),
);
ipcMain.handle("social:request-group-join", (_event, code: string) => leaderboardService.requestSocialGroupJoin(code));
ipcMain.handle("social:group-requests:mine", () => leaderboardService.getMySocialGroupRequests());
ipcMain.handle("social:group-requests:accept", (_event, requestId: string) =>
  leaderboardService.acceptSocialGroupFriendInvite(requestId),
);
ipcMain.handle("social:group-requests:decline", (_event, requestId: string) =>
  leaderboardService.declineSocialGroupFriendInvite(requestId),
);
ipcMain.handle("social:group-requests", (_event, groupId: string) => leaderboardService.getSocialGroupRequests(groupId));
ipcMain.handle("social:group-requests:approve", (_event, groupId: string, requestId: string) =>
  leaderboardService.approveSocialGroupRequest(groupId, requestId),
);
ipcMain.handle("social:group-requests:moderation-decline", (_event, groupId: string, requestId: string) =>
  leaderboardService.declineSocialGroupRequest(groupId, requestId),
);
ipcMain.handle("social:leave-group", (_event, groupId: string) => leaderboardService.leaveSocialGroup(groupId));
ipcMain.handle("social:set-group-share-usage", (_event, groupId: string, shareUsage: boolean) =>
  leaderboardService.setSocialGroupShareUsage(groupId, Boolean(shareUsage)),
);
ipcMain.handle("social:get-profile", (_event, userId: string) => leaderboardService.getSocialProfile(userId));
ipcMain.handle("social:get-profile-privacy", () => leaderboardService.getSocialProfilePrivacy());
ipcMain.handle("social:update-profile-privacy", (_event, input) =>
  leaderboardService.updateSocialProfilePrivacy(input),
);
ipcMain.handle("social:group-leaderboard", (_event, groupId: string, range?: unknown, basis?: unknown) =>
  leaderboardService.getSocialGroupLeaderboard(groupId, range, basis),
);
ipcMain.handle("cloud-sync:get-status", (): CloudSyncStatus => leaderboardService.cloudStatus());
ipcMain.handle("cloud-sync:start-new", () => {
  setTreeStartMode("new");
  startUsageWatchers();
  return leaderboardService.cloudStatus();
});
ipcMain.handle("cloud-sync:enable", () => leaderboardService.enableCloudSync());
ipcMain.handle("cloud-sync:join-existing", async () => {
  const status = await leaderboardService.joinCloudTree();
  if (!status.error) {
    setTreeStartMode("cloud");
    startUsageWatchers();
  }
  return status;
});
ipcMain.handle("cloud-sync:cancel-auth", () => leaderboardService.cancelAuth());
ipcMain.handle("cloud-sync:sync", () => leaderboardService.syncCloudTree({ force: true }));
ipcMain.handle("achievements:get", () => achievementState);
ipcMain.handle("achievements:unlock", (_event, items: Array<{ id: string; trigger?: Record<string, unknown> }>) =>
  unlockAchievements(Array.isArray(items) ? items : []),
);
ipcMain.handle("achievements:preview-toast", (_event, id: string) => {
  if (typeof id !== "string") return false;
  showAchievementToastOverlay([id]);
  return true;
});
ipcMain.handle("achievements:update-stats", (_event, stats: Record<string, unknown>) => {
  if (!stats || typeof stats !== "object") return achievementState;
  achievementState = normalizeAchievementState({
    ...achievementState,
    stats: { ...(achievementState.stats ?? {}), ...stats },
  });
  writeAchievementState();
  return achievementState;
});
ipcMain.handle(
  "achievements:reconcile",
  (_event, input: { version?: unknown; unlockedIds?: unknown; stats?: Record<string, unknown> }) =>
    reconcileAchievementState(input),
);
ipcMain.handle(
  "share:save-image",
  async (_event, input: { filename?: unknown; pngBase64?: unknown }) => {
    const pngBase64 = typeof input?.pngBase64 === "string" ? input.pngBase64 : "";
    if (!pngBase64) throw new Error("Missing share image data");

    const pngBuffer = Buffer.from(pngBase64, "base64");
    if (!pngBuffer.length) throw new Error("Empty share image");

    const filename = sanitizeShareImageFilename(input?.filename);
    const parent = managerWindow && !managerWindow.isDestroyed() ? managerWindow : undefined;
    const options = {
      title: "保存分享图",
      defaultPath: join(app.getPath("pictures"), filename),
      filters: [{ name: "PNG Image", extensions: ["png"] }],
    };
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };

    writeFileSync(result.filePath, pngBuffer);
    return { canceled: false, filePath: result.filePath };
  },
);
ipcMain.handle("window:show-manager", () => {
  showManager();
});
ipcMain.handle("window:open-settings", () => {
  openManagerSettings();
});
ipcMain.handle("window:open-menubar-settings", () => {
  openManagerSettings("menubar");
});
ipcMain.handle("window:open-manager-tab", (_event, tab: unknown) => {
  if (tab !== "home" && tab !== "achievements" && tab !== "leaderboard") return;
  openManagerTab(tab);
});
ipcMain.handle("menubar:toggle-popover", () => {
  toggleMenuBarPopover();
});
ipcMain.handle("menubar:hide-popover", () => {
  hideMenuBarPopover();
});

ipcMain.on("achievements:toast-ready", (event) => {
  if (!achievementToastWindow || achievementToastWindow.isDestroyed()) return;
  if (event.sender !== achievementToastWindow.webContents) return;
  achievementToastRendererReady = true;
  flushAchievementToastOverlay();
});

ipcMain.on("achievements:toast-drained", (event) => {
  if (!achievementToastWindow || achievementToastWindow.isDestroyed()) return;
  if (event.sender !== achievementToastWindow.webContents) return;
  if (achievementToastPendingItems.length) {
    flushAchievementToastOverlay();
    return;
  }
  scheduleAchievementToastDrainedHide();
});

ipcMain.on("level:toast", (_event, input: { from?: unknown; to?: unknown }) => {
  showLevelToastOverlay(input);
});

ipcMain.handle("ledger:add-entry", (_event, input: { tokens: number; note?: string }) => {
  const tokens = Math.max(0, Math.round(Number(input.tokens)));
  if (!tokens) return ledger;

  const entry: LedgerEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: "manual",
    tokens,
    note: input.note?.trim() || undefined,
  };
  ledger.entries.unshift(entry);
  appendUsageEntryToStore(entry);
  broadcast("bonsai:ledger", ledger);
  refreshTrayMenu();
  return ledger;
});

ipcMain.handle("settings:update", (_event, partial: Partial<Settings>) => {
  updateSettings(partial);
  return ledger;
});

ipcMain.on("manager:ready", (event) => {
  if (event.sender !== managerWindow?.webContents) return;
  managerRendererReady = true;
  flushManagerCommands();
});

ipcMain.handle("window:set-expanded", (_event, expanded: boolean) => {
  if (expanded) showManager();
  return expanded;
});

ipcMain.handle("window:get-bounds", (): WindowBounds | null => {
  if (!petWindow) return null;
  return petWindow.getBounds();
});

ipcMain.handle("window:set-position", (_event, position: { x: number; y: number }) => {
  if (!petWindow || ledger.settings.locked) return;
  setPetBounds(position);
});

ipcMain.handle("window:persist-position", () => {
  persistPetPosition();
});
