import type { ViewMode } from "./types";

export function appShellHtml(viewMode: ViewMode) {
  if (viewMode === "pet") {
    return `
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
  }
  if (viewMode === "manager") {
    return `
    <main class="manager-root" data-weather="clear" data-active="false">
      <div class="window-chrome">
        <span class="window-title">Vibe Tree</span>
      </div>
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
      <div class="floating-tool-group" aria-label="快捷操作">
        <button class="settings-fab" id="settingsButton" type="button" aria-label="打开设置" title="设置" data-i18n-aria="openSettings" data-i18n-title="settings">
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065" />
            <path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />
          </svg>
          <span class="settings-update-badge" aria-hidden="true">NEW</span>
        </button>
        <button class="share-export-button share-fab" id="shareExportButton" type="button" aria-label="分享成长图" title="分享成长图" data-i18n-aria="exportShareImage" data-i18n-title="exportShareImage">
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <path d="M13 4v4c-6.575 1.028 -9.02 6.788 -10 12c-.037 .206 5.384 -5.962 10 -6v4l8 -7l-8 -7" />
          </svg>
        </button>
      </div>

      <section class="dashboard">
        <header class="dashboard-header">
          <div>
            <p class="eyebrow" data-i18n="liveGrowth">Live growth</p>
            <div class="level-title-row">
              <h2 id="levelTitle">Lv.1 新芽</h2>
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
            <span class="next-level-help">
              <span id="nextLevelText">距离 Lv.2</span>
              <span class="help-tip" tabindex="0" aria-label="Token = input + output + cache read + cache write" data-tooltip="Token = input + output + cache read + cache write" data-i18n-tooltip="tokenHelp">?</span>
            </span>
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
            <div class="leaderboard-header-actions">
              <button class="secondary-button leaderboard-refresh-button" id="leaderboardPageRefreshButton" type="button" data-i18n="refreshLeaderboard">刷新并同步</button>
              <button class="secondary-button leaderboard-sync-button" id="leaderboardPageSyncButton" type="button" data-i18n="joinLeaderboard">加入排行</button>
            </div>
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
              <label class="scale-select">
                <span data-i18n="fontSize">字体</span>
                <select id="fontScaleSelect">
                  <option value="1">1x</option>
                  <option value="1.15">1.15x</option>
                  <option value="1.3">1.3x</option>
                  <option value="1.5">1.5x</option>
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
            <h4 data-i18n="visualTheme">界面主题</h4>
            <div class="theme-switcher" id="themeSwitcher" aria-label="界面主题" data-i18n-aria="visualTheme">
              <button type="button" data-ui-theme="day">
                <span data-i18n="themeDay">白天</span>
                <small data-i18n="themeDayNote">清爽浅色，适合白天工作</small>
              </button>
              <button type="button" data-ui-theme="night">
                <span data-i18n="themeNight">黑夜</span>
                <small data-i18n="themeNightNote">低亮深色，适合夜间专注</small>
              </button>
              <button type="button" data-ui-theme="soft">
                <span data-i18n="themeSoft">柔和</span>
                <small data-i18n="themeSoftNote">暖色低对比，看起来更柔和</small>
              </button>
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
              <label class="toggle-row leaderboard-preference-public-row">
                <input id="leaderboardPreferencesPublicInput" type="checkbox" />
                <span>
                  <strong data-i18n="leaderboardPreferencePublic">公开使用偏好</strong>
                </span>
              </label>
              <div class="leaderboard-help" aria-label="数据安全说明" data-i18n-aria="leaderboardPrivacyTitle">
                <strong data-i18n="leaderboardPrivacyTitle">数据安全说明</strong>
                <p data-i18n="leaderboardPrivacyDefault">默认只同步每日 Token 总量和本地首次使用日期。</p>
                <p data-i18n="leaderboardPrivacyPreference">开启公开使用偏好后，会额外上传使用的 Agent、模型、时段和峰值 Token，不会包含任何提示词、会话记录、文件、路径或其他敏感信息。</p>
                <p data-i18n="leaderboardPrivacyExit">您可以随时选择退出，退出后，您的信息将被完全删除。</p>
              </div>
              <div class="leaderboard-actions">
                <button class="secondary-button" id="leaderboardMembershipButton" type="button" data-i18n="joinLeaderboard">加入排行</button>
                <button class="secondary-button" id="leaderboardSettingsSyncButton" type="button" data-i18n="syncNow">立即同步</button>
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
              <label class="proxy-setting">
                <span data-i18n="proxyUrl">网络代理</span>
                <input id="proxyUrlInput" type="url" inputmode="url" placeholder="留空使用系统设置，例如 http://127.0.0.1:7897" data-i18n-placeholder="proxyPlaceholder" />
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
                <button class="secondary-button update-notes-button" id="updateNotesButton" type="button" data-i18n="viewUpdateNotes" hidden>查看更新内容</button>
              </div>
            </div>
          </section>

          <section class="settings-section">
            <h4 data-i18n="agentPaths">Agent 路径</h4>
            <div class="path-settings" id="sourceSettings" aria-label="Agent 路径和统计来源" data-i18n-aria="agentSourcesAria">
              <div class="agent-source-row">
                <label class="agent-source-toggle">
                  <input type="checkbox" data-stats-source="codex" />
                  <span data-i18n="codexPath">Codex 路径</span>
                </label>
                <input id="codexSessionsDirInput" type="text" placeholder="~/.codex/sessions" aria-label="Codex path" />
              </div>
              <div class="agent-source-row">
                <label class="agent-source-toggle">
                  <input type="checkbox" data-stats-source="claude" />
                  <span data-i18n="claudePath">Claude 路径</span>
                </label>
                <input id="claudeSessionsDirInput" type="text" placeholder="~/.claude/projects" aria-label="Claude path" />
              </div>
              <div class="agent-source-row">
                <label class="agent-source-toggle">
                  <input type="checkbox" data-stats-source="openclaw" />
                  <span data-i18n="openclawPath">OpenClaw 路径</span>
                </label>
                <input id="openclawSessionsDirInput" type="text" placeholder="~/.openclaw/agents" aria-label="OpenClaw path" />
              </div>
              <div class="agent-source-row">
                <label class="agent-source-toggle">
                  <input type="checkbox" data-stats-source="pi" />
                  <span data-i18n="piPath">Pi Agent 路径</span>
                </label>
                <input id="piSessionsDirInput" type="text" placeholder="~/.pi/agent/sessions" aria-label="Pi Agent path" />
              </div>
              <div class="agent-source-row">
                <label class="agent-source-toggle">
                  <input type="checkbox" data-stats-source="opencode" />
                  <span data-i18n="opencodePath">OpenCode 路径</span>
                </label>
                <input id="opencodeSessionsDirInput" type="text" placeholder="~/.local/share/opencode/opencode.db" aria-label="OpenCode path" />
              </div>
              <div class="agent-source-row">
                <label class="agent-source-toggle">
                  <input type="checkbox" data-stats-source="gemini" />
                  <span data-i18n="geminiPath">Gemini 路径</span>
                </label>
                <input id="geminiSessionsDirInput" type="text" placeholder="~/.gemini/tmp" aria-label="Gemini path" />
              </div>
              <div class="agent-source-row">
                <label class="agent-source-toggle">
                  <input type="checkbox" data-stats-source="hermes" />
                  <span data-i18n="hermesPath">Hermes 路径</span>
                </label>
                <input id="hermesSessionsDirInput" type="text" placeholder="~/.hermes/state.db" aria-label="Hermes path" />
              </div>
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
  }
  return `
    <main class="toast-root" data-placement="right">
      <div class="achievement-toast-layer" id="achievementToastLayer" aria-live="polite"></div>
    </main>
  `;
}
