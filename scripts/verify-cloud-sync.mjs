import { existsSync } from "node:fs";

const leaderboardModuleUrl = new URL("../dist/electron/leaderboard.js", import.meta.url);
const tokenAccountingModuleUrl = new URL("../dist/shared/tokenAccounting.js", import.meta.url);

if (!existsSync(leaderboardModuleUrl) || !existsSync(tokenAccountingModuleUrl)) {
  throw new Error("Missing built files. Run npm run build before scripts/verify-cloud-sync.mjs.");
}

const { createLeaderboardService } = await import(leaderboardModuleUrl.href);
const { countedTokensForEntry } = await import(tokenAccountingModuleUrl.href);

const profile = { id: "github-user-1", username: "olorin" };
const forbiddenEventKeys = [
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
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function assertNoForbiddenKeys(value, label) {
  for (const key of forbiddenEventKeys) {
    assert(!(key in value), `${label} leaked forbidden key: ${key}`);
  }
}

function createFakeCloud() {
  const events = new Map();
  const achievements = new Map();
  const devices = new Map();
  const modelStats = new Map();
  const requests = [];
  let leaderboardDeleteCount = 0;
  let deltaUnsupported = false;
  let clock = Date.parse("2026-05-27T00:00:00.000Z");

  function nextTimestamp() {
    clock += 1000;
    return new Date(clock).toISOString();
  }

  function rowTimestamp(row) {
    return row?.updatedAt ?? row?.createdAt ?? row?.unlockedAt ?? "1970-01-01T00:00:00.000Z";
  }

  function updateDeviceTotals(deviceId) {
    const device = devices.get(deviceId);
    if (!device) return;
    const deviceEvents = [...events.values()].filter((entry) => entry.deviceId === deviceId);
    device.entryCount = deviceEvents.length;
    device.tokens = deviceEvents.reduce((total, entry) => total + entry.tokens, 0);
  }

  function insertRemoteEvent(entry) {
    const updatedAt = nextTimestamp();
    events.set(entry.id, {
      ...entry,
      updatedAt,
      source: normalizeCloudSource(entry.source, entry.id),
      tokens: optionalCount(entry.tokens) ?? 0,
    });
    if (entry.deviceId && !devices.has(entry.deviceId)) {
      devices.set(entry.deviceId, {
        deviceId: entry.deviceId,
        lastSyncedAt: updatedAt,
        entryCount: 0,
        tokens: 0,
      });
    }
    if (entry.deviceId) updateDeviceTotals(entry.deviceId);
    return updatedAt;
  }

  async function requestJson(urlString, options = {}) {
    const url = new URL(urlString);
    const method = options.method ?? (options.body === undefined ? "GET" : "POST");
    const body = clone(options.body);
    requests.push({ path: url.pathname, search: url.search, method, body });

    if (url.pathname === "/api/tree" && method === "GET") {
      const cursor = nextTimestamp();
      const entries = [...events.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const unlocked = [...achievements.values()].sort((left, right) => left.unlockedAt.localeCompare(right.unlockedAt));
      return {
        entries,
        achievements: unlocked,
        devices: [...devices.values()],
        modelStats: [...modelStats.values()],
        cursor,
        delta: false,
        devicesFull: true,
        modelStatsFull: true,
        summary: {
          hasRemoteTree: entries.length > 0 || unlocked.length > 0 || devices.size > 0 || modelStats.size > 0,
          entryCount: entries.length,
          achievementCount: unlocked.length,
          deviceCount: devices.size,
          modelStatCount: modelStats.size,
        },
      };
    }

    if (url.pathname === "/api/tree/delta" && method === "GET") {
      if (deltaUnsupported) throw new Error("Not found");
      const since = url.searchParams.get("since");
      assert(typeof since === "string" && Number.isFinite(Date.parse(since)), "delta tree sync requires a valid since cursor");
      const cursor = nextTimestamp();
      const entries = [...events.values()]
        .filter((entry) => rowTimestamp(entry) > since && rowTimestamp(entry) <= cursor)
        .sort((left, right) => rowTimestamp(left).localeCompare(rowTimestamp(right)));
      const unlocked = [...achievements.values()]
        .filter((item) => rowTimestamp(item) > since && rowTimestamp(item) <= cursor)
        .sort((left, right) => rowTimestamp(left).localeCompare(rowTimestamp(right)));
      const changedModelStats = [...modelStats.values()]
        .filter((item) => rowTimestamp(item) > since && rowTimestamp(item) <= cursor)
        .sort((left, right) => rowTimestamp(left).localeCompare(rowTimestamp(right)));
      return {
        entries,
        achievements: unlocked,
        devices: [...devices.values()],
        modelStats: changedModelStats,
        cursor,
        delta: true,
        devicesFull: true,
        modelStatsFull: false,
        summary: {
          hasRemoteTree: entries.length > 0 || unlocked.length > 0 || devices.size > 0 || modelStats.size > 0,
          entryCount: entries.length,
          achievementCount: unlocked.length,
          deviceCount: devices.size,
          modelStatCount: changedModelStats.length,
        },
      };
    }

    if (url.pathname === "/api/tree/events" && method === "POST") {
      assert(options.token === "token", "tree event upload requires auth token");
      assert(typeof body?.deviceId === "string" && body.deviceId, "tree event upload requires device id");
      const updatedAt = nextTimestamp();
      const previousDevice = devices.get(body.deviceId) ?? {};
      devices.set(body.deviceId, {
        deviceId: body.deviceId,
        alias: body?.device?.alias ?? previousDevice.alias,
        platform: body?.device?.platform ?? previousDevice.platform,
        lastSyncedAt: updatedAt,
        entryCount: 0,
        tokens: 0,
        updatedAt,
      });
      if (Array.isArray(body?.modelStats) || body?.modelStatsEnabled === false) {
        for (const key of [...modelStats.keys()].filter((key) => key.startsWith(`${body.deviceId}|`))) {
          modelStats.delete(key);
        }
      }
      if (Array.isArray(body?.modelStats)) {
        for (const stat of body.modelStats) {
          assert(!("prompt" in stat), "model stats should not leak prompt");
          assert(!("reply" in stat), "model stats should not leak reply");
          assert(!("path" in stat), "model stats should not leak path");
          assert(!("session" in stat), "model stats should not leak session");
          assert(isSafeCloudSource(stat.source), `model stats used an unsafe source: ${stat.source}`);
          modelStats.set(`${body.deviceId}|${stat.date}|${stat.source}|${stat.model}`, {
            deviceId: body.deviceId,
            date: stat.date,
            source: normalizeCloudSource(stat.source),
            model: stat.model,
            tokens: optionalCount(stat.tokens) ?? 0,
            inputTokens: optionalCount(stat.inputTokens),
            outputTokens: optionalCount(stat.outputTokens),
            cacheReadTokens: optionalCount(stat.cacheReadTokens),
            cacheWriteTokens: optionalCount(stat.cacheWriteTokens),
            updatedAt,
          });
        }
      }
      const entries = Array.isArray(body?.entries) ? body.entries : [];
      for (const entry of entries) {
        assertNoForbiddenKeys(entry, `uploaded event ${entry?.id ?? "unknown"}`);
        assert(isSafeCloudSource(entry.source), `uploaded event ${entry?.id ?? "unknown"} used an unsafe source`);
        insertRemoteEvent({
          id: entry.id,
          createdAt: entry.createdAt,
          source: normalizeCloudSource(entry.source, entry.id),
          tokens: Math.max(0, Math.round(Number(entry.tokens))),
          inputTokens: optionalCount(entry.inputTokens),
          outputTokens: optionalCount(entry.outputTokens),
          cacheReadTokens: optionalCount(entry.cacheReadTokens),
          cacheWriteTokens: optionalCount(entry.cacheWriteTokens),
          deviceId: entry.deviceId || body.deviceId,
          eventFingerprint: entry.eventFingerprint,
        });
      }
      updateDeviceTotals(body.deviceId);
      return { ok: true, synced: entries.length };
    }

    if (url.pathname === "/api/tree/achievements" && method === "POST") {
      assert(options.token === "token", "achievement upload requires auth token");
      const updatedAt = nextTimestamp();
      const unlocked = Array.isArray(body?.achievements) ? body.achievements : [];
      for (const achievement of unlocked) {
        assert(!("trigger" in achievement), `uploaded achievement ${achievement?.id ?? "unknown"} leaked trigger`);
        achievements.set(achievement.id, {
          id: achievement.id,
          unlockedAt: achievement.unlockedAt,
          updatedAt,
        });
      }
      return { ok: true, synced: unlocked.length };
    }

    if (url.pathname === "/api/usage/daily" && method === "POST") {
      assert(options.token === "token", "leaderboard daily usage upload requires auth token");
      assert(Array.isArray(body?.days), "leaderboard daily usage upload requires day rows");
      return { ok: true, synced: body.days.length };
    }

    if (url.pathname === "/api/leaderboard" && method === "DELETE") {
      assert(options.token === "token", "leaderboard leave requires auth token");
      leaderboardDeleteCount += 1;
      return { ok: true };
    }

    throw new Error(`Unexpected fake cloud request: ${method} ${url.pathname}`);
  }

  return {
    events,
    achievements,
    devices,
    modelStats,
    requests,
    requestJson,
    insertRemoteEvent,
    setDeltaUnsupported(value) {
      deltaUnsupported = Boolean(value);
    },
    get leaderboardDeleteCount() {
      return leaderboardDeleteCount;
    },
  };
}

function optionalCount(value) {
  if (value === undefined || value === null) return undefined;
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function createDevice(
  name,
  deviceId,
  cloud,
  { entries = [], achievements = [], authenticated = true, openExternal } = {},
) {
  const files = new Map(
    authenticated
      ? [
          [
            `${name}:auth`,
            {
              token: "token",
              profile,
              createdAt: "2026-05-27T00:00:00.000Z",
            },
          ],
        ]
      : [],
  );
  const ledger = {
    installedAt: "2026-05-27T00:00:00.000Z",
    settings: {
      cloudSyncEnabled: false,
      cloudSyncDeviceId: deviceId,
      leaderboardProfile: profile,
      leaderboardPreferencesPublic: false,
      treeStartMode: undefined,
    },
    entries: clone(entries),
  };
  let achievementState = { unlocked: clone(achievements) };

  const service = createLeaderboardService({
    apiUrl: "https://fake-cloud.local",
    appName: "Vibe Tree",
    syncIntervalMs: 86_400_000,
    authTimeoutMs: 1_000,
    callbackPath: "/leaderboard/auth/callback",
    authPath: () => `${name}:auth`,
    cloudSyncPath: () => `${name}:cloud`,
    deviceId: () => deviceId,
    deviceInfo: () => ({ deviceId, alias: name, platform: name === "windows" ? "windows" : "mac" }),
    cloudModelStats: () =>
      ledger.entries
        .filter((entry) => entry.model && (!(entry.syncedFromCloud || entry.source === "cloud-sync") || !entry.deviceId || entry.deviceId === deviceId))
        .map((entry) => ({
          deviceId,
          date: entry.createdAt.slice(0, 10),
          source: normalizeCloudSource(entry.source, entry.id),
          model: entry.model,
          tokens: countedTokensForEntry(entry),
          inputTokens: optionalCount(entry.inputTokens),
          outputTokens: optionalCount(entry.outputTokens),
          cacheReadTokens: optionalCount(entry.cacheReadTokens),
          cacheWriteTokens: optionalCount(entry.cacheWriteTokens),
        }))
        .filter((stat) => stat.source !== "cloud-sync"),
    getLedger: () => ledger,
    getAchievements: () => achievementState,
    updateSettings: (partial) => {
      ledger.settings = { ...ledger.settings, ...partial };
    },
    appendRemoteEntries: (remoteEntries) => {
      const existing = new Map(ledger.entries.map((entry) => [entry.id, entry]));
      const existingByMirrorKey = new Map();
      for (const entry of ledger.entries) {
        const fingerprint = mirrorDedupeKey(entry);
        if (fingerprint && !existingByMirrorKey.has(fingerprint)) existingByMirrorKey.set(fingerprint, entry);
      }
      const accepted = [];
      for (const entry of remoteEntries) {
        assertNoForbiddenKeys(entry, `remote event ${entry?.id ?? "unknown"}`);
        if (!entry?.id) continue;
        const normalized = {
          ...entry,
          tokens: countedTokensForEntry(entry),
          syncedFromCloud: true,
          eventFingerprint: entry.eventFingerprint ?? eventFingerprint(entry),
        };
        const current = existing.get(entry.id);
        if (current) {
          if (current.source === "cloud-sync" || current.syncedFromCloud) {
            Object.assign(current, preserveLocalOnlyFields(normalized, current));
          }
          continue;
        }
        const fingerprint = mirrorDedupeKey(normalized);
        const mirrored = fingerprint ? existingByMirrorKey.get(fingerprint) : undefined;
        if (mirrored) {
          const preferred = duplicateScore(normalized) > duplicateScore(mirrored) ? normalized : mirrored;
          const secondary = preferred === normalized ? mirrored : normalized;
          Object.assign(mirrored, mergeDuplicate(preferred, secondary, normalized.eventFingerprint ?? mirrored.eventFingerprint ?? eventFingerprint(normalized) ?? fingerprint));
          continue;
        }
        existing.set(entry.id, normalized);
        if (fingerprint) existingByMirrorKey.set(fingerprint, normalized);
        accepted.push(normalized);
      }
      ledger.entries = dedupeByFingerprint([...accepted, ...ledger.entries]);
      return accepted.length;
    },
    mergeRemoteAchievements: (unlocked) => {
      const existing = new Set(achievementState.unlocked.map((item) => item.id));
      const accepted = [];
      for (const item of unlocked) {
        assert(!("trigger" in item), `remote achievement ${item?.id ?? "unknown"} leaked trigger`);
        if (!item?.id || existing.has(item.id)) continue;
        existing.add(item.id);
        accepted.push(item);
      }
      achievementState = { unlocked: [...achievementState.unlocked, ...accepted] };
      return accepted.length;
    },
    xpForEntry: countedTokensForEntry,
    dateKey: (date) => date.toISOString().slice(0, 10),
    currentAppVersion: () => "0.5.5-test",
    mainText,
    openExternal: openExternal ?? (async () => {
      throw new Error("GitHub auth should not open during contract verification");
    }),
    readJsonFile: (path) => clone(files.get(path)),
    writeJsonAtomic: (path, value) => {
      files.set(path, clone(value));
    },
    broadcastStatus: () => {},
    requestJson: cloud.requestJson,
  });
  service.readAuth();

  return {
    service,
    ledger,
    files,
    get achievements() {
      return achievementState;
    },
  };
}

function mainText(key) {
  const text = {
    leaderboardServiceNotConfigured: "service not configured",
    leaderboardLoginRequired: "login required",
    leaderboardLoginFailed: "login failed",
    leaderboardLoginCancelled: "login canceled",
    leaderboardSyncFailed: "sync failed",
    leaderboardLoadFailed: "load failed",
    leaderboardLoggedOut: "logged out",
    cloudSyncNoRemoteTree: "no remote tree",
  };
  return text[key] ?? key;
}

function localEntry(id, deviceId, source, createdAt, tokens) {
  return {
    id,
    createdAt,
    source,
    tokens,
    note: "PRIVATE NOTE SHOULD NOT UPLOAD",
    agent: `${source}:agent`,
    provider: "private-provider",
    model: "private-model",
    prompt: "private prompt",
    localPath: "/private/workspace/path",
    inputTokens: Math.floor(tokens * 0.6),
    outputTokens: Math.floor(tokens * 0.3),
    cacheReadTokens: Math.floor(tokens * 0.1),
    cacheWriteTokens: 0,
    deviceId,
  };
}

function normalizeCloudSource(source, eventId) {
  if (isSafeCloudSource(source) && source !== "cloud-sync") return source;
  const inferred = typeof eventId === "string" && eventId.includes(":") ? eventId.slice(0, eventId.indexOf(":")) : undefined;
  return isSafeCloudSource(inferred) ? inferred : "cloud-sync";
}

function eventFingerprint(entry) {
  if (!entry?.createdAt) return undefined;
  return [
    "v1",
    normalizeCloudSource(entry.source, entry.id),
    entry.createdAt,
    optionalCount(entry.tokens) ?? 0,
    optionalCount(entry.inputTokens) ?? 0,
    optionalCount(entry.outputTokens) ?? 0,
    optionalCount(entry.cacheReadTokens) ?? 0,
    optionalCount(entry.cacheWriteTokens) ?? 0,
  ].join("|");
}

function mirrorDedupeKey(entry) {
  if (!entry?.createdAt) return undefined;
  const hasBreakdown =
    entry.inputTokens !== undefined ||
    entry.outputTokens !== undefined ||
    entry.cacheReadTokens !== undefined ||
    entry.cacheWriteTokens !== undefined;
  if (!hasBreakdown) return entry.eventFingerprint ?? eventFingerprint(entry);
  return [
    "v1",
    normalizeCloudSource(entry.source, entry.id),
    entry.createdAt,
    optionalCount(entry.inputTokens) ?? 0,
    optionalCount(entry.outputTokens) ?? 0,
    optionalCount(entry.cacheReadTokens) ?? 0,
    optionalCount(entry.cacheWriteTokens) ?? 0,
  ].join("|");
}

function dedupeByFingerprint(entries) {
  const byFingerprint = new Map();
  const withoutFingerprint = [];
  for (const entry of entries) {
    const fingerprint = mirrorDedupeKey(entry);
    if (!fingerprint) {
      withoutFingerprint.push(entry);
      continue;
    }
    const existing = byFingerprint.get(fingerprint);
    if (!existing) {
      byFingerprint.set(fingerprint, { ...entry, eventFingerprint: entry.eventFingerprint ?? eventFingerprint(entry) });
      continue;
    }
    const preferred = duplicateScore(entry) > duplicateScore(existing) ? entry : existing;
    const secondary = preferred === entry ? existing : entry;
    byFingerprint.set(fingerprint, mergeDuplicate(preferred, secondary, mergeEventFingerprint(preferred, secondary) ?? fingerprint));
  }
  return [...withoutFingerprint, ...byFingerprint.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function mergeDuplicate(preferred, secondary, fingerprint) {
  return {
    ...preferred,
    agent: preferred.agent ?? secondary.agent,
    provider: preferred.provider ?? secondary.provider,
    model: preferred.model ?? secondary.model,
    note: preferred.note ?? secondary.note,
    tokens: secondary.syncedFromCloud || secondary.source === "cloud-sync" ? secondary.tokens : preferred.tokens,
    deviceId: preferred.deviceId ?? secondary.deviceId,
    syncedFromCloud: preferred.syncedFromCloud || secondary.syncedFromCloud || secondary.source === "cloud-sync" || undefined,
    eventFingerprint: fingerprint,
  };
}

function preserveLocalOnlyFields(base, fallback) {
  return {
    ...base,
    agent: base.agent ?? fallback.agent,
    provider: base.provider ?? fallback.provider,
    model: base.model ?? fallback.model,
    note: base.note ?? fallback.note,
  };
}

function mergeEventFingerprint(preferred, secondary) {
  if (secondary.syncedFromCloud || secondary.source === "cloud-sync") return secondary.eventFingerprint ?? eventFingerprint(secondary);
  if (preferred.syncedFromCloud || preferred.source === "cloud-sync") return preferred.eventFingerprint ?? eventFingerprint(preferred);
  return preferred.eventFingerprint ?? secondary.eventFingerprint ?? eventFingerprint(preferred) ?? eventFingerprint(secondary);
}

function duplicateScore(entry) {
  let score = 0;
  if (!entry.syncedFromCloud && entry.source !== "cloud-sync") score += 100;
  if (entry.source !== "cloud-sync") score += 20;
  if (entry.deviceId) score += 4;
  if (entry.eventFingerprint) score += 2;
  return score;
}

function isSafeCloudSource(source) {
  return safeCloudSources.has(source);
}

const safeCloudSources = new Set([
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

const authCancelCloud = createFakeCloud();
let authOpened = false;
const authCancelDevice = createDevice("auth-cancel", "auth-cancel-device", authCancelCloud, {
  authenticated: false,
  openExternal: async () => {
    authOpened = true;
  },
});
const authJoinPromise = authCancelDevice.service.joinCloudTree();
for (let attempt = 0; attempt < 10 && !authOpened; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert(authOpened, "joining a cloud tree should open GitHub auth when no token exists");
const cancelStatus = authCancelDevice.service.cancelAuth();
assert(cancelStatus.error === "login canceled", "canceling auth should return a canceled cloud status");
const canceledJoinStatus = await authJoinPromise;
assert(canceledJoinStatus.error === "login canceled", "canceling auth should release the pending join request");
assert(authCancelDevice.ledger.settings.cloudSyncEnabled === false, "canceled auth should not enable cloud sync");

const emptyCloud = createFakeCloud();
const emptyMac = createDevice("empty-mac", "mac-empty", emptyCloud);
let status = await emptyMac.service.joinCloudTree();
assert(status.error === "no remote tree", "joining an empty account should return a no remote tree error");
assert(emptyMac.ledger.settings.cloudSyncEnabled === false, "joining an empty account should leave cloud sync disabled");

const zeroTokenCloud = createFakeCloud();
const seedDevice = createDevice("seed-mac", "seed-device", zeroTokenCloud);
seedDevice.ledger.settings.cloudSyncEnabled = true;
seedDevice.ledger.settings.treeStartMode = "new";
status = await seedDevice.service.syncCloudTree({ force: true });
assert(!status.error, `zero-token seed sync failed: ${status.error}`);
assert(zeroTokenCloud.devices.get("seed-device")?.tokens === 0, "zero-token cloud tree should still store a device snapshot");
const joinZeroTokenDevice = createDevice("join-zero-token", "join-zero-device", zeroTokenCloud);
status = await joinZeroTokenDevice.service.joinCloudTree();
assert(!status.error, `joining a zero-token cloud tree should succeed: ${status.error}`);
assert(joinZeroTokenDevice.ledger.settings.cloudSyncEnabled === true, "joining a zero-token cloud tree should enable cloud sync");

const cloud = createFakeCloud();
const repairedWinEntry = {
  ...localEntry("win-repaired-from-cloud", "win-device", "codex-session", "2026-05-27T01:30:00.000Z", 500),
  model: "repaired-model",
  syncedFromCloud: true,
};
const pulledMacEntry = {
  ...localEntry("mac-pulled-cloud-copy", "mac-device", "claude-session", "2026-05-27T01:45:00.000Z", 600),
  model: "remote-model",
  syncedFromCloud: true,
};
const windows = createDevice("windows", "win-device", cloud, {
  entries: [localEntry("win-event-1", "win-device", "codex-session", "2026-05-27T01:00:00.000Z", 1000), repairedWinEntry, pulledMacEntry],
  achievements: [
    {
      id: "sprout",
      unlockedAt: "2026-05-27T01:01:00.000Z",
      trigger: { prompt: "private trigger data" },
    },
  ],
});
windows.ledger.settings.cloudSyncEnabled = true;
windows.ledger.settings.treeStartMode = "new";

status = await windows.service.syncCloudTree({ force: true });
assert(!status.error, `windows initial sync failed: ${status.error}`);
assert(windows.files.get("windows:cloud")?.treeCursor, "initial cloud sync should persist a tree cursor");
assert(cloud.events.size === 1, "windows initial sync should upload one event");
assert(cloud.achievements.size === 1, "windows initial sync should upload one achievement");
assert(cloud.events.get("win-event-1").source === "codex-session", "cloud should preserve safe source categories");
assert(cloud.devices.get("win-device")?.platform === "windows", "cloud should track device platform metadata");
assert(
  [...cloud.modelStats.values()].some((row) => row.deviceId === "win-device" && row.model === "private-model"),
  "cloud should store default aggregate model totals",
);
assert(
  [...cloud.modelStats.values()].some((row) => row.deviceId === "win-device" && row.model === "repaired-model"),
  "cloud should include repaired same-device cloud mirrors in aggregate model totals",
);
assert(
  ![...cloud.modelStats.values()].some((row) => row.deviceId === "win-device" && row.model === "remote-model"),
  "cloud should not let one device re-upload another device's aggregate model totals",
);

const modelStatsCacheCloud = createFakeCloud();
const modelStatsCacheDevice = createDevice("model-cache", "model-cache-device", modelStatsCacheCloud, {
  entries: [localEntry("model-cache-1", "model-cache-device", "codex-session", "2026-05-27T02:10:00.000Z", 900)],
});
modelStatsCacheDevice.ledger.settings.cloudSyncEnabled = true;
modelStatsCacheDevice.ledger.settings.treeStartMode = "new";
status = await modelStatsCacheDevice.service.syncCloudTree({ force: true });
assert(!status.error, `model stat cache seed sync failed: ${status.error}`);
const modelStatUploadCountAfterSeed = modelStatsCacheCloud.requests.filter(
  (request) => request.path === "/api/tree/events" && Array.isArray(request.body?.modelStats),
).length;
status = await modelStatsCacheDevice.service.syncCloudTree();
assert(!status.error, `model stat cache repeat sync failed: ${status.error}`);
assert(
  modelStatsCacheCloud.requests.filter(
    (request) => request.path === "/api/tree/events" && Array.isArray(request.body?.modelStats),
  ).length === modelStatUploadCountAfterSeed,
  "repeat cloud sync should not resend unchanged aggregate model stats",
);
modelStatsCacheDevice.ledger.entries.unshift(
  localEntry("model-cache-2", "model-cache-device", "codex-session", "2026-05-27T02:20:00.000Z", 100),
);
status = await modelStatsCacheDevice.service.syncCloudTree();
assert(!status.error, `model stat cache changed sync failed: ${status.error}`);
assert(
  modelStatsCacheCloud.requests.filter(
    (request) => request.path === "/api/tree/events" && Array.isArray(request.body?.modelStats),
  ).length === modelStatUploadCountAfterSeed + 1,
  "changed aggregate model stats should still upload on the next cloud sync",
);
modelStatsCacheDevice.service.stop();

const legacyModelCloud = createFakeCloud();
legacyModelCloud.events.set("codex-session:legacy-no-device-model", {
  id: "codex-session:legacy-no-device-model",
  createdAt: "2026-05-27T02:00:00.000Z",
  source: "codex-session",
  tokens: 700,
  inputTokens: 500,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  deviceId: "legacy-device",
});
const legacyModelDevice = createDevice("legacy-model-device", "legacy-device", legacyModelCloud, {
  entries: [
    {
      ...localEntry("codex-session:legacy-no-device-model", undefined, "cloud-sync", "2026-05-27T02:00:00.000Z", 700),
      model: "legacy-model",
      syncedFromCloud: true,
    },
  ],
});
legacyModelDevice.ledger.settings.cloudSyncEnabled = true;
legacyModelDevice.ledger.settings.treeStartMode = "cloud";
status = await legacyModelDevice.service.syncCloudTree({ force: true });
assert(!status.error, `legacy no-device model sync failed: ${status.error}`);
assert(
  [...legacyModelCloud.modelStats.values()].some(
    (row) => row.deviceId === "legacy-device" && row.source === "codex-session" && row.model === "legacy-model",
  ),
  "same-device cloud mirrors without a device id should still repair aggregate model totals",
);
legacyModelDevice.service.stop();

const mac = createDevice("mac", "mac-device", cloud);
status = await mac.service.joinCloudTree();
assert(!status.error, `mac join existing failed: ${status.error}`);
assert(mac.ledger.entries.length === 1, "mac should pull the windows event");
assert(mac.ledger.entries[0].source === "codex-session", "mac should preserve pulled event source");
assert(mac.ledger.entries[0].syncedFromCloud === true, "mac should mark pulled events as cloud-synced");
assert(mac.ledger.entries[0].deviceId === "win-device", "mac should preserve remote device id");
assert(mac.achievements.unlocked.some((item) => item.id === "sprout"), "mac should merge remote achievement");
assert(mac.service.cloudStatus().modelStats?.some((row) => row.model === "private-model"), "mac should cache remote aggregate model stats");

const eventPostCountAfterJoin = cloud.requests.filter((request) => request.path === "/api/tree/events").length;
mac.ledger.entries.unshift(localEntry("win-event-1-different-local-id", "mac-device", "codex-session", "2026-05-27T01:00:00.000Z", 1000));
status = await mac.service.syncCloudTree({ force: true });
assert(!status.error, `mac duplicate-history sync failed: ${status.error}`);
assert(cloud.events.size === 1, "mac should not upload same historical event with a different local id");

mac.ledger.entries.unshift(localEntry("mac-event-1", "mac-device", "claude-session", "2026-05-27T02:00:00.000Z", 2000));
mac.achievements.unlocked.push({
  id: "mac-growth",
  unlockedAt: "2026-05-27T02:01:00.000Z",
  trigger: { reply: "private reply" },
});
status = await mac.service.syncCloudTree({ force: true });
assert(!status.error, `mac force sync failed: ${status.error}`);
assert(cloud.events.size === 2, "mac sync should add exactly one new event");
assert(cloud.achievements.has("mac-growth"), "mac sync should upload new achievement");

const macEventUploads = cloud.requests
  .slice(eventPostCountAfterJoin)
  .filter((request) => request.path === "/api/tree/events")
  .flatMap((request) => request.body.entries);
assert(macEventUploads.some((entry) => entry.id === "mac-event-1"), "mac sync should upload the mac local event");
assert(!macEventUploads.some((entry) => entry.id === "win-event-1"), "mac sync should not re-upload pulled cloud events");

const deltaRequestsBeforeWindowsPull = cloud.requests.filter((request) => request.path === "/api/tree/delta").length;
status = await windows.service.syncCloudTree();
assert(!status.error, `windows follow-up sync failed: ${status.error}`);
assert(
  cloud.requests.filter((request) => request.path === "/api/tree/delta").length === deltaRequestsBeforeWindowsPull + 1,
  "windows follow-up sync should use the cloud tree delta endpoint",
);
assert(
  windows.files.get("windows:cloud")?.lastDownloadedCount === 1,
  "delta sync should only append the newly remote event, not re-download the full tree",
);
assert(
  windows.ledger.entries.some((entry) => entry.id === "mac-event-1" && entry.source === "claude-session" && entry.syncedFromCloud),
  "windows should pull mac event with its safe source category",
);
assert(windows.achievements.unlocked.some((item) => item.id === "mac-growth"), "windows should pull mac achievement");

const beforeRepeatIds = windows.ledger.entries.map((entry) => entry.id).sort().join(",");
status = await windows.service.syncCloudTree();
assert(!status.error, `repeat sync failed: ${status.error}`);
const afterRepeatIds = windows.ledger.entries.map((entry) => entry.id).sort().join(",");
assert(afterRepeatIds === beforeRepeatIds, "repeat sync should not duplicate entries");

windows.ledger.settings.leaderboardEnabled = true;
windows.ledger.settings.cloudSyncEnabled = true;
status = await windows.service.logout();
assert(!status.joined, "leaving leaderboard should disable leaderboard membership");
assert(status.authenticated, "leaving leaderboard should keep GitHub auth for cloud sync");
assert(windows.ledger.settings.cloudSyncEnabled === true, "leaving leaderboard should keep cloud sync enabled");
assert(cloud.leaderboardDeleteCount === 1, "leaving leaderboard should call the leaderboard-only delete endpoint");
assert(cloud.events.size === 2, "leaving leaderboard must not delete cloud tree events");
assert(cloud.achievements.size === 2, "leaving leaderboard must not delete cloud tree achievements");

const fallbackCloud = createFakeCloud();
const fallbackDevice = createDevice("fallback-device", "fallback-device-id", fallbackCloud, {
  entries: [localEntry("fallback-local-event", "fallback-device-id", "codex-session", "2026-05-27T04:00:00.000Z", 300)],
});
fallbackDevice.ledger.settings.cloudSyncEnabled = true;
fallbackDevice.ledger.settings.treeStartMode = "new";
status = await fallbackDevice.service.syncCloudTree({ force: true });
assert(!status.error, `fallback seed sync failed: ${status.error}`);
fallbackCloud.insertRemoteEvent({
  id: "fallback-remote-event",
  createdAt: "2026-05-27T04:10:00.000Z",
  source: "openclaw-session",
  tokens: 450,
  deviceId: "fallback-other-device",
});
fallbackCloud.setDeltaUnsupported(true);
const fallbackDeltaBefore = fallbackCloud.requests.filter((request) => request.path === "/api/tree/delta").length;
const fallbackFullBefore = fallbackCloud.requests.filter((request) => request.path === "/api/tree").length;
status = await fallbackDevice.service.syncCloudTree();
assert(!status.error, `delta fallback sync failed: ${status.error}`);
assert(
  fallbackCloud.requests.filter((request) => request.path === "/api/tree/delta").length === fallbackDeltaBefore + 1 &&
    fallbackCloud.requests.filter((request) => request.path === "/api/tree").length === fallbackFullBefore + 1,
  "unsupported delta endpoint should fall back to the full cloud tree endpoint",
);
assert(
  fallbackDevice.ledger.entries.some((entry) => entry.id === "fallback-remote-event"),
  "full fallback should still merge remote events",
);
fallbackDevice.service.stop();

const cacheCloud = createFakeCloud();
cacheCloud.events.set("codex-session:cache-heavy", {
  id: "codex-session:cache-heavy",
  createdAt: "2026-05-27T03:00:00.000Z",
  source: "codex-session",
  tokens: 1100,
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 900,
  cacheWriteTokens: 0,
  deviceId: "win-device",
});
const pollutedMac = createDevice("polluted-mac", "polluted-mac-device", cacheCloud, {
  entries: [
    {
      id: "codex-session:cache-heavy-local-path-id",
      createdAt: "2026-05-27T03:00:00.000Z",
      source: "codex-session",
      model: "gpt-5.5",
      tokens: 1100,
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 900,
      cacheWriteTokens: 0,
      deviceId: "win-device",
    },
    {
      id: "codex-session:cache-heavy",
      createdAt: "2026-05-27T03:00:00.000Z",
      source: "cloud-sync",
      tokens: 2000,
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 900,
      cacheWriteTokens: 0,
      deviceId: "win-device",
      syncedFromCloud: true,
    },
  ],
});
pollutedMac.ledger.settings.cloudSyncEnabled = true;
pollutedMac.ledger.settings.treeStartMode = "cloud";
status = await pollutedMac.service.syncCloudTree({ force: true, pullFirst: true });
assert(!status.error, `polluted cache repair sync failed: ${status.error}`);
const cacheHeavyEntries = pollutedMac.ledger.entries.filter((entry) => mirrorDedupeKey(entry) === mirrorDedupeKey(cacheCloud.events.get("codex-session:cache-heavy")));
assert(cacheHeavyEntries.length === 1, "sync should collapse local original and cloud mirror with different ids");
const repaired = cacheHeavyEntries[0];
assert(repaired?.tokens === 1100, "cloud-sync repair should trust authoritative server tokens");
assert(countedTokensForEntry(repaired) === 1100, "cloud-sync XP should not add cache read twice");
assert(repaired.source === "codex-session", "cloud-sync repair should restore the safe source category");
assert(repaired.model === "gpt-5.5", "cloud-sync repair should preserve local model labels");
assert(pollutedMac.ledger.entries.reduce((total, entry) => total + countedTokensForEntry(entry), 0) === 1100, "polluted cache mirror must not keep counting after repair");

const leaderboardCloud = createFakeCloud();
const leaderboardDevice = createDevice("leaderboard-cloud", "leaderboard-device", leaderboardCloud, {
  entries: [
    {
      id: "codex-session:older-cloud-history",
      createdAt: "2026-05-21T03:00:00.000Z",
      source: "codex-session",
      tokens: 4200,
      deviceId: "win-device",
      syncedFromCloud: true,
    },
    {
      id: "codex-session:newer-local-history",
      createdAt: "2026-05-27T03:00:00.000Z",
      source: "codex-session",
      tokens: 800,
      deviceId: "leaderboard-device",
    },
  ],
});
leaderboardDevice.ledger.installedAt = "2026-05-27T00:00:00.000Z";
leaderboardDevice.ledger.settings.cloudSyncEnabled = true;
leaderboardDevice.ledger.settings.leaderboardPreferencesPublic = true;
leaderboardDevice.files.set("leaderboard-cloud:cloud", {
  modelStats: [
    {
      deviceId: "win-device",
      date: "2026-05-21",
      source: "codex-session",
      model: "remote-favorite-model",
      tokens: 4200,
    },
  ],
});
status = await leaderboardDevice.service.setEnabled(true);
assert(!status.error, `leaderboard sync failed: ${status.error}`);
const dailyUsageUpload = leaderboardCloud.requests.find((request) => request.path === "/api/usage/daily")?.body;
assert(dailyUsageUpload?.usageStartDate === "2026-05-21", "leaderboard sync should preserve older cloud history start date");
assert(
  dailyUsageUpload.days.some((day) => day.date === "2026-05-21" && day.tokens === 4200),
  "leaderboard sync should upload older cloud history rows",
);
assert(
  dailyUsageUpload.hours?.some((hour) => typeof hour.hourStartUtc === "string" && hour.tokens >= 0),
  "leaderboard sync should upload recent hourly rows for the 24h leaderboard",
);
const allPreference = dailyUsageUpload.usagePreferences?.find((item) => item.range === "all");
assert(
  allPreference?.favoriteModel === "remote-favorite-model",
  "leaderboard public preferences should use synced aggregate model stats across devices",
);
assert(status.lastSyncedAt, "joining the leaderboard should wait for the first daily sync");
leaderboardDevice.service.stop();

console.log(
  "Cloud sync contract verified: auth cancellation, two-device merge, delta sync and full fallback, aggregate model-stat cache, zero-token cloud tree join, dedupe, authoritative cloud tokens, empty-account guard, hourly leaderboard upload, leaderboard leave safety, and privacy payload whitelist passed.",
);
