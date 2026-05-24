import * as http from "node:http";
import * as https from "node:https";
import { createHash, randomBytes } from "node:crypto";
import type {
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
} from "../shared/types.js";

interface LeaderboardAuthFile {
  token?: string;
  profile?: LeaderboardProfile;
  createdAt?: string;
}

interface LeaderboardAuthSessionResponse {
  token?: string;
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
  authTimeoutMs: number;
  callbackPath: string;
  authPath: () => string;
  getLedger: () => LedgerFile;
  updateSettings: (partial: Partial<Settings>) => void;
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
  let syncing = false;
  let authServer: http.Server | null = null;
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
    broadcast();
  }

  function stop() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = null;
    authServer?.close();
    authServer = null;
  }

  function scheduleNextSync() {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }

    if (!configured || !auth.token || !ledger().settings.leaderboardEnabled) return;

    syncTimer = setTimeout(() => {
      syncTimer = null;
      void syncUsage();
    }, nextSyncDelay());
  }

  function nextSyncDelay() {
    const lastSyncedAt = ledger().settings.leaderboardLastSyncedAt ?? lastSyncAttemptAt;
    if (!lastSyncedAt) return Math.min(3_000, options.syncIntervalMs);
    const lastSyncedTime = Date.parse(lastSyncedAt);
    if (!Number.isFinite(lastSyncedTime)) return Math.min(3_000, options.syncIntervalMs);
    return Math.max(3_000, lastSyncedTime + options.syncIntervalMs - Date.now());
  }

  async function login(): Promise<LeaderboardStatus> {
    if (!configured) return status(text("leaderboardServiceNotConfigured"));

    try {
      const token = await waitForToken();
      const profile = await fetchProfile(token);
      writeAuth({
        token,
        profile,
        createdAt: new Date().toISOString(),
      });
      options.updateSettings({
        leaderboardEnabled: true,
        leaderboardProfile: profile,
      });
      void syncUsage();
      return status();
    } catch (error) {
      return status(error instanceof Error ? error.message : text("leaderboardLoginFailed"));
    }
  }

  async function setEnabled(enabled: boolean): Promise<LeaderboardStatus> {
    if (enabled && !configured) return status(text("leaderboardServiceNotConfigured"));
    if (enabled && !auth.token) return status(text("leaderboardLoginRequired"));

    options.updateSettings({
      leaderboardEnabled: enabled,
      leaderboardProfile: enabled ? auth.profile : ledger().settings.leaderboardProfile,
    });
    if (enabled) void syncUsage();
    return status();
  }

  async function logout(): Promise<LeaderboardStatus> {
    const token = auth.token;
    if (token && configured) {
      try {
        await requestJson(apiUrl("/api/me"), { method: "DELETE", token });
      } catch {
        // Local opt-out should still succeed even if the remote service is unavailable.
      }
    }
    clearAuth();
    options.updateSettings({
      leaderboardEnabled: false,
      leaderboardProfile: undefined,
      leaderboardLastSyncedAt: undefined,
    });
    return status(text("leaderboardLoggedOut"));
  }

  async function syncUsage(syncOptions: LeaderboardSyncOptions = {}): Promise<LeaderboardStatus> {
    if (!configured) return status(text("leaderboardServiceNotConfigured"));
    if (!auth.token || !auth.profile) return status(text("leaderboardLoginRequired"));
    if (!ledger().settings.leaderboardEnabled) return status();
    if (syncing) return status();

    syncing = true;
    lastSyncAttemptAt = new Date().toISOString();
    broadcast();

    try {
      await requestJson(apiUrl("/api/usage/daily"), {
        method: "POST",
        token: auth.token,
        body: {
          days: dailyUsage(),
          appVersion: options.currentAppVersion(),
          usageStartDate: usageStartDate(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          forceSync: syncOptions.force === true,
          usagePreferencesPublic: ledger().settings.leaderboardPreferencesPublic,
          usagePreferences: ledger().settings.leaderboardPreferencesPublic ? usagePreferences() : undefined,
        },
      });
      syncing = false;
      options.updateSettings({
        leaderboardEnabled: true,
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

  function waitForToken(): Promise<string> {
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
      const cleanup = () => {
        clearTimeout(timeout);
        authServer?.close();
        authServer = null;
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
        cleanup();
      };
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
    const modelTotals = new Map<string, number>();
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
      const model = cleanPreferenceLabel(entry.model);
      if (model) modelTotals.set(model, (modelTotals.get(model) ?? 0) + tokens);
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

  function usageStartDate() {
    const installedAt = new Date(ledger().installedAt);
    if (!Number.isFinite(installedAt.getTime())) return undefined;
    return options.dateKey(installedAt);
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
    getLeaderboard,
    getLeaderboards,
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

function normalizeRange(value: unknown): LeaderboardRange {
  return value === "today" || value === "30d" || value === "all" ? value : "7d";
}

const LEADERBOARD_PREFERENCE_RANGES: LeaderboardRange[] = ["today", "7d", "30d", "all"];

const AGENT_LABELS: Record<string, string> = {
  codex: "Codex",
  openclaw: "OpenClaw",
  pi: "Pi Agent",
  opencode: "OpenCode",
  claude: "Claude Code",
  gemini: "Gemini",
  hermes: "Hermes",
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
  start.setHours(0, 0, 0, 0);
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "30d") start.setDate(start.getDate() - 29);
  return start;
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
  if (entry.source === "codex-session" || entry.agent === "codex-desktop") return "codex";
  if (entry.source === "openclaw-session" || entry.agent === "openclaw") return "openclaw";
  if (entry.source === "pi-session" || entry.agent === "pi-agent") return "pi";
  if (entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"))) {
    return "opencode";
  }
  if (entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"))) return "claude";
  if (entry.source === "gemini-session" || entry.agent === "gemini") return "gemini";
  if (entry.source === "hermes-session" || entry.agent === "hermes") return "hermes";
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
  const rawRanges = collection?.ranges as Partial<Record<LeaderboardRange, unknown>> | undefined;
  const ranges = Object.fromEntries(
    LEADERBOARD_PREFERENCE_RANGES.map((range) => [range, normalizeData(rawRanges?.[range], range)]),
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
