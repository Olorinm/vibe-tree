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
        <div class="level-badge" id="petLevelBadge">
          <span class="badge-card">
            <span class="badge-face badge-front">Lv.1</span>
            <span class="badge-face badge-back">0</span>
          </span>
        </div>
        <button class="pet-hitbox" id="petHitbox" type="button" aria-label="打开管理窗口" data-i18n-aria="openManager"></button>
      </section>
    </main>
	  `;
  }
  if (viewMode === "menubar") {
    return `
    <main class="menubar-root" data-weather="clear" data-active="false">
      <section class="menubar-panel" aria-label="Vibe Tree">
        <header class="menubar-topbar">
          <div class="menubar-brand">
            <p class="eyebrow">Vibe Tree</p>
            <span class="menubar-lv-chip" id="menubarLevelChip">Lv.1</span>
          </div>
          <div class="menubar-weather">
            <span class="menubar-live-dot" id="menubarLiveDot" aria-hidden="true"></span>
            <span id="menubarWeatherText">—</span>
          </div>
        </header>

        <div class="menubar-hero-growth">
          <div class="menubar-hero-main">
            <span class="menubar-hero-label" data-i18n="metricToday">今日成长</span>
            <strong class="menubar-hero-value" id="menubarTodayText">+0</strong>
          </div>
          <div class="menubar-hero-ctx" id="menubarTodayCtx"></div>
        </div>

        <section class="menubar-progress">
          <div class="menubar-progress-row">
            <span id="menubarNextLevelText">距离 Lv.2</span>
            <strong id="menubarProgressPercent">0%</strong>
          </div>
          <div class="source-meter" aria-hidden="true"><span id="menubarProgressBar"></span></div>
          <p id="menubarProgressText">0 / 0 token</p>
        </section>

        <div class="menubar-slot">
          <article class="menubar-viz active" data-viz="rhythm">
            <div class="menubar-viz-head">
              <span class="menubar-viz-title" data-i18n="menubarRhythmTitle">24h 节奏</span>
              <span class="menubar-viz-meta" id="menubarRhythmMeta"></span>
            </div>
            <div class="menubar-rhythm-bars" id="menubarRhythmBars" aria-hidden="true"></div>
            <div class="menubar-rhythm-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
          </article>

          <article class="menubar-viz" data-viz="sync">
            <div class="menubar-viz-head">
              <span class="menubar-viz-title" data-i18n="menubarSyncTitle">同养小树</span>
              <button class="menubar-action" id="menubarSyncButton" type="button" data-i18n="menubarSyncAction">同步</button>
            </div>
            <div class="menubar-sync-list" id="menubarSyncList"></div>
          </article>

          <article class="menubar-viz" data-viz="activity">
            <div class="menubar-viz-head">
              <span class="menubar-viz-title" data-i18n="menubarActivityTitle">Agent 状态</span>
              <span class="menubar-viz-meta" id="menubarActivityMeta"></span>
            </div>
            <div class="menubar-activity-list" id="menubarActivityList"></div>
          </article>

          <article class="menubar-viz" data-viz="rank">
            <div class="menubar-viz-head">
              <span class="menubar-viz-title" data-i18n="menubarLeaderboard24h">24h 排行榜</span>
              <button class="menubar-action" id="menubarRankRefreshButton" type="button" data-i18n="refreshLeaderboard">刷新榜单</button>
            </div>
            <div class="menubar-rank-list" id="menubarRankList"></div>
          </article>

          <article class="menubar-viz" data-viz="sources">
            <div class="menubar-viz-head">
              <span class="menubar-viz-title" data-i18n="menubarTodaySources">今日来源</span>
              <span class="menubar-viz-meta" id="menubarSourceSummary"></span>
            </div>
            <div class="menubar-source-list" id="menubarSourceList"></div>
          </article>

          <article class="menubar-viz" data-viz="speed">
            <div class="menubar-viz-head">
              <span class="menubar-viz-title" data-i18n="menubarSpeedTitle">实时速率</span>
              <span class="menubar-viz-meta" id="menubarSpeedMeta"></span>
            </div>
            <div class="menubar-wave" id="menubarWave" aria-hidden="true"></div>
            <div class="menubar-speed-foot">
              <span id="menubarSpeedWindow">近 5 分钟</span>
              <span class="menubar-speed-peak" id="menubarSpeedPeak"></span>
              <strong id="menubarSpeedTotal">+0</strong>
            </div>
          </article>
        </div>

        <div class="menubar-dots" id="menubarDots" role="tablist" aria-label="可视化切换"></div>
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
          <button type="button" data-dashboard-tab="social" data-i18n="social">社交</button>
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

      <section class="tree-start-modal" id="treeStartModal" hidden>
        <div class="tree-start-card">
          <div class="tree-start-copy">
            <p class="eyebrow" data-i18n="treeStartEyebrow">First run</p>
            <h2 data-i18n="treeStartTitle">你想怎么开始？</h2>
            <p data-i18n="treeStartCopy">可以从这台设备开始，也可以登录同一账号同步云端小树。</p>
          </div>
          <div class="tree-start-preview" aria-hidden="true">
            <img id="treeStartTreeImage" alt="" />
            <span>Lv.1</span>
          </div>
          <div class="tree-start-feedback-row">
            <div class="tree-start-feedback" id="treeStartFeedback" aria-live="polite"></div>
            <button class="tree-start-cancel" id="treeStartCancelButton" type="button" data-i18n="treeStartCancelSync" hidden>
              取消同步
            </button>
          </div>
          <div class="tree-start-options">
            <button class="tree-start-option" id="treeStartNewButton" type="button">
              <span class="tree-start-option-text">
                <span class="tree-start-option-kicker" data-i18n="treeStartNewKicker">本机新开始</span>
                <strong data-i18n="treeStartNewTitle">新养一棵树</strong>
                <span class="tree-start-option-copy" data-i18n="treeStartNewCopy">只统计这台设备之后产生的新 token。</span>
              </span>
            </button>
            <button class="tree-start-option is-primary" id="treeStartExistingButton" type="button">
              <span class="tree-start-option-text">
                <span class="tree-start-option-kicker" data-i18n="treeStartExistingKicker">云端同步</span>
                <strong data-i18n="treeStartExistingTitle">同步云端小树</strong>
                <span class="tree-start-option-copy" data-i18n="treeStartExistingCopy">登录同一账号，合并其他设备的 Token、等级和成就。</span>
              </span>
            </button>
          </div>
        </div>
      </section>

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
              <button class="secondary-button leaderboard-refresh-button" id="leaderboardPageRefreshButton" type="button" data-i18n="refreshLeaderboard">刷新榜单</button>
              <button class="secondary-button leaderboard-sync-button" id="leaderboardPageSyncButton" type="button">加入排行</button>
            </div>
          </div>
          <div class="leaderboard-range-tabs" id="leaderboardRangeTabs" role="tablist" aria-label="全球排行榜范围" data-i18n-aria="leaderboardAria">
            <button type="button" data-leaderboard-range="24h" data-i18n="leaderboard24h">24h</button>
            <button type="button" data-leaderboard-range="7d" data-i18n="leaderboard7d">7 天</button>
            <button type="button" data-leaderboard-range="30d" data-i18n="leaderboard30d">30 天</button>
            <button type="button" data-leaderboard-range="all" data-i18n="leaderboardAllTime">全部</button>
          </div>
          <div class="leaderboard-summary" id="leaderboardSummary"></div>
          <div class="leaderboard-rows" id="leaderboardRows"></div>
        </section>

        <section class="social-card" aria-label="好友与群组" data-i18n-aria="socialAria">
          <div class="section-header">
            <div>
              <p class="eyebrow" data-i18n="socialEyebrow">Guild hall</p>
              <h3 data-i18n="socialTitle">好友 / 群组</h3>
            </div>
            <div class="social-header-actions">
              <button class="secondary-button social-settings-button" id="socialSettingsButton" type="button" data-i18n="socialSettings">设置</button>
              <button class="secondary-button social-refresh-button" id="socialRefreshButton" type="button" data-i18n="socialRefresh">刷新</button>
            </div>
          </div>
          <div class="social-mode-tabs" id="socialModeTabs" role="tablist" aria-label="社交分类" data-i18n-aria="socialModeAria">
            <button type="button" data-social-panel="friends" data-i18n="socialPanelFriends">好友</button>
            <button type="button" data-social-panel="groups" data-i18n="socialPanelGroups">群组</button>
          </div>
          <div class="leaderboard-summary social-summary" id="socialSummary"></div>
          <div class="social-panel social-friends-panel" id="socialFriendsPanel">
            <form class="social-mini-form" id="socialAddFriendForm">
              <label for="socialFriendUsernameInput" data-i18n="socialAddFriend">添加好友</label>
              <div class="social-input-row">
                <input id="socialFriendUsernameInput" type="text" maxlength="80" autocomplete="off" spellcheck="false" placeholder="GitHub 用户名" data-i18n-placeholder="socialFriendUsernamePlaceholder" />
                <button class="secondary-button" id="socialAddFriendButton" type="submit" data-i18n="socialAddFriendAction">添加</button>
              </div>
            </form>
            <div class="social-group-inbox" id="socialGroupInbox"></div>
            <div class="social-friend-list" id="socialFriendList"></div>
          </div>
          <div class="social-panel social-groups-panel" id="socialGroupsPanel" hidden>
            <div class="social-groups-shell" id="socialGroupsShell">
              <div class="social-groups-sidebar">
                <div class="social-empty-copy" id="socialGroupIntro">
                  <strong data-i18n="socialGroupsEmpty">还没有群组</strong>
                  <span data-i18n="socialCreateOrJoin">创建一个群组，或用邀请码加入朋友的群组。</span>
                </div>
                <button class="secondary-button social-group-manage-button" id="socialGroupManageButton" type="button" data-i18n="socialGroupManage">管理群组</button>
                <div class="social-group-list" id="socialGroupList"></div>
              </div>
              <div class="social-detail-panel" id="socialGroupDetailPanel">
                <div class="social-detail-header" id="socialGroupDetail"></div>
                <div class="social-toolbar">
                  <div class="leaderboard-range-tabs social-range-tabs" id="socialGroupRangeTabs" role="tablist" aria-label="群组排行榜范围" data-i18n-aria="socialGroupLeaderboardAria">
                    <button type="button" data-social-group-range="24h" data-i18n="leaderboard24h">24h</button>
                    <button type="button" data-social-group-range="7d" data-i18n="leaderboard7d">7 天</button>
                    <button type="button" data-social-group-range="30d" data-i18n="leaderboard30d">30 天</button>
                    <button type="button" data-social-group-range="all" data-i18n="leaderboardAllTime">全部</button>
                  </div>
                  <div class="leaderboard-range-tabs social-basis-tabs" id="socialGroupBasisTabs" role="tablist" aria-label="群组榜单口径" data-i18n-aria="socialGroupBasisAria">
                    <button type="button" data-social-group-basis="total" data-i18n="socialGroupBasisTotal">总用量</button>
                    <button type="button" data-social-group-basis="since_join" data-i18n="socialGroupBasisSinceJoin">入群后</button>
                  </div>
                  <div class="social-group-controls" id="socialGroupControls" aria-label="群组操作" data-i18n-aria="socialGroupControlsAria"></div>
                </div>
                <p class="social-board-note" data-i18n="socialGroupContributionNote">可切换总用量 / 入群后贡献；时间范围用 24h / 7 天 / 30 天 / 全部控制。</p>
                <div class="leaderboard-rows social-leaderboard-rows" id="socialGroupLeaderboardRows"></div>
              </div>
            </div>
          </div>
        </section>

        <section class="social-settings-modal" id="socialSettingsModal" aria-hidden="true" hidden>
          <div class="social-settings-backdrop" id="socialSettingsBackdrop"></div>
          <div class="social-settings-panel" role="dialog" aria-modal="true" aria-labelledby="socialSettingsTitle">
            <header>
              <p class="eyebrow" data-i18n="socialEyebrow">Guild hall</p>
              <h3 id="socialSettingsTitle" data-i18n="socialSettingsTitle">社交设置</h3>
              <button class="icon-button" id="socialSettingsCloseButton" type="button" aria-label="关闭设置" data-i18n-aria="closeSettings">×</button>
            </header>
            <p class="social-settings-intro" data-i18n="socialSettingsHint">管理资料卡展示范围。每个群的排行榜共享仍在群组详情里单独控制。</p>
            <div class="social-profile-privacy-settings" id="socialProfilePrivacySettings">
              <label class="scale-select">
                <span data-i18n="socialProfileVisibilityLabel">谁可以打开资料卡</span>
                <select id="socialProfileVisibilitySelect">
                  <option value="relations" data-i18n="socialProfileVisibilityRelations">好友和同群成员</option>
                  <option value="friends" data-i18n="socialProfileVisibilityFriends">仅好友</option>
                  <option value="private" data-i18n="socialProfileVisibilityPrivate">仅自己</option>
                </select>
              </label>
              <label class="toggle-row">
                <input id="socialProfileShowLevelInput" type="checkbox" />
                <span data-i18n="socialProfileShowLevel">展示等级和阶段</span>
              </label>
              <label class="toggle-row">
                <input id="socialProfileShowTokenTotalInput" type="checkbox" />
                <span data-i18n="socialProfileShowTokenTotal">展示累计 Token</span>
              </label>
              <label class="toggle-row">
                <input id="socialProfileShowActiveDaysInput" type="checkbox" />
                <span data-i18n="socialProfileShowActiveDays">展示活跃天数</span>
              </label>
              <label class="toggle-row">
                <input id="socialProfileShowAchievementsInput" type="checkbox" />
                <span data-i18n="socialProfileShowAchievements">展示成就陈列</span>
              </label>
              <div class="leaderboard-status" id="socialProfilePrivacyStatus"></div>
            </div>
          </div>
        </section>

        <section class="social-group-actions-modal" id="socialGroupActionsModal" aria-hidden="true" hidden>
          <div class="social-group-actions-backdrop" id="socialGroupActionsBackdrop"></div>
          <div class="social-group-actions-panel" role="dialog" aria-modal="true" aria-labelledby="socialGroupActionsTitle">
            <header>
              <p class="eyebrow" data-i18n="socialEyebrow">Guild hall</p>
              <h3 id="socialGroupActionsTitle" data-i18n="socialGroupActions">创建或加入群组</h3>
              <button class="icon-button" id="socialGroupActionsCloseButton" type="button" aria-label="关闭设置" data-i18n-aria="closeSettings">×</button>
            </header>
            <div class="social-action-stack">
              <p class="social-visibility-note" data-i18n="socialGroupVisibilityNote">加入群组后，群成员可以看到你的 Token 总用量（不含提示词、会话或文件）。可在群组详情里随时停止共享。</p>
              <form class="social-mini-form" id="socialCreateGroupForm">
                <label for="socialGroupNameInput" data-i18n="socialCreateGroup">创建群组</label>
                <div class="social-input-row">
                  <input id="socialGroupNameInput" type="text" maxlength="48" autocomplete="off" placeholder="群组名" data-i18n-placeholder="socialGroupNamePlaceholder" />
                  <button class="secondary-button" id="socialCreateGroupButton" type="submit" data-i18n="socialCreateGroupAction">创建</button>
                </div>
              </form>
              <form class="social-mini-form" id="socialJoinInviteForm">
                <label for="socialInviteCodeInput" data-i18n="socialJoinInvite">邀请码加入</label>
                <div class="social-input-row">
                  <input id="socialInviteCodeInput" type="text" autocomplete="off" spellcheck="false" placeholder="邀请码" data-i18n-placeholder="socialInvitePlaceholder" />
                  <button class="secondary-button" id="socialJoinInviteButton" type="submit" data-i18n="socialJoinInviteAction">加入</button>
                </div>
              </form>
              <section class="social-mini-form social-invite-manager" id="socialInviteManager" hidden>
                <div class="social-mini-form-label" data-i18n="socialInviteManager">当前群组邀请</div>
                <div class="social-invite-manager-summary" id="socialInviteGroupSummary"></div>
                <form class="social-mini-form social-friend-invite-form" id="socialGroupFriendInviteForm">
                  <label for="socialGroupFriendInviteSelect" data-i18n="socialInviteFriend">邀请好友入群</label>
                  <div class="social-input-row">
                    <select id="socialGroupFriendInviteSelect"></select>
                    <button class="secondary-button" id="socialGroupFriendInviteButton" type="submit" data-i18n="socialInviteFriendAction">邀请</button>
                  </div>
                </form>
                <button class="secondary-button social-invite-button" id="socialCreateInviteButton" type="button" data-i18n="socialCreateInvite">生成邀请</button>
                <div class="social-invite-output" id="socialInviteOutput"></div>
                <div class="social-group-request-list" id="socialGroupRequestList"></div>
              </section>
            </div>
          </div>
        </section>

        <section class="social-profile-modal" id="socialProfileModal" aria-hidden="true" hidden>
          <div class="social-profile-backdrop" id="socialProfileBackdrop"></div>
          <div class="social-profile-panel" role="dialog" aria-modal="true" aria-labelledby="socialProfileTitle">
            <header>
              <p class="eyebrow" data-i18n="socialProfileEyebrow">Adventurer</p>
              <h3 id="socialProfileTitle" data-i18n="socialProfileTitle">资料卡</h3>
              <button class="icon-button" id="socialProfileCloseButton" type="button" aria-label="关闭" data-i18n-aria="close">×</button>
            </header>
            <div class="social-profile-body" id="socialProfileBody"></div>
          </div>
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

          <div class="settings-layout">
            <nav class="settings-nav" id="settingsNav" role="tablist" aria-label="设置分类" data-i18n-aria="settingsCategoriesAria">
              <button id="settingsCategoryBasicTab" type="button" role="tab" aria-selected="true" aria-controls="settingsCategoryBasic" data-settings-category-button="basic" data-i18n="settingsCategoryBasic">基础</button>
              <button id="settingsCategoryMenubarTab" type="button" role="tab" aria-selected="false" aria-controls="settingsCategoryMenubar" data-settings-category-button="menubar" data-i18n="settingsCategoryMenubar">浮窗</button>
              <button id="settingsCategorySyncTab" type="button" role="tab" aria-selected="false" aria-controls="settingsCategorySync" data-settings-category-button="sync" data-i18n="settingsCategorySync">同步</button>
              <button id="settingsCategoryUpdatesTab" type="button" role="tab" aria-selected="false" aria-controls="settingsCategoryUpdates" data-settings-category-button="updates" data-i18n="settingsCategoryUpdates">更新</button>
              <button id="settingsCategorySourcesTab" type="button" role="tab" aria-selected="false" aria-controls="settingsCategorySources" data-settings-category-button="sources" data-i18n="settingsCategorySources">路径</button>
            </nav>

            <div class="settings-content">
              <div class="settings-category-panel" id="settingsCategoryBasic" role="tabpanel" aria-labelledby="settingsCategoryBasicTab" data-settings-category-panel="basic">
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
                  <h4 data-i18n="startupNetwork">启动与网络</h4>
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
              </div>

              <div class="settings-category-panel" id="settingsCategoryMenubar" role="tabpanel" aria-labelledby="settingsCategoryMenubarTab" data-settings-category-panel="menubar" hidden>
                <section class="settings-section">
                  <h4 data-i18n="settingsMenubarTitle">菜单栏浮窗组件</h4>
                  <p class="settings-hint" data-i18n="settingsMenubarHint">勾选要在菜单栏浮窗显示的组件，用箭头调整顺序。至少保留一个。</p>
                  <div class="menubar-component-list" id="menubarComponentList"></div>
                </section>
              </div>

              <div class="settings-category-panel" id="settingsCategorySync" role="tabpanel" aria-labelledby="settingsCategorySyncTab" data-settings-category-panel="sync" hidden>
                <section class="settings-section">
                  <h4 data-i18n="globalLeaderboard">全球排行榜</h4>
                  <div class="leaderboard-settings" aria-label="全球排行榜设置" data-i18n-aria="leaderboardAria">
                    <div class="leaderboard-user-card" id="leaderboardUserCard"></div>
                    <div class="leaderboard-status" id="leaderboardStatusText"></div>
                    <label class="toggle-row">
                      <input id="leaderboardAutoSyncInput" type="checkbox" />
                      <span data-i18n="leaderboardAutoSyncHourly">每小时自动同步排行榜</span>
                    </label>
                    <label class="toggle-row leaderboard-preference-public-row">
                      <input id="leaderboardPreferencesPublicInput" type="checkbox" />
                      <span>
                        <strong data-i18n="leaderboardPreferencePublic">公开使用偏好</strong>
                      </span>
                    </label>
                    <div class="leaderboard-help" aria-label="数据安全说明" data-i18n-aria="leaderboardPrivacyTitle">
                      <strong data-i18n="leaderboardPrivacyTitle">数据安全说明</strong>
                      <p data-i18n="leaderboardPrivacyDefault">默认只同步每日 Token 总量、24h 小时级 Token 汇总和本地首次使用日期。</p>
                      <p data-i18n="leaderboardPrivacyPreference">开启公开使用偏好后，会额外上传使用的 Agent、模型、时段和峰值 Token，不会包含任何提示词、会话记录、文件、路径或其他敏感信息。</p>
                      <p data-i18n="leaderboardPrivacyExit">您可以随时选择退出，退出后，您的信息将被完全删除。</p>
                    </div>
                  </div>
                </section>

                <section class="settings-section">
                  <h4 data-i18n="cloudSyncTitle">同养一棵树</h4>
                  <div class="cloud-sync-settings">
                    <div class="leaderboard-status" id="cloudSyncStatusText"></div>
                    <div class="leaderboard-actions">
                      <button class="secondary-button" id="cloudSyncActionButton" type="button" data-i18n="cloudSyncConnectAndSync">连接并同步小树</button>
                    </div>
                    <label class="toggle-row">
                      <input id="cloudSyncAutoSyncInput" type="checkbox" />
                      <span data-i18n="cloudSyncAutoSyncHourly">每小时自动同步小树</span>
                    </label>
                    <div class="leaderboard-help">
                      <strong data-i18n="cloudSyncPrivacyTitle">同步内容</strong>
                      <p data-i18n="cloudSyncPrivacyCopy">同步 token 事件、设备 id、成就状态和按天汇总的模型 token。不会上传提示词、回复、文件内容、本地路径或单条会话。</p>
                    </div>
                    <div class="cloud-device-list" id="cloudSyncDeviceList"></div>
                  </div>
                </section>
              </div>

              <div class="settings-category-panel" id="settingsCategoryUpdates" role="tabpanel" aria-labelledby="settingsCategoryUpdatesTab" data-settings-category-panel="updates" hidden>
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

                <section class="settings-section release-section">
                  <h4 data-i18n="releasePage">发布页</h4>
                  <div class="release-settings">
                    <span data-i18n="releaseDescription">查看版本记录和发布说明</span>
                    <button class="secondary-button" id="releasePageButton" type="button" data-i18n="openReleasePage">打开发布页</button>
                  </div>
                </section>
              </div>

              <div class="settings-category-panel" id="settingsCategorySources" role="tabpanel" aria-labelledby="settingsCategorySourcesTab" data-settings-category-panel="sources" hidden>
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
                    <div class="agent-source-row">
                      <label class="agent-source-toggle">
                        <input type="checkbox" data-stats-source="kimi" />
                        <span data-i18n="kimiPath">Kimi Code 路径</span>
                      </label>
                      <input id="kimiSessionsDirInput" type="text" placeholder="~/.kimi-code/sessions" aria-label="Kimi Code path" />
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
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
