import * as http from "node:http";
import * as https from "node:https";
import { createHash, randomBytes } from "node:crypto";
import type {
  AchievementState,
  AchievementUnlock,
  CloudDeviceSummary,
  CloudModelStat,
  CloudSyncStatus,
  CreateSocialFriendInput,
  CreateSocialGroupFriendInviteInput,
  CreateSocialGroupInput,
  CreateSocialGroupInviteInput,
  LedgerEntry,
  LedgerFile,
  LeaderboardCollection,
  LeaderboardData,
  LeaderboardEntry,
  LeaderboardPreferencePeriod,
  LeaderboardProfile,
  LeaderboardRange,
  LeaderboardStatus,
  LeaderboardUsagePreference,
  Settings,
  SocialFriend,
  SocialFriendList,
  SocialGroup,
  SocialGroupInvite,
  SocialGroupJoinRequest,
  SocialGroupLeaderboardBasis,
  SocialGroupLeaderboardData,
  SocialGroupLeaderboardEntry,
  SocialGroupList,
  SocialGroupMember,
  SocialGroupModerationList,
  SocialGroupRequestList,
  SocialGroupRole,
  SocialGroupVisibility,
  SocialProfile,
  SocialProfilePrivacy,
  SocialProfileResult,
} from "../shared/types.js";

interface LeaderboardAuthFile {
  token?: string;
  profile?: LeaderboardProfile;
  createdAt?: string;
}

interface LeaderboardAuthSessionResponse {
  token?: string;
}

interface CloudSyncFile {
  syncedEntryIds?: string[];
  syncedEventFingerprints?: string[];
  syncedAchievementIds?: string[];
  lastUploadedCount?: number;
  lastDownloadedCount?: number;
  devices?: CloudDeviceSummary[];
  modelStats?: CloudModelStat[];
  modelStatsSignature?: string;
  treeCursor?: string;
}

interface CloudTreeResponse {
  entries?: unknown[];
  achievements?: unknown[];
  devices?: unknown[];
  modelStats?: unknown[];
  cursor?: unknown;
  delta?: boolean;
  modelStatsFull?: boolean;
  devicesFull?: boolean;
  summary?: {
    hasRemoteTree?: boolean;
  };
}

interface CloudDeviceInfo {
  deviceId: string;
  alias?: string;
  platform?: string;
}

export interface LeaderboardRequestJsonOptions {
  method?: string;
  token?: string;
  body?: unknown;
  timeoutMs?: number;
}

export type LeaderboardRequestJson = <T = unknown>(
  urlString: string,
  options?: LeaderboardRequestJsonOptions,
) => Promise<T>;

interface LeaderboardServiceOptions {
  apiUrl: string;
  appName: string;
  syncIntervalMs: number;
  cloudSyncIntervalMs: number;
  authTimeoutMs: number;
  callbackPath: string;
  authPath: () => string;
  cloudSyncPath: () => string;
  deviceId: () => string;
  deviceInfo: () => CloudDeviceInfo;
  cloudModelStats: () => CloudModelStat[];
  getLedger: () => LedgerFile;
  getAchievements: () => AchievementState;
  updateSettings: (partial: Partial<Settings>) => void;
  appendRemoteEntries: (entries: LedgerEntry[]) => number;
  mergeRemoteAchievements: (unlocked: AchievementUnlock[]) => number;
  xpForEntry: (entry: LedgerEntry) => number;
  dateKey: (date: Date) => string;
  currentAppVersion: () => string;
  mainText: (key: string) => string;
  openExternal: (url: string) => Promise<void>;
  readJsonFile: <T>(path: string) => T | undefined;
  writeJsonAtomic: (path: string, value: unknown) => void;
  broadcastStatus: (status: LeaderboardStatus) => void;
  requestJson?: LeaderboardRequestJson;
}

export interface LeaderboardSyncOptions {
  force?: boolean;
}

export function createLeaderboardService(options: LeaderboardServiceOptions) {
  let auth: LeaderboardAuthFile = {};
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;
  let cloudSyncing = false;
  let lastCloudUploadedCount = 0;
  let lastCloudDownloadedCount = 0;
  let authServer: http.Server | null = null;
  let cancelPendingAuth: ((message?: string) => boolean) | null = null;
  let lastSyncAttemptAt: string | undefined;

  const configured = Boolean(options.apiUrl);
  const ledger = () => options.getLedger();
  const text = (key: string) => options.mainText(key);
  const requestJson: LeaderboardRequestJson = (urlString, requestOptions) =>
    options.requestJson ? options.requestJson(urlString, requestOptions) : defaultRequestJson(urlString, requestOptions);

  function readAuth() {
    auth = normalizeAuth(options.readJsonFile<LeaderboardAuthFile>(options.authPath()));
    return auth;
  }

  function writeAuth(nextAuth = auth) {
    auth = normalizeAuth(nextAuth);
    options.writeJsonAtomic(options.authPath(), auth);
  }

  function clearAuth() {
    auth = {};
    options.writeJsonAtomic(options.authPath(), {});
  }

  function status(error?: string): LeaderboardStatus {
    const authenticated = Boolean(auth.token && auth.profile);
    const profile = authenticated ? auth.profile : ledger().settings.leaderboardProfile;
    return {
      configured,
      authenticated,
      joined: Boolean(ledger().settings.leaderboardEnabled && authenticated),
      syncing,
      profile,
      lastSyncedAt: ledger().settings.leaderboardLastSyncedAt,
      error,
    };
  }

  function broadcast(error?: string) {
    options.broadcastStatus(status(error));
  }

  function startSync() {
    scheduleNextSync();
    scheduleCloudSyncSoon(nextCloudSyncDelay());
    broadcast();
  }

  function stop() {
    if (syncTimer) clearTimeout(syncTimer);
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    syncTimer = null;
    cloudSyncTimer = null;
    cancelPendingAuth?.(text("leaderboardLoginCancelled"));
    authServer?.close();
    authServer = null;
  }

  // Usage uploads feed both the global leaderboard (when joined) and group
  // leaderboards (when in any group). Group-only users still upload, but mark
  // their data non-public so they never appear on the global board.
  function shouldSyncUsage() {
    return ledger().settings.leaderboardEnabled === true || (ledger().settings.socialGroupCount ?? 0) > 0;
  }

  function scheduleNextSync() {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }

    if (!configured || !auth.token || !shouldSyncUsage() || !ledger().settings.leaderboardAutoSyncEnabled) return;

    syncTimer = setTimeout(() => {
      syncTimer = null;
      void syncUsage();
    }, nextSyncDelay());
  }

  function scheduleCloudSyncSoon(delayMs = 3_000) {
    if (cloudSyncTimer) {
      clearTimeout(cloudSyncTimer);
      cloudSyncTimer = null;
    }
    if (!configured || !auth.token || !ledger().settings.cloudSyncEnabled || !ledger().settings.cloudSyncAutoSyncEnabled) return;
    cloudSyncTimer = setTimeout(() => {
      cloudSyncTimer = null;
      void syncCloudTree();
    }, delayMs);
  }

  function cloudStatus(error?: string): CloudSyncStatus {
    const authenticated = Boolean(auth.token && auth.profile);
    const state = readCloudSyncState();
    return {
      configured,
      authenticated,
      enabled: Boolean(ledger().settings.cloudSyncEnabled && authenticated),
      syncing: cloudSyncing,
      hasRemoteTree: state.syncedEntryIds?.length || state.syncedAchievementIds?.length ? true : undefined,
      deviceId: ledger().settings.cloudSyncDeviceId,
      profile: authenticated ? auth.profile : ledger().settings.leaderboardProfile,
      lastSyncedAt: ledger().settings.cloudSyncLastSyncedAt,
      lastPulledAt: ledger().settings.cloudSyncLastPulledAt,
      lastUploadedCount: lastCloudUploadedCount || state.lastUploadedCount,
      lastDownloadedCount: lastCloudDownloadedCount || state.lastDownloadedCount,
      devices: state.devices,
      modelStats: state.modelStats,
      error,
    };
  }

  function nextSyncDelay() {
    const lastSyncedTime = latestSyncTime(ledger().settings.leaderboardLastSyncedAt, lastSyncAttemptAt);
    if (!lastSyncedTime) return Math.min(3_000, options.syncIntervalMs);
    return Math.max(3_000, lastSyncedTime + options.syncIntervalMs - Date.now());
  }

  function nextCloudSyncDelay() {
    const lastSyncedTime = latestSyncTime(ledger().settings.cloudSyncLastSyncedAt);
    if (!lastSyncedTime) return Math.min(3_000, options.cloudSyncIntervalMs);
    return Math.max(3_000, lastSyncedTime + options.cloudSyncIntervalMs - Date.now());
  }

  function latestSyncTime(...values: Array<string | undefined>) {
    const times = values
      .map((value) => (value ? Date.parse(value) : NaN))
      .filter((time) => Number.isFinite(time));
    return times.length ? Math.max(...times) : undefined;
  }

  async function login(): Promise<LeaderboardStatus> {
    if (!configured) return status(text("leaderboardServiceNotConfigured"));

    try {
      const profile = await authenticate();
      options.updateSettings({
        leaderboardEnabled: true,
        leaderboardProfile: profile,
      });
      return await syncUsage({ force: true });
    } catch (error) {
      return status(error instanceof Error ? error.message : text("leaderboardLoginFailed"));
    }
  }

  async function authenticate() {
    if (auth.token && auth.profile) return auth.profile;
    const token = await waitForToken();
    const profile = await fetchProfile(token);
    writeAuth({
      token,
      profile,
      createdAt: new Date().toISOString(),
    });
    options.updateSettings({
      leaderboardProfile: profile,
    });
    return profile;
  }

  async function setEnabled(enabled: boolean): Promise<LeaderboardStatus> {
    if (enabled && !configured) return status(text("leaderboardServiceNotConfigured"));
    if (enabled && !auth.token) return status(text("leaderboardLoginRequired"));

    options.updateSettings({
      leaderboardEnabled: enabled,
      leaderboardProfile: enabled ? auth.profile : ledger().settings.leaderboardProfile,
    });
    if (enabled) return await syncUsage({ force: true });
    return status();
  }

  async function logout(): Promise<LeaderboardStatus> {
    const token = auth.token;
    if (token && configured) {
      try {
        await requestJson(apiUrl("/api/leaderboard"), { method: "DELETE", token });
      } catch (error) {
        return status(error instanceof Error ? error.message : text("leaderboardSyncFailed"));
      }
    }
    options.updateSettings({
      leaderboardEnabled: false,
      leaderboardLastSyncedAt: undefined,
      leaderboardPreferencesPublic: false,
    });
    return status(text("leaderboardLoggedOut"));
  }

  async function syncUsage(syncOptions: LeaderboardSyncOptions = {}): Promise<LeaderboardStatus> {
    if (!configured) return status(text("leaderboardServiceNotConfigured"));
    if (!auth.token || !auth.profile) return status(text("leaderboardLoginRequired"));
    if (!shouldSyncUsage()) return status();
    if (syncing) return status();

    const leaderboardEnabled = ledger().settings.leaderboardEnabled === true;
    syncing = true;
    lastSyncAttemptAt = new Date().toISOString();
    broadcast();

    try {
      await requestJson(apiUrl("/api/usage/daily"), {
        method: "POST",
        token: auth.token,
        body: {
          days: dailyUsage(),
          hours: hourlyUsage(),
          ...usageTotals(),
          appVersion: options.currentAppVersion(),
          usageStartDate: usageStartDate(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          forceSync: syncOptions.force === true,
          usagePublic: leaderboardEnabled,
          usagePreferencesPublic: leaderboardEnabled && ledger().settings.leaderboardPreferencesPublic,
          usagePreferences:
            leaderboardEnabled && ledger().settings.leaderboardPreferencesPublic ? usagePreferences() : undefined,
        },
      });
      syncing = false;
      options.updateSettings({
        leaderboardProfile: auth.profile,
        leaderboardLastSyncedAt: new Date().toISOString(),
      });
      scheduleNextSync();
      broadcast();
      return status();
    } catch (error) {
      syncing = false;
      scheduleNextSync();
      const message = error instanceof Error ? error.message : text("leaderboardSyncFailed");
      broadcast(message);
      return status(message);
    }
  }

  async function enableCloudSync(): Promise<CloudSyncStatus> {
    if (!configured) return cloudStatus(text("leaderboardServiceNotConfigured"));
    try {
      const profile = await authenticate();
      const deviceId = options.deviceId();
      options.updateSettings({
        cloudSyncEnabled: true,
        cloudSyncDeviceId: deviceId,
        leaderboardProfile: profile,
        treeStartMode: ledger().settings.treeStartMode ?? "new",
      });
      return await syncCloudTree({ force: true });
    } catch (error) {
      return cloudStatus(error instanceof Error ? error.message : text("leaderboardLoginFailed"));
    }
  }

  async function joinCloudTree(): Promise<CloudSyncStatus> {
    if (!configured) return cloudStatus(text("leaderboardServiceNotConfigured"));
    try {
      const profile = await authenticate();
      options.updateSettings({
        cloudSyncEnabled: true,
        cloudSyncDeviceId: options.deviceId(),
        leaderboardProfile: profile,
      });
      const result = await syncCloudTree({ force: true, pullFirst: true, requireRemote: true });
      if (result.error) {
        options.updateSettings({ cloudSyncEnabled: false });
        return cloudStatus(result.error);
      }
      return result;
    } catch (error) {
      return cloudStatus(error instanceof Error ? error.message : text("leaderboardLoginFailed"));
    }
  }

  function cancelAuth(message = text("leaderboardLoginCancelled")): CloudSyncStatus {
    cancelPendingAuth?.(message);
    return cloudStatus(message);
  }

  async function syncCloudTree(
    syncOptions: { force?: boolean; pullFirst?: boolean; requireRemote?: boolean } = {},
  ): Promise<CloudSyncStatus> {
    if (!configured) return cloudStatus(text("leaderboardServiceNotConfigured"));
    if (!auth.token || !auth.profile) return cloudStatus(text("leaderboardLoginRequired"));
    if (!ledger().settings.cloudSyncEnabled) return cloudStatus();
    if (cloudSyncing) return cloudStatus();

    cloudSyncing = true;
    let state = readCloudSyncState();
    let uploadedCount = 0;
    let downloadedCount = 0;

    try {
      if (syncOptions.pullFirst) {
        const pulled = await pullCloudTree({ state });
        if (syncOptions.requireRemote && !pulled.hasRemoteTree) {
          throw new Error(text("cloudSyncNoRemoteTree"));
        }
        downloadedCount += pulled.downloaded;
        state = mergeCloudState(state, pulled.entries, pulled.achievements, pulled.devices, pulled.modelStats, pulled.cursor);
      }

      const modelStatsSignature = await syncCloudDeviceSnapshot(state, syncOptions.force === true);
      state = { ...state, modelStatsSignature };

      const syncedEntryIds = new Set(syncOptions.force && !syncOptions.pullFirst ? [] : state.syncedEntryIds ?? []);
      const syncedEventFingerprints = new Set(state.syncedEventFingerprints ?? []);
      const localEntries = ledger().entries.filter((entry) => {
        if (isCloudSyncedEntry(entry) || syncedEntryIds.has(entry.id)) return false;
        const fingerprint = cloudEventFingerprint(entry);
        return !fingerprint || !syncedEventFingerprints.has(fingerprint);
      });
      for (const chunk of chunkArray(localEntries, 500)) {
        if (!chunk.length) continue;
        await requestJson(apiUrl("/api/tree/events"), {
          method: "POST",
          token: auth.token,
          body: {
            deviceId: options.deviceId(),
            entries: chunk.map((entry) => cloudEntry(entry, options.deviceId())),
            appVersion: options.currentAppVersion(),
          },
        });
        uploadedCount += chunk.length;
        for (const entry of chunk) {
          syncedEntryIds.add(entry.id);
          const fingerprint = cloudEventFingerprint(entry);
          if (fingerprint) syncedEventFingerprints.add(fingerprint);
        }
      }

      const syncedAchievementIds = new Set(syncOptions.force ? [] : state.syncedAchievementIds ?? []);
      const localAchievements = options.getAchievements().unlocked.filter((item) => !syncedAchievementIds.has(item.id));
      if (localAchievements.length) {
        await requestJson(apiUrl("/api/tree/achievements"), {
          method: "POST",
          token: auth.token,
          body: {
            achievements: localAchievements.map(cloudAchievement),
            appVersion: options.currentAppVersion(),
          },
        });
        for (const achievement of localAchievements) syncedAchievementIds.add(achievement.id);
      }

      const pulled = await pullCloudTree({ state });
      downloadedCount += pulled.downloaded;
      state = mergeCloudState(
        {
          ...state,
          syncedEntryIds: [...syncedEntryIds],
          syncedEventFingerprints: [...syncedEventFingerprints],
          syncedAchievementIds: [...syncedAchievementIds],
        },
        pulled.entries,
        pulled.achievements,
        pulled.devices,
        pulled.modelStats,
        pulled.cursor,
      );

      lastCloudUploadedCount = uploadedCount;
      lastCloudDownloadedCount = downloadedCount;
      writeCloudSyncState({
        ...state,
        lastUploadedCount: uploadedCount,
        lastDownloadedCount: downloadedCount,
      });
      options.updateSettings({
        cloudSyncEnabled: true,
        cloudSyncDeviceId: options.deviceId(),
        cloudSyncLastSyncedAt: new Date().toISOString(),
        cloudSyncLastPulledAt: new Date().toISOString(),
      });
      cloudSyncing = false;
      scheduleCloudSyncSoon(nextCloudSyncDelay());
      return cloudStatus();
    } catch (error) {
      cloudSyncing = false;
      if (!syncOptions.requireRemote) scheduleCloudSyncSoon(30_000);
      return cloudStatus(error instanceof Error ? error.message : text("leaderboardSyncFailed"));
    }
  }

  async function getLeaderboard(rangeInput: unknown): Promise<LeaderboardData> {
    const range = normalizeRange(rangeInput);
    if (!configured) {
      return {
        range,
        entries: [],
        error: text("leaderboardServiceNotConfigured"),
      };
    }

    try {
      const url = new URL(apiUrl("/api/leaderboard"));
      url.searchParams.set("range", range);
      const data = await requestJson<unknown>(url.toString(), { token: auth.token });
      return normalizeData(data, range);
    } catch (error) {
      return {
        range,
        entries: [],
        error: error instanceof Error ? error.message : text("leaderboardLoadFailed"),
      };
    }
  }

  async function getLeaderboards(): Promise<LeaderboardCollection> {
    if (!configured) {
      return collectionWithError(text("leaderboardServiceNotConfigured"));
    }

    try {
      const data = await requestJson<unknown>(apiUrl("/api/leaderboards"), { token: auth.token });
      return normalizeCollection(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : text("leaderboardLoadFailed");
      if (message === "Not found" || message.includes("(404)")) return getLeaderboardsByRange();
      return collectionWithError(message);
    }
  }

  async function getLeaderboardsByRange(): Promise<LeaderboardCollection> {
    const results = await Promise.all(LEADERBOARD_PREFERENCE_RANGES.map((range) => getLeaderboard(range)));
    const ranges = Object.fromEntries(results.map((data) => [data.range, data])) as Record<
      LeaderboardRange,
      LeaderboardData
    >;
    return { ranges };
  }

  async function getSocialFriends(): Promise<SocialFriendList> {
    if (!configured) return socialFriendListWithError(text("leaderboardServiceNotConfigured"));
    if (!auth.token) return socialFriendListWithError(text("leaderboardLoginRequired"));

    try {
      const data = await requestJson<unknown>(apiUrl("/api/social/friends"), { token: auth.token });
      return normalizeSocialFriendList(data);
    } catch (error) {
      return socialFriendListWithError(error instanceof Error ? error.message : text("socialFriendsLoadFailed"));
    }
  }

  async function requestSocialFriend(input: CreateSocialFriendInput): Promise<SocialFriend> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));

    const username = cleanOptionalString(input?.username, 80);
    const userId = cleanOptionalString(input?.userId, 80);
    if (!username && !userId) throw new Error(text("socialFriendTargetRequired"));
    const data = await requestJson<unknown>(apiUrl("/api/social/friends"), {
      method: "POST",
      token: auth.token,
      body: { username, userId },
    });
    const friend = normalizeSocialFriend((data as { friend?: unknown })?.friend ?? data);
    if (!friend) throw new Error(text("socialFriendRequestFailed"));
    return friend;
  }

  async function acceptSocialFriend(userId: string): Promise<SocialFriend> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));
    const targetUserId = cleanOptionalString(userId, 80);
    if (!targetUserId) throw new Error(text("socialFriendAcceptFailed"));
    const data = await requestJson<unknown>(apiUrl(`/api/social/friends/${encodeURIComponent(targetUserId)}/accept`), {
      method: "POST",
      token: auth.token,
    });
    const friend = normalizeSocialFriend((data as { friend?: unknown })?.friend ?? data);
    if (!friend) throw new Error(text("socialFriendAcceptFailed"));
    return friend;
  }

  async function removeSocialFriend(userId: string): Promise<SocialFriendList> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));
    const targetUserId = cleanOptionalString(userId, 80);
    if (!targetUserId) throw new Error(text("socialFriendRemoveFailed"));
    const data = await requestJson<unknown>(apiUrl(`/api/social/friends/${encodeURIComponent(targetUserId)}`), {
      method: "DELETE",
      token: auth.token,
    });
    return normalizeSocialFriendList(data);
  }

  // Cache the group count in settings so the main-process sync timer can cheaply
  // decide whether to upload usage (group-only members upload too). Bumping it
  // re-arms the timer via the updateSettings change detection in main.ts.
  function setSocialGroupCount(count: number) {
    const next = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
    if (ledger().settings.socialGroupCount === next) return;
    options.updateSettings({ socialGroupCount: next });
  }

  async function getSocialGroups(): Promise<SocialGroupList> {
    if (!configured) return socialGroupListWithError(text("leaderboardServiceNotConfigured"));
    if (!auth.token) return socialGroupListWithError(text("leaderboardLoginRequired"));

    try {
      const data = await requestJson<unknown>(apiUrl("/api/social/groups"), { token: auth.token });
      const list = normalizeSocialGroupList(data);
      if (!list.error) setSocialGroupCount(list.groups.length);
      return list;
    } catch (error) {
      return socialGroupListWithError(error instanceof Error ? error.message : text("socialGroupsLoadFailed"));
    }
  }

  async function createSocialGroup(input: CreateSocialGroupInput): Promise<SocialGroup> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));

    const name = cleanOptionalString(input?.name, 48);
    if (!name) throw new Error(text("socialGroupNameRequired"));
    const data = await requestJson<unknown>(apiUrl("/api/social/groups"), {
      method: "POST",
      token: auth.token,
      body: {
        name,
        description: cleanOptionalString(input?.description, 180),
        iconEmoji: cleanOptionalString(input?.iconEmoji, 8),
        visibility: normalizeSocialVisibility(input?.visibility),
      },
    });
    const group = normalizeSocialGroup((data as { group?: unknown })?.group ?? data);
    if (!group) throw new Error(text("socialGroupCreateFailed"));
    setSocialGroupCount((ledger().settings.socialGroupCount ?? 0) + 1);
    return group;
  }

  async function createSocialGroupInvite(
    groupId: string,
    input: CreateSocialGroupInviteInput = {},
  ): Promise<SocialGroupInvite> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));

    const data = await requestJson<unknown>(apiUrl(`/api/social/groups/${encodeURIComponent(groupId)}/invites`), {
      method: "POST",
      token: auth.token,
      body: {
        role: normalizeSocialRole(input.role) === "officer" ? "officer" : "member",
        maxUses: positiveInteger(input.maxUses),
        expiresInDays: positiveInteger(input.expiresInDays),
      },
    });
    const invite = normalizeSocialInvite((data as { invite?: unknown })?.invite ?? data);
    if (!invite) throw new Error(text("socialInviteCreateFailed"));
    return invite;
  }

  async function createSocialGroupFriendInvite(
    groupId: string,
    input: CreateSocialGroupFriendInviteInput,
  ): Promise<SocialGroupJoinRequest> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));

    const targetGroupId = cleanOptionalString(groupId, 80);
    const userId = cleanOptionalString(input?.userId, 80);
    if (!targetGroupId || !userId) throw new Error(text("socialGroupFriendInviteFailed"));
    const data = await requestJson<unknown>(apiUrl(`/api/social/groups/${encodeURIComponent(targetGroupId)}/friend-invites`), {
      method: "POST",
      token: auth.token,
      body: {
        userId,
        role: normalizeSocialRole(input.role) === "officer" ? "officer" : "member",
      },
    });
    const joinRequest = normalizeSocialGroupJoinRequest((data as { request?: unknown })?.request ?? data);
    if (!joinRequest) throw new Error(text("socialGroupFriendInviteFailed"));
    return joinRequest;
  }

  async function requestSocialGroupJoin(code: string): Promise<SocialGroupJoinRequest> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));

    const inviteCode = typeof code === "string" ? code.trim() : "";
    if (!inviteCode) throw new Error(text("socialInviteAcceptFailed"));
    const data = await requestJson<unknown>(apiUrl(`/api/social/invites/${encodeURIComponent(inviteCode)}/accept`), {
      method: "POST",
      token: auth.token,
    });
    const joinRequest = normalizeSocialGroupJoinRequest((data as { request?: unknown })?.request ?? data);
    if (!joinRequest) throw new Error(text("socialInviteAcceptFailed"));
    return joinRequest;
  }

  async function getMySocialGroupRequests(): Promise<SocialGroupRequestList> {
    if (!configured) return socialGroupRequestListWithError(text("leaderboardServiceNotConfigured"));
    if (!auth.token) return socialGroupRequestListWithError(text("leaderboardLoginRequired"));

    try {
      const data = await requestJson<unknown>(apiUrl("/api/social/group-requests"), { token: auth.token });
      return normalizeSocialGroupRequestList(data);
    } catch (error) {
      return socialGroupRequestListWithError(error instanceof Error ? error.message : text("socialGroupRequestsLoadFailed"));
    }
  }

  async function acceptSocialGroupFriendInvite(requestId: string): Promise<SocialGroup> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));

    const targetRequestId = cleanOptionalString(requestId, 80);
    if (!targetRequestId) throw new Error(text("socialGroupRequestUpdateFailed"));
    const data = await requestJson<unknown>(
      apiUrl(`/api/social/group-requests/${encodeURIComponent(targetRequestId)}/accept`),
      { method: "POST", token: auth.token },
    );
    const group = normalizeSocialGroup((data as { group?: unknown })?.group ?? data);
    if (!group) throw new Error(text("socialGroupRequestUpdateFailed"));
    setSocialGroupCount((ledger().settings.socialGroupCount ?? 0) + 1);
    return group;
  }

  async function declineSocialGroupFriendInvite(requestId: string): Promise<SocialGroupJoinRequest> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));

    const targetRequestId = cleanOptionalString(requestId, 80);
    if (!targetRequestId) throw new Error(text("socialGroupRequestUpdateFailed"));
    const data = await requestJson<unknown>(
      apiUrl(`/api/social/group-requests/${encodeURIComponent(targetRequestId)}/decline`),
      { method: "POST", token: auth.token },
    );
    const joinRequest = normalizeSocialGroupJoinRequest((data as { request?: unknown })?.request ?? data);
    if (!joinRequest) throw new Error(text("socialGroupRequestUpdateFailed"));
    return joinRequest;
  }

  async function getSocialGroupRequests(groupId: string): Promise<SocialGroupModerationList> {
    if (!configured) return socialGroupModerationListWithError(text("leaderboardServiceNotConfigured"));
    if (!auth.token) return socialGroupModerationListWithError(text("leaderboardLoginRequired"));

    const targetGroupId = cleanOptionalString(groupId, 80);
    if (!targetGroupId) return socialGroupModerationListWithError(text("socialGroupRequestsLoadFailed"));
    try {
      const data = await requestJson<unknown>(
        apiUrl(`/api/social/groups/${encodeURIComponent(targetGroupId)}/requests`),
        { token: auth.token },
      );
      return normalizeSocialGroupModerationList(data);
    } catch (error) {
      return socialGroupModerationListWithError(error instanceof Error ? error.message : text("socialGroupRequestsLoadFailed"));
    }
  }

  async function approveSocialGroupRequest(groupId: string, requestId: string): Promise<SocialGroup> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));

    const targetGroupId = cleanOptionalString(groupId, 80);
    const targetRequestId = cleanOptionalString(requestId, 80);
    if (!targetGroupId || !targetRequestId) throw new Error(text("socialGroupRequestUpdateFailed"));
    const data = await requestJson<unknown>(
      apiUrl(`/api/social/groups/${encodeURIComponent(targetGroupId)}/requests/${encodeURIComponent(targetRequestId)}/approve`),
      { method: "POST", token: auth.token },
    );
    const group = normalizeSocialGroup((data as { group?: unknown })?.group ?? data);
    if (!group) throw new Error(text("socialGroupRequestUpdateFailed"));
    return group;
  }

  async function declineSocialGroupRequest(groupId: string, requestId: string): Promise<SocialGroupJoinRequest> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));

    const targetGroupId = cleanOptionalString(groupId, 80);
    const targetRequestId = cleanOptionalString(requestId, 80);
    if (!targetGroupId || !targetRequestId) throw new Error(text("socialGroupRequestUpdateFailed"));
    const data = await requestJson<unknown>(
      apiUrl(`/api/social/groups/${encodeURIComponent(targetGroupId)}/requests/${encodeURIComponent(targetRequestId)}/decline`),
      { method: "POST", token: auth.token },
    );
    const joinRequest = normalizeSocialGroupJoinRequest((data as { request?: unknown })?.request ?? data);
    if (!joinRequest) throw new Error(text("socialGroupRequestUpdateFailed"));
    return joinRequest;
  }

  async function leaveSocialGroup(groupId: string): Promise<void> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));

    const targetGroupId = cleanOptionalString(groupId, 80);
    if (!targetGroupId) throw new Error(text("socialGroupLeaveFailed"));
    await requestJson<unknown>(apiUrl(`/api/social/groups/${encodeURIComponent(targetGroupId)}/members/me`), {
      method: "DELETE",
      token: auth.token,
    });
    setSocialGroupCount(Math.max(0, (ledger().settings.socialGroupCount ?? 0) - 1));
  }

  async function setSocialGroupShareUsage(groupId: string, shareUsage: boolean): Promise<SocialGroup> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));

    const targetGroupId = cleanOptionalString(groupId, 80);
    if (!targetGroupId) throw new Error(text("socialGroupShareToggleFailed"));
    const data = await requestJson<unknown>(apiUrl(`/api/social/groups/${encodeURIComponent(targetGroupId)}/membership`), {
      method: "POST",
      token: auth.token,
      body: { shareUsage: shareUsage === true },
    });
    const group = normalizeSocialGroup((data as { group?: unknown })?.group ?? data);
    if (!group) throw new Error(text("socialGroupShareToggleFailed"));
    return group;
  }

  async function getSocialProfile(userId: string): Promise<SocialProfileResult> {
    if (!configured) return { error: text("leaderboardServiceNotConfigured") };
    if (!auth.token) return { error: text("leaderboardLoginRequired") };

    const targetUserId = cleanOptionalString(userId, 80);
    if (!targetUserId) return { error: text("socialProfileLoadFailed") };
    try {
      const data = await requestJson<unknown>(
        apiUrl(`/api/social/users/${encodeURIComponent(targetUserId)}/profile`),
        { token: auth.token },
      );
      const profile = normalizeSocialProfile((data as { profile?: unknown })?.profile ?? data);
      if (!profile) return { error: text("socialProfileLoadFailed") };
      return { profile };
    } catch (error) {
      return { error: error instanceof Error ? error.message : text("socialProfileLoadFailed") };
    }
  }

  async function getSocialProfilePrivacy(): Promise<SocialProfilePrivacy> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));
    const data = await requestJson<unknown>(apiUrl("/api/social/profile-privacy"), { token: auth.token });
    return normalizeSocialProfilePrivacy((data as { privacy?: unknown })?.privacy ?? data);
  }

  async function updateSocialProfilePrivacy(input: Partial<SocialProfilePrivacy>): Promise<SocialProfilePrivacy> {
    if (!configured) throw new Error(text("leaderboardServiceNotConfigured"));
    await authenticate();
    if (!auth.token) throw new Error(text("leaderboardLoginRequired"));
    const data = await requestJson<unknown>(apiUrl("/api/social/profile-privacy"), {
      method: "POST",
      token: auth.token,
      body: {
        profileVisibility: normalizeSocialProfileVisibility(input.profileVisibility),
        showLevel: input.showLevel,
        showTokenTotal: input.showTokenTotal,
        showActiveDays: input.showActiveDays,
        showAchievements: input.showAchievements,
      },
    });
    return normalizeSocialProfilePrivacy((data as { privacy?: unknown })?.privacy ?? data);
  }

  async function getSocialGroupLeaderboard(
    groupId: string,
    rangeInput: unknown,
    basisInput: unknown,
  ): Promise<SocialGroupLeaderboardData> {
    const range = normalizeRange(rangeInput);
    const basis = normalizeSocialGroupLeaderboardBasis(basisInput);
    if (!configured) return socialGroupLeaderboardWithError(groupId, range, basis, text("leaderboardServiceNotConfigured"));
    if (!auth.token) return socialGroupLeaderboardWithError(groupId, range, basis, text("leaderboardLoginRequired"));

    try {
      const url = new URL(apiUrl(`/api/social/groups/${encodeURIComponent(groupId)}/leaderboard`));
      url.searchParams.set("range", range);
      url.searchParams.set("basis", basis);
      const data = await requestJson<unknown>(url.toString(), { token: auth.token });
      return normalizeSocialGroupLeaderboard(data, groupId, range, basis);
    } catch (error) {
      return socialGroupLeaderboardWithError(
        groupId,
        range,
        basis,
        error instanceof Error ? error.message : text("socialGroupLeaderboardLoadFailed"),
      );
    }
  }

  async function pullCloudTree({ state }: { state: CloudSyncFile }) {
    const cursor = normalizeTreeCursor(state.treeCursor);
    let data: CloudTreeResponse;
    if (cursor) {
      const deltaUrl = new URL(apiUrl("/api/tree/delta"));
      deltaUrl.searchParams.set("since", cursor);
      try {
        data = await requestJson<CloudTreeResponse>(deltaUrl.toString(), { token: auth.token });
      } catch (error) {
        if (!isDeltaUnsupportedError(error)) throw error;
        data = await requestJson<CloudTreeResponse>(apiUrl("/api/tree"), { token: auth.token });
      }
    } else {
      data = await requestJson<CloudTreeResponse>(apiUrl("/api/tree"), { token: auth.token });
    }
    const entries = normalizeCloudEntries(data.entries ?? []);
    const achievements = normalizeCloudAchievements(data.achievements ?? []);
    const devices = data.devicesFull === false
      ? mergeCloudDevices(state.devices ?? [], normalizeCloudDevices(data.devices ?? []))
      : normalizeCloudDevices(data.devices ?? []);
    const modelStats = data.modelStatsFull === false
      ? mergeCloudModelStats(state.modelStats ?? [], normalizeCloudModelStats(data.modelStats ?? []))
      : normalizeCloudModelStats(data.modelStats ?? []);
    const downloaded = options.appendRemoteEntries(entries);
    options.mergeRemoteAchievements(achievements);
    const hasRemoteTree = Boolean(
      data.summary?.hasRemoteTree ?? (entries.length > 0 || achievements.length > 0 || devices.length > 0 || modelStats.length > 0),
    );
    return {
      entries,
      achievements,
      devices,
      modelStats,
      downloaded,
      hasRemoteTree,
      cursor: normalizeTreeCursor(data.cursor) ?? cursor,
      delta: data.delta === true,
    };
  }

  async function syncCloudDeviceSnapshot(state: CloudSyncFile, forceModelStats: boolean) {
    const modelStats = options.cloudModelStats();
    const modelStatsSignature = cloudModelStatsSignature(modelStats);
    const shouldSendModelStats = forceModelStats || state.modelStatsSignature !== modelStatsSignature;
    await requestJson(apiUrl("/api/tree/events"), {
      method: "POST",
      token: auth.token,
      body: {
        deviceId: options.deviceId(),
        device: options.deviceInfo(),
        entries: [],
        ...(shouldSendModelStats ? { modelStats } : {}),
        appVersion: options.currentAppVersion(),
      },
    });
    return modelStatsSignature;
  }

  function readCloudSyncState(): CloudSyncFile {
    const state = options.readJsonFile<CloudSyncFile>(options.cloudSyncPath());
    return {
      syncedEntryIds: Array.isArray(state?.syncedEntryIds)
        ? state.syncedEntryIds.filter((id): id is string => typeof id === "string")
        : [],
      syncedEventFingerprints: Array.isArray(state?.syncedEventFingerprints)
        ? state.syncedEventFingerprints.filter((id): id is string => typeof id === "string")
        : [],
      syncedAchievementIds: Array.isArray(state?.syncedAchievementIds)
        ? state.syncedAchievementIds.filter((id): id is string => typeof id === "string")
        : [],
      lastUploadedCount: positiveInteger(state?.lastUploadedCount),
      lastDownloadedCount: positiveInteger(state?.lastDownloadedCount),
      devices: normalizeCloudDevices(state?.devices ?? []),
      modelStats: normalizeCloudModelStats(state?.modelStats ?? []),
      modelStatsSignature:
        typeof state?.modelStatsSignature === "string" && state.modelStatsSignature.trim()
          ? state.modelStatsSignature.trim()
          : undefined,
      treeCursor: normalizeTreeCursor(state?.treeCursor),
    };
  }

  function writeCloudSyncState(state: CloudSyncFile) {
    options.writeJsonAtomic(options.cloudSyncPath(), {
      syncedEntryIds: [...new Set(state.syncedEntryIds ?? [])],
      syncedEventFingerprints: [...new Set(state.syncedEventFingerprints ?? [])],
      syncedAchievementIds: [...new Set(state.syncedAchievementIds ?? [])],
      lastUploadedCount: positiveInteger(state.lastUploadedCount) ?? 0,
      lastDownloadedCount: positiveInteger(state.lastDownloadedCount) ?? 0,
      devices: normalizeCloudDevices(state.devices ?? []),
      modelStats: normalizeCloudModelStats(state.modelStats ?? []),
      modelStatsSignature:
        typeof state.modelStatsSignature === "string" && state.modelStatsSignature.trim()
          ? state.modelStatsSignature.trim()
          : undefined,
      treeCursor: normalizeTreeCursor(state.treeCursor),
    });
  }

  function mergeCloudState(
    state: CloudSyncFile,
    entries: LedgerEntry[],
    achievements: AchievementUnlock[],
    devices: CloudDeviceSummary[] = state.devices ?? [],
    modelStats: CloudModelStat[] = state.modelStats ?? [],
    treeCursor: string | undefined = state.treeCursor,
  ) {
    return {
      ...state,
      syncedEntryIds: [
        ...new Set([...(state.syncedEntryIds ?? []), ...entries.map((entry) => entry.id)]),
      ],
      syncedEventFingerprints: [
        ...new Set([
          ...(state.syncedEventFingerprints ?? []),
          ...entries.map(cloudEventFingerprint).filter((value): value is string => Boolean(value)),
        ]),
      ],
      syncedAchievementIds: [
        ...new Set([...(state.syncedAchievementIds ?? []), ...achievements.map((item) => item.id)]),
      ],
      devices,
      modelStats,
      treeCursor: normalizeTreeCursor(treeCursor),
    };
  }

  function waitForToken(): Promise<string> {
    cancelPendingAuth?.(text("leaderboardLoginCancelled"));
    const state = crypto.randomUUID();
    const codeVerifier = randomPkceValue();
    const codeChallenge = codeChallengeForVerifier(codeVerifier);

    return new Promise((resolve, reject) => {
      if (authServer) {
        authServer.close();
        authServer = null;
      }

      let settled = false;
      let callbackUrl = "";
      let timeout: ReturnType<typeof setTimeout>;
      let cancelCurrentAuth: ((message?: string) => boolean) | null = null;
      const cleanup = () => {
        clearTimeout(timeout);
        authServer?.close();
        authServer = null;
        if (cancelPendingAuth === cancelCurrentAuth) cancelPendingAuth = null;
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
        cleanup();
      };
      cancelCurrentAuth = (message = text("leaderboardLoginCancelled")) => {
        if (settled) return false;
        finish(() => reject(new Error(message)));
        return true;
      };
      cancelPendingAuth = cancelCurrentAuth;
      timeout = setTimeout(() => {
        finish(() => reject(new Error(text("leaderboardLoginTimedOut"))));
      }, options.authTimeoutMs);

      const server = http.createServer((request, response) => {
        void handleCallback(request, response).catch((error) => {
          sendAuthPage(response, 400, text("leaderboardLoginFailed"));
          finish(() => reject(error instanceof Error ? error : new Error(text("leaderboardLoginFailed"))));
        });
      });

      async function handleCallback(request: http.IncomingMessage, response: http.ServerResponse) {
        const requestUrl = new URL(request.url ?? "/", callbackUrl || "http://127.0.0.1");
        if (requestUrl.pathname !== options.callbackPath) {
          sendAuthPage(response, 404, text("leaderboardLoginFailed"));
          return;
        }

        if (requestUrl.searchParams.get("state") !== state) {
          sendAuthPage(response, 400, text("leaderboardLoginFailed"));
          finish(() => reject(new Error(text("leaderboardLoginFailed"))));
          return;
        }

        const error = requestUrl.searchParams.get("error");
        if (error) {
          sendAuthPage(response, 400, text("leaderboardLoginFailed"));
          finish(() => reject(new Error(error)));
          return;
        }

        const code = requestUrl.searchParams.get("code") || "";
        if (!isPkceValue(code)) {
          sendAuthPage(response, 400, text("leaderboardLoginFailed"));
          finish(() => reject(new Error(text("leaderboardLoginFailed"))));
          return;
        }

        const token = await exchangeAuthCode(code, codeVerifier);
        sendAuthPage(response, 200, text("leaderboardLoginComplete"));
        finish(() => resolve(token));
      }

      authServer = server;
      server.on("error", (error) => finish(() => reject(error)));
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        callbackUrl = `http://127.0.0.1:${port}${options.callbackPath}`;
        const authUrl = new URL(apiUrl("/auth/github/start"));
        authUrl.searchParams.set("callback", callbackUrl);
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", codeChallenge);
        options.openExternal(authUrl.toString()).catch((error) => finish(() => reject(error)));
      });
    });
  }

  function sendAuthPage(response: http.ServerResponse, statusCode: number, message: string) {
    response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><meta charset="utf-8"><title>Vibe Tree</title><body style="font-family:system-ui;background:#171927;color:#f3f4ff;padding:32px"><h1>${escapeHtml(message)}</h1><p>${escapeHtml(text("leaderboardLoginPageHint"))}</p></body>`);
  }

  async function fetchProfile(token: string): Promise<LeaderboardProfile> {
    const response = await requestJson<unknown>(apiUrl("/api/me"), { token });
    const profile = normalizeProfile((response as { profile?: unknown })?.profile ?? response);
    if (!profile) throw new Error(text("leaderboardProfileFailed"));
    return profile;
  }

  async function exchangeAuthCode(code: string, codeVerifier: string) {
    const response = await requestJson<LeaderboardAuthSessionResponse>(apiUrl("/auth/session"), {
      method: "POST",
      body: { code, codeVerifier },
    });
    if (typeof response.token !== "string" || !response.token.trim()) {
      throw new Error(text("leaderboardLoginFailed"));
    }
    return response.token.trim();
  }

  function dailyUsage() {
    const byDate = new Map<string, number>();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 29);
    cutoff.setHours(0, 0, 0, 0);

    for (const entry of ledger().entries) {
      const createdAt = new Date(entry.createdAt);
      if (!Number.isFinite(createdAt.getTime()) || createdAt < cutoff) continue;
      const tokens = options.xpForEntry(entry);
      if (!tokens) continue;
      const key = options.dateKey(createdAt);
      byDate.set(key, (byDate.get(key) ?? 0) + tokens);
    }

    return [...byDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, tokens]) => {
        const rounded = Math.round(tokens);
        return { date, tokens: rounded, xp: rounded };
      });
  }

  function usageTotals() {
    const activeDates = new Set<string>();
    let totalTokens = 0;

    for (const entry of ledger().entries) {
      const createdAt = new Date(entry.createdAt);
      if (!Number.isFinite(createdAt.getTime())) continue;
      const tokens = options.xpForEntry(entry);
      if (tokens <= 0) continue;
      totalTokens += tokens;
      activeDates.add(options.dateKey(createdAt));
    }

    const rounded = Math.round(totalTokens);
    return {
      totalTokens: rounded,
      totalXp: rounded,
      totalDaysActive: activeDates.size,
      firstUsageDate: usageStartDate(),
    };
  }

  function hourlyUsage() {
    const byHour = new Map<string, number>();
    const cutoff = new Date();
    cutoff.setTime(cutoff.getTime() - HOURLY_USAGE_UPLOAD_HOURS * 60 * 60 * 1000);

    for (const entry of ledger().entries) {
      const createdAt = new Date(entry.createdAt);
      if (!Number.isFinite(createdAt.getTime()) || createdAt < cutoff) continue;
      const tokens = options.xpForEntry(entry);
      if (!tokens) continue;
      const key = utcHourKey(createdAt);
      byHour.set(key, (byHour.get(key) ?? 0) + tokens);
    }
    const currentHour = utcHourKey(new Date());
    if (!byHour.has(currentHour)) byHour.set(currentHour, 0);

    return [...byHour.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([hourStartUtc, tokens]) => {
        const rounded = Math.round(tokens);
        return { hourStartUtc, tokens: rounded, xp: rounded };
      });
  }

  function usagePreferences() {
    return LEADERBOARD_PREFERENCE_RANGES.map((range) => {
      const preference = usagePreferenceForRange(range);
      return preference ? { range, ...preference } : undefined;
    }).filter((item): item is { range: LeaderboardRange } & LeaderboardUsagePreference => Boolean(item));
  }

  function usagePreferenceForRange(range: LeaderboardRange): LeaderboardUsagePreference | undefined {
    const now = new Date();
    const start = preferenceRangeStart(range, now);
    const agentTotals = new Map<string, number>();
    const modelTotals = modelTotalsFromSyncedAggregates(start);
    const useAggregateModelTotals = modelTotals.size > 0;
    const hourTotals = Array.from({ length: 24 }, () => 0);
    const hourBuckets = new Map<number, number>();
    let totalTokens = 0;

    for (const entry of ledger().entries) {
      const createdAt = new Date(entry.createdAt);
      if (!Number.isFinite(createdAt.getTime())) continue;
      if (start && createdAt < start) continue;
      const tokens = options.xpForEntry(entry);
      if (tokens <= 0) continue;

      totalTokens += tokens;
      const agentLabel = agentLabelForEntry(entry);
      if (agentLabel) agentTotals.set(agentLabel, (agentTotals.get(agentLabel) ?? 0) + tokens);
      if (!useAggregateModelTotals) {
        const model = cleanPreferenceLabel(entry.model);
        if (model) modelTotals.set(model, (modelTotals.get(model) ?? 0) + tokens);
      }
      hourTotals[createdAt.getHours()] += tokens;
      const hourKey = Math.floor(createdAt.getTime() / 3_600_000);
      hourBuckets.set(hourKey, (hourBuckets.get(hourKey) ?? 0) + tokens);
    }

    if (totalTokens <= 0) return undefined;

    const topAgent = topPreferenceEntry(agentTotals);
    const topModel = topPreferenceEntry(modelTotals);
    const peakHourTokens = Math.max(0, ...hourBuckets.values());
    const favoritePeriod = favoritePreferencePeriod(hourTotals);

    return {
      favoriteAgent: topAgent
        ? {
            label: topAgent.label,
            percent: Math.max(1, Math.min(100, Math.round((topAgent.tokens / totalTokens) * 100))),
          }
        : undefined,
      favoriteModel: topModel?.label,
      favoritePeriod,
      peakTokensPerMinute: Math.max(0, Math.round(peakHourTokens / 60)),
    };
  }

  function modelTotalsFromSyncedAggregates(start: Date | undefined) {
    const rows = new Map<string, CloudModelStat>();
    if (ledger().settings.cloudSyncEnabled) {
      for (const stat of readCloudSyncState().modelStats ?? []) mergePreferenceModelStat(rows, stat);
    }
    for (const stat of options.cloudModelStats()) mergePreferenceModelStat(rows, stat);

    const totals = new Map<string, number>();
    for (const stat of rows.values()) {
      if (!modelStatInPreferenceRange(stat, start)) continue;
      const model = cleanPreferenceLabel(stat.model);
      const tokens = positiveInteger(stat.tokens);
      if (!model || !tokens) continue;
      totals.set(model, (totals.get(model) ?? 0) + tokens);
    }
    return totals;
  }

  function mergePreferenceModelStat(rows: Map<string, CloudModelStat>, input: CloudModelStat) {
    const [stat] = normalizeCloudModelStats([input]);
    if (!stat) return;
    const key = `${stat.deviceId}|${stat.date}|${stat.source}|${stat.model}`;
    const existing = rows.get(key);
    if (!existing || stat.tokens > existing.tokens) rows.set(key, stat);
  }

  function modelStatInPreferenceRange(stat: CloudModelStat, start: Date | undefined) {
    if (!start) return true;
    const date = new Date(`${stat.date}T00:00:00`);
    return Number.isFinite(date.getTime()) && date >= start;
  }

  function usageStartDate() {
    const dates: string[] = [];
    const installedAt = new Date(ledger().installedAt);
    if (Number.isFinite(installedAt.getTime())) dates.push(options.dateKey(installedAt));
    for (const entry of ledger().entries) {
      const createdAt = new Date(entry.createdAt);
      if (Number.isFinite(createdAt.getTime())) dates.push(options.dateKey(createdAt));
    }
    return dates.sort()[0];
  }

  function apiUrl(path: string) {
    return new URL(path.replace(/^\/+/, ""), `${options.apiUrl}/`).toString();
  }

  function defaultRequestJson<T = unknown>(
    urlString: string,
    requestOptions: LeaderboardRequestJsonOptions = {},
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
      const method = requestOptions.method ?? (requestOptions.body === undefined ? "GET" : "POST");
      const body = requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": `${options.appName}/${options.currentAppVersion()}`,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(body));
      }
      if (requestOptions.token) headers.Authorization = `Bearer ${requestOptions.token}`;

      const transportRequest = url.protocol === "http:" ? http.request : https.request;
      const request = transportRequest(
        url,
        {
          method,
          headers,
          timeout: requestOptions.timeoutMs ?? 10_000,
        },
        (response) => {
          let raw = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            raw += chunk;
            if (raw.length > 1_024_000) {
              request.destroy(new Error(text("leaderboardResponseTooLarge")));
            }
          });
          response.on("end", () => {
            let parsed: unknown = {};
            if (raw.trim()) {
              try {
                parsed = JSON.parse(raw);
              } catch {
                reject(new Error(text("leaderboardResponseParseFailed")));
                return;
              }
            }

            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
              const message =
                typeof (parsed as { error?: unknown })?.error === "string"
                  ? (parsed as { error: string }).error
                  : `${text("leaderboardRequestFailed")} (${response.statusCode ?? "unknown"})`;
              reject(new Error(message));
              return;
            }

            resolve(parsed as T);
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error(text("leaderboardRequestTimedOut"))));
      request.on("error", reject);
      if (body !== undefined) request.write(body);
      request.end();
    });
  }

  return {
    readAuth,
    startSync,
    stop,
    status,
    broadcast,
    login,
    logout,
    setEnabled,
    syncUsage,
    cloudStatus,
    cancelAuth,
    enableCloudSync,
    joinCloudTree,
    syncCloudTree,
    scheduleCloudSyncSoon,
    getLeaderboard,
    getLeaderboards,
    getSocialFriends,
    requestSocialFriend,
    acceptSocialFriend,
    removeSocialFriend,
    getSocialGroups,
    createSocialGroup,
    createSocialGroupInvite,
    createSocialGroupFriendInvite,
    requestSocialGroupJoin,
    getMySocialGroupRequests,
    acceptSocialGroupFriendInvite,
    declineSocialGroupFriendInvite,
    getSocialGroupRequests,
    approveSocialGroupRequest,
    declineSocialGroupRequest,
    leaveSocialGroup,
    setSocialGroupShareUsage,
    getSocialProfile,
    getSocialProfilePrivacy,
    updateSocialProfilePrivacy,
    getSocialGroupLeaderboard,
  };
}

function normalizeAuth(auth: Partial<LeaderboardAuthFile> | undefined): LeaderboardAuthFile {
  const token = typeof auth?.token === "string" && auth.token.trim() ? auth.token.trim() : undefined;
  const profile = normalizeProfile(auth?.profile);
  const createdAt =
    typeof auth?.createdAt === "string" && Number.isFinite(Date.parse(auth.createdAt)) ? auth.createdAt : undefined;
  return token && profile ? { token, profile, createdAt } : {};
}

function normalizeProfile(value: unknown): LeaderboardProfile | undefined {
  const profile = value as Partial<LeaderboardProfile> | undefined;
  const id = typeof profile?.id === "string" && profile.id.trim() ? profile.id.trim() : undefined;
  const username =
    typeof profile?.username === "string" && profile.username.trim() ? profile.username.trim() : undefined;
  if (!id || !username) return undefined;
  const avatarUrl =
    typeof profile?.avatarUrl === "string" && profile.avatarUrl.trim() ? profile.avatarUrl.trim() : undefined;
  return { id, username, avatarUrl };
}

function cloudEntry(entry: LedgerEntry, deviceId: string) {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    source: normalizeCloudEventSource(entry.source, entry.id),
    tokens: Math.max(0, Math.round(entry.tokens)),
    inputTokens: optionalCount(entry.inputTokens),
    outputTokens: optionalCount(entry.outputTokens),
    cacheReadTokens: optionalCount(entry.cacheReadTokens),
    cacheWriteTokens: optionalCount(entry.cacheWriteTokens),
    deviceId: entry.deviceId || deviceId,
    eventFingerprint: cloudEventFingerprint(entry),
  };
}

function cloudAchievement(item: AchievementUnlock) {
  return {
    id: item.id,
    unlockedAt: item.unlockedAt,
  };
}

function normalizeCloudEntries(values: unknown[]) {
  const entries: LedgerEntry[] = [];
  for (const value of values) {
    const input = value as Partial<LedgerEntry> | undefined;
    if (!input || typeof input.id !== "string" || typeof input.createdAt !== "string") continue;
    if (!Number.isFinite(Date.parse(input.createdAt))) continue;
    entries.push({
      id: input.id,
      createdAt: input.createdAt,
      source: normalizeCloudEventSource(input.source, input.id),
      tokens: optionalCount(input.tokens) ?? 0,
      inputTokens: optionalCount(input.inputTokens),
      outputTokens: optionalCount(input.outputTokens),
      cacheReadTokens: optionalCount(input.cacheReadTokens),
      cacheWriteTokens: optionalCount(input.cacheWriteTokens),
      deviceId: cleanOptionalString(input.deviceId, 80),
      syncedFromCloud: true,
      eventFingerprint:
        cleanOptionalString(input.eventFingerprint, 240) ??
        cloudEventFingerprint({
          id: input.id,
          createdAt: input.createdAt,
          source: normalizeCloudEventSource(input.source, input.id),
          tokens: optionalCount(input.tokens) ?? 0,
          inputTokens: optionalCount(input.inputTokens),
          outputTokens: optionalCount(input.outputTokens),
          cacheReadTokens: optionalCount(input.cacheReadTokens),
          cacheWriteTokens: optionalCount(input.cacheWriteTokens),
        }),
    });
  }
  return entries;
}

function normalizeCloudDevices(values: unknown[]) {
  const devices: CloudDeviceSummary[] = [];
  for (const value of values) {
    const input = value as Partial<CloudDeviceSummary> | undefined;
    const deviceId = cleanOptionalString(input?.deviceId, 80);
    if (!deviceId) continue;
    const lastSyncedAt =
      typeof input?.lastSyncedAt === "string" && Number.isFinite(Date.parse(input.lastSyncedAt))
        ? input.lastSyncedAt
        : undefined;
    devices.push({
      deviceId,
      alias: cleanOptionalString(input?.alias, 64),
      platform: cleanOptionalString(input?.platform, 32),
      lastSyncedAt,
      appVersion: cleanOptionalString(input?.appVersion, 32),
      entryCount: optionalCount(input?.entryCount) ?? 0,
      tokens: optionalCount(input?.tokens) ?? 0,
    });
  }
  return devices.sort((a, b) => b.tokens - a.tokens);
}

function normalizeCloudModelStats(values: unknown[]) {
  const stats: CloudModelStat[] = [];
  for (const value of values) {
    const input = value as Partial<CloudModelStat> | undefined;
    const deviceId = cleanOptionalString(input?.deviceId, 80);
    const date = cleanDateKey(input?.date);
    const source = normalizeCloudEventSource(input?.source);
    const model = cleanOptionalString(input?.model, 64);
    const tokens = optionalCount(input?.tokens) ?? 0;
    if (!deviceId || !date || source === "cloud-sync" || !model || tokens <= 0) continue;
    stats.push({
      deviceId,
      date,
      source,
      model,
      tokens,
      inputTokens: optionalCount(input?.inputTokens),
      outputTokens: optionalCount(input?.outputTokens),
      cacheReadTokens: optionalCount(input?.cacheReadTokens),
      cacheWriteTokens: optionalCount(input?.cacheWriteTokens),
    });
  }
  return stats;
}

function mergeCloudDevices(existing: CloudDeviceSummary[], incoming: CloudDeviceSummary[]) {
  const byDevice = new Map(existing.map((device) => [device.deviceId, device]));
  for (const device of incoming) byDevice.set(device.deviceId, device);
  return [...byDevice.values()].sort((a, b) => b.tokens - a.tokens);
}

function mergeCloudModelStats(existing: CloudModelStat[], incoming: CloudModelStat[]) {
  const byStat = new Map(existing.map((stat) => [cloudModelStatKey(stat), stat]));
  for (const stat of incoming) byStat.set(cloudModelStatKey(stat), stat);
  return [...byStat.values()];
}

function cloudModelStatKey(stat: CloudModelStat) {
  return [stat.deviceId, stat.date, stat.source, stat.model].join("|");
}

function cloudModelStatsSignature(stats: CloudModelStat[]) {
  const normalized = normalizeCloudModelStats(stats)
    .sort((left, right) => cloudModelStatKey(left).localeCompare(cloudModelStatKey(right)))
    .map((stat) => ({
      deviceId: stat.deviceId,
      date: stat.date,
      source: stat.source,
      model: stat.model,
      tokens: stat.tokens,
      inputTokens: stat.inputTokens ?? 0,
      outputTokens: stat.outputTokens ?? 0,
      cacheReadTokens: stat.cacheReadTokens ?? 0,
      cacheWriteTokens: stat.cacheWriteTokens ?? 0,
    }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function normalizeTreeCursor(value: unknown) {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const iso = date.toISOString();
  return iso <= new Date(Date.now() + 60_000).toISOString() ? iso : undefined;
}

function isDeltaUnsupportedError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.message === "Not found" || error.message.includes("(404)") || error.message.includes("(405)");
}

function isCloudSyncedEntry(entry: LedgerEntry) {
  return entry.syncedFromCloud === true || entry.source === "cloud-sync";
}

function normalizeCloudEventSource(value: unknown, eventId?: unknown) {
  const source = typeof value === "string" ? value.trim() : "";
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
    optionalCount(entry.tokens) ?? 0,
    optionalCount(entry.inputTokens) ?? 0,
    optionalCount(entry.outputTokens) ?? 0,
    optionalCount(entry.cacheReadTokens) ?? 0,
    optionalCount(entry.cacheWriteTokens) ?? 0,
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

function normalizeCloudAchievements(values: unknown[]) {
  const achievements: AchievementUnlock[] = [];
  for (const value of values) {
    const input = value as Partial<AchievementUnlock> | undefined;
    if (!input || typeof input.id !== "string" || typeof input.unlockedAt !== "string") continue;
    if (!Number.isFinite(Date.parse(input.unlockedAt))) continue;
    achievements.push({
      id: input.id,
      unlockedAt: input.unlockedAt,
    });
  }
  return achievements;
}

function cleanOptionalString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function cleanDateKey(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function optionalCount(value: unknown) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function positiveInteger(value: unknown) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function nonNegativeInteger(value: unknown) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeRange(value: unknown): LeaderboardRange {
  if (value === "today" || value === "24h") return "24h";
  return value === "30d" || value === "all" ? value : "7d";
}

function normalizeSocialGroupLeaderboardBasis(value: unknown): SocialGroupLeaderboardBasis {
  return value === "since_join" || value === "joined" ? "since_join" : "total";
}

const LEADERBOARD_PREFERENCE_RANGES: LeaderboardRange[] = ["24h", "7d", "30d", "all"];
const HOURLY_USAGE_UPLOAD_HOURS = 48;

const AGENT_LABELS: Record<string, string> = {
  codex: "Codex",
  openclaw: "OpenClaw",
  pi: "Pi Agent",
  opencode: "OpenCode",
  claude: "Claude Code",
  gemini: "Gemini",
  hermes: "Hermes",
  cloud: "Cloud Tree",
};

const PREFERENCE_PERIODS: Array<{
  id: LeaderboardPreferencePeriod;
  startHour: number;
  endHour: number;
  hours: number[];
}> = [
  { id: "early", startHour: 0, endHour: 6, hours: [0, 1, 2, 3, 4, 5] },
  { id: "morning", startHour: 6, endHour: 12, hours: [6, 7, 8, 9, 10, 11] },
  { id: "afternoon", startHour: 12, endHour: 18, hours: [12, 13, 14, 15, 16, 17] },
  { id: "evening", startHour: 18, endHour: 21, hours: [18, 19, 20] },
  { id: "night", startHour: 21, endHour: 24, hours: [21, 22, 23] },
];

function preferenceRangeStart(range: LeaderboardRange, now: Date) {
  if (range === "all") return undefined;
  const start = new Date(now);
  if (range === "24h") {
    start.setTime(now.getTime() - 24 * 60 * 60 * 1000);
    return start;
  }
  start.setHours(0, 0, 0, 0);
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "30d") start.setDate(start.getDate() - 29);
  return start;
}

function utcHourKey(date: Date) {
  const hour = new Date(date);
  hour.setUTCMinutes(0, 0, 0);
  return hour.toISOString();
}

function topPreferenceEntry(values: Map<string, number>) {
  let best: { label: string; tokens: number } | undefined;
  for (const [label, tokens] of values) {
    if (!best || tokens > best.tokens) best = { label, tokens };
  }
  return best;
}

function favoritePreferencePeriod(hourTotals: number[]): LeaderboardUsagePreference["favoritePeriod"] | undefined {
  let best: (typeof PREFERENCE_PERIODS)[number] | undefined;
  let bestTokens = 0;
  for (const period of PREFERENCE_PERIODS) {
    const tokens = period.hours.reduce((sum, hour) => sum + (hourTotals[hour] ?? 0), 0);
    if (tokens > bestTokens) {
      best = period;
      bestTokens = tokens;
    }
  }
  return best && bestTokens > 0
    ? { id: best.id, startHour: best.startHour, endHour: best.endHour }
    : undefined;
}

function agentLabelForEntry(entry: LedgerEntry) {
  const sourceId = preferenceSourceIdForEntry(entry);
  if (sourceId) return AGENT_LABELS[sourceId];
  return cleanPreferenceLabel(entry.agent) || cleanPreferenceLabel(entry.source);
}

function preferenceSourceIdForEntry(entry: LedgerEntry): keyof typeof AGENT_LABELS | undefined {
  if (entry.source === "cloud-sync") {
    const inferred = sourceFromEventId(entry.id);
    return inferred ? preferenceSourceIdForSource(inferred, entry.agent) : "cloud";
  }
  return preferenceSourceIdForSource(entry.source, entry.agent);
}

function preferenceSourceIdForSource(source: string, agent?: string): keyof typeof AGENT_LABELS | undefined {
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

function cleanPreferenceLabel(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : undefined;
}

function randomPkceValue() {
  return base64Url(randomBytes(32));
}

function codeChallengeForVerifier(verifier: string) {
  return base64Url(createHash("sha256").update(verifier).digest());
}

function base64Url(value: Buffer) {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isPkceValue(value: string) {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function normalizeData(value: unknown, fallbackRange: LeaderboardRange): LeaderboardData {
  const data = value as Partial<LeaderboardData> | undefined;
  const range = normalizeRange(data?.range ?? fallbackRange);
  const entries = Array.isArray(data?.entries)
    ? data.entries.map(normalizeEntry).filter((entry): entry is LeaderboardEntry => Boolean(entry))
    : [];
  const me = normalizeEntry(data?.me);
  const updatedAt =
    typeof data?.updatedAt === "string" && Number.isFinite(Date.parse(data.updatedAt)) ? data.updatedAt : undefined;
  const error = typeof data?.error === "string" ? data.error : undefined;
  return { range, entries, updatedAt, me, error };
}

function normalizeCollection(value: unknown): LeaderboardCollection {
  const collection = value as Partial<LeaderboardCollection> | undefined;
  const rawRanges = collection?.ranges as Record<string, unknown> | undefined;
  const ranges = Object.fromEntries(
    LEADERBOARD_PREFERENCE_RANGES.map((range) => [
      range,
      normalizeData(rawRanges?.[range] ?? (range === "24h" ? rawRanges?.today : undefined), range),
    ]),
  ) as Record<LeaderboardRange, LeaderboardData>;
  const updatedAt =
    typeof collection?.updatedAt === "string" && Number.isFinite(Date.parse(collection.updatedAt))
      ? collection.updatedAt
      : undefined;
  return { ranges, updatedAt };
}

function collectionWithError(error: string): LeaderboardCollection {
  const ranges = {} as Record<LeaderboardRange, LeaderboardData>;
  for (const range of LEADERBOARD_PREFERENCE_RANGES) {
    ranges[range] = { range, entries: [], error };
  }
  return { ranges };
}

function socialGroupListWithError(error: string): SocialGroupList {
  return { groups: [], error };
}

function socialFriendListWithError(error: string): SocialFriendList {
  return { friends: [], error };
}

function socialGroupRequestListWithError(error: string): SocialGroupRequestList {
  return { incomingInvites: [], outgoingRequests: [], error };
}

function socialGroupModerationListWithError(error: string): SocialGroupModerationList {
  return { requests: [], error };
}

function normalizeSocialFriendList(value: unknown): SocialFriendList {
  const list = value as Partial<SocialFriendList> | undefined;
  const friends = Array.isArray(list?.friends)
    ? list.friends.map(normalizeSocialFriend).filter((friend): friend is SocialFriend => Boolean(friend))
    : [];
  const updatedAt =
    typeof list?.updatedAt === "string" && Number.isFinite(Date.parse(list.updatedAt)) ? list.updatedAt : undefined;
  const error = typeof list?.error === "string" ? list.error : undefined;
  return { friends, updatedAt, error };
}

function normalizeSocialFriend(value: unknown): SocialFriend | undefined {
  const friend = value as Partial<SocialFriend> | undefined;
  if (!friend) return undefined;
  const userId = typeof friend.userId === "string" && friend.userId.trim() ? friend.userId.trim() : undefined;
  const username = typeof friend.username === "string" && friend.username.trim() ? friend.username.trim() : undefined;
  const status = friend.status === "accepted" || friend.status === "pending" ? friend.status : undefined;
  if (!userId || !username || !status) return undefined;
  const avatarUrl =
    typeof friend.avatarUrl === "string" && friend.avatarUrl.trim() ? friend.avatarUrl.trim() : undefined;
  const direction = friend.direction === "incoming" || friend.direction === "outgoing" ? friend.direction : undefined;
  const requestedByMe = friend.requestedByMe === true;
  const createdAt =
    typeof friend.createdAt === "string" && Number.isFinite(Date.parse(friend.createdAt)) ? friend.createdAt : undefined;
  const updatedAt =
    typeof friend.updatedAt === "string" && Number.isFinite(Date.parse(friend.updatedAt)) ? friend.updatedAt : undefined;
  return { userId, username, avatarUrl, status, direction, requestedByMe, createdAt, updatedAt };
}

function normalizeSocialGroupList(value: unknown): SocialGroupList {
  const list = value as Partial<SocialGroupList> | undefined;
  const groups = Array.isArray(list?.groups)
    ? list.groups.map(normalizeSocialGroup).filter((group): group is SocialGroup => Boolean(group))
    : [];
  const updatedAt =
    typeof list?.updatedAt === "string" && Number.isFinite(Date.parse(list.updatedAt)) ? list.updatedAt : undefined;
  const error = typeof list?.error === "string" ? list.error : undefined;
  return { groups, updatedAt, error };
}

function normalizeSocialGroupRequestList(value: unknown): SocialGroupRequestList {
  const list = value as Partial<SocialGroupRequestList> | undefined;
  const incomingInvites = Array.isArray(list?.incomingInvites)
    ? list.incomingInvites
        .map(normalizeSocialGroupJoinRequest)
        .filter((item): item is SocialGroupJoinRequest => Boolean(item))
    : [];
  const outgoingRequests = Array.isArray(list?.outgoingRequests)
    ? list.outgoingRequests
        .map(normalizeSocialGroupJoinRequest)
        .filter((item): item is SocialGroupJoinRequest => Boolean(item))
    : [];
  const updatedAt =
    typeof list?.updatedAt === "string" && Number.isFinite(Date.parse(list.updatedAt)) ? list.updatedAt : undefined;
  const error = typeof list?.error === "string" ? list.error : undefined;
  return { incomingInvites, outgoingRequests, updatedAt, error };
}

function normalizeSocialGroupModerationList(value: unknown): SocialGroupModerationList {
  const list = value as Partial<SocialGroupModerationList> | undefined;
  const requests = Array.isArray(list?.requests)
    ? list.requests
        .map(normalizeSocialGroupJoinRequest)
        .filter((item): item is SocialGroupJoinRequest => Boolean(item))
    : [];
  const updatedAt =
    typeof list?.updatedAt === "string" && Number.isFinite(Date.parse(list.updatedAt)) ? list.updatedAt : undefined;
  const error = typeof list?.error === "string" ? list.error : undefined;
  return { requests, updatedAt, error };
}

function normalizeSocialGroupJoinRequest(value: unknown): SocialGroupJoinRequest | undefined {
  const item = value as Partial<SocialGroupJoinRequest> | undefined;
  if (!item) return undefined;
  const requestId = typeof item.requestId === "string" && item.requestId.trim() ? item.requestId.trim() : undefined;
  const groupId = typeof item.groupId === "string" && item.groupId.trim() ? item.groupId.trim() : undefined;
  const groupName = typeof item.groupName === "string" && item.groupName.trim() ? item.groupName.trim() : undefined;
  const requesterUserId =
    typeof item.requesterUserId === "string" && item.requesterUserId.trim() ? item.requesterUserId.trim() : undefined;
  const requesterUsername =
    typeof item.requesterUsername === "string" && item.requesterUsername.trim() ? item.requesterUsername.trim() : undefined;
  const type = normalizeSocialGroupJoinRequestType(item.type);
  const status = normalizeSocialGroupJoinRequestStatus(item.status);
  const role = normalizeSocialRole(item.role);
  if (!requestId || !groupId || !groupName || !requesterUserId || !requesterUsername || !type || !status || !role || role === "leader") {
    return undefined;
  }
  return {
    requestId,
    groupId,
    groupName,
    groupIconEmoji: cleanOptionalString(item.groupIconEmoji, 8),
    type,
    status,
    role,
    requesterUserId,
    requesterUsername,
    requesterAvatarUrl: cleanOptionalString(item.requesterAvatarUrl, 300),
    invitedByUserId: cleanOptionalString(item.invitedByUserId, 80),
    invitedByUsername: cleanOptionalString(item.invitedByUsername, 80),
    invitedByAvatarUrl: cleanOptionalString(item.invitedByAvatarUrl, 300),
    createdAt:
      typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : undefined,
    updatedAt:
      typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt)) ? item.updatedAt : undefined,
    expiresAt:
      typeof item.expiresAt === "string" && Number.isFinite(Date.parse(item.expiresAt)) ? item.expiresAt : undefined,
  };
}

function normalizeSocialGroup(value: unknown): SocialGroup | undefined {
  const group = value as Partial<SocialGroup> | undefined;
  if (!group) return undefined;
  const groupId = typeof group?.groupId === "string" && group.groupId.trim() ? group.groupId.trim() : undefined;
  const name = typeof group?.name === "string" && group.name.trim() ? group.name.trim() : undefined;
  const ownerUserId =
    typeof group?.ownerUserId === "string" && group.ownerUserId.trim() ? group.ownerUserId.trim() : undefined;
  if (!groupId || !name || !ownerUserId) return undefined;
  const visibility = normalizeSocialVisibility(group.visibility) ?? "invite";
  const description = cleanOptionalString(group.description, 180);
  const iconEmoji = cleanOptionalString(group.iconEmoji, 8);
  const createdAt =
    typeof group.createdAt === "string" && Number.isFinite(Date.parse(group.createdAt)) ? group.createdAt : undefined;
  const updatedAt =
    typeof group.updatedAt === "string" && Number.isFinite(Date.parse(group.updatedAt)) ? group.updatedAt : undefined;
  const memberCount = Math.max(0, Math.round(Number(group.memberCount)));
  const role = normalizeSocialRole(group.role);
  const shareUsage = typeof group.shareUsage === "boolean" ? group.shareUsage : undefined;
  const members = Array.isArray(group.members)
    ? group.members.map(normalizeSocialMember).filter((member): member is SocialGroupMember => Boolean(member))
    : undefined;
  return {
    groupId,
    name,
    description,
    iconEmoji,
    visibility,
    ownerUserId,
    createdAt,
    updatedAt,
    memberCount: Number.isFinite(memberCount) ? memberCount : 0,
    role,
    shareUsage,
    members,
  };
}

function normalizeSocialMember(value: unknown): SocialGroupMember | undefined {
  const member = value as Partial<SocialGroupMember> | undefined;
  if (!member) return undefined;
  const userId = typeof member?.userId === "string" && member.userId.trim() ? member.userId.trim() : undefined;
  const username = typeof member?.username === "string" && member.username.trim() ? member.username.trim() : undefined;
  if (!userId || !username) return undefined;
  const role = normalizeSocialRole(member.role) ?? "member";
  const avatarUrl = typeof member.avatarUrl === "string" && member.avatarUrl.trim() ? member.avatarUrl.trim() : undefined;
  const shareUsage = member.shareUsage === true;
  const joinedAt =
    typeof member.joinedAt === "string" && Number.isFinite(Date.parse(member.joinedAt)) ? member.joinedAt : undefined;
  const updatedAt =
    typeof member.updatedAt === "string" && Number.isFinite(Date.parse(member.updatedAt)) ? member.updatedAt : undefined;
  return { userId, username, avatarUrl, role, shareUsage, joinedAt, updatedAt };
}

function normalizeSocialProfile(value: unknown): SocialProfile | undefined {
  const profile = value as Partial<SocialProfile> | undefined;
  if (!profile) return undefined;
  const id = typeof profile.id === "string" && profile.id.trim() ? profile.id.trim() : undefined;
  const username = typeof profile.username === "string" && profile.username.trim() ? profile.username.trim() : undefined;
  if (!id || !username) return undefined;
  const avatarUrl = typeof profile.avatarUrl === "string" && profile.avatarUrl.trim() ? profile.avatarUrl.trim() : undefined;
  const joinedAt =
    typeof profile.joinedAt === "string" && Number.isFinite(Date.parse(profile.joinedAt)) ? profile.joinedAt : undefined;
  const usageVisible = profile.usageVisible === true;
  const achievements: SocialProfile["achievements"] = [];
  if (Array.isArray(profile.achievements)) {
    for (const entry of profile.achievements) {
      const item = entry as { id?: unknown; unlockedAt?: unknown } | undefined;
      const achievementId = typeof item?.id === "string" && item.id.trim() ? item.id.trim() : undefined;
      if (!achievementId) continue;
      const unlockedAt =
        typeof item?.unlockedAt === "string" && Number.isFinite(Date.parse(item.unlockedAt))
          ? item.unlockedAt
          : undefined;
      achievements.push({ id: achievementId, unlockedAt });
    }
  }
  return {
    id,
    username,
    avatarUrl,
    joinedAt,
    isSelf: profile.isSelf === true,
    isFriend: profile.isFriend === true,
    mutualGroupCount: nonNegativeInteger(profile.mutualGroupCount) ?? 0,
    friendCount: nonNegativeInteger(profile.friendCount) ?? 0,
    groupCount: nonNegativeInteger(profile.groupCount) ?? 0,
    usageVisible,
    levelVisible: usageVisible && profile.levelVisible !== false,
    tokenTotalVisible: usageVisible && profile.tokenTotalVisible !== false && profile.totalTokens !== undefined,
    activeDaysVisible: usageVisible && profile.activeDaysVisible !== false && profile.daysActive !== undefined,
    achievementsVisible: usageVisible && profile.achievementsVisible !== false && profile.achievements !== undefined,
    level: usageVisible ? nonNegativeInteger(profile.level) : undefined,
    totalTokens: usageVisible && profile.totalTokens !== undefined ? nonNegativeInteger(profile.totalTokens) ?? 0 : undefined,
    daysActive: usageVisible && profile.daysActive !== undefined ? nonNegativeInteger(profile.daysActive) ?? 0 : undefined,
    achievements: usageVisible && profile.achievements !== undefined ? achievements : undefined,
  };
}

function normalizeSocialProfilePrivacy(value: unknown): SocialProfilePrivacy {
  const privacy = value as Partial<SocialProfilePrivacy> | undefined;
  return {
    profileVisibility: normalizeSocialProfileVisibility(privacy?.profileVisibility) ?? "relations",
    showLevel: privacy?.showLevel !== false,
    showTokenTotal: privacy?.showTokenTotal !== false,
    showActiveDays: privacy?.showActiveDays !== false,
    showAchievements: privacy?.showAchievements !== false,
    updatedAt:
      typeof privacy?.updatedAt === "string" && Number.isFinite(Date.parse(privacy.updatedAt))
        ? privacy.updatedAt
        : undefined,
  };
}

function normalizeSocialProfileVisibility(value: unknown): SocialProfilePrivacy["profileVisibility"] | undefined {
  return value === "relations" || value === "friends" || value === "private" ? value : undefined;
}

function normalizeSocialInvite(value: unknown): SocialGroupInvite | undefined {
  const invite = value as Partial<SocialGroupInvite> | undefined;
  if (!invite) return undefined;
  const code = typeof invite?.code === "string" && invite.code.trim() ? invite.code.trim() : undefined;
  const groupId = typeof invite?.groupId === "string" && invite.groupId.trim() ? invite.groupId.trim() : undefined;
  const role = normalizeSocialRole(invite?.role);
  if (!code || !groupId || !role || role === "leader") return undefined;
  const maxUses = positiveInteger(invite.maxUses);
  const uses = nonNegativeInteger(invite.uses) ?? 0;
  const expiresAt =
    typeof invite.expiresAt === "string" && Number.isFinite(Date.parse(invite.expiresAt))
      ? invite.expiresAt
      : undefined;
  const createdAt =
    typeof invite.createdAt === "string" && Number.isFinite(Date.parse(invite.createdAt))
      ? invite.createdAt
      : undefined;
  return { code, groupId, role, maxUses, uses, expiresAt, createdAt };
}

function normalizeSocialGroupLeaderboard(
  value: unknown,
  fallbackGroupId: string,
  fallbackRange: LeaderboardRange,
  fallbackBasis: SocialGroupLeaderboardBasis,
): SocialGroupLeaderboardData {
  const data = value as Partial<SocialGroupLeaderboardData> | undefined;
  const groupId =
    typeof data?.groupId === "string" && data.groupId.trim() ? data.groupId.trim() : fallbackGroupId;
  const range = normalizeRange(data?.range ?? fallbackRange);
  const basis = normalizeSocialGroupLeaderboardBasis(data?.basis ?? fallbackBasis);
  const entries = Array.isArray(data?.entries)
    ? data.entries
        .map(normalizeSocialGroupLeaderboardEntry)
        .filter((entry): entry is SocialGroupLeaderboardEntry => Boolean(entry))
    : [];
  const me = normalizeSocialGroupLeaderboardEntry(data?.me);
  const updatedAt =
    typeof data?.updatedAt === "string" && Number.isFinite(Date.parse(data.updatedAt)) ? data.updatedAt : undefined;
  const error = typeof data?.error === "string" ? data.error : undefined;
  return { groupId, range, basis, entries, updatedAt, me, error };
}

function socialGroupLeaderboardWithError(
  groupId: string,
  range: LeaderboardRange,
  basis: SocialGroupLeaderboardBasis,
  error: string,
): SocialGroupLeaderboardData {
  return { groupId, range, basis, entries: [], error };
}

function normalizeSocialGroupLeaderboardEntry(value: unknown): SocialGroupLeaderboardEntry | undefined {
  const entry = normalizeEntry(value);
  if (!entry) return undefined;
  const role = normalizeSocialRole((value as Partial<SocialGroupLeaderboardEntry> | undefined)?.role);
  return { ...entry, role };
}

function normalizeSocialRole(value: unknown): SocialGroupRole | undefined {
  return value === "leader" || value === "officer" || value === "member" ? value : undefined;
}

function normalizeSocialGroupJoinRequestType(value: unknown): SocialGroupJoinRequest["type"] | undefined {
  return value === "invite_code" || value === "friend_invite" ? value : undefined;
}

function normalizeSocialGroupJoinRequestStatus(value: unknown): SocialGroupJoinRequest["status"] | undefined {
  return value === "pending" || value === "approved" || value === "declined" || value === "cancelled"
    ? value
    : undefined;
}

function normalizeSocialVisibility(value: unknown): SocialGroupVisibility | undefined {
  return value === "closed" || value === "invite" ? value : undefined;
}

function normalizeEntry(value: unknown): LeaderboardEntry | undefined {
  const entry = value as Partial<LeaderboardEntry> | undefined;
  const rank = Math.max(1, Math.round(Number(entry?.rank)));
  const userId = typeof entry?.userId === "string" && entry.userId.trim() ? entry.userId.trim() : undefined;
  const username = typeof entry?.username === "string" && entry.username.trim() ? entry.username.trim() : undefined;
  const rawTokens = entry?.tokens ?? entry?.xp;
  const tokens = Math.max(0, Math.round(Number(rawTokens)));
  if (!Number.isFinite(rank) || !userId || !username || !Number.isFinite(tokens)) return undefined;
  const avatarUrl =
    typeof entry?.avatarUrl === "string" && entry.avatarUrl.trim() ? entry.avatarUrl.trim() : undefined;
  const daysActive = Number.isFinite(Number(entry?.daysActive))
    ? Math.max(0, Math.round(Number(entry?.daysActive)))
    : undefined;
  const usagePreference = normalizeUsagePreference(entry?.usagePreference);
  return { rank, userId, username, avatarUrl, tokens, xp: tokens, daysActive, usagePreference };
}

function normalizeUsagePreference(value: unknown): LeaderboardUsagePreference | undefined {
  const input = value as Partial<LeaderboardUsagePreference> | undefined;
  if (!input || typeof input !== "object") return undefined;
  const favoriteAgent =
    typeof input.favoriteAgent?.label === "string" && input.favoriteAgent.label.trim()
      ? {
          label: input.favoriteAgent.label.trim().slice(0, 64),
          percent: Math.max(0, Math.min(100, Math.round(Number(input.favoriteAgent.percent)))),
        }
      : undefined;
  const favoriteModel =
    typeof input.favoriteModel === "string" && input.favoriteModel.trim()
      ? input.favoriteModel.trim().slice(0, 64)
      : undefined;
  const period = input.favoritePeriod;
  const favoritePeriod =
    period &&
    (period.id === "early" ||
      period.id === "morning" ||
      period.id === "afternoon" ||
      period.id === "evening" ||
      period.id === "night") &&
    Number.isFinite(Number(period.startHour)) &&
    Number.isFinite(Number(period.endHour))
      ? {
          id: period.id,
          startHour: Math.max(0, Math.min(23, Math.round(Number(period.startHour)))),
          endHour: Math.max(1, Math.min(24, Math.round(Number(period.endHour)))),
        }
      : undefined;
  const peakTokensPerMinute = Number.isFinite(Number(input.peakTokensPerMinute))
    ? Math.max(0, Math.round(Number(input.peakTokensPerMinute)))
    : undefined;
  const updatedAt =
    typeof input.updatedAt === "string" && Number.isFinite(Date.parse(input.updatedAt)) ? input.updatedAt : undefined;
  if (!favoriteAgent && !favoriteModel && !favoritePeriod && !peakTokensPerMinute) return undefined;
  return { favoriteAgent, favoriteModel, favoritePeriod, peakTokensPerMinute, updatedAt };
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
