import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const workerDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const persistDir = mkdtempSync(join(tmpdir(), "vibe-tree-worker-api-"));
const token = "verify-worker-token";
const tokenHash = createHash("sha256").update(token).digest("hex");
const friendToken = "verify-friend-token";
const friendTokenHash = createHash("sha256").update(friendToken).digest("hex");
const palToken = "verify-pal-token";
const palTokenHash = createHash("sha256").update(palToken).digest("hex");
const strangerToken = "verify-stranger-token";
const strangerTokenHash = createHash("sha256").update(strangerToken).digest("hex");
const now = "2026-05-27T00:00:00.000Z";
const expiresAt = "2099-01-01T00:00:00.000Z";
const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const utcToday = dateKey(new Date());
const eastOfUtcToday = addDays(utcToday, 1);
let devProcess;

try {
  const seedSql = `
INSERT OR REPLACE INTO users (user_id, username, avatar_url, profile_url, created_at, updated_at)
VALUES ('user-verify', 'verify-user', NULL, NULL, '${now}', '${now}');

INSERT OR REPLACE INTO users (user_id, username, avatar_url, profile_url, created_at, updated_at)
VALUES ('user-friend', 'friend-user', NULL, NULL, '${now}', '${now}');

INSERT OR REPLACE INTO users (user_id, username, avatar_url, profile_url, created_at, updated_at)
VALUES ('user-pal', 'pal-user', NULL, NULL, '${now}', '${now}');

INSERT OR REPLACE INTO users (user_id, username, avatar_url, profile_url, created_at, updated_at)
VALUES ('user-stranger', 'stranger-user', NULL, NULL, '${now}', '${now}');

INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at)
VALUES ('${tokenHash}', 'user-verify', '${now}', '${expiresAt}');

INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at)
VALUES ('${friendTokenHash}', 'user-friend', '${now}', '${expiresAt}');

INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at)
VALUES ('${palTokenHash}', 'user-pal', '${now}', '${expiresAt}');

INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at)
VALUES ('${strangerTokenHash}', 'user-stranger', '${now}', '${expiresAt}');
`;

  devProcess = spawnWrangler([
    "dev",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    persistDir,
    "--var",
    "APP_ORIGIN:*",
    "--var",
    "GITHUB_CLIENT_ID:test-client",
    "--var",
    "GITHUB_CLIENT_SECRET:test-secret",
    "--var",
    "SESSION_SECRET:test-session-secret",
    "--log-level",
    "error",
    "--show-interactive-dev-session=false",
  ]);

  await waitForWorker();
  await prepareD1Database(seedSql);

  let cloudTree = await requestJson("/api/tree");
  assert(cloudTree.summary?.hasRemoteTree === false, "empty cloud tree summary should not report an existing tree");

  await requestJson("/api/tree/events", {
    method: "POST",
    body: {
      deviceId: "zero-token-device",
      device: { alias: "Zero Token Mac", platform: "mac" },
      appVersion: "0.5.5-test",
      entries: [],
      modelStats: [],
    },
  });

  cloudTree = await requestJson("/api/tree");
  assert(cloudTree.summary?.hasRemoteTree === true, "device-only cloud tree should count as an existing tree");
  assert(cloudTree.summary?.entryCount === 0, "device-only cloud tree should still have zero events");
  assert(cloudTree.summary?.deviceCount === 1, "device-only cloud tree should report its device snapshot");

  await requestJson("/api/tree/events", {
    method: "POST",
    body: {
      deviceId: "mac-device",
      device: { alias: "Mac", platform: "mac" },
      appVersion: "0.5.5-test",
      modelStats: [
        {
          date: utcToday,
          source: "codex-session",
          model: "private-model",
          tokens: 1234,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 34,
          cacheWriteTokens: 0,
          prompt: "private prompt",
          localPath: "/private/workspace/path",
        },
      ],
      entries: [
        {
          id: "mac-event-1",
          createdAt: "2026-05-27T01:00:00.000Z",
          source: "codex-session",
          tokens: 1234,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 34,
          cacheWriteTokens: 0,
          deviceId: "mac-device",
          note: "PRIVATE NOTE",
          agent: "codex-desktop",
          provider: "private-provider",
          model: "private-model",
          prompt: "private prompt",
          reply: "private reply",
          localPath: "/private/workspace/path",
        },
      ],
    },
  });

  await requestJson("/api/tree/achievements", {
    method: "POST",
    body: {
      appVersion: "0.5.5-test",
      achievements: [
        {
          id: "sprout",
          unlockedAt: "2026-05-27T01:01:00.000Z",
          trigger: { prompt: "private trigger" },
        },
      ],
    },
  });

  await requestJson("/api/tree/events", {
    method: "POST",
    body: {
      deviceId: "other-device",
      appVersion: "0.5.5-test",
      entries: [
        {
          id: "mac-event-1-different-path-id",
          createdAt: "2026-05-27T01:00:00.000Z",
          source: "codex-session",
          tokens: 1234,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 34,
          cacheWriteTokens: 0,
          deviceId: "other-device",
        },
      ],
    },
  });

  cloudTree = await requestJson("/api/tree");
  assert(cloudTree.summary?.hasRemoteTree === true, "cloud tree summary should report an existing tree");
  assert(cloudTree.summary?.entryCount === 1, "cloud tree should contain one event");
  assert(cloudTree.summary?.achievementCount === 1, "cloud tree should contain one achievement");
  assert(cloudTree.summary?.deviceCount === 3, "cloud tree should include all device snapshots");
  const [event] = cloudTree.entries ?? [];
  const [achievement] = cloudTree.achievements ?? [];
  const [device] = cloudTree.devices ?? [];
  const [modelStat] = cloudTree.modelStats ?? [];
  assert(event?.id === "mac-event-1", "cloud tree should return the uploaded event");
  assert(event.source === "codex-session", "worker should preserve safe source categories");
  assert(event.deviceId === "mac-device", "worker should preserve device id");
  assert(event.tokens === 1234, "worker should preserve token count");
  assertNoForbiddenKeys(event, "GET /api/tree event");
  assert(achievement?.id === "sprout", "cloud tree should return the uploaded achievement");
  assertNoForbiddenKeys(achievement, "GET /api/tree achievement");
  assert(device?.deviceId === "mac-device" && device.platform === "mac", "cloud tree should return device metadata");
  assert(modelStat?.model === "private-model" && modelStat.tokens === 1234, "cloud tree should return aggregate model stats");
  assert(!("prompt" in modelStat) && !("localPath" in modelStat), "cloud model stats should not leak raw session data");
  const fullTreeCursor = cloudTree.cursor;
  assert(typeof fullTreeCursor === "string" && Number.isFinite(Date.parse(fullTreeCursor)), "full cloud tree should return a sync cursor");

  await delay(5);
  await requestJson("/api/tree/events", {
    method: "POST",
    body: {
      deviceId: "mac-device",
      appVersion: "0.5.5-test",
      modelStats: [
        {
          date: utcToday,
          source: "codex-session",
          model: "private-model",
          tokens: 1334,
          inputTokens: 1100,
          outputTokens: 200,
          cacheReadTokens: 34,
          cacheWriteTokens: 0,
        },
      ],
      entries: [
        {
          id: "mac-event-2",
          createdAt: "2026-05-27T02:00:00.000Z",
          source: "openclaw-session",
          tokens: 100,
          inputTokens: 80,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          deviceId: "mac-device",
        },
      ],
    },
  });
  await requestJson("/api/tree/achievements", {
    method: "POST",
    body: {
      appVersion: "0.5.5-test",
      achievements: [
        {
          id: "branch",
          unlockedAt: "2026-05-27T02:01:00.000Z",
        },
      ],
    },
  });
  const deltaTree = await requestJson(`/api/tree/delta?since=${encodeURIComponent(fullTreeCursor)}`);
  assert(deltaTree.delta === true, "delta cloud tree should mark the payload as a delta");
  assert(typeof deltaTree.cursor === "string" && deltaTree.cursor > fullTreeCursor, "delta cloud tree should advance the cursor");
  assert(deltaTree.entries?.length === 1 && deltaTree.entries[0].id === "mac-event-2", "delta cloud tree should only return events changed after the cursor");
  assert(deltaTree.achievements?.length === 1 && deltaTree.achievements[0].id === "branch", "delta cloud tree should only return achievements changed after the cursor");
  assert(deltaTree.devicesFull === true, "delta cloud tree should keep device snapshots backward-compatible");
  assert(deltaTree.modelStatsFull === false, "delta cloud tree should only include changed model aggregate snapshots");
  assert(deltaTree.devices?.find((item) => item.deviceId === "mac-device")?.tokens === 1334, "delta cloud tree should use cached per-device totals");
  assert(deltaTree.modelStats?.find((item) => item.model === "private-model")?.tokens === 1334, "delta cloud tree should include the latest aggregate model totals");
  await assertRejects(
    () => requestJson("/api/tree/delta?since=not-a-date"),
    "delta cloud tree should reject invalid cursors",
  );

  await requestJson("/api/usage/daily", {
    method: "POST",
    body: {
      appVersion: "0.5.5-test",
      usageStartDate: utcToday,
      days: [
        { date: utcToday, tokens: 1234 },
        { date: eastOfUtcToday, tokens: 4321 },
      ],
      usagePreferencesPublic: true,
      usagePreferences: [
        {
          range: "24h",
          favoriteAgent: { label: "Codex", percent: 100 },
          favoriteModel: "private-model",
          favoritePeriod: { id: "morning", startHour: 6, endHour: 12 },
          peakTokensPerMinute: 20,
        },
      ],
    },
  });
  let dayLeaderboard = await requestJson("/api/leaderboard?range=today");
  assert(
    dayLeaderboard.entries?.[0]?.tokens === 4321,
    "legacy clients without hourly buckets should still have a recent daily fallback for the 24h leaderboard",
  );

  const currentHour = hourKey(new Date());
  const previousHour = hourKey(addHours(new Date(), -1));
  const oldHour = hourKey(addHours(new Date(), -25));
  await requestJson("/api/usage/daily", {
    method: "POST",
    body: {
      appVersion: "0.5.5-test",
      forceSync: true,
      usageStartDate: utcToday,
      days: [
        { date: utcToday, tokens: 1234 },
        { date: eastOfUtcToday, tokens: 5000 },
      ],
      hours: [
        { hourStartUtc: previousHour, tokens: 1111 },
        { hourStartUtc: currentHour, tokens: 2222 },
        { hourStartUtc: oldHour, tokens: 999999 },
      ],
    },
  });
  dayLeaderboard = await requestJson("/api/leaderboard?range=24h");
  assert(dayLeaderboard.range === "24h", "leaderboard should expose the rolling 24h range");
  assert(dayLeaderboard.entries?.[0]?.tokens === 3333, "rolling 24h leaderboard should use hourly buckets");
  dayLeaderboard = await requestJson("/api/leaderboard?range=today");
  assert(dayLeaderboard.entries?.[0]?.tokens === 3333, "legacy today range should alias to rolling 24h");
  const leaderboardCollection = await requestJson("/api/leaderboards");
  assert(leaderboardCollection.ranges?.["24h"]?.entries?.[0]?.tokens === 3333, "leaderboard collection should expose 24h");
  assert(leaderboardCollection.ranges?.today?.entries?.[0]?.tokens === 3333, "leaderboard collection should keep a legacy today alias");

  let friendList = await requestJson("/api/social/friends");
  assert(Array.isArray(friendList.friends) && friendList.friends.length === 0, "fresh user should start without friends");
  const friendRequest = await requestJson("/api/social/friends", {
    method: "POST",
    body: { username: "friend-user" },
  });
  assert(friendRequest.friend?.status === "pending", "friend request should start pending");
  assert(friendRequest.friend?.direction === "outgoing", "requester should see outgoing friend request");
  const incomingRequest = await requestJson("/api/social/friends", { token: friendToken });
  assert(incomingRequest.friends?.[0]?.direction === "incoming", "target should see incoming friend request");
  const acceptedFriend = await requestJson("/api/social/friends/user-verify/accept", {
    method: "POST",
    token: friendToken,
  });
  assert(acceptedFriend.friend?.status === "accepted", "incoming friend request should be accepted");
  friendList = await requestJson("/api/social/friends");
  assert(friendList.friends?.[0]?.status === "accepted", "requester should see accepted friend");
  const removedFriendList = await requestJson("/api/social/friends/user-friend", { method: "DELETE" });
  assert(removedFriendList.friends?.length === 0, "removing a friend should clear the relationship");

  const groupCreate = await requestJson("/api/social/groups", {
    method: "POST",
    body: {
      name: "Vibe Guild",
      description: "A playful coding guild",
      iconEmoji: "🌱",
    },
  });
  const groupId = groupCreate.group?.groupId;
  assert(groupId && groupCreate.group?.role === "leader", "social group creator should become leader");
  assert(groupCreate.group?.memberCount === 1, "new social group should start with one member");

  const invite = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/invites`, {
    method: "POST",
    body: { maxUses: 2 },
  });
  assert(typeof invite.invite?.code === "string", "group invite should return a visible invite code");

  const joinRequest = await requestJson(`/api/social/invites/${encodeURIComponent(invite.invite.code)}/accept`, {
    method: "POST",
    token: friendToken,
  });
  assert(joinRequest.request?.status === "pending", "invite code should create a pending join request");
  assert(joinRequest.request?.type === "invite_code", "invite-code joins should require group approval");
  const friendPendingRequests = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/requests`);
  assert(
    friendPendingRequests.requests?.some((request) => request.requesterUserId === "user-friend"),
    "group managers should see invite-code join requests",
  );
  const approvedJoin = await requestJson(
    `/api/social/groups/${encodeURIComponent(groupId)}/requests/${encodeURIComponent(joinRequest.request.requestId)}/approve`,
    { method: "POST" },
  );
  assert(approvedJoin.group?.memberCount === 2, "approving a join request should add the second member");
  assert(
    approvedJoin.group?.members?.some((member) => member.userId === "user-friend"),
    "approved group should list the new member",
  );

  const friendGroups = await requestJson("/api/social/groups", { token: friendToken });
  assert(friendGroups.groups?.[0]?.groupId === groupId, "joined member should see the group in their group list");

  await requestJson("/api/social/friends", {
    method: "POST",
    body: { username: "pal-user" },
  });
  await requestJson("/api/social/friends/user-verify/accept", {
    method: "POST",
    token: palToken,
  });
  const palInvite = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/friend-invites`, {
    method: "POST",
    body: { userId: "user-pal" },
  });
  assert(palInvite.request?.type === "friend_invite", "friend invite should create an incoming invite for the friend");
  const palInbox = await requestJson("/api/social/group-requests", { token: palToken });
  assert(
    palInbox.incomingInvites?.some((request) => request.requestId === palInvite.request.requestId),
    "invited friends should see pending group invites",
  );
  const palAccepted = await requestJson(
    `/api/social/group-requests/${encodeURIComponent(palInvite.request.requestId)}/accept`,
    { method: "POST", token: palToken },
  );
  assert(
    palAccepted.group?.members?.some((member) => member.userId === "user-pal"),
    "accepting a friend invite should add the invited friend",
  );
  await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/members/me`, {
    method: "DELETE",
    token: palToken,
  });

  await requestJson("/api/usage/daily", {
    method: "POST",
    token: friendToken,
    body: {
      appVersion: "0.5.5-test",
      forceSync: true,
      usageStartDate: utcToday,
      days: [{ date: eastOfUtcToday, tokens: 777 }],
      hours: [{ hourStartUtc: currentHour, tokens: 777 }],
    },
  });
  const groupLeaderboard = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=24h`);
  assert(groupLeaderboard.entries?.length === 2, "group leaderboard should include both sharing members");
  assert(groupLeaderboard.entries?.[0]?.tokens === 3333, "group leaderboard should rank the highest member first");
  assert(groupLeaderboard.entries?.[1]?.tokens === 777, "group leaderboard should include the invited member contribution");

  // (g) group boards expose both product modes: internal lifetime totals for
  // friends/company rankings and since-joining contribution for guild-style play.
  // user-friend joined today; put 9999 historical tokens outside the daily
  // upload window so total mode must use usage_totals, not daily_usage.
  const beforeJoinDate = addDays(utcToday, -60);
  await requestJson("/api/usage/daily", {
    method: "POST",
    token: friendToken,
    body: {
      appVersion: "0.5.5-test",
      forceSync: true,
      totalTokens: 10776,
      totalXp: 10776,
      totalDaysActive: 2,
      firstUsageDate: beforeJoinDate,
      days: [
        { date: eastOfUtcToday, tokens: 777 },
      ],
    },
  });
  const groupAllBoard = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=all`);
  const friendGroupAll = groupAllBoard.entries?.find((entry) => entry.userId === "user-friend");
  assert(
    friendGroupAll?.tokens === 10776,
    "group all-time board should include shared historical usage for internal rankings",
  );
  const groupSinceJoinBoard = await requestJson(
    `/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=all&basis=since_join`,
  );
  const friendGroupSinceJoin = groupSinceJoinBoard.entries?.find((entry) => entry.userId === "user-friend");
  assert(
    friendGroupSinceJoin?.tokens === 777,
    "group since-joining board should exclude pre-join usage for contribution rankings",
  );
  const globalAllBoard = await requestJson("/api/leaderboard?range=all");
  const friendGlobalAll = globalAllBoard.entries?.find((entry) => entry.userId === "user-friend");
  assert(
    friendGlobalAll?.tokens === 10776,
    "global all-time total should include the same historical usage while public",
  );

  // (d) share_usage=false hides a member from the group board; restoring it shows them again.
  await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/membership`, {
    method: "POST",
    token: friendToken,
    body: { shareUsage: false },
  });
  const groupBoardNoShare = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=24h`);
  assert(
    !groupBoardNoShare.entries?.some((entry) => entry.userId === "user-friend"),
    "share_usage=false should hide the member from the group board",
  );
  await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/membership`, {
    method: "POST",
    token: friendToken,
    body: { shareUsage: true },
  });
  const groupBoardShare = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=24h`);
  assert(
    groupBoardShare.entries?.some((entry) => entry.userId === "user-friend"),
    "restoring share_usage should show the member on the group board again",
  );

  // (a) a non-public member is hidden from the GLOBAL board but stays on the GROUP board.
  await requestJson("/api/usage/daily", {
    method: "POST",
    token: friendToken,
    body: {
      appVersion: "0.5.5-test",
      forceSync: true,
      usagePublic: false,
      usageStartDate: utcToday,
      days: [{ date: eastOfUtcToday, tokens: 777 }],
      hours: [{ hourStartUtc: currentHour, tokens: 777 }],
    },
  });
  const globalAfterPrivate = await requestJson("/api/leaderboard?range=24h", { token: friendToken });
  assert(
    !globalAfterPrivate.entries?.some((entry) => entry.userId === "user-friend"),
    "non-public member should not appear on the global board",
  );
  assert(
    globalAfterPrivate.entries?.some((entry) => entry.userId === "user-verify"),
    "public member should still appear on the global board",
  );
  const groupAfterPrivate = await requestJson(
    `/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=24h`,
    { token: friendToken },
  );
  assert(
    groupAfterPrivate.entries?.some((entry) => entry.userId === "user-friend"),
    "non-public member should still appear on the group board",
  );
  await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/membership`, {
    method: "POST",
    token: friendToken,
    body: { shareUsage: false },
  });
  const redactedNoShareProfile = await requestJson("/api/social/users/user-friend/profile");
  assert(
    redactedNoShareProfile.profile?.usageVisible === false,
    "turning off group sharing should hide private usage from co-members' profile views",
  );
  await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/membership`, {
    method: "POST",
    token: friendToken,
    body: { shareUsage: true },
  });

  // (e) profile cards: relationship-gated access + usage-consent honoring.
  // user-verify and user-friend are co-members (not friends); user-verify is public-global,
  // user-friend is private-global but shares usage in the group; user-stranger has no relationship.
  const selfProfile = await requestJson("/api/social/users/user-verify/profile");
  assert(selfProfile.profile?.isSelf === true, "own profile should be flagged as self");
  assert(selfProfile.profile?.usageVisible === true, "own profile should always expose usage");
  assert(typeof selfProfile.profile?.totalTokens === "number", "own profile should include token total");
  assert(
    Array.isArray(selfProfile.profile?.achievements) && selfProfile.profile.achievements.length === 2,
    "own profile should include unlocked achievements",
  );
  assert(typeof selfProfile.profile?.joinedAt === "string", "profile should include the join date");

  // Co-member viewing a public-global member: usage visible because they're on the global board.
  const coMemberView = await requestJson("/api/social/users/user-verify/profile", { token: friendToken });
  assert(coMemberView.profile?.isSelf === false, "co-member view should not be flagged as self");
  assert(coMemberView.profile?.mutualGroupCount >= 1, "co-members should report a shared group");
  assert(
    coMemberView.profile?.usageVisible === true,
    "a global-board member's usage should be visible to a co-member",
  );

  // Owner viewing the private-global member: usage still visible because they share usage in the group.
  const sharingMemberView = await requestJson("/api/social/users/user-friend/profile");
  assert(
    sharingMemberView.profile?.usageVisible === true,
    "a member sharing usage in a shared group should expose usage to a co-member",
  );
  assert(
    sharingMemberView.profile?.totalTokens === 10776,
    "profile token total should use lifetime usage totals instead of the rolling daily window",
  );

  const friendPrivacyDefault = await requestJson("/api/social/profile-privacy", { token: friendToken });
  assert(
    friendPrivacyDefault.privacy?.profileVisibility === "relations",
    "profile privacy should default to friends-and-groups visibility",
  );
  await requestJson("/api/social/profile-privacy", {
    method: "POST",
    token: friendToken,
    body: {
      profileVisibility: "relations",
      showLevel: true,
      showTokenTotal: false,
      showActiveDays: false,
      showAchievements: false,
    },
  });
  const redactedMemberView = await requestJson("/api/social/users/user-friend/profile");
  assert(redactedMemberView.profile?.usageVisible === true, "one visible field should keep growth data visible");
  assert(typeof redactedMemberView.profile?.level === "number", "visible level should be returned");
  assert(
    !("totalTokens" in (redactedMemberView.profile ?? {})),
    "hidden token total should not be returned by the profile API",
  );
  assert(
    !("daysActive" in (redactedMemberView.profile ?? {})),
    "hidden active days should not be returned by the profile API",
  );
  assert(
    !("achievements" in (redactedMemberView.profile ?? {})),
    "hidden achievements should not be returned by the profile API",
  );

  await requestJson("/api/social/profile-privacy", {
    method: "POST",
    token: friendToken,
    body: {
      profileVisibility: "private",
      showLevel: true,
      showTokenTotal: true,
      showActiveDays: true,
      showAchievements: true,
    },
  });
  await assertRejects(
    () => requestJson("/api/social/users/user-friend/profile"),
    "a private profile should not be openable by a co-member",
  );
  await requestJson("/api/social/profile-privacy", {
    method: "POST",
    token: friendToken,
    body: {
      profileVisibility: "relations",
      showLevel: true,
      showTokenTotal: true,
      showActiveDays: true,
      showAchievements: true,
    },
  });

  // A stranger with no friendship and no shared group cannot even open the card (404, existence hidden).
  await assertRejects(
    () => requestJson("/api/social/users/user-verify/profile", { token: strangerToken }),
    "a user with no relationship should not be able to view a profile",
  );

  await assertRejects(
    () =>
      requestJson("/api/usage/daily", {
        method: "POST",
        body: {
          appVersion: "0.5.5-test",
          usageStartDate: utcToday,
          days: [{ date: eastOfUtcToday, tokens: 5678 }],
          hours: [{ hourStartUtc: currentHour, tokens: 5678 }],
        },
      }),
    "non-forced leaderboard sync should still honor cooldown",
  );

  await requestJson("/api/leaderboard", { method: "DELETE" });
  cloudTree = await requestJson("/api/tree");
  assert(cloudTree.summary?.entryCount === 2, "leaving leaderboard must not delete cloud tree events");
  assert(cloudTree.summary?.achievementCount === 2, "leaving leaderboard must not delete cloud tree achievements");

  // (b) leaving the global board keeps group data: user-verify (in a group) drops off the
  // global board but stays on the group board with the same contribution.
  const globalAfterLeave = await requestJson("/api/leaderboard?range=24h");
  assert(
    !globalAfterLeave.entries?.some((entry) => entry.userId === "user-verify"),
    "leaving the global board should hide the user from it",
  );
  const groupAfterLeave = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=24h`);
  assert(
    groupAfterLeave.entries?.some((entry) => entry.userId === "user-verify"),
    "leaving the global board must keep the user's group contribution",
  );

  // (c) leaving a group removes the member; the owner cannot leave their own group.
  await assertRejects(
    () => requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/members/me`, { method: "DELETE" }),
    "group owner should not be able to leave their own group",
  );
  await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/members/me`, {
    method: "DELETE",
    token: friendToken,
  });
  const friendGroupsAfterLeave = await requestJson("/api/social/groups", { token: friendToken });
  assert(
    !friendGroupsAfterLeave.groups?.some((group) => group.groupId === groupId),
    "leaving a group should remove it from the member's group list",
  );
  const groupAfterMemberLeave = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=24h`);
  assert(
    !groupAfterMemberLeave.entries?.some((entry) => entry.userId === "user-friend"),
    "leaving a group should remove the member from the group board",
  );

  // (f) invite maxUses is consumed atomically: a single-use invite can't be re-spent
  // after the use is claimed, even if the joiner later leaves (uses must not reset).
  const singleUseInvite = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/invites`, {
    method: "POST",
    body: { maxUses: 1 },
  });
  const singleUseCode = singleUseInvite.invite?.code;
  assert(typeof singleUseCode === "string", "single-use invite should return a code");
  const strangerJoin = await requestJson(`/api/social/invites/${encodeURIComponent(singleUseCode)}/accept`, {
    method: "POST",
    token: strangerToken,
  });
  assert(strangerJoin.request?.status === "pending", "single-use invite should reserve a pending request");
  const strangerApproved = await requestJson(
    `/api/social/groups/${encodeURIComponent(groupId)}/requests/${encodeURIComponent(strangerJoin.request.requestId)}/approve`,
    { method: "POST" },
  );
  assert(
    strangerApproved.group?.members?.some((member) => member.userId === "user-stranger"),
    "approving the single-use request should admit the first requester",
  );
  await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/members/me`, {
    method: "DELETE",
    token: strangerToken,
  });
  await assertRejects(
    () =>
      requestJson(`/api/social/invites/${encodeURIComponent(singleUseCode)}/accept`, {
        method: "POST",
        token: strangerToken,
      }),
    "an exhausted single-use invite must not be reusable after the use is claimed",
  );

  console.log("Worker API verified: device-only cloud trees, tree sync privacy, delta cloud tree sync, achievement privacy, 24h leaderboard buckets, social friends, social groups/invite-code approval/friend invites/group leaderboard with internal totals and since-joining contribution, group/global decoupling (private members, leave-keeps-group-data, leave-group, share toggle), relationship-gated profile cards (self/co-member/sharing/stranger), atomic invite maxUses, legacy fallback, and leaderboard leave safety passed.");
} finally {
  if (devProcess) await terminate(devProcess);
  rmSync(persistDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}

function wranglerCommand() {
  if (process.platform === "win32") {
    const npxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
    if (existsSync(npxCli)) return { command: process.execPath, args: [npxCli, "--yes", "wrangler@3.114.0"] };
  }
  const candidates = ["/opt/homebrew/bin/npx", "/usr/local/bin/npx", "/usr/bin/npx", "npx"];
  const command = candidates.find((candidate) => candidate === "npx" || existsSync(candidate));
  return { command: command ?? candidates[0], args: ["--yes", "wrangler@3.114.0"] };
}

function spawnWrangler(args) {
  const wrangler = wranglerCommand();
  const commandArgs = [...wrangler.args, ...args];
  const child = spawn(wrangler.command, commandArgs, {
    cwd: workerDir,
    env: {
      ...process.env,
      PATH: ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].filter(Boolean).join(delimiter),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  child.output = "";
  const collect = (chunk) => {
    child.output = `${child.output}${chunk.toString("utf8")}`.slice(-20_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  return child;
}

function getFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const portNumber = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!portNumber) {
          reject(new Error("Could not allocate a local port for wrangler dev"));
          return;
        }
        resolvePromise(portNumber);
      });
    });
  });
}

async function prepareD1Database(seedSql) {
  await ensureLocalD1DatabaseCreated();
  const databasePath = findLocalD1DatabasePath();
  await runSqliteScript(databasePath, readFileSync(join(workerDir, "schema.sql"), "utf8"));
  await runSqliteScript(databasePath, seedSql);
}

async function ensureLocalD1DatabaseCreated() {
  try {
    await fetch(`${baseUrl}/api/leaderboard?range=24h`);
  } catch {
    // The first D1-backed request may fail before schema is loaded; it still creates the local SQLite file.
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      findLocalD1DatabasePath();
      return;
    } catch {
      await delay(100);
    }
  }
  findLocalD1DatabasePath();
}

function findLocalD1DatabasePath() {
  const databaseDir = join(persistDir, "v3", "d1", "miniflare-D1DatabaseObject");
  const databaseFile = readdirSync(databaseDir).find((file) => file.endsWith(".sqlite"));
  assert(databaseFile, `Could not find local D1 sqlite database in ${databaseDir}`);
  return join(databaseDir, databaseFile);
}

function runSqliteScript(databasePath, sql) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("sqlite3", [databasePath], {
      env: {
      ...process.env,
      PATH: ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].filter(Boolean).join(delimiter),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const collect = (chunk) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-20_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`sqlite3 failed (${code ?? signal ?? "unknown"})\n${output.trim()}`));
    });
    child.stdin.end(sql);
  });
}

async function waitForWorker() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    if (devProcess.exitCode !== null) {
      throw new Error(`wrangler dev exited early (${devProcess.exitCode})\n${devProcess.output.trim()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Retry until wrangler dev finishes booting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for wrangler dev\n${devProcess.output.trim()}`);
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${options.token ?? token}`,
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed (${response.status}) ${text}`);
  }
  return body;
}

function terminate(child) {
  if (child.killed) return Promise.resolve();
  if (process.platform === "win32" && child.pid) {
    return new Promise((resolveTerminate) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      killer.on("error", () => resolveTerminate());
      killer.on("exit", () => resolveTerminate());
    });
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  return delay(500);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function addHours(value, hours) {
  const date = new Date(value);
  date.setUTCHours(date.getUTCHours() + hours);
  return date;
}

function hourKey(value) {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

async function assertRejects(action, message) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(message);
}

function assertNoForbiddenKeys(value, label) {
  for (const key of [
    "note",
    "agent",
    "provider",
    "model",
    "prompt",
    "reply",
    "content",
    "path",
    "localPath",
    "file",
    "session",
    "trigger",
    "triggerJson",
  ]) {
    assert(!(key in value), `${label} leaked forbidden key: ${key}`);
  }
}
