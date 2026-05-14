import type {
  AchievementState,
  AchievementUnlock,
  AppLanguage,
  LedgerEntry,
  LedgerFile,
  LeaderboardData,
  LeaderboardRange,
  LeaderboardStatus,
  TreeAsset,
  TreeStage,
  UpdateStatus,
  UsageStatus,
  WindowBounds,
} from "../shared/types";
import { countedTokensForEntry } from "../shared/tokenAccounting";
import { ACHIEVEMENTS, CATEGORY_ORDER, rarityOrder } from "./achievements";
import type { AchievementContext, AchievementDef } from "./achievements";
import {
  ACHIEVEMENT_CATEGORY_LABELS,
  ACHIEVEMENT_RARITY_LABELS,
  ACHIEVEMENT_TEXT_EN,
  UI_TEXT,
  browserLanguage,
  normalizeLanguage,
} from "./i18n";
import type { AchievementCategory, AchievementRarity } from "./i18n";
import "./styles.css";

type WeatherId = "clear" | "breeze" | "drizzle" | "rain" | "thunder" | "storm";
type ViewMode = "pet" | "manager" | "toast";
type HistoryFilter = "all" | "codex" | "openclaw" | "opencode" | "claude";
type SourceScope = "today" | "total";
type BadgeMetric = "level" | "total" | "rate";
type TotalDisplayUnit = "raw" | "k" | "m" | "wan" | "yi";
type DashboardTab = "home" | "achievements" | "leaderboard";
type AchievementCategoryFilter = AchievementCategory;
type AchievementStatusFilter = "all" | "unlocked" | "locked" | "hidden";

interface WeatherState {
  id: WeatherId;
  label: string;
  tokensPerMinute: number;
  activity: number;
}

interface Stats {
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
  sevenDays: HistoryDayRow[];
  sourceBreakdown: SourceBreakdown[];
}

interface HistoryDayRow {
  label: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  sources: Record<HistorySourceId, number>;
}

type HistorySourceId = "codex" | "openclaw" | "opencode" | "claude";

interface SourceBreakdown {
  id: string;
  label: string;
  xp: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface PureSvgManifest {
  stages: Array<{
    id: string;
    label: string;
    asset: string;
  }>;
}

interface GameBalance {
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

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
document.title = "Vibe Tree";

const viewParam = new URLSearchParams(location.search).get("view");
const viewMode: ViewMode = viewParam === "manager" ? "manager" : viewParam === "toast" ? "toast" : "pet";
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
let leaderboardRange: LeaderboardRange = "7d";
let leaderboardData: LeaderboardData = {
  range: "7d",
  entries: [],
};
let achievementState: AchievementState = { unlocked: [] };
let lastWeatherId: WeatherId | null = null;
let lastRenderedLevel: number | null = null;
let levelUpTimer: number | undefined;
let achievementSyncInFlight = false;
let achievementToastTimer: number | undefined;
let lockedAchievementHintTimer: number | undefined;
const achievementToastQueue: AchievementDef[] = [];
const ACHIEVEMENT_TOAST_DURATION_MS = 5_000;
const TOAST_PREVIEW_IDS = ["sprout", "deep_night", "xp_1m", "xp_100m", "fibonacci"];
let toastPreviewIndex = 0;
let pendingLevelUp: { from: number; to: number } | null = null;
const AUTO_BADGE_FLIP_MS = 30_000;
const BADGE_TOKEN_HOLD_MS = 2_500;
const badgeFlipTimers = new Map<string, number>();
let badgeAutoFlipTimer: number | undefined;
let historyFilter: HistoryFilter = "all";
let lastHistoryChartKey = "";
let sourceScope: SourceScope = "today";
let dashboardTab: DashboardTab = "home";
let achievementCategoryFilter: AchievementCategoryFilter = "growth";
let achievementStatusFilter: AchievementStatusFilter = "all";
let seenAchievementIds = new Set<string>();
let expandedSourceKey: string | null = null;
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
let lastPetTap: null | {
  time: number;
  x: number;
  y: number;
} = null;
let appLanguage: AppLanguage = browserLanguage();


if (viewMode === "pet") {
  app.innerHTML = `
    <main class="pet-root" data-locked="false" data-weather="clear" data-active="false">
      <section class="pet-stage" id="petStage" aria-label="Vibe Tree">
        <div class="weather-layer weather-back" id="weatherBack"></div>
        <div class="pet-aura"></div>
        <img class="tree-image" id="treeImage" alt="Vibe Tree" draggable="false" />
        <div class="weather-layer weather-front" id="weatherFront"></div>
        <div class="level-up-toast" aria-hidden="true">
          <strong>LEVEL UP!</strong>
          <span id="petLevelUpText">Lv.1 -> Lv.2</span>
        </div>
        <div class="level-badge" id="petLevelBadge">
          <span class="badge-card">
            <span class="badge-face badge-front">Lv.1</span>
            <span class="badge-face badge-back">0</span>
          </span>
        </div>
        <button class="pet-hitbox" id="petHitbox" type="button" aria-label="打开 Vibe Tree"></button>
      </section>
    </main>
  `;
} else if (viewMode === "manager") {
  app.innerHTML = `
    <main class="manager-root" data-weather="clear" data-active="false">
      <aside class="pet-preview-panel">
        <header class="app-title">
          <p>Vibe Tree</p>
          <h1 data-i18n="productTitle">Token 天气树</h1>
        </header>

        <section class="preview-stage" aria-label="桌面小树预览" data-i18n-aria="petPreviewAria">
          <div class="weather-layer weather-back" id="previewWeatherBack"></div>
          <div class="pet-aura"></div>
          <img class="tree-image" id="previewTreeImage" alt="Vibe Tree preview" draggable="false" />
          <div class="weather-layer weather-front" id="previewWeatherFront"></div>
          <div class="level-up-toast" aria-hidden="true">
            <strong>LEVEL UP!</strong>
            <span id="previewLevelUpText">Lv.1 -> Lv.2</span>
          </div>
          <div class="level-badge preview-level" id="previewLevelBadge">
            <span class="badge-card">
              <span class="badge-face badge-front">Lv.1</span>
              <span class="badge-face badge-back">0</span>
            </span>
          </div>
        </section>

        <nav class="side-tabs" id="sideTabs" aria-label="页面切换" data-i18n-aria="pageSwitchAria">
          <button type="button" data-dashboard-tab="home" data-i18n="home">主页</button>
          <button type="button" data-dashboard-tab="achievements" data-i18n="achievements">成就</button>
          <button type="button" data-dashboard-tab="leaderboard" data-i18n="leaderboard">排行榜</button>
        </nav>

      </aside>
      <button class="settings-fab" id="settingsButton" type="button" aria-label="打开设置" title="设置" data-i18n-aria="openSettings" data-i18n-title="settings">
        <span aria-hidden="true">⚙</span>
        <span class="settings-update-badge" aria-hidden="true">NEW</span>
      </button>

      <section class="dashboard">
        <header class="dashboard-header">
          <div>
            <p class="eyebrow" data-i18n="liveGrowth">Live growth</p>
            <div class="level-title-row">
              <h2 id="levelTitle">Lv.1 新芽</h2>
              <span class="help-tip" tabindex="0" aria-label="计入 Token = input + output；Claude 会加上 cache write" data-tooltip="计入 Token = input + output；Claude 会加上 cache write" data-i18n-tooltip="tokenHelp">?</span>
            </div>
          </div>
          <div class="weather-readout">
            <span id="weatherLabel">晴朗</span>
            <strong id="weatherRateText">0 token/min</strong>
          </div>
        </header>

        <div class="metric-grid">
          <article>
            <span data-i18n="metricTotalTokens">累计 Token</span>
            <strong id="totalText">0</strong>
          </article>
          <article>
            <span data-i18n="metricToday">今日成长</span>
            <strong id="todayText">0</strong>
          </article>
          <article>
            <span data-i18n="metricSessions">活跃会话</span>
            <strong id="activeSessionsText">0</strong>
          </article>
        </div>

        <section class="progress-block">
          <div class="progress-meta">
            <span id="nextLevelText">距离 Lv.2</span>
            <span id="progressText">0 / 800 token</span>
          </div>
          <div class="progress-track xp-track">
            <span id="progressBar"></span>
          </div>
        </section>

        <section class="achievement-card" aria-label="Achievements">
          <div class="section-header">
            <div>
              <h3 data-i18n="memorialAchievements">纪念 / 成就</h3>
            </div>
            <div class="achievement-header-tools">
              <button class="achievement-preview-button" id="achievementToastPreviewButton" type="button" data-i18n="previewToast">预览弹窗</button>
              <span id="achievementSummary">0 / 0</span>
            </div>
          </div>
          <div class="achievement-overview" id="achievementOverview"></div>
          <div class="achievement-filter-panel">
            <div class="achievement-category-tabs" id="achievementCategoryTabs" role="tablist" aria-label="成就分类" data-i18n-aria="achievementCategoryAria">
              <button type="button" data-achievement-category="growth" data-i18n-achievement-category="growth">成长之路</button>
              <button type="button" data-achievement-category="peak" data-i18n-achievement-category="peak">巅峰时刻</button>
              <button type="button" data-achievement-category="time" data-i18n-achievement-category="time">时间档案</button>
              <button type="button" data-achievement-category="agent" data-i18n-achievement-category="agent">Agent</button>
              <button type="button" data-achievement-category="hidden" data-i18n-achievement-category="hidden">未解之谜</button>
            </div>
            <div class="achievement-status-tabs" id="achievementStatusTabs" role="tablist" aria-label="成就状态" data-i18n-aria="achievementStatusAria">
              <button type="button" data-achievement-status="all" data-i18n="all">全部</button>
              <button type="button" data-achievement-status="unlocked" data-i18n="unlocked">已点亮</button>
              <button type="button" data-achievement-status="locked" data-i18n="locked">未点亮</button>
            </div>
          </div>
          <div class="achievement-recent" id="achievementRecent"></div>
          <div class="achievement-grid" id="achievementGrid"></div>
        </section>

        <section class="leaderboard-card" aria-label="全球排行榜" data-i18n-aria="leaderboardAria">
          <div class="section-header">
            <div>
              <p class="eyebrow" data-i18n="leaderboardEyebrow">Global rank</p>
              <h3 data-i18n="globalLeaderboard">全球排行榜</h3>
            </div>
            <button class="secondary-button leaderboard-sync-button" id="leaderboardPageSyncButton" type="button" data-i18n="joinLeaderboard">加入排行</button>
          </div>
          <div class="leaderboard-range-tabs" id="leaderboardRangeTabs" role="tablist" aria-label="全球排行榜范围" data-i18n-aria="leaderboardAria">
            <button type="button" data-leaderboard-range="today" data-i18n="leaderboardToday">今日</button>
            <button type="button" data-leaderboard-range="7d" data-i18n="leaderboard7d">7 天</button>
            <button type="button" data-leaderboard-range="30d" data-i18n="leaderboard30d">30 天</button>
            <button type="button" data-leaderboard-range="all" data-i18n="leaderboardAllTime">全部</button>
          </div>
          <div class="leaderboard-summary" id="leaderboardSummary"></div>
          <div class="leaderboard-rows" id="leaderboardRows"></div>
        </section>

        <section class="source-card" aria-label="Token 来源" data-i18n-aria="sourceAria">
          <div class="section-header">
            <h3 data-i18n="sourceTitle">数据来源</h3>
            <div class="source-header-tools">
              <div class="source-scope-tabs" id="sourceScopeTabs" role="tablist" aria-label="数据来源范围" data-i18n-aria="sourceScopeAria">
                <button type="button" data-source-scope="today" data-i18n="today">今日</button>
                <button type="button" data-source-scope="total" data-i18n="total">总计</button>
              </div>
            </div>
          </div>
          <div class="source-rows" id="sourceBreakdown"></div>
        </section>

        <section class="chart-card">
          <div class="section-header">
            <h3 data-i18n="recentSevenDays">最近 7 天</h3>
            <span id="peakText">5 分钟 +0 token</span>
          </div>
        </section>
      </section>
      <div class="achievement-toast-layer" id="achievementToastLayer" aria-live="polite"></div>

      <section class="settings-modal" id="settingsModal" aria-hidden="true">
        <div class="settings-backdrop" id="settingsBackdrop"></div>
        <div class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
          <header class="settings-panel-header">
            <div>
              <p class="eyebrow" data-i18n="preferences">偏好设置</p>
              <h3 id="settingsTitle" data-i18n="settings">设置</h3>
            </div>
            <button class="icon-button" id="settingsCloseButton" type="button" aria-label="关闭设置" data-i18n-aria="closeSettings">×</button>
          </header>

          <section class="settings-section">
            <h4 data-i18n="desktopTree">桌面小树</h4>
            <div class="pet-settings" aria-label="桌面小树设置" data-i18n-aria="desktopTreeAria">
              <label class="scale-select">
                <span data-i18n="size">大小</span>
                <select id="scaleSelect">
                  <option value="0.5">0.5x</option>
                  <option value="1">1x</option>
                  <option value="1.5">1.5x</option>
                  <option value="2">2x</option>
                </select>
              </label>
              <label class="toggle-row">
                <input id="lockInput" type="checkbox" />
                <span data-i18n="lockTree">锁定小树位置</span>
              </label>
            </div>
          </section>

          <section class="settings-section">
            <h4 data-i18n="badgeDisplay">牌子显示</h4>
            <div class="badge-settings" aria-label="牌子显示" data-i18n-aria="badgeDisplay">
              <label>
                <span data-i18n="badgeFront">正面</span>
                <select id="badgeFrontMetricSelect">
                  <option value="level" data-i18n="metricLevel">等级</option>
                  <option value="total" data-i18n="metricTotalToken">累计 token</option>
                  <option value="rate" data-i18n="metricRate">token/s</option>
                </select>
              </label>
              <label>
                <span data-i18n="badgeBack">背面</span>
                <select id="badgeBackMetricSelect">
                  <option value="level" data-i18n="metricLevel">等级</option>
                  <option value="total" data-i18n="metricTotalToken">累计 token</option>
                  <option value="rate" data-i18n="metricRate">token/s</option>
                </select>
              </label>
              <label>
                <span data-i18n="totalUnit">总量单位</span>
                <select id="totalDisplayUnitSelect">
                  <option value="raw" data-i18n="unitRaw">完整数字</option>
                  <option value="k">k</option>
                  <option value="m">m</option>
                  <option value="wan" data-i18n="unitWan">万</option>
                  <option value="yi" data-i18n="unitYi">亿</option>
                </select>
              </label>
            </div>
          </section>

          <section class="settings-section">
            <h4 data-i18n="languageTitle">语言</h4>
            <label class="scale-select">
              <span data-i18n="languageLabel">界面语言</span>
              <select id="languageSelect">
                <option value="zh-CN" data-i18n="languageChinese">简体中文</option>
                <option value="en-US" data-i18n="languageEnglish">English</option>
              </select>
            </label>
          </section>

          <section class="settings-section">
            <h4 data-i18n="globalLeaderboard">全球排行榜</h4>
            <div class="leaderboard-settings" aria-label="全球排行榜设置" data-i18n-aria="leaderboardAria">
              <div class="leaderboard-user-card" id="leaderboardUserCard"></div>
              <div class="leaderboard-status" id="leaderboardStatusText"></div>
              <label class="toggle-row">
                <input id="leaderboardJoinInput" type="checkbox" />
                <span data-i18n="joinGlobalLeaderboard">加入全球排行榜</span>
              </label>
              <p class="leaderboard-help" data-i18n="leaderboardPrivacyNote">用户说明：加入后仅上传近 30 日每日消耗的 Token，不会包含任何提示词、文件、会话记录、使用模型等其他信息。</p>
              <div class="leaderboard-actions">
                <button class="secondary-button" id="leaderboardLoginButton" type="button" data-i18n="loginGithub">登录 GitHub</button>
                <button class="secondary-button" id="leaderboardSettingsSyncButton" type="button" data-i18n="syncNow">立即同步</button>
                <button class="secondary-button danger-button" id="leaderboardLogoutButton" type="button" data-i18n="leaveLeaderboard">退出排行榜</button>
              </div>
            </div>
          </section>

          <section class="settings-section">
            <h4 data-i18n="device">设备</h4>
            <div class="device-controls" aria-label="设备设置" data-i18n-aria="deviceAria">
              <label class="toggle-row">
                <input id="launchOnStartupInput" type="checkbox" />
                <span data-i18n="launchOnStartup">开机启动</span>
              </label>
              <label class="toggle-row">
                <input id="silentStartupInput" type="checkbox" />
                <span data-i18n="silentStartup">静默启动</span>
              </label>
            </div>
          </section>

          <section class="settings-section">
            <h4 data-i18n="updateTitle">更新</h4>
            <div class="update-settings" aria-label="更新设置" data-i18n-aria="updateAria">
              <div class="update-status" id="updateStatusText">
                <strong data-i18n="currentVersion">当前版本</strong>
                <span data-i18n="waitingCheck">等待检查</span>
              </div>
              <label class="toggle-row">
                <input id="updateCheckEnabledInput" type="checkbox" />
                <span data-i18n="autoUpdateCheck">自动检测更新</span>
              </label>
              <div class="update-actions">
                <button class="secondary-button" id="checkUpdateButton" type="button" data-i18n="checkUpdate">检查更新</button>
                <button class="primary-button" id="installUpdateButton" type="button" data-i18n="terminalUpdate">终端更新</button>
              </div>
            </div>
          </section>

          <section class="settings-section">
            <h4 data-i18n="agentPaths">Agent 路径</h4>
            <div class="path-settings">
              <label>
                <span data-i18n="codexPath">Codex 路径</span>
                <input id="codexSessionsDirInput" type="text" placeholder="~/.codex/sessions" />
              </label>
              <label>
                <span data-i18n="claudePath">Claude 路径</span>
                <input id="claudeSessionsDirInput" type="text" placeholder="~/.claude/projects" />
              </label>
              <label>
                <span data-i18n="openclawPath">OpenClaw 路径</span>
                <input id="openclawSessionsDirInput" type="text" placeholder="~/.openclaw/agents" />
              </label>
              <label>
                <span data-i18n="opencodePath">OpenCode 路径</span>
                <input id="opencodeSessionsDirInput" type="text" placeholder="~/.local/share/opencode/storage/message" />
              </label>
            </div>
          </section>

          <section class="settings-section release-section">
            <h4 data-i18n="releasePage">发布页</h4>
            <div class="release-settings">
              <span data-i18n="releaseDescription">查看版本记录和发布说明</span>
              <button class="secondary-button" id="releasePageButton" type="button" data-i18n="openReleasePage">打开发布页</button>
            </div>
          </section>
        </div>
      </section>
    </main>
  `;
} else {
  app.innerHTML = `
    <main class="toast-root" data-placement="right">
      <div class="achievement-toast-layer" id="achievementToastLayer" aria-live="polite"></div>
    </main>
  `;
}

const root = document.querySelector<HTMLElement>(
  viewMode === "pet" ? ".pet-root" : viewMode === "manager" ? ".manager-root" : ".toast-root",
)!;
const treeImage = document.querySelector<HTMLImageElement>("#treeImage");
const previewTreeImage = document.querySelector<HTMLImageElement>("#previewTreeImage");
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
const scaleSelect = document.querySelector<HTMLSelectElement>("#scaleSelect");
const launchOnStartupInput = document.querySelector<HTMLInputElement>("#launchOnStartupInput");
const silentStartupInput = document.querySelector<HTMLInputElement>("#silentStartupInput");
const updateCheckEnabledInput = document.querySelector<HTMLInputElement>("#updateCheckEnabledInput");
const updateStatusText = document.querySelector<HTMLElement>("#updateStatusText");
const checkUpdateButton = document.querySelector<HTMLButtonElement>("#checkUpdateButton");
const installUpdateButton = document.querySelector<HTMLButtonElement>("#installUpdateButton");
const releasePageButton = document.querySelector<HTMLButtonElement>("#releasePageButton");
const languageSelect = document.querySelector<HTMLSelectElement>("#languageSelect");
const badgeFrontMetricSelect = document.querySelector<HTMLSelectElement>("#badgeFrontMetricSelect");
const badgeBackMetricSelect = document.querySelector<HTMLSelectElement>("#badgeBackMetricSelect");
const totalDisplayUnitSelect = document.querySelector<HTMLSelectElement>("#totalDisplayUnitSelect");
const codexSessionsDirInput = document.querySelector<HTMLInputElement>("#codexSessionsDirInput");
const claudeSessionsDirInput = document.querySelector<HTMLInputElement>("#claudeSessionsDirInput");
const openclawSessionsDirInput = document.querySelector<HTMLInputElement>("#openclawSessionsDirInput");
const opencodeSessionsDirInput = document.querySelector<HTMLInputElement>("#opencodeSessionsDirInput");
const leaderboardJoinInput = document.querySelector<HTMLInputElement>("#leaderboardJoinInput");
const leaderboardStatusText = document.querySelector<HTMLElement>("#leaderboardStatusText");
const leaderboardUserCard = document.querySelector<HTMLElement>("#leaderboardUserCard");
const leaderboardLoginButton = document.querySelector<HTMLButtonElement>("#leaderboardLoginButton");
const leaderboardLogoutButton = document.querySelector<HTMLButtonElement>("#leaderboardLogoutButton");
const leaderboardSettingsSyncButton = document.querySelector<HTMLButtonElement>("#leaderboardSettingsSyncButton");
const leaderboardPageSyncButton = document.querySelector<HTMLButtonElement>("#leaderboardPageSyncButton");
const leaderboardRangeTabs = document.querySelector<HTMLElement>("#leaderboardRangeTabs");
const leaderboardSummary = document.querySelector<HTMLElement>("#leaderboardSummary");
const leaderboardRows = document.querySelector<HTMLElement>("#leaderboardRows");

if (viewMode === "manager") {
  setupHistoryCard();
}

const historyBars = document.querySelector<HTMLElement>("#historyBars");
const historyTabs = document.querySelector<HTMLElement>("#historyTabs");
const historyLegend = document.querySelector<HTMLElement>("#historyLegend");
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
        <button type="button" data-history-filter="opencode">OpenCode</button>
        <button type="button" data-history-filter="claude">Claude Code</button>
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

function t(key: string): string {
  return UI_TEXT[currentLanguage()][key] ?? UI_TEXT["zh-CN"][key] ?? key;
}

function applyI18n() {
  document.documentElement.lang = languageLocale();
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
    bindToastOverlayEvents();
    return;
  }

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
  ledger = await window.bonsai.getLedger();
  appLanguage = normalizeLanguage(ledger.settings.language);
  usageStatus = await window.bonsai.getUsageStatus();
  updateStatus = await window.bonsai.getUpdateStatus();
  leaderboardStatus = await window.bonsai.getLeaderboardStatus();
  leaderboardData = await window.bonsai.getLeaderboard(leaderboardRange);
  achievementState = await window.bonsai.getAchievements();
  initializeSeenAchievements();

  bindEvents();
  applyI18n();
  render();
  setInterval(render, 1_000);
  startAutoBadgeFlipLoop();

  window.bonsai.onLedger((nextLedger) => {
    ledger = nextLedger;
    appLanguage = normalizeLanguage(ledger.settings.language);
    applyI18n();
    render();
  });
  window.bonsai.onUsageStatus((nextStatus) => {
    usageStatus = nextStatus;
    renderUsageStatus();
  });
  window.bonsai.onUpdateStatus((nextStatus) => {
    updateStatus = nextStatus;
    renderUpdateStatus();
  });
  window.bonsai.onLeaderboardStatus((nextStatus) => {
    leaderboardStatus = nextStatus;
    renderLeaderboardSettings();
    renderLeaderboard();
  });
  window.bonsai.onAchievements((nextState, unlocked) => {
    achievementState = nextState;
    renderAchievements();
  });
}

function bindToastOverlayEvents() {
  window.bonsai.onAchievementToast((payload) => {
    root.dataset.placement = payload.placement;
    queueAchievementToasts(payload.ids);
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

    petHitbox.addEventListener("dblclick", () => {
      void window.bonsai.setExpanded(true);
    });

    petStage.addEventListener("pointerdown", async (event) => {
      if (event.button !== 0 || ledger?.settings.locked) return;
      if ((event.target as HTMLElement).closest("#petLevelBadge")) return;
      if (event.detail >= 2) {
        lastPetTap = null;
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
      const isDoubleTap = consumePetTap(event);
      void endPetDrag();
      if (isDoubleTap) void window.bonsai.setExpanded(true);
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

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setSettingsOpen(false);
  });

  scaleSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ scale: Number(scaleSelect.value) });
    render();
  });

  languageSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ language: normalizeLanguage(languageSelect.value) });
    appLanguage = ledger.settings.language;
    lastHistoryChartKey = "";
    applyI18n();
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

  releasePageButton?.addEventListener("click", () => {
    void window.bonsai.openUpdatePage();
  });

  leaderboardLoginButton?.addEventListener("click", async () => {
    leaderboardStatus = await window.bonsai.loginLeaderboard();
    await refreshLeaderboard();
  });

  leaderboardJoinInput?.addEventListener("change", async () => {
    if (leaderboardJoinInput.checked && !leaderboardStatus.authenticated) {
      leaderboardStatus = await window.bonsai.loginLeaderboard();
    } else {
      leaderboardStatus = await window.bonsai.setLeaderboardEnabled(leaderboardJoinInput.checked);
    }
    await refreshLeaderboard();
  });

  leaderboardLogoutButton?.addEventListener("click", async () => {
    leaderboardStatus = await window.bonsai.logoutLeaderboard();
    await refreshLeaderboard();
  });

  leaderboardSettingsSyncButton?.addEventListener("click", () => {
    void syncAndRefreshLeaderboard();
  });

  leaderboardPageSyncButton?.addEventListener("click", () => {
    openLeaderboardSettings();
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
  opencodeSessionsDirInput?.addEventListener("change", () =>
    updatePathSetting("opencodeSessionsDir", opencodeSessionsDirInput),
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
    renderDashboardTabs();
    if (dashboardTab === "leaderboard") void refreshLeaderboard();
  });

  leaderboardRangeTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-leaderboard-range]");
    if (!button) return;
    const nextRange = normalizeLeaderboardRange(button.dataset.leaderboardRange);
    if (nextRange === leaderboardRange) return;
    leaderboardRange = nextRange;
    void refreshLeaderboard();
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
    markAchievementSeen(def.id);
    showAchievementDetail(def);
  });

  achievementRecentElement?.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>("[data-achievement-id]");
    if (!item) return;
    const id = item.dataset.achievementId;
    const def = ACHIEVEMENTS.find((d) => d.id === id);
    if (!def) return;
    markAchievementSeen(def.id);
    showAchievementDetail(def);
  });

  achievementToastPreviewButton?.addEventListener("click", () => {
    previewAchievementToast();
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
  lastPetTap = null;
  await endPetDrag();
}

function consumePetTap(event: PointerEvent) {
  const pointer = activePetPointer;
  activePetPointer = null;
  if (!pointer || pointer.pointerId !== event.pointerId || pointer.moved || pointerDistance(pointer, event) > 8) {
    lastPetTap = null;
    return false;
  }

  const now = Date.now();
  const isDoubleTap =
    Boolean(lastPetTap) &&
    now - lastPetTap!.time <= 420 &&
    Math.hypot(event.screenX - lastPetTap!.x, event.screenY - lastPetTap!.y) <= 12;
  lastPetTap = isDoubleTap ? null : { time: now, x: event.screenX, y: event.screenY };
  return isDoubleTap;
}

function pointerDistance(start: { x: number; y: number }, event: PointerEvent) {
  return Math.hypot(event.screenX - start.x, event.screenY - start.y);
}

async function updatePathSetting(
  key: "codexSessionsDir" | "claudeSessionsDir" | "openclawSessionsDir" | "opencodeSessionsDir",
  input: HTMLInputElement,
) {
  if (!ledger) return;
  const value = input.value.trim() || undefined;
  ledger = await window.bonsai.updateSettings({ [key]: value });
  render();
}

async function refreshLeaderboard() {
  leaderboardStatus = await window.bonsai.getLeaderboardStatus();
  leaderboardData = await window.bonsai.getLeaderboard(leaderboardRange);
  renderLeaderboardSettings();
  renderLeaderboard();
}

async function syncAndRefreshLeaderboard() {
  leaderboardStatus = await window.bonsai.syncLeaderboard();
  leaderboardData = await window.bonsai.getLeaderboard(leaderboardRange);
  renderLeaderboardSettings();
  renderLeaderboard();
}

function setSettingsOpen(open: boolean) {
  if (!settingsModal) return;
  settingsModal.classList.toggle("open", open);
  settingsModal.setAttribute("aria-hidden", String(!open));
}

function openLeaderboardSettings() {
  setSettingsOpen(true);
  window.requestAnimationFrame(() => {
    leaderboardJoinInput?.scrollIntoView({ block: "center", behavior: "smooth" });
    leaderboardJoinInput?.focus({ preventScroll: true });
  });
}

function render() {
  if (!ledger || !tree || !gameBalance) return;
  const stats = calculateStats(ledger.entries, tree, gameBalance);
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
  renderScopedSourceBreakdown();

  const progressBar = document.querySelector<HTMLElement>("#progressBar");
  if (progressBar) progressBar.style.width = `${stats.levelProgress * 100}%`;
  if (lockInput) lockInput.checked = ledger.settings.locked;
  if (scaleSelect) scaleSelect.value = String(ledger.settings.scale);
  if (languageSelect) languageSelect.value = ledger.settings.language;
  if (launchOnStartupInput) launchOnStartupInput.checked = ledger.settings.launchOnStartup;
  if (silentStartupInput) silentStartupInput.checked = ledger.settings.silentStartup;
  if (updateCheckEnabledInput) updateCheckEnabledInput.checked = ledger.settings.updateCheckEnabled;
  if (badgeFrontMetricSelect) badgeFrontMetricSelect.value = ledger.settings.badgeFrontMetric;
  if (badgeBackMetricSelect) badgeBackMetricSelect.value = ledger.settings.badgeBackMetric;
  if (totalDisplayUnitSelect) totalDisplayUnitSelect.value = ledger.settings.totalDisplayUnit;
  syncInputValue(codexSessionsDirInput, ledger.settings.codexSessionsDir ?? "");
  syncInputValue(claudeSessionsDirInput, ledger.settings.claudeSessionsDir ?? "");
  syncInputValue(openclawSessionsDirInput, ledger.settings.openclawSessionsDir ?? "");
  syncInputValue(opencodeSessionsDirInput, ledger.settings.opencodeSessionsDir ?? "");

  if (lastWeatherId !== stats.weather.id) {
    lastWeatherId = stats.weather.id;
    renderWeatherLayers(stats.weather.id);
  }
  if (pendingLevelUp) triggerLevelUpAnimation(pendingLevelUp);
  renderUsageStatus();
  renderUpdateStatus();
  renderLeaderboardSettings();
  renderLeaderboard();
  renderHistoryChart(getSevenDayRows(ledger.entries, historyFilter), historyFilter);
  const achievementContext = buildAchievementContext(stats);
  renderAchievements(stats, achievementContext);
  renderDashboardTabs();
  syncAchievements(stats, achievementContext);
}

function renderDashboardTabs() {
  root.dataset.tab = dashboardTab;
  sideTabs?.querySelectorAll<HTMLButtonElement>("[data-dashboard-tab]").forEach((button) => {
    const active = button.dataset.dashboardTab === dashboardTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function triggerLevelUpAnimation(levels: { from: number; to: number }) {
  text("#petLevelUpText", `Lv.${levels.from} -> Lv.${levels.to}`);
  text("#previewLevelUpText", `Lv.${levels.from} -> Lv.${levels.to}`);
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
  if (!stats && ledger && tree && gameBalance) stats = calculateStats(ledger.entries, tree, gameBalance);
  if (!context && stats) context = buildAchievementContext(stats);
  const unlockedIds = achievementUnlockedIds();
  const unseenIds = new Set([...unlockedIds].filter((id) => !seenAchievementIds.has(id)));
  const visibleDefs = ACHIEVEMENTS.filter((def) => !def.planned || unlockedIds.has(def.id));
  const unlockedCount = visibleDefs.filter((def) => unlockedIds.has(def.id)).length;
  const completion = visibleDefs.length ? Math.round((unlockedCount / visibleDefs.length) * 100) : 0;
  const legendaryCount = visibleDefs.filter((def) => unlockedIds.has(def.id) && def.rarity === "legendary").length;
  const hiddenCount = visibleDefs.filter((def) => unlockedIds.has(def.id) && def.hidden).length;
  const filteredDefs = visibleDefs.filter((def) => matchesAchievementFilters(def, unlockedIds));

  achievementSummaryElement.textContent = `${unlockedCount} / ${visibleDefs.length}`;

  achievementCategoryTabs?.querySelectorAll<HTMLButtonElement>("[data-achievement-category]").forEach((button) => {
    const active = button.dataset.achievementCategory === achievementCategoryFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
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

function showAchievementDetail(def: AchievementDef) {
  const unlockedIds = achievementUnlockedIds();
  const unlocked = unlockedIds.has(def.id);
  const reveal = unlocked || !def.hidden;
  const unlock = achievementState.unlocked.find((u) => u.id === def.id);
  const unlockDate = unlock ? new Date(unlock.unlockedAt).toLocaleDateString(languageLocale(), { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  const rarityLabel = achievementRarityLabel(def.rarity);
  const categoryLabel = achievementCategoryLabel(def.category);
  const markIcon = unlocked ? "✦" : def.hidden && !unlocked ? "?" : "·";
  const copy = achievementText(def);

  const stats = ledger && tree && gameBalance ? calculateStats(ledger.entries, tree, gameBalance) : undefined;
  const context = stats ? buildAchievementContext(stats) : undefined;
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
      <span class="achievement-detail-rarity">${escapeHtml(rarityLabel)}</span>
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
    const peak = peakStat("peakXpPerMinute", stats.weather.tokensPerMinute);
    return {
      percent: clamp((peak / target) * 100, 0, 100),
      label: `${formatCompact(peak)} / ${formatCompact(target)} token/min`,
    };
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
    peakXpPerMinute: stats.weather.tokensPerMinute,
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

function syncAchievements(stats: Stats, context: AchievementContext) {
  if (!ledger || !tree || achievementSyncInFlight) return;
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
      queueAchievementToasts(result.unlocked.map((item) => item.id));
      renderAchievements(stats, context);
    })
    .finally(() => {
      achievementSyncInFlight = false;
    });
}

function buildAchievementContext(stats: Stats): AchievementContext {
  const entries = ledger?.entries ?? [];
  const dayXp = new Map<string, number>();
  const daySources = new Map<string, Set<HistorySourceId>>();
  const activeSources = new Set<HistorySourceId>();
  const sourceXp: Record<HistorySourceId, number> = { codex: 0, openclaw: 0, opencode: 0, claude: 0 };
  const hourSet = new Set<number>();
  const weekendDays = new Map<string, Set<number>>();
  const hourKeys = new Set<number>();
  let hasFibonacciSession = false;

  for (const entry of entries) {
    const xp = xpForEntry(entry);
    if (xp <= 0) continue;
    const createdAt = new Date(entry.createdAt);
    const key = dateKey(createdAt);
    dayXp.set(key, (dayXp.get(key) ?? 0) + xp);
    hourSet.add(createdAt.getHours());
    hourKeys.add(Math.floor(createdAt.getTime() / 3_600_000));
    if (isFibonacci(xp)) hasFibonacciSession = true;

    const source = historySourceId(entry);
    if (source) {
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
  const maxSourcesOneDay = Math.max(0, ...[...daySources.values()].map((sources) => sources.size));
  const stageIndex = tree ? tree.stages.findIndex((stage) => stage.id === stats.stage.id) : 0;

  return {
    stats,
    entries,
    stageIndex,
    maxDailyXp,
    consecutiveDays: longestConsecutiveDays(activeDayKeys),
    activeSources,
    maxSourcesOneDay,
    hasAgentSwitchWithinTenMinutes: hasAgentSwitchWithin(entries, 10 * 60 * 1000),
    sourceXp,
    hourSet,
    weekendWarrior: [...weekendDays.values()].some((days) => days.has(0) && days.has(6)),
    touchGrassReturn: hasReturnAfterInactiveGap(activeDayKeys, 7),
    coffeeOverdose: hasConsecutiveHourActivity(hourKeys, 8),
    hasFibonacciSession,
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
}

function queueAchievementToasts(ids: string[]) {
  const defs = ids.map((id) => ACHIEVEMENTS.find((def) => def.id === id)).filter((def): def is AchievementDef => Boolean(def));
  if (!defs.length) return;
  achievementToastQueue.push(...defs);
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
  const def = achievementToastQueue.shift()!;
  const copy = achievementText(def);
  achievementToastLayer.innerHTML = `
    <div class="achievement-toast rarity-${def.rarity}">
      <div class="achievement-toast-head">
        <span class="achievement-toast-meta">${escapeHtml(achievementRarityLabel(def.rarity))} · ${escapeHtml(t("achievementUnlocked"))}</span>
        <span class="achievement-toast-new">${escapeHtml(t("newBadge"))}</span>
      </div>
      <strong>${escapeHtml(copy.name)}</strong>
      <p>${escapeHtml(copy.description)}</p>
    </div>
  `;
  achievementToastTimer = window.setTimeout(() => {
    achievementToastLayer.innerHTML = "";
    achievementToastTimer = undefined;
    showNextAchievementToast();
  }, ACHIEVEMENT_TOAST_DURATION_MS);
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

function hasAgentSwitchWithin(entries: LedgerEntry[], windowMs: number) {
  const sorted = entries
    .map((entry) => ({ time: new Date(entry.createdAt).getTime(), source: historySourceId(entry) }))
    .filter((item): item is { time: number; source: HistorySourceId } => Boolean(item.source) && Number.isFinite(item.time))
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
}

function renderLeaderboardSettings() {
  if (leaderboardJoinInput) {
    leaderboardJoinInput.checked = leaderboardStatus.joined;
    leaderboardJoinInput.disabled = leaderboardStatus.syncing || !leaderboardStatus.configured;
  }
  if (leaderboardLoginButton) {
    leaderboardLoginButton.disabled = leaderboardStatus.syncing || !leaderboardStatus.configured || leaderboardStatus.authenticated;
    leaderboardLoginButton.textContent = t("loginGithub");
  }
  if (leaderboardLogoutButton) {
    leaderboardLogoutButton.disabled = leaderboardStatus.syncing || !leaderboardStatus.authenticated;
  }
  if (leaderboardSettingsSyncButton) {
    leaderboardSettingsSyncButton.disabled =
      leaderboardStatus.syncing || !leaderboardStatus.configured || !leaderboardStatus.joined;
    leaderboardSettingsSyncButton.textContent = leaderboardStatus.syncing ? t("leaderboardSyncing") : t("syncNow");
  }
  if (leaderboardPageSyncButton) {
    leaderboardPageSyncButton.disabled = !leaderboardStatus.configured;
    leaderboardPageSyncButton.textContent = t("joinLeaderboard");
  }

  if (leaderboardUserCard) {
    const profile = leaderboardStatus.profile;
    leaderboardUserCard.innerHTML = profile
      ? `
        ${leaderboardAvatar(profile.avatarUrl, profile.username)}
        <div>
          <strong>${escapeHtml(profile.username)}</strong>
          <span>${leaderboardStatus.joined ? t("leaderboardOnlyDailyTokens") : t("leaderboardSignedInNotJoined")}</span>
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
      return `
        <article class="leaderboard-row${isMe ? " is-me" : ""}">
          <strong class="leaderboard-rank">#${entry.rank}</strong>
          ${leaderboardAvatar(entry.avatarUrl, entry.username)}
          <div class="leaderboard-person">
            <strong>${escapeHtml(entry.username || t("unknownUser"))}${isMe ? ` <em>${t("leaderboardMe")}</em>` : ""}</strong>
            ${days}
          </div>
          <strong class="leaderboard-tokens">${formatNumber(entry.tokens)} token</strong>
        </article>
      `;
    })
    .join("");
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

function leaderboardRangeLabel(range: LeaderboardRange) {
  const labels: Record<LeaderboardRange, string> = {
    today: t("leaderboardToday"),
    "7d": t("leaderboard7d"),
    "30d": t("leaderboard30d"),
    all: t("leaderboardAllTime"),
  };
  return labels[range];
}

function leaderboardAvatar(avatarUrl: string | undefined, username: string) {
  const initial = (username || "?").trim().slice(0, 2).toUpperCase();
  if (!avatarUrl) return `<span class="leaderboard-avatar placeholder" aria-hidden="true">${escapeHtml(initial)}</span>`;
  return `<img class="leaderboard-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />`;
}

function renderScopedSourceBreakdown() {
  if (!ledger) return;
  renderSourceBreakdown(getSourceBreakdown(getSourceScopeEntries(ledger.entries)));
}

function renderSourceBreakdown(rows: SourceBreakdown[]) {
  const element = document.querySelector<HTMLElement>("#sourceBreakdown");
  if (!element) return;
  syncSourceScopeTabs();
  const totalXp = rows.reduce((total, row) => total + row.xp, 0);
  const activeSources = rows.filter((row) => row.xp > 0).length;
  text(
    "#sourceSummary",
    activeSources
      ? sourceActiveText(activeSources)
      : sourceScope === "today"
        ? t("waitingTodayTokens")
        : t("waitingTokens"),
  );
  element.innerHTML = getMonitorSourceRows(rows)
    .map((row) => {
      const percent = row.xp > 0 && totalXp > 0 ? Math.max(3, Math.round((row.xp / totalXp) * 100)) : 0;
      const expanded = expandedSourceKey === row.sourceKey;
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
            <p>in ${formatCompact(row.inputTokens)} · out ${formatCompact(row.outputTokens)} · cache ${formatCompact(row.cacheReadTokens)}</p>
          </div>
          ${expanded ? renderModelBreakdown(row.sourceKey) : ""}
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
};

function getMonitorSourceRows(rows: SourceBreakdown[]): SourceRowView[] {
  const monitors = [
    {
      sourceKey: "codex",
      label: "Codex",
      status: usageStatus?.codexSession,
      match: (row: SourceBreakdown) => row.id === "codex-desktop" || row.id === "codex-session" || row.label === "Codex",
    },
    {
      sourceKey: "claude",
      label: "Claude Code",
      status: usageStatus?.claudeSession,
      match: (row: SourceBreakdown) =>
        row.id === "claude-code" ||
        row.id === "claude-session" ||
        row.label === "Claude Code" ||
        row.id.startsWith("claude-code:"),
    },
    {
      sourceKey: "openclaw",
      label: "OpenClaw",
      status: usageStatus?.openclawSession,
      match: (row: SourceBreakdown) => row.id === "openclaw" || row.id === "openclaw-session" || row.label === "OpenClaw",
    },
    {
      sourceKey: "opencode",
      label: "OpenCode",
      status: usageStatus?.opencodeSession,
      match: (row: SourceBreakdown) =>
        row.id === "opencode" || row.id === "opencode-session" || row.label === "OpenCode" || row.id.startsWith("opencode:"),
    },
  ];
  const used = new Set<SourceBreakdown>();
  const monitorRows = monitors.map((monitor) => {
    const matches = rows.filter((row) => monitor.match(row));
    matches.forEach((row) => used.add(row));
    return {
      ...combineSourceRows(monitor.label, matches),
      sourceKey: monitor.sourceKey,
      ...monitorStatusView(monitor.status),
    };
  });
  return monitorRows;
}

function combineSourceRows(label: string, rows: SourceBreakdown[]): SourceBreakdown {
  return rows.reduce(
    (total, row) => ({
      ...total,
      xp: total.xp + row.xp,
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      cacheReadTokens: total.cacheReadTokens + row.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + row.cacheWriteTokens,
    }),
    { id: label, label, xp: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
}

function monitorStatusView(status: UsageStatus["codexSession"] | undefined) {
  if (!status) return { status: t("sourceChecking"), statusClass: "pending", meta: t("readingLocalRecords") };
  const running = status.exists && status.running;
  return {
    status: running ? t("sourceOnline") : t("sourceOffline"),
    statusClass: running ? "running" : "missing",
    meta: `${status.filesWatched} ${t("files")} · ${status.lastEventAt ? formatRelativeTime(status.lastEventAt) : t("waitingNewToken")}`,
  };
}

function renderModelBreakdown(sourceKey: string) {
  const rows = getModelBreakdown(sourceKey);
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
              <p>in ${formatCompact(row.inputTokens)} · out ${formatCompact(row.outputTokens)} · cache ${formatCompact(row.cacheReadTokens)}</p>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function getModelBreakdown(sourceKey: string) {
  if (!ledger) return [];
  const rows = new Map<string, SourceBreakdown>();
  for (const entry of getSourceScopeEntries(ledger.entries)) {
    if (!entryMatchesSourceKey(entry, sourceKey)) continue;
    const model = entry.model || entry.provider || "unknown";
    const existing =
      rows.get(model) ??
      {
        id: model,
        label: model,
        xp: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
    existing.xp += xpForEntry(entry);
    existing.inputTokens += safeTokens(entry.inputTokens ?? 0);
    existing.outputTokens += safeTokens(entry.outputTokens ?? 0);
    existing.cacheReadTokens += safeTokens(entry.cacheReadTokens ?? 0);
    existing.cacheWriteTokens += safeTokens(entry.cacheWriteTokens ?? 0);
    rows.set(model, existing);
  }
  return [...rows.values()].filter((row) => row.xp > 0).sort((a, b) => b.xp - a.xp);
}

function getSourceScopeEntries(entries: LedgerEntry[]) {
  if (sourceScope === "total") return entries;
  const todayKey = dateKey(new Date());
  return entries.filter((entry) => dateKey(new Date(entry.createdAt)) === todayKey);
}

function entryMatchesSourceKey(entry: LedgerEntry, sourceKey: string) {
  if (sourceKey === "codex") return entry.source === "codex-session" || entry.agent === "codex-desktop";
  if (sourceKey === "claude") return entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"));
  if (sourceKey === "openclaw") return entry.source === "openclaw-session" || entry.agent === "openclaw";
  if (sourceKey === "opencode") {
    return entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"));
  }
  if (sourceKey.startsWith("source:")) {
    const id = sourceKey.slice("source:".length);
    const entryId = entry.source === "manual" ? "manual" : entry.agent || entry.source;
    return entryId === id;
  }
  return false;
}

function buildTreeAsset(manifest: PureSvgManifest): TreeAsset {
  const labels: Record<string, string> = {
    sprout: "新芽",
    seedling: "幼苗",
    young: "小树",
    medium: "成长期",
    lush: "繁茂",
    full: "完全体",
  };

  return {
    id: "vibe-bonsai",
    displayName: "Vibe Tree",
    baseSize: { width: 96, height: 96 },
    defaultScale: 2,
    palette: {
      leaf: "#5bbf7a",
      rain: "#78b7d8",
      storm: "#fff2a8",
      soilGlow: "#f2a541",
      wind: "#d7f7d0",
    },
    stages: manifest.stages.map((stage) => ({
      id: stage.id,
      label: labels[stage.id] ?? stage.label,
      image: stage.asset,
    })),
  };
}

function calculateStats(entries: LedgerEntry[], asset: TreeAsset, balance: GameBalance): Stats {
  const now = Date.now();
  const peakWindowAgo = now - balance.activity.peakWindowSeconds * 1000;
  const activeWindowAgo = now - balance.activity.activeWindowSeconds * 1000;
  const todayKey = dateKey(new Date());
  const xp = entries.reduce((total, entry) => total + xpForEntry(entry), 0);
  const todayXp = entries
    .filter((entry) => dateKey(new Date(entry.createdAt)) === todayKey)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const lastFiveMinuteXp = entries
    .filter((entry) => new Date(entry.createdAt).getTime() >= peakWindowAgo)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const recentXp = entries
    .filter((entry) => new Date(entry.createdAt).getTime() >= activeWindowAgo)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const activeSessions = getActiveSessionCount(entries, activeWindowAgo);
  const levelState = getLevelState(xp, balance);
  const stageInfo = getStageForLevel(levelState.level, balance);
  const stage = asset.stages.find((item) => item.id === stageInfo.id) ?? asset.stages[0];
  const nextStage = getNextStageForLevel(levelState.level, balance);
  const stageProgress = getStageProgress(levelState.level, balance);
  const weather = getWeather(getWeatherRate(entries, now, balance), balance);

  return {
    xp,
    todayXp,
    level: levelState.level,
    levelXp: levelState.levelXp,
    nextLevelXp: levelState.nextLevelXp,
    levelProgress: levelState.progress,
    stage,
    nextStageLabel: nextStage?.label,
    stageProgress,
    weather,
    lastFiveMinuteXp,
    recentXp,
    activeSessions,
    sevenDays: getSevenDayRows(entries),
    sourceBreakdown: getSourceBreakdown(entries),
  };
}

function getLevelState(totalXp: number, balance: GameBalance) {
  let level = 1;
  let remaining = totalXp;
  let needed = xpForNextLevel(level, balance);
  while (remaining >= needed && level < balance.xp.maxLevel) {
    remaining -= needed;
    level += 1;
    needed = xpForNextLevel(level, balance);
  }
  return {
    level,
    levelXp: remaining,
    nextLevelXp: needed,
    progress: needed ? clamp(remaining / needed, 0, 1) : 1,
  };
}

function xpForNextLevel(level: number, balance: GameBalance) {
  return Math.round(balance.xp.levelBase * level ** balance.xp.levelExponent);
}

function getStageForLevel(level: number, balance: GameBalance) {
  return balance.stages.reduce((current, stage) => (level >= stage.minLevel ? stage : current), balance.stages[0]);
}

function getNextStageForLevel(level: number, balance: GameBalance) {
  return balance.stages.find((stage) => stage.minLevel > level);
}

function getStageProgress(level: number, balance: GameBalance) {
  const current = getStageForLevel(level, balance);
  const next = getNextStageForLevel(level, balance);
  if (!next) return 1;
  return clamp((level - current.minLevel) / (next.minLevel - current.minLevel), 0, 1);
}

function getWeatherRate(entries: LedgerEntry[], now: number, balance: GameBalance) {
  const recentTokens = getWindowXp(entries, now, balance.weather.rateWindowSeconds);
  return (recentTokens / balance.weather.rateWindowSeconds) * 60;
}

function getWindowXp(entries: LedgerEntry[], now: number, seconds: number) {
  return entries.reduce((total, entry) => {
    const ageSeconds = Math.max(0, (now - new Date(entry.createdAt).getTime()) / 1000);
    if (ageSeconds > seconds) return total;
    return total + xpForEntry(entry);
  }, 0);
}

function getActiveSessionCount(entries: LedgerEntry[], since: number) {
  const sessions = new Set<string>();
  for (const entry of entries) {
    if (new Date(entry.createdAt).getTime() < since) continue;
    if (xpForEntry(entry) <= 0) continue;
    sessions.add(entry.agent || entry.source);
  }
  return sessions.size;
}

function getWeather(tokensPerMinute: number, balance: GameBalance): WeatherState {
  const state = balance.weather.thresholds.reduce((current, candidate) => {
    return tokensPerMinute >= candidate.minXpPerMinute ? candidate : current;
  }, balance.weather.thresholds[0]);
  const maxWeatherRate = balance.weather.thresholds[balance.weather.thresholds.length - 1]?.minXpPerMinute || 1;
  return {
    id: state.id,
    label: state.label,
    tokensPerMinute,
    activity: clamp(tokensPerMinute / maxWeatherRate, 0, 1),
  };
}

function getSevenDayRows(entries: LedgerEntry[], filter: HistoryFilter = "all") {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = dateKey(date);
    const dayEntries = entries.filter(
      (entry) => sourceMatchesHistoryFilter(entry, filter) && dateKey(new Date(entry.createdAt)) === key,
    );
    const inputTokens = dayEntries.reduce((total, entry) => total + safeTokens(entry.inputTokens ?? 0), 0);
    const outputTokens = dayEntries.reduce((total, entry) => total + safeTokens(entry.outputTokens ?? 0), 0);
    const cacheReadTokens = dayEntries.reduce((total, entry) => total + safeTokens(entry.cacheReadTokens ?? 0), 0);
    const cacheWriteTokens = dayEntries.reduce((total, entry) => total + safeTokens(entry.cacheWriteTokens ?? 0), 0);
    const tokens = dayEntries.reduce((total, entry) => total + xpForEntry(entry), 0);
    const sources: Record<HistorySourceId, number> = { codex: 0, openclaw: 0, opencode: 0, claude: 0 };
    for (const entry of dayEntries) {
      const source = historySourceId(entry);
      if (source) sources[source] += xpForEntry(entry);
    }
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      tokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      sources,
    };
  });
}

function historySourceId(entry: LedgerEntry): HistorySourceId | undefined {
  if (entry.source === "codex-session" || entry.agent === "codex-desktop") return "codex";
  if (entry.source === "openclaw-session" || entry.agent === "openclaw") return "openclaw";
  if (entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"))) {
    return "opencode";
  }
  if (entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"))) return "claude";
  return undefined;
}

function sourceMatchesHistoryFilter(entry: LedgerEntry, filter: HistoryFilter) {
  if (filter === "all") return true;
  if (filter === "codex") {
    return entry.source === "codex-session" || entry.agent === "codex-desktop";
  }
  if (filter === "openclaw") {
    return entry.source === "openclaw-session" || entry.agent === "openclaw";
  }
  if (filter === "opencode") {
    return entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"));
  }
  return entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"));
}

function getSourceBreakdown(entries: LedgerEntry[]): SourceBreakdown[] {
  const rows = new Map<string, SourceBreakdown>();
  for (const entry of entries) {
    const id = entry.source === "manual" ? "manual" : entry.agent || entry.source;
    const existing =
      rows.get(id) ??
      {
        id,
        label: sourceLabel(id, entry.source),
        xp: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
    const inputTokens = safeTokens(entry.inputTokens ?? 0);
    const outputTokens = safeTokens(entry.outputTokens ?? 0);
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.cacheReadTokens += safeTokens(entry.cacheReadTokens ?? 0);
    existing.cacheWriteTokens += safeTokens(entry.cacheWriteTokens ?? 0);
    existing.xp += xpForEntry(entry);
    rows.set(id, existing);
  }
  return [...rows.values()].sort((a, b) => b.xp - a.xp);
}

function sourceLabel(id: string, source: string) {
  if (source === "manual") return t("manualFeed");
  if (id.startsWith("claude-code:")) return `Claude ${id.replace("claude-code:", "")}`;
  if (id === "claude-code" || source === "claude-session") return "Claude Code";
  if (id === "codex-desktop" || source === "codex-session") return "Codex";
  if (id === "openclaw" || source === "openclaw-session") return "OpenClaw";
  if (id.startsWith("opencode:")) return `OpenCode ${id.replace("opencode:", "")}`;
  if (id === "opencode" || source === "opencode-session") return "OpenCode";
  return id;
}

function renderHistoryChart(rows: HistoryDayRow[], filter: HistoryFilter) {
  const labels: Record<HistoryFilter, string> = {
    all: t("historyAllSources"),
    codex: "Codex",
    openclaw: "OpenClaw",
    opencode: "OpenCode",
    claude: "Claude Code",
  };
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  const max = Math.max(1, ...rows.map((row) => row.tokens));

  text("#historySummary", `${labels[filter]} · ${formatCompact(total)} token`);
  if (historyLegend) historyLegend.innerHTML = filter === "all" ? historyAgentLegendHtml() : historyTokenLegendHtml();

  historyTabs?.querySelectorAll<HTMLButtonElement>("[data-history-filter]").forEach((button) => {
    const active = button.dataset.historyFilter === filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (!historyBars) return;
  const chartKey = historyChartKey(rows, filter);
  if (chartKey === lastHistoryChartKey && historyBars.childElementCount > 0) return;
  lastHistoryChartKey = chartKey;
  historyBars.innerHTML = rows
    .map((row) => {
      const segmentTotal = filter === "all" ? row.tokens : row.tokens + row.cacheReadTokens + row.cacheWriteTokens;
      const height = row.tokens > 0 ? scaledHistoryHeight(row.tokens, max) : 0;
      const segments =
        filter === "all"
          ? `
              <span class="history-segment codex" style="height:${segmentPercent(row.sources.codex, segmentTotal)}%"></span>
              <span class="history-segment openclaw" style="height:${segmentPercent(row.sources.openclaw, segmentTotal)}%"></span>
              <span class="history-segment opencode" style="height:${segmentPercent(row.sources.opencode, segmentTotal)}%"></span>
              <span class="history-segment claude" style="height:${segmentPercent(row.sources.claude, segmentTotal)}%"></span>
            `
          : `
              <span class="history-segment input" style="height:${segmentPercent(row.inputTokens, segmentTotal)}%"></span>
              <span class="history-segment output" style="height:${segmentPercent(row.outputTokens, segmentTotal)}%"></span>
              <span class="history-segment cache-read" style="height:${segmentPercent(row.cacheReadTokens, segmentTotal)}%"></span>
              <span class="history-segment cache-write" style="height:${segmentPercent(row.cacheWriteTokens, segmentTotal)}%"></span>
            `;
      return `
        <article class="history-day" tabindex="0">
          <div class="history-bar-shell">
            <div class="history-stack" style="height:${height}%">
              ${segments}
            </div>
          </div>
          ${historyTooltipHtml(row, filter)}
          <strong>${formatCompact(row.tokens)}</strong>
          <span>${row.label}</span>
        </article>
      `;
    })
    .join("");
}

function historyChartKey(rows: HistoryDayRow[], filter: HistoryFilter) {
  return JSON.stringify({
    filter,
    rows: rows.map((row) => [
      row.label,
      row.tokens,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
      row.sources.codex,
      row.sources.openclaw,
      row.sources.opencode,
      row.sources.claude,
    ]),
  });
}

function historyTooltipHtml(row: HistoryDayRow, filter: HistoryFilter) {
  const items =
    filter === "all"
      ? [
          { label: "Codex", value: row.sources.codex, tone: "codex" },
          { label: "OpenClaw", value: row.sources.openclaw, tone: "openclaw" },
          { label: "OpenCode", value: row.sources.opencode, tone: "opencode" },
          { label: "Claude", value: row.sources.claude, tone: "claude" },
        ]
      : [
          { label: "input", value: row.inputTokens, tone: "input" },
          { label: "output", value: row.outputTokens, tone: "output" },
          { label: "cache hit", value: row.cacheReadTokens, tone: "cache-read" },
          { label: "cache write", value: row.cacheWriteTokens, tone: "cache-write" },
        ];

  return `
    <div class="history-tooltip" role="tooltip">
      <div class="history-tooltip-head">
        <span>${escapeHtml(row.label)}</span>
        <strong>${formatCompact(row.tokens)} token</strong>
      </div>
      <div class="history-tooltip-items">
        ${items
          .map(
            (item) => `
              <span class="${item.value > 0 ? "" : "empty"}">
                <i class="history-tooltip-dot ${item.tone}"></i>
                <b>${escapeHtml(item.label)}</b>
                <em>${formatCompact(item.value)}</em>
              </span>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function historyTokenLegendHtml() {
  return `
    <span><i class="legend-input"></i>input</span>
    <span><i class="legend-output"></i>output</span>
    <span><i class="legend-cache-read"></i>cache hit</span>
    <span><i class="legend-cache-write"></i>cache write</span>
  `;
}

function historyAgentLegendHtml() {
  return `
    <span><i class="legend-codex"></i>Codex</span>
    <span><i class="legend-openclaw"></i>OpenClaw</span>
    <span><i class="legend-opencode"></i>OpenCode</span>
    <span><i class="legend-claude"></i>Claude Code</span>
  `;
}

function segmentPercent(value: number, total: number) {
  if (value <= 0 || total <= 0) return 0;
  return Math.max(4, Math.round((value / total) * 100));
}

function scaledHistoryHeight(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0;
  return clamp((value / max) * 100, 1.5, 100);
}

function xpForEntry(entry: LedgerEntry) {
  return countedTokensForEntry(entry);
}

function safeTokens(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeBadgeMetric(value: string, fallback: BadgeMetric): BadgeMetric {
  return value === "level" || value === "total" || value === "rate" ? value : fallback;
}

function normalizeTotalDisplayUnit(value: string): TotalDisplayUnit {
  return value === "raw" || value === "k" || value === "m" || value === "wan" || value === "yi" ? value : "m";
}

function normalizeLeaderboardRange(value: unknown): LeaderboardRange {
  return value === "today" || value === "30d" || value === "all" ? value : "7d";
}

function formatByUnit(value: number, unit: TotalDisplayUnit) {
  const safeValue = Math.max(0, value);
  if (unit === "raw") return formatIntegerWithCommas(safeValue);
  if (unit === "wan") return `${formatScaledUnit(safeValue, 10_000)}万`;
  if (unit === "yi") return `${formatScaledUnit(safeValue, 100_000_000)}亿`;
  const divisor = unit === "m" ? 1_000_000 : 1_000;
  return `${formatIntegerWithCommas(Math.round(safeValue / divisor))}${unit}`;
}

function formatScaledUnit(value: number, divisor: number) {
  const scaled = value / divisor;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return new Intl.NumberFormat(languageLocale(), { maximumFractionDigits: digits }).format(scaled);
}

function formatIntegerWithCommas(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function weatherBackHtml(weather: WeatherId) {
  if (weather === "drizzle") {
    return `<svg class="weather-svg behind" viewBox="0 0 192 192">${cloud(118, 34, false, "small")}</svg>`;
  }
  if (weather === "rain") {
    return `<svg class="weather-svg behind" viewBox="0 0 192 192">${cloud(56, 34, false, "medium")}</svg>`;
  }
  if (weather === "thunder" || weather === "storm") {
    return `<svg class="weather-svg behind" viewBox="0 0 192 192">${cloud(weather === "storm" ? 102 : 104, weather === "storm" ? 32 : 30, true, weather === "storm" ? "wide" : "thunder")}</svg>`;
  }
  return "";
}

function weatherFrontHtml(weather: WeatherId) {
  if (weather === "clear") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="sun">${sunIcon(34, 34)}</g>
        <g class="spark-a">${tinySpark(36, 108)}${tinySpark(82, 84)}</g>
        <g class="spark-b">${tinySpark(146, 98)}</g>
      </svg>
    `;
  }
  if (weather === "breeze") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="wind-a">${windLine(118, 68, 24)}${windLine(110, 84, 30)}</g>
        <g class="wind-b">${windLine(124, 100, 22)}${leafBit(76, 96)}${leafBit(132, 94)}</g>
      </svg>
    `;
  }
  if (weather === "drizzle") {
    return `<svg class="weather-svg" viewBox="0 0 192 192"><g class="rain-slow">${drop(114, 56)}${drop(134, 68)}${drop(152, 86)}${drop(150, 116)}</g></svg>`;
  }
  if (weather === "rain") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="rain-slow">${drop(52, 72)}${drop(74, 66)}${drop(112, 68)}${drop(136, 76)}</g>
        <g class="rain-fast">${drop(48, 102)}${drop(88, 94)}${drop(126, 102)}${drop(148, 116)}</g>
        <g class="puddle">${puddle(72, 140)}${puddle(116, 142)}</g>
      </svg>
    `;
  }
  if (weather === "thunder") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="rain-slow">${drop(52, 72)}${drop(74, 66)}${drop(112, 68)}${drop(136, 76)}</g>
        <g class="rain-fast">${drop(48, 102)}${drop(88, 94)}${drop(126, 102)}${drop(148, 116)}</g>
        <g class="puddle">${puddle(72, 140)}${puddle(116, 142)}</g>
        <g class="bolt">${boltIcon(132, 58)}</g>
      </svg>
    `;
  }
  if (weather === "storm") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="rain-slant">${slantDrop(76, 70)}${slantDrop(100, 66)}${slantDrop(124, 72)}${slantDrop(146, 84)}${slantDrop(154, 104)}</g>
        <g class="wind-a">${windLine(56, 112, 28)}${windLine(52, 128, 22)}</g>
        <g class="wind-b">${windLine(112, 124, 30)}${leafBit(150, 92)}</g>
        <g class="puddle">${puddle(72, 140)}${puddle(116, 142)}</g>
      </svg>
    `;
  }
  return "";
}

function px(x: number, y: number, w: number, h: number, fill: string) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

function tinySpark(x: number, y: number) {
  return `${px(x, y + 4, 10, 4, "#ffd239")}${px(x + 3, y, 4, 12, "#ffd239")}`;
}

function sunIcon(x: number, y: number) {
  return `
    ${px(x, y, 17, 17, "#ffd239")}
    ${px(x + 5, y - 8, 5, 5, "#ffc928")}
    ${px(x + 5, y + 20, 5, 5, "#ffc928")}
    ${px(x - 8, y + 6, 5, 5, "#ffc928")}
    ${px(x + 20, y + 6, 5, 5, "#ffc928")}
    ${px(x + 4, y + 4, 8, 8, "#fff07a")}
  `;
}

function windLine(x: number, y: number, w: number) {
  return px(x, y, w, 4, "#b9e8f4");
}

function leafBit(x: number, y: number) {
  return px(x, y, 5, 5, "#83b93c");
}

function drop(x: number, y: number) {
  return px(x, y, 4, 14, "#86cbed");
}

function slantDrop(x: number, y: number) {
  return `<rect x="${x}" y="${y}" width="4" height="18" fill="#86cbed" transform="rotate(28 ${x} ${y})"/>`;
}

function puddle(x: number, y: number) {
  return `${px(x, y, 15, 4, "#5dbde7")}${px(x + 3, y - 2, 7, 2, "#9fe4ff")}`;
}

function boltIcon(x: number, y: number) {
  return `
    <polygon points="${x + 10},${y} ${x + 24},${y} ${x + 16},${y + 20} ${x + 26},${y + 20} ${x + 2},${y + 52} ${x + 10},${y + 28} ${x},${y + 28}" fill="#070807"/>
    <polygon points="${x + 12},${y + 4} ${x + 20},${y + 4} ${x + 12},${y + 24} ${x + 22},${y + 24} ${x + 6},${y + 44} ${x + 12},${y + 24} ${x + 4},${y + 24}" fill="#ffc928"/>
    ${px(x + 13, y + 6, 5, 7, "#fff07a")}
  `;
}

function cloud(x: number, y: number, dark: boolean, size: "small" | "medium" | "wide" | "thunder") {
  const main = dark ? "#66707a" : "#aebfca";
  const mid = dark ? "#505860" : "#7f929f";
  const hi = dark ? "#929ba3" : "#dfe9ee";
  const scale = size === "small" ? 0.72 : size === "wide" ? 0.92 : size === "thunder" ? 0.96 : 0.82;
  const sx = (value: number) => Math.round(value * scale);
  return `
    <g class="cloud" transform="translate(${x} ${y})">
      ${px(-sx(4), sx(22), sx(70), sx(18), "#070807")}
      ${px(sx(8), sx(10), sx(48), sx(24), "#070807")}
      ${px(sx(2), sx(24), sx(62), sx(12), main)}
      ${px(sx(14), sx(14), sx(40), sx(18), main)}
      ${px(sx(20), sx(14), sx(15), sx(6), hi)}
      ${px(sx(42), sx(24), sx(16), sx(8), mid)}
      ${px(sx(4), sx(32), sx(18), sx(8), mid)}
    </g>
  `;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(languageLocale()).format(Math.round(value));
}

function formatCompact(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute < 1_000) return `${Math.round(value)}`;

  const units = [
    { value: 1_000_000_000, suffix: "b" },
    { value: 1_000_000, suffix: "m" },
    { value: 1_000, suffix: "k" },
  ];
  const unit = units.find((item) => absolute >= item.value);
  if (!unit) return `${Math.round(value)}`;

  const scaled = absolute / unit.value;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const formatted = scaled.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");
  return `${sign}${formatted}${unit.suffix}`;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function text(selector: string, value: string) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
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
