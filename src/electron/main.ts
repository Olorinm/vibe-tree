import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, Notification, screen, shell, Tray } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import * as https from "node:https";
import { dirname, join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import type {
  AchievementState,
  AchievementUnlock,
  AchievementUnlockResult,
  AppLanguage,
  LedgerEntry,
  LedgerFile,
  LeaderboardProfile,
  Settings,
  UpdateStatus,
  UsageEvent,
  UsageStatus,
  WindowBounds,
} from "../shared/types.js";
import { startClaudeSessionWatcher, startOpenClawSessionWatcher, startOpenCodeSessionWatcher } from "./agentSessionWatchers.js";
import { startCodexSessionWatcher } from "./codexSessionWatcher.js";
import { MAIN_TEXT, WEATHER_LABELS } from "./i18n.js";
import type { WeatherId } from "./i18n.js";
import { createLeaderboardService } from "./leaderboard.js";
import type { LeaderboardRequestJsonOptions } from "./leaderboard.js";
import { countedTokensForEntry } from "../shared/tokenAccounting.js";

const PET_BASE = { width: 192, height: 208 };
const PET_STAGE_OFFSET = { x: 28, y: 0 };
const ACHIEVEMENT_TOAST_SIZE = { width: 236, height: 104 };
const ACHIEVEMENT_TOAST_OVERLAP_PER_SCALE = 48;
const ACHIEVEMENT_TOAST_DOWN_OFFSET_PER_SCALE = 18;
const ACHIEVEMENT_TOAST_DURATION_MS = 5_000;
const ACHIEVEMENT_TOAST_WINDOW_PADDING_MS = 600;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_REMINDER_DELAY_MS = 3_000;
const UPDATE_RELAUNCH_DELAY_MS = 1_200;
const UPDATE_LATEST_RELEASE_URL = "https://api.github.com/repos/Olorinm/vibe-tree/releases/latest";
const UPDATE_TAGS_URL = "https://api.github.com/repos/Olorinm/vibe-tree/tags?per_page=20";
const UPDATE_PAGE_URL = "https://github.com/Olorinm/vibe-tree/releases";
const DEFAULT_LEADERBOARD_API_URL = "https://vibe-tree-leaderboard.melanthascherffmugutubu.workers.dev";
const LEADERBOARD_API_URL = (process.env.VIBE_TREE_LEADERBOARD_API_URL ?? DEFAULT_LEADERBOARD_API_URL).replace(/\/+$/, "");
const LEADERBOARD_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const LEADERBOARD_AUTH_TIMEOUT_MS = 2 * 60 * 1000;
const LEADERBOARD_CALLBACK_PATH = "/leaderboard/auth/callback";
const MAC_TRAY_ICON_SIZE = 18;
const MANAGER_SIZE = { width: 1120, height: 760 };
const MANAGER_MIN_SIZE = { width: 860, height: 620 };
const APP_NAME = "Vibe Tree";
const APP_ID = "com.vibetree.app";
const APP_ICON_PATHS = [
  join(__dirname, "../renderer/assets/app-icon.png"),
  join(__dirname, "../renderer/assets/app-icon.ico"),
  join(__dirname, "../../public/assets/app-icon.png"),
  join(__dirname, "../../public/assets/app-icon.ico"),
];

const DEFAULT_SETTINGS: Settings = {
  locked: false,
  alwaysOnTop: true,
  language: "zh-CN",
  scale: 0.5,
  badgeFrontMetric: "level",
  badgeBackMetric: "total",
  totalDisplayUnit: "m",
  updateCheckEnabled: true,
  leaderboardEnabled: false,
  leaderboardProfile: undefined,
  leaderboardLastSyncedAt: undefined,
  launchOnStartup: false,
  silentStartup: false,
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
let achievementToastWindow: BrowserWindow | null = null;
let achievementToastHideTimer: ReturnType<typeof setTimeout> | null = null;
let achievementToastFallbackHideAt = 0;
let achievementToastRendererReady = false;
let achievementToastPendingIds: string[] = [];
let updateCheckTimer: ReturnType<typeof setInterval> | null = null;
let updateStatus: UpdateStatus = {
  checking: false,
  installing: false,
  available: false,
  canTerminalUpdate: canTerminalUpdate(),
  currentVersion: currentAppVersion(),
};
let tray: Tray | null = null;
let ledger: LedgerFile = { entries: [], settings: DEFAULT_SETTINGS, installedAt: startOfLocalDayIso(new Date()) };
let achievementState: AchievementState = { unlocked: [] };
let codexSessionWatcher: ReturnType<typeof startCodexSessionWatcher> | null = null;
let claudeSessionWatcher: ReturnType<typeof startClaudeSessionWatcher> | null = null;
let openclawSessionWatcher: ReturnType<typeof startOpenClawSessionWatcher> | null = null;
let opencodeSessionWatcher: ReturnType<typeof startOpenCodeSessionWatcher> | null = null;
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
let opencodeSessionStatus: UsageStatus["opencodeSession"] = {
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
  authTimeoutMs: LEADERBOARD_AUTH_TIMEOUT_MS,
  callbackPath: LEADERBOARD_CALLBACK_PATH,
  authPath: leaderboardAuthPath,
  getLedger: () => ledger,
  updateSettings,
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

function readLedger(): LedgerFile {
  const legacy = readLegacyLedger();
  const installedAt = readInstalledAt(legacy);
  const settings = readDeviceSettings(legacy?.settings);
  let entries = readUsageEntries();

  if (!entries.length && legacy?.entries?.length) {
    entries = legacy.entries.filter(isEntry);
    for (const entry of entries.slice().reverse()) {
      appendUsageEntryToStore(entry);
    }
  }

  return {
    entries: entries.filter((entry) => entryTime(entry) >= Date.parse(installedAt)),
    settings,
    installedAt,
  };
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

function readDeviceSettings(legacySettings: Partial<Settings> | undefined): Settings {
  const stored = readJsonFile<Partial<Settings>>(deviceSettingsPath());
  const language = normalizeLanguage(stored?.language ?? legacySettings?.language ?? detectSystemLanguage());
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    language,
    ...(legacySettings ?? {}),
    ...(stored ?? {}),
  });
  if (!stored || stored.language === undefined) {
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

function normalizeSettings(settings: Partial<Settings>): Settings {
  const scale = typeof settings.scale === "number" && [0.5, 1, 1.5, 2].includes(settings.scale) ? settings.scale : 0.5;
  const leaderboardProfile = normalizeLeaderboardProfile(settings.leaderboardProfile);
  const leaderboardLastSyncedAt =
    typeof settings.leaderboardLastSyncedAt === "string" && Number.isFinite(Date.parse(settings.leaderboardLastSyncedAt))
      ? settings.leaderboardLastSyncedAt
      : undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    locked: Boolean(settings.locked),
    alwaysOnTop: settings.alwaysOnTop !== false,
    language: normalizeLanguage(settings.language),
    updateCheckEnabled: settings.updateCheckEnabled !== false,
    lastUpdateReminderVersion:
      typeof settings.lastUpdateReminderVersion === "string" ? settings.lastUpdateReminderVersion : undefined,
    leaderboardEnabled: Boolean(settings.leaderboardEnabled && leaderboardProfile),
    leaderboardProfile,
    leaderboardLastSyncedAt,
    launchOnStartup: Boolean(settings.launchOnStartup),
    silentStartup: Boolean(settings.silentStartup),
    scale,
    badgeFrontMetric: normalizeBadgeMetric(settings.badgeFrontMetric, "level"),
    badgeBackMetric: normalizeBadgeMetric(settings.badgeBackMetric, "total"),
    totalDisplayUnit: normalizeTotalDisplayUnit(settings.totalDisplayUnit),
    codexSessionsDir: cleanPath(settings.codexSessionsDir),
    claudeSessionsDir: cleanPath(settings.claudeSessionsDir),
    openclawSessionsDir: cleanPath(settings.openclawSessionsDir),
    opencodeSessionsDir: cleanPath(settings.opencodeSessionsDir),
  };
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
  const raw = readFileSync(usageEventsPath(), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = parseJson(line);
    if (isEntry(parsed)) {
      byId.set(parsed.id, parsed);
    }
  }
  return [...byId.values()].sort((a, b) => entryTime(b) - entryTime(a));
}

function appendUsageEntryToStore(entry: LedgerEntry) {
  const path = usageEventsPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
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

async function loadRenderer(window: BrowserWindow, view: "pet" | "manager" | "toast") {
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(`${process.env.VITE_DEV_SERVER_URL}?view=${view}`);
    return;
  }
  await window.loadFile(rendererFile, { query: { view } });
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

  managerWindow = new BrowserWindow({
    width: MANAGER_SIZE.width,
    height: MANAGER_SIZE.height,
    minWidth: MANAGER_MIN_SIZE.width,
    minHeight: MANAGER_MIN_SIZE.height,
    title: APP_NAME,
    icon: createAppIcon(),
    frame: true,
    transparent: false,
    resizable: true,
    show: true,
    backgroundColor: "#f6f2e8",
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  managerWindow.on("closed", () => {
    managerWindow = null;
    refreshTrayMenu();
  });
  managerWindow.webContents.setZoomFactor(1);
  managerWindow.webContents.on("zoom-changed", (event) => event.preventDefault());
  void managerWindow.webContents.setVisualZoomLevelLimits(1, 1);
  void loadRenderer(managerWindow, "manager");
  return managerWindow;
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
  const placement = canUseRight || !canUseLeft ? "right" : "left";
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
    !achievementToastPendingIds.length
  ) {
    return;
  }

  const ids = achievementToastPendingIds;
  achievementToastPendingIds = [];
  const { bounds, placement } = achievementToastPlacement();
  achievementToastWindow.setBounds(bounds, false);
  achievementToastWindow.setAlwaysOnTop(true, "floating");
  achievementToastWindow.webContents.send("bonsai:achievement-toast", { ids, placement });
  achievementToastWindow.showInactive();
  scheduleAchievementToastFallbackHide(ids.length);
}

function showAchievementToastOverlay(ids: string[]) {
  const cleanIds = ids.filter((id) => typeof id === "string" && id.length);
  if (!cleanIds.length) return;

  achievementToastPendingIds.push(...cleanIds);
  const window = createAchievementToastWindow();
  const { bounds, placement } = achievementToastPlacement();
  window.setBounds(bounds, false);
  window.setAlwaysOnTop(true, "floating");
  window.webContents.send("bonsai:achievement-toast-placement", placement);
  flushAchievementToastOverlay();
}

function showManager() {
  const window = createManagerWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  refreshTrayMenu();
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

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip(APP_NAME);
  tray.on("click", showManager);
  refreshTrayMenu();
}

function createTrayIcon() {
  if (process.platform === "darwin") return createMacTrayIcon();
  return createAppIcon();
}

function createMacTrayIcon() {
  for (const iconPath of APP_ICON_PATHS) {
    try {
      if (!existsSync(iconPath)) continue;
      const icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) continue;
      const resized = icon.resize({ width: MAC_TRAY_ICON_SIZE, height: MAC_TRAY_ICON_SIZE });
      resized.setTemplateImage(false);
      return resized.isEmpty() ? icon : resized;
    } catch {
      // Fall back to the embedded icon below.
    }
  }
  return createAppIcon().resize({ width: MAC_TRAY_ICON_SIZE, height: MAC_TRAY_ICON_SIZE });
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
      label: mainText("openManager"),
      click: showManager,
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
  const template = Menu.buildFromTemplate([
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
      label: mainText("openManager"),
      click: showManager,
    },
    {
      label: petWindow?.isVisible() ? mainText("hidePet") : mainText("showPet"),
      click: () => {
        if (!petWindow) createPetWindow();
        petWindow?.isVisible() ? petWindow.hide() : petWindow?.show();
        refreshTrayMenu();
      },
    },
    {
      label:
        updateStatus.available && updateStatus.latestVersion
          ? `${mainText("updateFound")} v${updateStatus.latestVersion}`
          : mainText("checkUpdate"),
      enabled: !updateStatus.checking,
      click: () => {
        void checkForUpdates({ manual: true, remind: true });
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
  tray.setContextMenu(template);
  tray.setToolTip(`${APP_NAME} · Lv.${trayStats.level} · ${trayStats.weatherLabel}`);
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
  return countedTokensForEntry(entry);
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
  if (partial.scale !== undefined) resizePetWindow();
  writeDeviceSettings();
  if (partial.launchOnStartup !== undefined || partial.silentStartup !== undefined) {
    applyLoginItemSettings();
  }
  if (partial.updateCheckEnabled !== undefined) {
    startUpdateChecks();
    if (ledger.settings.updateCheckEnabled) void checkForUpdates({ manual: true, remind: true });
  }
  if (
    previous.leaderboardEnabled !== ledger.settings.leaderboardEnabled ||
    previous.leaderboardProfile?.id !== ledger.settings.leaderboardProfile?.id
  ) {
    leaderboardService.startSync();
  } else if (
    partial.leaderboardEnabled !== undefined ||
    partial.leaderboardProfile !== undefined ||
    partial.leaderboardLastSyncedAt !== undefined
  ) {
    leaderboardService.broadcast();
  }
  if (
    previous.codexSessionsDir !== ledger.settings.codexSessionsDir ||
    previous.claudeSessionsDir !== ledger.settings.claudeSessionsDir ||
    previous.openclawSessionsDir !== ledger.settings.openclawSessionsDir ||
    previous.opencodeSessionsDir !== ledger.settings.opencodeSessionsDir
  ) {
    restartUsageWatchers();
  }
  refreshTrayMenu();
  broadcast("bonsai:ledger", ledger);
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
  };
  ledger.entries.unshift(entry);
  appendUsageEntryToStore(entry);
  broadcast("bonsai:ledger", ledger);
  refreshTrayMenu();
}

function broadcast(channel: string, ...args: unknown[]) {
  for (const window of [petWindow, managerWindow]) {
    if (!window || window.isDestroyed()) continue;
    window.webContents.send(channel, ...args);
  }
}

function getUsageStatus(): UsageStatus {
  return {
    codexSession: codexSessionStatus,
    claudeSession: claudeSessionStatus,
    openclawSession: openclawSessionStatus,
    opencodeSession: opencodeSessionStatus,
  };
}

function startUpdateChecks() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
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

  setTimeout(() => {
    void checkForUpdates({ remind: true });
  }, UPDATE_REMINDER_DELAY_MS);
  updateCheckTimer = setInterval(() => {
    void checkForUpdates({ remind: true });
  }, UPDATE_CHECK_INTERVAL_MS);
}

async function checkForUpdates(options: { manual?: boolean; remind?: boolean } = {}): Promise<UpdateStatus> {
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

  try {
    const latest = await fetchLatestUpdate();
    const currentVersion = currentAppVersion();
    const available = compareVersions(latest.version, currentVersion) > 0;
    updateStatus = {
      ...updateStatus,
      checking: false,
      installing: false,
      available,
      canTerminalUpdate: canTerminalUpdate(),
      currentVersion,
      latestVersion: latest.version,
      releaseUrl: latest.releaseUrl,
      checkedAt: new Date().toISOString(),
      error: undefined,
    };
    if (available && options.remind) remindUpdateAvailable(updateStatus);
  } catch (error) {
    updateStatus = {
      ...updateStatus,
      checking: false,
      available: false,
      canTerminalUpdate: canTerminalUpdate(),
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : mainText("updateCheckFailed"),
    };
  }

  broadcastUpdateStatus();
  refreshTrayMenu();
  return updateStatus;
}

async function fetchLatestUpdate() {
  try {
    const release = await fetchJson(UPDATE_LATEST_RELEASE_URL);
    const releaseVersion = normalizeVersion(
      typeof (release as { tag_name?: unknown })?.tag_name === "string" ? (release as { tag_name: string }).tag_name : "",
    );
    if (releaseVersion && isSemver(releaseVersion)) {
      return {
        version: releaseVersion,
        releaseUrl:
          typeof (release as { html_url?: unknown })?.html_url === "string"
            ? (release as { html_url: string }).html_url
            : UPDATE_PAGE_URL,
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
  return {
    version: latest.version,
    releaseUrl: UPDATE_PAGE_URL,
  };
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
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": `${APP_NAME}/${currentAppVersion()}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await net.fetch(urlString, {
    method,
    headers,
    body,
  });
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
    const dirty = (await runTerminalCommand("git", ["status", "--porcelain", "--untracked-files=no"], cwd)).trim();
    if (dirty) {
      throw new Error(mainText("dirtyWorkspace"));
    }

    await runUpdateStep(mainText("fetchUpdates"), "git", ["fetch", "--tags", "--prune", "origin"], cwd);
    await runUpdateStep(mainText("pullMain"), "git", ["pull", "--ff-only", "origin", "main"], cwd);
    await runUpdateStep(mainText("syncDependencies"), npmCommand(), ["install"], cwd);
    await runUpdateStep(mainText("buildApp"), npmCommand(), ["run", "build"], cwd);

    updateStatus = {
      ...updateStatus,
      installing: false,
      available: false,
      currentVersion: currentAppVersion(),
      checkedAt: new Date().toISOString(),
      installedAt: new Date().toISOString(),
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

async function runUpdateStep(label: string, command: string, args: string[], cwd: string) {
  updateStatus = {
    ...updateStatus,
    installLog: label,
  };
  broadcastUpdateStatus();
  await runTerminalCommand(command, args, cwd);
}

function runTerminalCommand(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, cwd);
    let output = "";
    const collect = (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-12_000);
    };

    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output.trim());
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} ${mainText("commandFailed")} (${code ?? "unknown"})${output ? `\n${output.trim()}` : ""}`));
    });
  });
}

function spawnCommand(command: string, args: string[], cwd: string) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", [command, ...args].map(quoteWindowsCmdArg).join(" ")], {
      cwd,
      shell: false,
      windowsHide: true,
    });
  }
  return spawn(command, args, { cwd, shell: false, windowsHide: true });
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
}

function stopUsageWatchers() {
  codexSessionWatcher?.close();
  claudeSessionWatcher?.close();
  openclawSessionWatcher?.close();
  opencodeSessionWatcher?.close();
  codexSessionWatcher = null;
  claudeSessionWatcher = null;
  openclawSessionWatcher = null;
  opencodeSessionWatcher = null;
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
    openAsHidden: ledger.settings.silentStartup,
    path: process.execPath,
    args: loginItemArgs(),
  });
}

function loginItemArgs() {
  if (app.isPackaged) return [];
  const entry = process.argv.find((arg, index) => index > 0 && /dist[\\/]electron[\\/]main\.js$/.test(arg));
  return entry ? [entry] : [];
}

app.whenReady().then(() => {
  app.setName(APP_NAME);
  app.setAppUserModelId(APP_ID);
  Menu.setApplicationMenu(null);
  ledger = readLedger();
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
  void leaderboardService.syncUsage();

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
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  leaderboardService.stop();
});

ipcMain.handle("ledger:get", () => ledger);
ipcMain.handle("usage:get-status", getUsageStatus);
ipcMain.handle("updates:get-status", () => updateStatus);
ipcMain.handle("updates:check", () => checkForUpdates({ manual: true, remind: true }));
ipcMain.handle("updates:install", () => installUpdate());
ipcMain.handle("updates:open", (_event, url?: string) => openUpdatePage(typeof url === "string" ? url : undefined));
ipcMain.handle("leaderboard:get-status", () => leaderboardService.status());
ipcMain.handle("leaderboard:login", () => leaderboardService.login());
ipcMain.handle("leaderboard:logout", () => leaderboardService.logout());
ipcMain.handle("leaderboard:set-enabled", (_event, enabled: boolean) => leaderboardService.setEnabled(Boolean(enabled)));
ipcMain.handle("leaderboard:sync", () => leaderboardService.syncUsage());
ipcMain.handle("leaderboard:get", (_event, range?: unknown) => leaderboardService.getLeaderboard(range));
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

ipcMain.on("achievements:toast-ready", (event) => {
  if (!achievementToastWindow || achievementToastWindow.isDestroyed()) return;
  if (event.sender !== achievementToastWindow.webContents) return;
  achievementToastRendererReady = true;
  flushAchievementToastOverlay();
});

ipcMain.on("achievements:toast-drained", (event) => {
  if (!achievementToastWindow || achievementToastWindow.isDestroyed()) return;
  if (event.sender !== achievementToastWindow.webContents) return;
  if (achievementToastPendingIds.length) {
    flushAchievementToastOverlay();
    return;
  }
  scheduleAchievementToastDrainedHide();
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
