# Changelog

## 2026-06-18 (v0.7.3)

- Made Codex session scanning yield in small slices so large local session folders do not monopolize the Electron main process during startup.
- Batched ledger broadcasts and switched local usage dedupe to an ID index so backfilled usage records do not trigger one full UI refresh per event.
- Made source enablement control the corresponding background watcher, so disabled sources stop being scanned.
- Fixed the achievement tab's new-achievement badge so it remains floated above the navigation without being covered by neighboring tabs.

## 2026-05-24 (v0.5.5)

- 新增 Pi Agent Token 统计，自动读取 `~/.pi/agent/sessions/**/*.jsonl` 会话记录。
- 设置页、数据来源、历史图表、来源统计、托盘状态、成就和排行榜偏好已支持 Pi Agent。
- 更新 README 中的多 Agent 来源说明，并补充 Pi Agent 默认数据路径。

## 2026-05-19 (v0.5.4)

- 修正 Token 统计口径：总成长会计入 cache read，同时避免已经把缓存计入 input 的来源被重复计算。
- 更新数据来源、历史图表和设置文案里的 Token 说明，让不同 Agent 的统计口径保持一致。
- 在设置的更新区域新增「查看更新内容」入口：发现新版本时可查看更新公告，已是最新版时也可以回看当前版本内容。
- 更新检查现在会读取 GitHub Release 正文；如果 Release 不可用，会回退读取本地 changelog，方便内置更新直接展示本次公告。

## 2026-05-19 (v0.5.3)

- Added OpenCode SQLite `opencode.db` ingestion, while keeping the legacy `storage/message/**/*.json` reader as a fallback.
- Made OpenCode SQLite polling WAL-aware and prevented first-run scans from importing the entire historical database unless history import is explicitly enabled.
- Updated OpenCode path hints and README source documentation for the current SQLite storage location.
- Fixed English UI button wrapping across side tabs, leaderboard controls, history/source filters, achievement filters, and update actions.

## 2026-05-17 (v0.5.2)

- Added Gemini CLI JSONL session-log support, including standalone Gemini logs under `.gemini/tmp/*/chats`.
- Fixed Gemini standalone accounting so cached input is deducted from `input` while OpenCode Gemini keeps its separate-cache accounting.
- Counted cache-write tokens for all providers so custom Claude/OpenClaw providers are not undercounted when provider names are proxied or renamed.
- Fixed Codex cached-input accounting and reconciled affected achievements after the corrected totals are applied.
- Refreshed README screenshots and share export docs, and added the QR-enhanced share-image export flow.

## 2026-05-15 (v0.5.1)

- Hardened terminal updates with git/npm timeouts so stalled fetches or dependency installs fail cleanly instead of leaving the UI stuck.
- Added terminal-update npm recovery for interrupted installs by cleaning leftover `.node_modules-*` and nested `node_modules/node_modules` artifacts before retrying dependency sync.
- Passed configured proxy settings and a default Electron download mirror into terminal-update child processes so Electron binary downloads are less likely to fail on slow GitHub paths.
- Cached leaderboard results locally for one hour and switched leaderboard refresh to one bundled read request with API-level sync throttling.

## 2026-05-15 (v0.5.0)

- Added the share-image export flow with a carousel picker, three polished templates, and image saving from real user growth data.
- Added 7-day / 24-hour share-card heatmaps, peak-hour stories, favorite coding period copy, most-used agent, and cumulative token highlights.
- Reworked the manager UI around the new share-card visual language, including Day, Night, and Soft themes that can be switched from Settings.
- Refined the floating settings/share control, title bar, scrollbars, progress bars, achievement surfaces, and theme-specific colors for a more consistent desktop feel.
- Added leaderboard usage-preference sharing as an opt-in privacy feature: favorite agent, favorite model, preferred time period, and peak token rate can be shown on leaderboard rows.
- Kept leaderboard privacy conservative by default: users who do not opt in show only the public ranking data and a "not shared" preference note.
- Updated leaderboard sync behavior so manual refresh can submit the current local snapshot before fetching all leaderboard ranges.
- Fixed the floating pet and achievement toast windows so visual themes no longer leak into surfaces that should stay transparent or dark.
- Updated Chinese and English copy for share templates, visual themes, leaderboard preferences, and privacy notes.

## 2026-05-15 (v0.4.0)

- Added 21 new achievements across active days, model variety, agent loyalty, daily peaks, time windows, holidays, long returns, and interaction milestones.
- Added achievement progress for the new numeric milestones and tightened the new criteria so disabled sources and zero-token entries do not unlock rewards.
- Added a global font-size setting for the manager UI, persisted in device settings.
- Added a configurable network proxy setting for leaderboard requests, with environment proxy fallback and clearer timeout copy.
- Kept leaderboard network requests bounded with request timeouts so failed proxy/network paths return cleanly.

## 2026-05-14 (v0.3.7)

- Reduced automatic update checks to once per day and persisted the last check time so restarts do not repeatedly hit GitHub.
- Reduced automatic leaderboard sync to once per day and removed the startup-time forced sync.
- Stopped loading the public leaderboard when the manager window opens or when ranges change; the leaderboard now loads only after pressing Refresh.
- Added a leaderboard Refresh button and loading/empty copy for manual leaderboard fetches.
- Combined leaderboard join and leave controls into one membership button.
- Added a confirmation prompt before leaving the leaderboard, clearly warning that remote daily token data will be fully deleted.

## 2026-05-14 (v0.3.6)

- Added source visibility settings so installed agents can be included or excluded from token statistics.
- Hid uninstalled agents from source breakdowns and history charts while keeping detected agents expanded.
- Added a tray action to recover the floating tree and clarified startup behavior as hiding only the manager window.
- Improved renderer startup responsiveness by caching derived stats and avoiding unnecessary history chart rebuilds.
- Split the large renderer entrypoint into focused modules for app shell, stats, sources, history chart, tree assets, weather art, formatting, and shared renderer types.

## 2026-05-14 (v0.3.5)

- Added an Electron main-process smoke test to CI so releases must prove the built app can start.
- Added the same startup verification to terminal updates before relaunching into a freshly built version.

## 2026-05-14 (v0.3.4)

- Fixed Windows startup after v0.3.3 by marking compiled shared runtime files as CommonJS during the Electron build.

## 2026-05-14 (v0.3.3)

- Added Gemini and Hermes session ingestion alongside Codex, Claude Code, OpenClaw, and OpenCode.
- Expanded source breakdowns, achievements, settings, and tray monitor status for the new agents.
- Made missing sources compact and sorted them below installed sources.
- Updated tray actions so settings opens directly, hide-tree lives with the checkbox controls, and manual update checks reopen the tray menu instead of sending notifications.
- Improved leaderboard opt-out copy and backend cleanup so user-linked remote rows are removed when leaving.

## 2026-05-14 (v0.3.2)

- Fixed macOS update checks by reading the running app bundle's package version before falling back to the repository package.
- Updated release detection to prefer GitHub's latest published release and only fall back to tags when needed.
- Included package metadata in the Electron build output so app version comparisons stay consistent across platforms.

## 2026-05-14 (v0.3.1)

- Renamed user-facing scoring to Token across the dashboard, achievements, charts, tray menu, README, and leaderboard copy.
- Added a `NEW` badge directly inside achievement unlock toasts so fresh achievements are visible before opening the achievements page.
- Updated leaderboard sync payloads and responses to use `tokens`, while keeping backward compatibility for existing backend data.
- Refreshed README screenshots and install guidance, including `npm ci` and the Electron mirror note for slower GitHub downloads.
- Included the README achievement-system note and the weather showcase preview before the main dashboard screenshot.

## 2026-05-14 (v0.3.0)

- Added an optional global leaderboard with GitHub sign-in, join/leave controls in Settings, and a dedicated leaderboard tab in the manager window.
- Synced only daily token totals from the last 30 days; prompts, files, session records, models used, and other information are not uploaded.
- Added leaderboard status, sync, and opt-out IPC across Electron main/preload/renderer.
- Added a Cloudflare Worker + D1 backend template for GitHub OAuth, one-time auth-code session exchange, daily token upserts, leaderboard reads, and cloud opt-out deletion.
- Added baseline Community leaderboard safety rails: 30-minute per-user sync cooldown, 30-day backfill limit, rate limit bindings, hashed security-event logs, and a very loose dirty-data rejection threshold.
- Added CI for pull requests and protected-release hygiene around main-branch changes.
- Documented leaderboard setup and the `VIBE_TREE_LEADERBOARD_API_URL` runtime configuration.

## 2026-05-13 (v0.2.2)

- Fixed the macOS menu bar icon by using a real resized PNG app icon instead of the SVG template image that could render as an invisible zero-width status item.

## 2026-05-13 (v0.2.1)

- Added hourly update checks with a small in-app `新版本` / `NEW` badge on the settings button.
- Added terminal update support from Settings and the tray menu, including `git pull`, dependency sync, build, and automatic relaunch after success.
- Added Simplified Chinese / English UI switching, with first-run language detection from the user's system language.
- Added release-page access in Settings and localized update status copy across the renderer, tray, and notifications.
- Moved achievement copy and UI localization out of the main renderer file to keep the app easier to maintain.
- Fixed desktop tree pointer handling so it only follows the cursor while actively dragging, and restored double-click manager opening.
- Updated the macOS tray icon to use a template-style menu bar icon that better matches system sizing.
- Refined the compact full-number badge spacing and text sizing for large token totals.
- Added the counted-token help tip beside the tree level title.

## 2026-05-13

- Added a full achievement system with persistent unlock state, rarity levels, category filters, status filters, locked-state hints, and detail modals.
- Added achievement unlock feedback for the desktop pet, including a separate toast window that follows the pet position and avoids covering the tree.
- Added a `NEW` state for newly unlocked achievements so users are guided to open the detail view and read the reward copy.
- Reworked the achievement page into a collection view with summary stats, category navigation, high-rarity showcase chips, and compact source-list-style achievement rows.
- Added hidden-achievement behavior: locked hidden achievements hide their name and condition until unlocked.
- Added achievement detail copy separation: card rows show achievement conditions, while detail views reveal the flavor text after unlock.
- Refined achievement visual design to match the main dashboard: dark panels, green progress language, rarity-colored markers, clearer text contrast, and a custom in-panel scrollbar.
- Added click-through details for high-rarity showcase chips.
- Removed the duplicate hidden status filter and kept hidden achievements as their own category.
- Cleaned dashboard copy and token-source separators, replacing stray separator text with proper dot separators.

## 2026-05-11

- Moved pet lock and scale controls into the settings panel, keeping the main dashboard focused on the tree and live stats.
- Added a pet-window context menu for opening the manager, locking the pet, changing scale, configuring badge faces, choosing k/m units, and hiding the pet.
- Changed source contribution defaults to Today, added Today/Total switching, and applied the same scope to expanded per-agent model breakdowns.
- Refined the 3D level badge: smoother flip motion, hover-to-flip with immediate return on pointer leave, 2.5s timed auto flips, and no badge flip during level-up.
- Reworked the 7-day chart tooltip into an in-app hover card and avoided unnecessary chart DOM rebuilds to prevent flicker.
- Corrected 7-day chart bar semantics so bar height follows counted tokens (`input + output`) while cache read/write remain separately visible.
- Reduced misleading minimum bar heights so small daily values preserve visible proportion differences.
- Clarified the product display model around counted tokens versus cache traffic during OpenClaw comparison work.

## 2026-05-09

- Unified the product name as Vibe Tree and connected the app icon for system surfaces.
- Improved incremental token ingestion so historical cumulative usage is not counted as new tokens on startup.
- Slowed growth pacing by raising level and stage thresholds.
- Added LEVEL UP feedback and a 3D level badge with hover, level-up, and timed flip behavior.
- Added configurable badge faces for level, total token, and token/s, with k/m total unit options.
- Moved preferences into a gear-triggered settings panel instead of showing configuration on the main dashboard.
- Combined source monitoring and contribution stats into one row per agent.
- Added expandable per-agent model breakdowns.
- Enhanced the 7-day chart: all sources show agent share, while individual agents show input, output, cache hit, and cache write.
- Removed manual feeding from the main product UI.
