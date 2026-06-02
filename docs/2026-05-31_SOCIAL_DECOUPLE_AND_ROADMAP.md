# Vibe Tree 社交功能:Review 现状、解耦方案与路线图

> 承接 [`2026-05-29_SOCIAL_FRIENDS_GROUPS_PLAN.md`](./2026-05-29_SOCIAL_FRIENDS_GROUPS_PLAN.md)。
> 分支:`JJJyuhao-social-friends-groups`,基线 main / v0.6.0(commit 448f0f4)。
> 本文档记录 review 结论、已落地的解耦架构、验证状态与后续路线图。

---

## 1. Review 现状总结

好友/群组 MVP 已实现:Worker + D1 数据模型(4 张 social 表)、Electron 服务层(9 个社交 API)、社交 UI(好友/群组双 tab、管理弹窗、群组榜、前端缓存)。

**工程质量:扎实,可作为合并基线。**

- 类型链路完整无断点:`shared/types.ts` → `preload.ts`/`preload.cjs` → `global.d.ts` → `renderer`。
- Worker 端 normalize / 输入校验防御到位(`cleanShortText`、`normalizeSocialGroupRole`、`cleanInviteCode` 等)。
- `ensureSocialTables` 用 `CREATE TABLE/INDEX IF NOT EXISTS`,与 migration 幂等一致,deploy 顺序安全(即使忘跑 migration,首个请求也会建表)。
- `verify-worker-api.mjs` 覆盖好友 pending→accept→remove 全流程、建组、邀请加入、群组榜两成员排序。
- i18n 中英双语齐全;`npm run typecheck` 通过。
- `deleteMe` 已补 social 表的级联清理(交接未提,但做对了)。

**一个贯穿性架构事实(非 bug,但决定后续):**

群组排行榜和全球排行榜**共用同一份数据、同一个开关**。群组榜查的是 `daily_usage` / `hourly_usage`([`socialGroupLeaderboardDataForRange`](../server/leaderboard-worker/src/index.ts) `index.ts:1509`),而这两张表只在用户"加入全球榜"(`leaderboardEnabled`)后由客户端 `syncUsage` 写入。全球榜查询([`leaderboardDataForRange`](../server/leaderboard-worker/src/index.ts) `index.ts:2028`)**无任何 opt-in 列过滤**——成员资格 == "表里有没有你的行"。

也就是说,当前三件事被绑成一个:**"上传数据" == "daily_usage 里有行" == "出现在全球榜"**。这与原 PLAN.md「加入群组 ≠ 加入全球榜」(`PLAN.md:54`)矛盾,对"公司 token 统计"场景尤其致命:员工必须先公开上全球榜,公司群才看得到数据。第 3 节解决此问题。

---

## 2. 确认的 Bug 清单(分级)

### A. 真正会产生错误行为

- **A1. 退出全球榜静默清零群组贡献。** [`leaveLeaderboard`](../server/leaderboard-worker/src/index.ts) `index.ts:486` 删除 `daily_usage` + `hourly_usage`,用户不会知道这同时让自己在所有群组榜归零。两个本该独立的关系被耦合在同一张表上。→ 第 3 节 Step 3 修复。
- **A2. username 改名 / 抢注可能加错人。** [`resolveSocialFriendTarget`](../server/leaderboard-worker/src/index.ts) `index.ts:1376` 用 `lower(username) = lower(?)` + `ORDER BY updated_at DESC LIMIT 1`。GitHub 用户名虽唯一但可改名:A 改名后 B 占用旧名并登录,按旧名加好友会命中"最近登录的那个"(= B)。**修法(轻):** 加好友成功后 UI 明确展示头像 + 用户名,让用户确认是不是本人。
- **A3. 邀请 `maxUses` 并发竞态。** 用量检查与 `uses + 1` 不在同一事务([`acceptSocialGroupInvite`](../server/leaderboard-worker/src/index.ts) `index.ts:720-738`),临界点可超发;同一用户并发接受也可能重复消耗 uses。→ 已用条件化 claim + redemption 表收口。

### B. 半成品 / 接线断裂

- **B1. `share_usage` 过滤是死代码。** 字段、类型、UI 布尔全有,但插入永远写死 `1`([index.ts:657](../server/leaderboard-worker/src/index.ts)、[:731](../server/leaderboard-worker/src/index.ts)),无任何 `UPDATE`、无开关接口,`WHERE share_usage > 0` 恒真。**这正是 per-group 隐私开关的地基,接上即可用。** → 第 3 节 Step 4。

### C. 架构耦合(第 3 节解决)

- **C1. 群组数据完全依赖"已加入全球榜"。** 见第 1 节。

### 技术债(随手级)

- 冗余 migration:`20260529_social_friendships_indexes.sql` 只重建主 migration 里已有的索引,无害但易混淆。
- social 路由限流 keyPrefix 纯按 IP(`api:/api/social`),公司 NAT 出口多人会互挤额度——又踩中公司场景。
- 无建组 / 好友请求数量上限,可被刷。

---

## 3. 解耦架构方案(已定稿)

### 已拍板的产品决策(硬约束)

1. **群组不强制加入全球榜。** 在群组里可以让用量喂给群组榜,而不出现在全球榜。
2. **加入即共享,可按群关闭。** 加入群组默认共享用量给该群(`share_usage` 默认开),提供 per-group 开关关闭。
3. **退出全球榜保留数据,仅隐藏全球榜。** 离开全球榜必须保留已上传用量(群组仍可用),只把自己从全球榜隐藏。账号删除(`deleteMe`)仍全级联。
4. **必须加退群能力。**
5. **群主禁止直接退群**(需先转让或删群,留 P1)。
6. 群内展示方向:个人资料卡 + 可选隐私设置(P1);加入后贡献指标(P2)。

### 机制一句话

引入一个**独立于"数据是否存在"的 per-user 全球可见性标记**,只有全球榜查询认它,群组榜刻意忽略它;并把"数据上传"与"全球可见"解耦。

### 已确认的复用基础

- 架构里**已有两条独立上传管线**:`leaderboardEnabled` → `daily_usage`、`cloudSyncEnabled` → `tree_events`。"上传数据、按功能开关门控"是既有模式,解耦不是从零发明。
- 已有可复用 opt-in 模式:`Settings.leaderboardPreferencesPublic` → 请求体 `usagePreferencesPublic` → worker 按标志写入([leaderboard.ts:334](../src/electron/leaderboard.ts)、[index.ts:986](../server/leaderboard-worker/src/index.ts))。
- `daily_usage` / `hourly_usage` **只被全球榜 + 群组榜消费**(加上 deleteMe/leaveLeaderboard/syncDailyUsage 的清理),无其他读取方,改动面可控。

### Step 1 — 服务端:per-user 全球可见性标记

新建小表,用 lazy 建表(仿 [`ensureUsagePreferencesTable`](../server/leaderboard-worker/src/index.ts) `index.ts:1107`):

```sql
CREATE TABLE IF NOT EXISTS usage_visibility (
  user_id TEXT PRIMARY KEY,
  public_global INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

- **不用 `users` 表加列**:OAuth upsert([index.ts:368](../server/leaderboard-worker/src/index.ts))每次登录 `ON CONFLICT DO UPDATE`,会 clobber 该标记。
- **不复用 `sync_limits`**:单一职责(冷却),且它是 `leaveLeaderboard` 会删的表。
- 新增 `ensureUsageVisibilityTable(env)`,在 `getLeaderboard` / `getLeaderboards` 读路径里调用。

**全球榜 3 个 range 分支**([`leaderboardDataForRange`](../server/leaderboard-worker/src/index.ts) `index.ts:2028-2178`)统一加:

```sql
LEFT JOIN usage_visibility v ON v.user_id = u.user_id
WHERE COALESCE(v.public_global, 1) = 1
```

**向后兼容关键:** 老客户端从不写该表 → 无行 → `COALESCE(..., 1)` 默认 1 → 仍可见。只有新客户端显式写 `public_global = 0`(退出全球榜或群组-only)才隐藏。

**群组榜不动**([`socialGroupLeaderboardDataForRange`](../server/leaderboard-worker/src/index.ts) `index.ts:1509`),仍只看 `m.share_usage > 0`。这是解耦的核心:`public_global = 0` + `share_usage = 1` ⇒ 上群组榜、不上全球榜。

### Step 2 — 服务端:`/api/usage/daily` 接受 `usagePublic`

[`syncDailyUsage`](../server/leaderboard-worker/src/index.ts) `index.ts:966`:
- body 加 `usagePublic?: boolean`,解析为 `const usagePublic = body?.usagePublic !== false;`(**默认 true**,与 COALESCE 一致)。
- 数据写入仍**无条件**(上传 ≠ 可见)。
- 在现有 `env.DB.batch([...])` 里加 `usage_visibility` upsert(仿 `sync_limits` upsert `index.ts:1064`),绑定 `(userId, usagePublic ? 1 : 0, now)`。`leaderboardCache.clear()`(`:1070`)已覆盖。

### Step 3 — 服务端:`leaveLeaderboard` 保留数据(修 A1)

[`leaveLeaderboard`](../server/leaderboard-worker/src/index.ts) `index.ts:486`:
- **移除** `DELETE FROM daily_usage` / `DELETE FROM hourly_usage`(`:491-492`)。
- 改为 upsert `usage_visibility` 设 `public_global = 0`(保留数据,仅隐藏全球榜)。
- 保留删 `usage_preferences`(全球榜展示用的额外信息,重新加入时会再上传)、`sync_limits`、`leaderboardCache.clear()`。
- `deleteMe`(`index.ts:447`)仍是唯一会删除该用户排行榜聚合 usage 的路径,并显式清 `usage_visibility`。

### Step 4 — 服务端:退群 + share_usage 开关 API(接 B1)

接入 [`handleSocialRoute`](../server/leaderboard-worker/src/index.ts) `index.ts:500`,用现有 `url.pathname.match(...)` 风格:

- **`DELETE /api/social/groups/:groupId/members/me`** —— 退群。`requireSocialGroupMembership` 校验 → 若 `owner_user_id === user.userId` 则 **409 拒绝**(群主需删群,避免无主群)→ 否则删 membership。不动 usage 表。
- **`POST /api/social/groups/:groupId/membership`** `{ shareUsage: boolean }` —— 切换 per-group 共享。`UPDATE social_group_members SET share_usage = ?, updated_at = ?`,返回刷新后的 group payload(`requireSocialGroupPayload`)。
- 两路由已被 `/api/social/` 的 WRITE 限流覆盖。

### Step 5 — 客户端:解耦上传门控([leaderboard.ts](../src/electron/leaderboard.ts))

主进程同步定时器需要便宜地感知"是否在任何群组"。方案:Settings 缓存计数。

- `Settings` 加 `socialGroupCount: number`(默认 0),在 `getSocialGroups`(权威,每次刷新面板都跑)/ `createSocialGroup` / `acceptSocialGroupInvite` / `leaveSocialGroup` 维护(复用 `options.updateSettings`)。
- 新增门控 `shouldSyncUsage = () => leaderboardEnabled || socialGroupCount > 0`,替换 [`scheduleNextSync`](../src/electron/leaderboard.ts) `:194` 和 [`syncUsage`](../src/electron/leaderboard.ts) `:316` 的 `!leaderboardEnabled` 判断。**在 0 群且未上全球榜的用户不投机上传**(隐私)。
- 请求体加 `usagePublic: leaderboardEnabled === true`(全球榜开 ⇒ 可见;群组-only ⇒ 上传但隐藏)。
- **Bug 修正:** 删 `syncUsage` 成功块里的 `leaderboardEnabled: true` 副作用([:340](../src/electron/leaderboard.ts))——否则会替群组-only 用户重新打开全球榜。`login`/`setEnabled` 已显式设此标志,安全。
- 主进程 [`updateSettings`](../src/electron/main.ts) `main.ts:1568` 的 `startSync` 变更检测加 `socialGroupCount`,使 0→1 群立即重排定时器。

### Step 6 — 类型 + 服务方法 + IPC + preload(两份)+ renderer

- `shared/types.ts`:`Settings.socialGroupCount`。
- `leaderboard.ts`:`leaveSocialGroup(groupId)`、`setSocialGroupShareUsage(groupId, shareUsage)`(仿 [`removeSocialFriend`](../src/electron/leaderboard.ts) `:595`),并导出。
- `main.ts`:2 个 `ipcMain.handle`(`social:leave-group`、`social:set-group-share-usage`);`DEFAULT_SETTINGS` + `normalizeSettings` 加 `socialGroupCount`。
- `preload.ts` + `preload.cjs`(**两份手维护**)+ `global.d.ts`:补签名。
- `renderer/main.ts`:群组详情区([renderSocial](../src/renderer/main.ts) `:4491`)加退群按钮(群主隐藏)+ per-group 共享开关;`socialGroupDetail` 加点击委托(仿好友列表 [:1335](../src/renderer/main.ts));`socialRenderSignature`([:4358](../src/renderer/main.ts))纳入 `shareUsage` 以触发重渲染。退群用 `showAppConfirm` 二次确认。
- `i18n.ts`:中英双补 `socialGroupLeave` / 退群确认文案 / `socialGroupShareOn` / `socialGroupShareOff` / `socialGroupOwnerCannotLeave` / 失败文案等。

### Step 7 — 迁移

- 新建 `server/leaderboard-worker/migrations/20260531_usage_visibility.sql`(`usage_visibility` 建表),并**同步 `schema.sql`**(verify 脚本整体加载 `schema.sql`,不同步会导致新的全球榜 `LEFT JOIN` 在测试下找不到表)。生产环境靠 lazy `ensureUsageVisibilityTable` 覆盖既有 DB。
- 注:冗余 migration `20260529_social_friendships_indexes.sql` 留作单独清理,不属本次。

### Step 8 — `verify-worker-api.mjs` 断言

复用已有 fixture(`user-verify` 群主 + `user-friend` 成员,均已共享用量):
- **(a)** 非 public 群成员:`POST /api/usage/daily {usagePublic:false}` 后,全球榜无该成员、群组榜有。
- **(b)** 退出全球榜后群组数据仍在(`DELETE /api/leaderboard` 后群组榜仍含该用户,全球榜不含;保留现有 tree-events leave-safety 断言)。
- **(c)** 退群移除成员 + 群主退群被 `assertRejects` 拒。
- **(d)** `share_usage=false` 从群组榜隐藏,`true` 重新出现。
- 顺序:(a)/(b)/(d) 在两人都是成员时跑,(c) 最后(移除 `user-friend` + 校验群主拒绝)。

### 部署顺序(关键)

1. `schema.sql` + migration 先行。
2. 部署 Worker 并对生产 D1 apply migration,**早于**客户端发布(老 Worker + 新客户端会 404 新路由)。
3. 向后兼容靠 `COALESCE(public_global, 1) = 1`(老客户端仍可见)+ `share_usage DEFAULT 1`(老 membership 仍共享)。

---

## 4. 分期路线图

### P0(合并前 / 紧接)
- 退群接口 + UI(本方案 Step 4 + Step 6)。
- 群组榜与全球榜解耦(本方案 Step 1-3、5、7、8)。
- 加群 / 建组时**明示数据可见范围**(文案级,低成本)。
- 修 A2:加好友后展示头像 + 用户名确认。

### P1(公会成熟度)
- ✅ **个人资料卡 / 主页**:头像、小树等级 / 阶段、成就徽章、好友 / 群组关系 —— 区别于"用量后台"的关键。见第 6 节。
- ✅ `share_usage` per-group 隐私开关的完整 UI(P0 已落地切换按钮,资料卡使用相同 consent 信号决定是否展示用量)。
- 邀请管理:撤销(`revoked_at` 字段已在,缺接口)、列出当前有效邀请。
- 角色管理:踢人、任命 officer、转让群主、删群。

### P2(可玩性)
- ✅ **加入后贡献指标**(群内增量,而非历史总量)—— 更像公会战,顺带强化隐私语义。见第 7 节。
- 好友 / 群组未读 badge(有 incoming pending 时社交 tab 红点)—— 解决"对方不刷新看不到请求",比 WebSocket 性价比高。
- 群组成就 / 等级 / 赛季榜。

### 技术债
- ✅ 原子化邀请计数(修 A3):`uses = uses + 1` 改为带 `AND (max_uses IS NULL OR uses < max_uses)` 条件的单条 UPDATE,并加 `social_group_invite_redemptions` 防止同一用户并发重复消耗同一邀请码。见第 6 节。
- 限流 key 加 actorId(缓解公司 NAT 互挤)。
- 清理冗余 migration(`20260529_social_friendships_indexes.sql`)——评估后暂留:仅重建已有索引,无害,且删除会让既有 runbook 失效,价值极低。
- 建组 / 好友数量上限。

---

## 5. 实现状态(2026-05-31)

第 3 节 Step 1-8 的**解耦方案已实现**,并已补上资料卡、邀请原子化与群内私域榜口径。改动文件:

- **Worker** [`index.ts`](../server/leaderboard-worker/src/index.ts):`ensureUsageVisibilityTable`、全球榜 3 个 range 分支加 `LEFT JOIN usage_visibility v ... COALESCE(v.public_global,1)=1`、`syncDailyUsage` 接受 `usagePublic` 并 upsert、`leaveLeaderboard` 改为只设 `public_global=0` 并保留 usage、`deleteMe` 显式清 visibility/redemptions、新增 `leaveSocialGroup`(群主 409)+ `setSocialGroupShareUsage` 并接入 `handleSocialRoute`。
- **Schema/迁移**:[`schema.sql`](../server/leaderboard-worker/schema.sql) 加 `usage_visibility` 与 `social_group_invite_redemptions`,新建 [`migrations/20260531_usage_visibility.sql`](../server/leaderboard-worker/migrations/20260531_usage_visibility.sql) 和 [`migrations/20260531_social_group_invite_redemptions.sql`](../server/leaderboard-worker/migrations/20260531_social_group_invite_redemptions.sql),`package.json` 加对应 `db:migrate:*` 脚本。
- **客户端** [`leaderboard.ts`](../src/electron/leaderboard.ts):`shouldSyncUsage`(leaderboardEnabled || socialGroupCount>0)、`syncUsage` 发 `usagePublic` 并去掉 `leaderboardEnabled:true` 副作用、`socialGroupCount` 维护、`leaveSocialGroup`/`setSocialGroupShareUsage` 方法。
- **类型/IPC/preload**:`shared/types.ts` 加 `Settings.socialGroupCount`;`main.ts` 加 2 个 IPC + DEFAULT_SETTINGS/normalizeSettings/startSync 变更检测;`preload.ts`+`preload.cjs`+`global.d.ts` 补签名。
- **Renderer** [`main.ts`](../src/renderer/main.ts):群组详情区退群按钮(群主隐藏)+ per-group 共享开关 + 点击委托 + 处理函数 + `socialRenderSignature` 纳入 shareUsage;`styles.css` 加 `.social-group-detail-actions`;`i18n.ts` 中英双补。
- **verify** [`verify-worker-api.mjs`](../server/leaderboard-worker/scripts/verify-worker-api.mjs):新增 (a) 非 public 成员全球榜隐藏/群组榜可见、(b) 退全球榜保留群组数据、(c) 退群移除成员+群主退群被拒、(d) share_usage 开关。

**验证状态:**
- ✅ `npm run typecheck` 通过。
- ✅ `npm run build` 通过。
- ✅ `npm run smoke:electron` 通过。
- ✅ `cd server/leaderboard-worker && npm run verify:api` 通过,覆盖好友、群组、邀请、群组/全球榜解耦、退全球榜保留群组数据、资料卡关系门、原子化邀请、群内历史总榜口径。
- ✅ `git diff --check` 通过。

**部署提醒:** 先 apply migration + 部署 Worker,再发客户端(老 Worker 会 404 新路由)。

---

## 6. 个人资料卡(2026-05-31,P1 首项)

把社交从"用量后台"推向"游戏好友"的分水岭功能:点好友 / 群成员 → 弹出资料卡。

### 设计要点

- **数据复用 + 轻量总量聚合。** `daily_usage` / `hourly_usage` 继续负责 24h / 7d / 30d 等榜单窗口;`usage_totals` 只存每个用户的历史 token 总量、活跃天数和最早日期,用于个人卡片与群组 / 全球的 `全部 + 总用量`。这避免为了全量榜反复上传完整历史明细,也避免把"总用量"误做成 30 天滚动窗口。
- **两层隐私,与解耦的 consent 信号一致。**
  - *访问门*(能否打开卡片):本人 / 已接受好友 / 同群成员,否则 **404**(连存在性都不暴露)。
  - *用量层*(等级 / 总量 / 活跃天 / 成就是否展示):仅当目标有触达本查看者的 consent 信号——本人、已上全球榜(`public_global=1`)、或在共享群里 `share_usage=1`。好友若全关,则只显示身份层(头像 / 名字 / 入会 / 关系数)。这把"群内展示到什么程度"用既有开关回答了,而非新发明隐私模型。

### 改动文件

- **Worker** [`index.ts`](../server/leaderboard-worker/src/index.ts):新增 `getSocialProfile`(关系门 + consent 判定 + `SUM(xp)`/成就聚合),接入 `handleSocialRoute` 的 `GET /api/social/users/:userId/profile`。
- **类型 / IPC / preload**:`shared/types.ts` 加 `SocialProfile` / `SocialProfileResult`;`leaderboard.ts` 加 `getSocialProfile` + `normalizeSocialProfile`;`main.ts` 加 `social:get-profile`;`preload.ts`+`preload.cjs`+`global.d.ts` 补签名。
- **Renderer** [`main.ts`](../src/renderer/main.ts):新增资料卡 modal(`appShell.ts`)、`openSocialProfile`/`closeSocialProfile`/`renderSocialProfile`、好友行与群组榜行包成 `.social-profile-trigger` 点击触发;`stats.ts` 导出 `summarizeXpProgression`;`styles.css` 加资料卡样式(复用 `--rarity-*` 徽章色);`i18n.ts` 中英双补 `socialProfile*` 文案。
- **verify** [`verify-worker-api.mjs`](../server/leaderboard-worker/scripts/verify-worker-api.mjs):加 `user-stranger` fixture + 断言 (e):本人卡含成就 / 总量 / 入会;同群查看公开成员用量可见;查看共享群成员用量可见;无关系陌生人 404。

**验证:** ✅ typecheck + build + smoke:electron + worker verify:api 通过。

---

## 7. 统计与同步流量排查(2026-06-01 更新)

本轮排查确认:原先 `全部 + 总用量` 仍会落到 `daily_usage` 求和,而客户端只上传 30 天 daily 窗口,所以它不是可靠历史总量。修复后:

- `/api/usage/daily` 仍只上传最多 30 天 daily + 约 72 小时 hourly,保证榜单窗口轻量。
- 同一请求额外带 `totalTokens` / `totalDaysActive` / `firstUsageDate`,写入 `usage_totals`,用于全球榜与群组榜的 `range=all&basis=total`、个人资料卡历史总量。
- `range=all&basis=since_join` 继续按 `daily_usage` + `m.joined_at` 过滤,保持公会贡献榜语义。
- 云同步的 `tree_model_stats` 上传加本地签名缓存,未变化时只上传设备心跳,不再重复发送模型聚合整包。
- `/api/tree/delta` 的 `modelStats` 改为只返回 cursor 后变更的行,响应标记 `modelStatsFull:false`;客户端已有 merge 逻辑,会把增量合入本地缓存。

**新增验证:** `verify-worker-api.mjs` 覆盖 30 天窗口外历史总量进入 `basis=total`、不进入 `basis=since_join`;`verify-cloud-sync.mjs` 覆盖模型统计未变不重复上传、变更后继续上传、delta 只返回变更模型统计。

---

## 8. 资料卡隐私设置(2026-06-01 更新)

用户明确提出:现在没有办法决定资料卡里展示什么、不展示什么。这里补的是**服务端字段级隐私**,不是前端视觉隐藏。

### 产品规则

- `谁可以打开资料卡`:好友和同群成员 / 仅好友 / 仅自己。
- 字段开关:等级和阶段、累计 Token、活跃天数、成就陈列。
- 本人看自己永远完整;其他人只在既满足访问门、又满足用量 consent(全球公开或同群共享)时,才按字段开关拿到数据。
- 被隐藏字段不出现在 `GET /api/social/users/:userId/profile` 响应里,避免客户端或抓包看到被关掉的数值。
- 群组排行榜仍由每个群的 `群内共享用量` 控制,资料卡隐私不偷偷改群榜。

### 实现

- **Worker**:新增 `social_profile_privacy` 表与 `GET/POST /api/social/profile-privacy`;`getSocialProfile` 读取目标用户隐私,访问门从固定"好友/同群"升级为可配置,返回字段按 `show_*` 裁剪。
- **Schema/迁移**:新增 [`migrations/20260601_social_profile_privacy.sql`](../server/leaderboard-worker/migrations/20260601_social_profile_privacy.sql) 和 [`migrations/20260601_usage_totals.sql`](../server/leaderboard-worker/migrations/20260601_usage_totals.sql),`schema.sql` 和 `package.json` 同步 `db:migrate:social-profile-privacy` / `db:migrate:usage-totals`。
- **客户端桥接**:`leaderboard.ts` / `main.ts` / `preload.ts` / `preload.cjs` / `global.d.ts` 增加 profile privacy 读写方法。
- **Renderer**:设置页「同步与排行」里新增「资料卡隐私」区域;资料卡渲染支持字段缺失时的降级显示,例如只展示等级但隐藏具体累计 Token。
- **verify**:新增断言:默认资料卡对好友/同群可见;关闭累计 Token/活跃天/成就后接口不返回这些字段;切到仅自己后同群成员打开资料卡返回 404。

**验证:** ✅ typecheck + build + worker verify:api 通过;UI 已在本地 Electron 设置页做可视检查。

### A3 修复:原子化邀请 maxUses(随手清技术债)

原 [`acceptSocialGroupInvite`](../server/leaderboard-worker/src/index.ts) 先 `SELECT uses` 判断 `uses >= maxUses`,再在独立 batch 里 `uses = uses + 1`——两步之间存在 TOCTOU 竞态,并发接受可超发。改为两层防护:先写 `social_group_invite_redemptions(invite_code_hash,user_id)` 防止同一用户并发重复消耗同一邀请码,再做**条件化单条 UPDATE**:`SET uses = uses + 1 WHERE invite_code_hash = ? AND revoked_at IS NULL AND (expires_at ...) AND (max_uses IS NULL OR uses < max_uses)`,以 `result.meta.changes` 判定是否抢到名额;抢不到(`changes === 0`)直接 410 并释放 redemption。SQLite 写串行化 ⇒ 恰好 maxUses 次 UPDATE 成功。抢到后再 `INSERT OR IGNORE` 成员(PK `group_id+user_id` 幂等);若成员已由其它路径并发加入,回退本次 uses。保留原有 revoked/expired/used-up 预检以提供常态下的友好报错。verify 加断言 (f):单次邀请被消费后,即便加入者退群,`uses` 不回退、邀请码不可复用。

---

## 9. 群内私域榜口径(2026-06-01 更新)

2026-05-31 曾把群组榜改成"入群后贡献",更像公会战/赛季榜。2026-06-01 明确产品上需要**两种口径并存**:既要好友 / 公司内部历史总榜,也要游戏式的入群后贡献榜。

- 群组成员 + `share_usage=1` 决定是否可见。
- `basis=total`:展示历史总用量或对应时间窗口总用量。
- `basis=since_join`:展示入群后的累计贡献或对应时间窗口内、且入群之后的贡献。
- `range=24h|7d|30d|all`:控制时间范围。
- `usage_visibility.public_global=0` 只影响全球榜,不影响用户在已加入且开启共享的群组里展示。

### 机制

[`socialGroupLeaderboardDataForRange`](../server/leaderboard-worker/src/index.ts) 先按群成员关系与 `share_usage` 过滤。`range=all&basis=total` 读 `usage_totals`,拿真实历史总量;`basis=since_join` 与 24h/7d/30d 仍读 `daily_usage`/`hourly_usage`,并在需要时加 `m.joined_at` 地板。这样默认总榜与全球榜在数学口径上保持一致,差别只在可见范围;切到入群后贡献时,同一套 range 会额外排除加入群组之前的桶。

### 客户端

- [`appShell.ts`](../src/renderer/appShell.ts):群组榜工具条新增 `总用量 / 入群后` 口径切换,并保留 `24h / 7 天 / 30 天 / 全部` 时间范围。`i18n.ts` 中英双补 `socialGroupBasis*` 与 `socialGroupContributionNote`。

### 验证说明(本次改动风险最高项)

verify 断言 (g) 已改为:默认 / `basis=total` 时,成员加入日期前且超出 30 天 daily 上传窗口的历史用量会通过 `usage_totals` 进入群组 `all` 榜(777 + 9999 = 10776),证明群组可做内部历史总榜;`basis=since_join` 时同一用户只显示入群后的 777,证明公会贡献榜也保留。同一用户后续设 `usagePublic:false` 时仍会从全球榜隐藏,但保留群组可见性。

**验证:** ✅ typecheck + build + smoke:electron + worker verify:api 通过。
