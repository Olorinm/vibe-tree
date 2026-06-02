export interface Env {
  DB: D1Database;
  APP_ORIGIN?: string;
  PUBLIC_READ_RATE_LIMITER?: RateLimitBinding;
  AUTH_RATE_LIMITER?: RateLimitBinding;
  WRITE_RATE_LIMITER?: RateLimitBinding;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}

type LeaderboardRange = "24h" | "7d" | "30d" | "all";
type SocialGroupLeaderboardBasis = "total" | "since_join";
type UsagePreferencePeriod = "early" | "morning" | "afternoon" | "evening" | "night";
type RateLimitName = "PUBLIC_READ_RATE_LIMITER" | "AUTH_RATE_LIMITER" | "WRITE_RATE_LIMITER";
type SocialFriendStatus = "pending" | "accepted";
type SocialGroupRole = "leader" | "officer" | "member";
type SocialGroupVisibility = "invite" | "closed";
type SocialGroupJoinRequestType = "invite_code" | "friend_invite";
type SocialGroupJoinRequestStatus = "pending" | "approved" | "declined" | "cancelled";
type SocialProfileVisibility = "relations" | "friends" | "private";
type SecurityEventType =
  | "rate_limited"
  | "invalid_callback"
  | "auth_failed"
  | "sync_cooldown"
  | "invalid_payload"
  | "server_error";

const MAX_DAILY_ACCEPTED_TOKENS = 1_000_000_000_000_000;
const MAX_BACKFILL_DAYS = 30;
const MAX_HOURLY_BACKFILL_HOURS = 72;
const LEGACY_DAILY_FALLBACK_HOURS = 26;
const LEADERBOARD_CACHE_TTL_MS = 60_000;
const SYNC_COOLDOWN_SECONDS = 30;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const LEADERBOARD_RANGES: LeaderboardRange[] = ["24h", "7d", "30d", "all"];
const leaderboardCache = new Map<LeaderboardRange, { expiresAt: number; updatedAt: string; entries: LeaderboardEntry[] }>();
const PROFILE_LEVEL_BASE = 100_000;
const PROFILE_LEVEL_EXPONENT = 1.65;
const PROFILE_MAX_LEVEL = 120;

interface SocialProfilePrivacy {
  profileVisibility: SocialProfileVisibility;
  showLevel: boolean;
  showTokenTotal: boolean;
  showActiveDays: boolean;
  showAchievements: boolean;
  updatedAt?: string;
}

interface UsageTotals {
  tokens: number;
  daysActive: number;
}

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface AuthState {
  callback: string;
  state: string;
  codeChallenge: string;
  exp: number;
}

interface GithubUser {
  id: number;
  login: string;
  avatar_url?: string;
  html_url?: string;
}

interface SessionUser {
  userId: string;
  username: string;
  avatarUrl?: string;
}

interface UsagePreferenceRow {
  range: LeaderboardRange;
  favoriteAgentLabel?: string;
  favoriteAgentPercent?: number;
  favoriteModel?: string;
  favoritePeriod?: UsagePreferencePeriod;
  favoritePeriodStart?: number;
  favoritePeriodEnd?: number;
  peakTokensPerMinute?: number;
}

interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatarUrl?: string;
  tokens: number;
  xp: number;
  daysActive: number;
  usagePreference?: ReturnType<typeof rowToUsagePreference>;
}

interface SocialGroupRow {
  groupId: string;
  name: string;
  description?: string | null;
  iconEmoji?: string | null;
  visibility: SocialGroupVisibility;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  memberCount?: number;
  role?: SocialGroupRole;
  shareUsage?: number;
}

interface SocialGroupMemberRow {
  userId: string;
  username: string;
  avatarUrl?: string | null;
  role: SocialGroupRole;
  shareUsage: number;
  joinedAt: string;
  updatedAt: string;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: Record<string, unknown> = {},
    public logType?: SecurityEventType,
    public logDetails: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env) });

    const url = new URL(request.url);
    try {
      await enforceRouteRateLimit(request, env, ctx);

      if (url.pathname === "/health") return json({ ok: true }, env);
      if (url.pathname === "/auth/github/start" && request.method === "GET") return await startGithubAuth(request, env);
      if (url.pathname === "/auth/github/callback" && request.method === "GET") return await finishGithubAuth(request, env);
      if (url.pathname === "/auth/session" && request.method === "POST") return await exchangeAuthSession(request, env);
      if (url.pathname === "/api/me" && request.method === "GET") return await getMe(request, env);
      if (url.pathname === "/api/me" && request.method === "DELETE") return await deleteMe(request, env);
      if (url.pathname === "/api/leaderboard" && request.method === "DELETE") return await leaveLeaderboard(request, env);
      if (url.pathname === "/api/tree" && request.method === "GET") return await getCloudTree(request, env);
      if (url.pathname === "/api/tree/delta" && request.method === "GET") return await getCloudTreeDelta(request, env);
      if (url.pathname === "/api/tree/events" && request.method === "POST") return await syncCloudTreeEvents(request, env);
      if (url.pathname === "/api/tree/achievements" && request.method === "POST") return await syncCloudTreeAchievements(request, env);
      if (url.pathname === "/api/usage/daily" && request.method === "POST") return await syncDailyUsage(request, env);
      if (url.pathname === "/api/social/groups" && request.method === "GET") return await listSocialGroups(request, env);
      if (url.pathname === "/api/social/groups" && request.method === "POST") return await createSocialGroup(request, env);
      if (url.pathname.startsWith("/api/social/")) return await handleSocialRoute(request, env);
      if (url.pathname === "/api/leaderboards" && request.method === "GET") return await getLeaderboards(request, env);
      if (url.pathname === "/api/leaderboard" && request.method === "GET") return await getLeaderboard(request, env);
      return json({ error: "Not found" }, env, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        if (shouldLogHttpError(error)) {
          ctx.waitUntil(logSecurityEvent(request, env, error.logType || statusLogType(error.status), {
            status: error.status,
            message: error.message,
            details: error.details,
            ...error.logDetails,
          }));
        }
        return json({ error: error.message, ...error.details }, env, error.status);
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      ctx.waitUntil(logSecurityEvent(request, env, "server_error", { status: 500, message }));
      return json({ error: message }, env, 500);
    }
  },
};

function corsHeaders(env: Env) {
  return {
    "Access-Control-Allow-Origin": env.APP_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
  };
}

function json(body: unknown, env: Env, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(env),
    },
  });
}

async function enforceRouteRateLimit(request: Request, env: Env, ctx: ExecutionContext) {
  const policy = rateLimitPolicy(request);
  if (!policy) return;

  const limiter = env[policy.name];
  if (!limiter) return;

  const key = `${policy.keyPrefix}:${clientIp(request)}`;
  const result = await limiter.limit({ key });
  if (result.success) return;

  ctx.waitUntil(logSecurityEvent(request, env, "rate_limited", {
    limiter: policy.name,
    keyPrefix: policy.keyPrefix,
    status: 429,
  }));
  throw new HttpError(429, "Too many requests. Please slow down and try again shortly.", {
    retryAfterSeconds: 60,
  }, "rate_limited");
}

function rateLimitPolicy(request: Request): { name: RateLimitName; keyPrefix: string } | undefined {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /api/leaderboard" || route === "GET /api/leaderboards") {
    return { name: "PUBLIC_READ_RATE_LIMITER", keyPrefix: "leaderboard:read" };
  }
  if (route === "GET /auth/github/start" || route === "GET /auth/github/callback") {
    return { name: "AUTH_RATE_LIMITER", keyPrefix: `auth:${url.pathname}` };
  }
  if (route === "POST /auth/session") {
    return { name: "AUTH_RATE_LIMITER", keyPrefix: "auth:/auth/session" };
  }
  if (
    route === "GET /api/me" ||
    route === "DELETE /api/me" ||
    route === "DELETE /api/leaderboard" ||
    route === "GET /api/tree" ||
    route === "POST /api/tree/events" ||
    route === "POST /api/tree/achievements" ||
    route === "POST /api/usage/daily"
  ) {
    return { name: "WRITE_RATE_LIMITER", keyPrefix: `api:${url.pathname}` };
  }
  if (url.pathname.startsWith("/api/social/")) {
    return { name: "WRITE_RATE_LIMITER", keyPrefix: "api:/api/social" };
  }

  return undefined;
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

function shouldLogHttpError(error: HttpError) {
  if (error.logType === "rate_limited") return false;
  if (error.logType === "sync_cooldown") return false;
  return Boolean(error.logType) || error.status === 401 || error.status === 429 || error.status >= 500;
}

function statusLogType(status: number): SecurityEventType {
  if (status === 401) return "auth_failed";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "invalid_payload";
}

async function logSecurityEvent(
  request: Request,
  env: Env,
  type: SecurityEventType,
  metadata: Record<string, unknown> = {},
) {
  const url = new URL(request.url);
  const now = new Date().toISOString();
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  const ipHash = await hashLogValue(clientIp(request), env);
  const userAgent = (request.headers.get("User-Agent") || "").slice(0, 180);
  const status = typeof metadata.status === "number" ? metadata.status : null;
  const actorId = typeof metadata.actorId === "string" ? metadata.actorId : null;
  const metadataJson = safeMetadataJson(metadata);

  const event = {
    event: "leaderboard_security",
    type,
    path: url.pathname,
    method: request.method,
    status,
    actorId,
    ipHash,
    country: cf?.country || null,
  };
  console.warn(JSON.stringify(event));

  if (type === "rate_limited") return;

  try {
    await env.DB.prepare(
      `INSERT INTO security_events
         (created_at, type, path, method, status, actor_id, ip_hash, country, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        now,
        type,
        url.pathname,
        request.method,
        status,
        actorId,
        ipHash,
        cf?.country || null,
        userAgent || null,
        metadataJson,
      )
      .run();
  } catch (error) {
    console.warn(JSON.stringify({
      event: "leaderboard_security_log_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }));
  }
}

async function hashLogValue(value: string, env: Env) {
  if (!value || value === "unknown") return null;
  return hmac(value, env.SESSION_SECRET || "vibe-tree").then((hash) => hash.slice(0, 32));
}

function safeMetadataJson(metadata: Record<string, unknown>) {
  try {
    return JSON.stringify(metadata).slice(0, 2000);
  } catch {
    return "{}";
  }
}

async function startGithubAuth(request: Request, env: Env) {
  assertConfigured(env);
  const url = new URL(request.url);
  const callback = url.searchParams.get("callback") || "";
  const state = url.searchParams.get("state") || "";
  const codeChallenge = url.searchParams.get("code_challenge") || "";
  if (!isLocalCallback(callback) || !state || !isPkceValue(codeChallenge)) {
    throw new HttpError(400, "Invalid callback", {}, "invalid_callback");
  }

  const redirectUri = new URL("/auth/github/callback", url.origin).toString();
  const signedState = await signState({ callback, state, codeChallenge, exp: Date.now() + 10 * 60 * 1000 }, env);
  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  github.searchParams.set("redirect_uri", redirectUri);
  github.searchParams.set("scope", "read:user");
  github.searchParams.set("state", signedState);
  return Response.redirect(github.toString(), 302);
}

async function finishGithubAuth(request: Request, env: Env) {
  assertConfigured(env);
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const signedState = url.searchParams.get("state") || "";
  const state = await verifyState(signedState, env);
  if (!code || !state) return redirectBack(state?.callback, state?.state, undefined, "GitHub login failed");
  if (state.exp < Date.now()) return redirectBack(state.callback, state.state, undefined, "GitHub login expired");

  const redirectUri = new URL("/auth/github/callback", url.origin).toString();
  const accessToken = await exchangeGithubCode(code, redirectUri, env);
  const githubUser = await fetchGithubUser(accessToken);
  const profile = {
    id: String(githubUser.id),
    username: githubUser.login,
    avatarUrl: githubUser.avatar_url || undefined,
  };
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (user_id, username, avatar_url, profile_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       username = excluded.username,
       avatar_url = excluded.avatar_url,
       profile_url = excluded.profile_url,
       updated_at = excluded.updated_at`,
  )
    .bind(profile.id, profile.username, profile.avatarUrl || null, githubUser.html_url || null, now, now)
    .run();

  const sessionCode = randomToken();
  const codeHash = await hashToken(sessionCode);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_codes WHERE expires_at <= ?").bind(now),
    env.DB.prepare(
      "INSERT INTO auth_codes (code_hash, user_id, code_challenge, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(codeHash, profile.id, state.codeChallenge, now, expiresAt),
  ]);

  return redirectBack(state.callback, state.state, sessionCode);
}

async function exchangeAuthSession(request: Request, env: Env) {
  assertConfigured(env);
  const body = await request.json().catch(() => undefined) as { code?: string; codeVerifier?: string } | undefined;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const codeVerifier = typeof body?.codeVerifier === "string" ? body.codeVerifier.trim() : "";
  if (!isPkceValue(code) || !isPkceValue(codeVerifier)) {
    throw new HttpError(400, "Invalid auth code", {}, "invalid_payload");
  }

  const now = new Date().toISOString();
  const codeHash = await hashToken(code);
  const codeChallenge = await codeChallengeForVerifier(codeVerifier);
  const consumed = await env.DB.prepare(
    `DELETE FROM auth_codes
     WHERE code_hash = ? AND code_challenge = ? AND expires_at > ?
     RETURNING user_id AS userId`,
  )
    .bind(codeHash, codeChallenge, now)
    .first<{ userId?: string }>();
  if (!consumed?.userId) {
    throw new HttpError(401, "Auth code expired or invalid", {}, "auth_failed");
  }

  const user = await env.DB.prepare(
    "SELECT user_id AS userId, username, avatar_url AS avatarUrl FROM users WHERE user_id = ?",
  )
    .bind(consumed.userId)
    .first<Record<string, unknown>>();
  if (!user) throw new HttpError(401, "Auth code user not found", {}, "auth_failed");

  const token = randomToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(tokenHash, String(user.userId), now, expiresAt)
    .run();

  return json({
    token,
    profile: toProfile({
      userId: String(user.userId),
      username: String(user.username),
      avatarUrl: typeof user.avatarUrl === "string" ? user.avatarUrl : undefined,
    }),
  }, env);
}

async function getMe(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  return json({ profile: toProfile(user) }, env);
}

async function deleteMe(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureUsagePreferencesTable(env);
  await ensureHourlyUsageTable(env);
  await ensureUsageVisibilityTable(env);
  await ensureUsageTotalsTable(env);
  await ensureCloudTreeTables(env);
  await ensureSocialTables(env);
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM social_group_join_requests
       WHERE requester_user_id = ?
          OR invited_by_user_id = ?
          OR resolved_by_user_id = ?
          OR group_id IN (SELECT group_id FROM social_groups WHERE owner_user_id = ?)`,
    ).bind(user.userId, user.userId, user.userId, user.userId),
    env.DB.prepare(
      `DELETE FROM social_group_invite_redemptions
       WHERE user_id = ?
          OR group_id IN (SELECT group_id FROM social_groups WHERE owner_user_id = ?)`,
    ).bind(user.userId, user.userId),
    env.DB.prepare(
      `DELETE FROM social_group_invites
       WHERE created_by_user_id = ?
          OR group_id IN (SELECT group_id FROM social_groups WHERE owner_user_id = ?)`,
    ).bind(user.userId, user.userId),
    env.DB.prepare(
      `DELETE FROM social_group_members
       WHERE user_id = ?
          OR group_id IN (SELECT group_id FROM social_groups WHERE owner_user_id = ?)`,
    ).bind(user.userId, user.userId),
    env.DB.prepare("DELETE FROM social_groups WHERE owner_user_id = ?").bind(user.userId),
    env.DB.prepare(
      "DELETE FROM social_friendships WHERE user_low = ? OR user_high = ? OR requester_user_id = ?",
    ).bind(user.userId, user.userId, user.userId),
    env.DB.prepare("DELETE FROM daily_usage WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM hourly_usage WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM tree_events WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM tree_achievements WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM tree_devices WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM tree_device_stats WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM tree_model_stats WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM usage_preferences WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM usage_visibility WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM usage_totals WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM sync_limits WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM auth_codes WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM security_events WHERE actor_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM users WHERE user_id = ?").bind(user.userId),
  ]);
  leaderboardCache.clear();
  return json({ ok: true }, env);
}

async function leaveLeaderboard(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureUsagePreferencesTable(env);
  await ensureUsageVisibilityTable(env);
  const now = new Date().toISOString();

  // Leaving the global board only hides the user from public global queries.
  // Usage rows stay intact so rejoining and group leaderboards keep continuity.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM usage_preferences WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM sync_limits WHERE user_id = ?").bind(user.userId),
    env.DB.prepare(
      `INSERT INTO usage_visibility (user_id, public_global, updated_at)
       VALUES (?, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         public_global = 0,
         updated_at = excluded.updated_at`,
    ).bind(user.userId, now),
  ]);
  leaderboardCache.clear();
  return json({ ok: true }, env);
}

async function handleSocialRoute(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/social/friends" && request.method === "GET") {
    return await listSocialFriends(request, env);
  }

  if (url.pathname === "/api/social/friends" && request.method === "POST") {
    return await requestSocialFriend(request, env);
  }

  if (url.pathname === "/api/social/profile-privacy" && request.method === "GET") {
    return await getSocialProfilePrivacy(request, env);
  }

  if (url.pathname === "/api/social/profile-privacy" && request.method === "POST") {
    return await updateSocialProfilePrivacy(request, env);
  }

  if (url.pathname === "/api/social/group-requests" && request.method === "GET") {
    return await listMySocialGroupRequests(request, env);
  }

  const myGroupRequestAcceptMatch = url.pathname.match(/^\/api\/social\/group-requests\/([^/]+)\/accept$/);
  if (myGroupRequestAcceptMatch && request.method === "POST") {
    return await acceptMySocialGroupRequest(request, env, decodeURIComponent(myGroupRequestAcceptMatch[1]));
  }

  const myGroupRequestDeclineMatch = url.pathname.match(/^\/api\/social\/group-requests\/([^/]+)\/decline$/);
  if (myGroupRequestDeclineMatch && request.method === "POST") {
    return await declineMySocialGroupRequest(request, env, decodeURIComponent(myGroupRequestDeclineMatch[1]));
  }

  const friendAcceptMatch = url.pathname.match(/^\/api\/social\/friends\/([^/]+)\/accept$/);
  if (friendAcceptMatch && request.method === "POST") {
    return await acceptSocialFriend(request, env, decodeURIComponent(friendAcceptMatch[1]));
  }

  const friendRemoveMatch = url.pathname.match(/^\/api\/social\/friends\/([^/]+)$/);
  if (friendRemoveMatch && request.method === "DELETE") {
    return await removeSocialFriend(request, env, decodeURIComponent(friendRemoveMatch[1]));
  }

  const groupMatch = url.pathname.match(/^\/api\/social\/groups\/([^/]+)$/);
  if (groupMatch && request.method === "GET") {
    return await getSocialGroup(request, env, decodeURIComponent(groupMatch[1]));
  }

  const inviteCreateMatch = url.pathname.match(/^\/api\/social\/groups\/([^/]+)\/invites$/);
  if (inviteCreateMatch && request.method === "POST") {
    return await createSocialGroupInvite(request, env, decodeURIComponent(inviteCreateMatch[1]));
  }

  const friendInviteCreateMatch = url.pathname.match(/^\/api\/social\/groups\/([^/]+)\/friend-invites$/);
  if (friendInviteCreateMatch && request.method === "POST") {
    return await createSocialGroupFriendInvite(request, env, decodeURIComponent(friendInviteCreateMatch[1]));
  }

  const groupRequestsMatch = url.pathname.match(/^\/api\/social\/groups\/([^/]+)\/requests$/);
  if (groupRequestsMatch && request.method === "GET") {
    return await listSocialGroupJoinRequests(request, env, decodeURIComponent(groupRequestsMatch[1]));
  }

  const groupRequestApproveMatch = url.pathname.match(/^\/api\/social\/groups\/([^/]+)\/requests\/([^/]+)\/approve$/);
  if (groupRequestApproveMatch && request.method === "POST") {
    return await approveSocialGroupJoinRequest(
      request,
      env,
      decodeURIComponent(groupRequestApproveMatch[1]),
      decodeURIComponent(groupRequestApproveMatch[2]),
    );
  }

  const groupRequestDeclineMatch = url.pathname.match(/^\/api\/social\/groups\/([^/]+)\/requests\/([^/]+)\/decline$/);
  if (groupRequestDeclineMatch && request.method === "POST") {
    return await declineSocialGroupJoinRequest(
      request,
      env,
      decodeURIComponent(groupRequestDeclineMatch[1]),
      decodeURIComponent(groupRequestDeclineMatch[2]),
    );
  }

  const leaveGroupMatch = url.pathname.match(/^\/api\/social\/groups\/([^/]+)\/members\/me$/);
  if (leaveGroupMatch && request.method === "DELETE") {
    return await leaveSocialGroup(request, env, decodeURIComponent(leaveGroupMatch[1]));
  }

  const membershipMatch = url.pathname.match(/^\/api\/social\/groups\/([^/]+)\/membership$/);
  if (membershipMatch && request.method === "POST") {
    return await setSocialGroupShareUsage(request, env, decodeURIComponent(membershipMatch[1]));
  }

  const groupLeaderboardMatch = url.pathname.match(/^\/api\/social\/groups\/([^/]+)\/leaderboard$/);
  if (groupLeaderboardMatch && request.method === "GET") {
    return await getSocialGroupLeaderboard(request, env, decodeURIComponent(groupLeaderboardMatch[1]));
  }

  const inviteAcceptMatch = url.pathname.match(/^\/api\/social\/invites\/([^/]+)\/accept$/);
  if (inviteAcceptMatch && request.method === "POST") {
    return await acceptSocialGroupInvite(request, env, decodeURIComponent(inviteAcceptMatch[1]));
  }

  const profileMatch = url.pathname.match(/^\/api\/social\/users\/([^/]+)\/profile$/);
  if (profileMatch && request.method === "GET") {
    return await getSocialProfile(request, env, decodeURIComponent(profileMatch[1]));
  }

  return json({ error: "Not found" }, env, 404);
}

async function listSocialFriends(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  return json(await socialFriendListPayload(user.userId, env), env);
}

async function requestSocialFriend(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  const body = await request.json().catch(() => undefined) as
    | { username?: unknown; userId?: unknown }
    | undefined;
  const target = await resolveSocialFriendTarget(body, user, env);
  const pair = orderedSocialUserPair(user.userId, target.userId);
  const now = new Date().toISOString();
  const existing = await socialFriendshipRow(pair.userLow, pair.userHigh, env);
  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO social_friendships
         (user_low, user_high, requester_user_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    ).bind(pair.userLow, pair.userHigh, user.userId, now, now).run();
    return json({ friend: await socialFriendPayload(target.userId, user.userId, env) }, env, 201);
  }

  const status = normalizeSocialFriendStatus(existing.status) ?? "pending";
  if (status === "pending" && String(existing.requesterUserId) !== user.userId) {
    await env.DB.prepare(
      `UPDATE social_friendships
       SET status = 'accepted', updated_at = ?
       WHERE user_low = ? AND user_high = ?`,
    ).bind(now, pair.userLow, pair.userHigh).run();
  }
  return json({ friend: await socialFriendPayload(target.userId, user.userId, env) }, env);
}

async function acceptSocialFriend(request: Request, env: Env, targetUserId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  const target = cleanShortText(targetUserId, 80);
  if (!target || target === user.userId) throw new HttpError(400, "Friend target is invalid.", {}, "invalid_payload");
  const pair = orderedSocialUserPair(user.userId, target);
  const existing = await socialFriendshipRow(pair.userLow, pair.userHigh, env);
  if (!existing) throw new HttpError(404, "Friend request not found.");
  const status = normalizeSocialFriendStatus(existing.status) ?? "pending";
  if (status === "pending" && String(existing.requesterUserId) === user.userId) {
    throw new HttpError(409, "Friend request is waiting for the other user.");
  }
  if (status !== "accepted") {
    await env.DB.prepare(
      `UPDATE social_friendships
       SET status = 'accepted', updated_at = ?
       WHERE user_low = ? AND user_high = ?`,
    ).bind(new Date().toISOString(), pair.userLow, pair.userHigh).run();
  }
  return json({ friend: await socialFriendPayload(target, user.userId, env) }, env);
}

async function removeSocialFriend(request: Request, env: Env, targetUserId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  const target = cleanShortText(targetUserId, 80);
  if (!target || target === user.userId) throw new HttpError(400, "Friend target is invalid.", {}, "invalid_payload");
  const pair = orderedSocialUserPair(user.userId, target);
  await env.DB.prepare("DELETE FROM social_friendships WHERE user_low = ? AND user_high = ?")
    .bind(pair.userLow, pair.userHigh)
    .run();
  return json(await socialFriendListPayload(user.userId, env), env);
}

async function listSocialGroups(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  const rows = await env.DB.prepare(
    `SELECT g.group_id AS groupId, g.name, g.description, g.icon_emoji AS iconEmoji,
            g.visibility, g.owner_user_id AS ownerUserId, g.created_at AS createdAt,
            g.updated_at AS updatedAt, m.role, m.share_usage AS shareUsage,
            COUNT(all_members.user_id) AS memberCount
     FROM social_group_members m
     JOIN social_groups g ON g.group_id = m.group_id
     LEFT JOIN social_group_members all_members ON all_members.group_id = g.group_id
     WHERE m.user_id = ?
     GROUP BY g.group_id
     ORDER BY m.joined_at DESC`,
  ).bind(user.userId).all<Record<string, unknown>>();
  return json({
    groups: (rows.results || []).map(socialGroupSummaryFromRow),
    updatedAt: new Date().toISOString(),
  }, env);
}

async function createSocialGroup(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  const body = await request.json().catch(() => undefined) as
    | { name?: unknown; description?: unknown; iconEmoji?: unknown; visibility?: unknown }
    | undefined;
  const name = cleanShortText(body?.name, 48);
  if (!name) throw new HttpError(400, "Group name is required.", {}, "invalid_payload");
  const description = cleanShortText(body?.description, 180) ?? null;
  const iconEmoji = normalizeGroupIcon(body?.iconEmoji);
  const visibility = normalizeSocialGroupVisibility(body?.visibility) ?? "invite";
  const groupId = `grp_${randomToken().slice(0, 18)}`;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO social_groups
         (group_id, name, description, icon_emoji, visibility, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(groupId, name, description, iconEmoji, visibility, user.userId, now, now),
    env.DB.prepare(
      `INSERT INTO social_group_members
         (group_id, user_id, role, share_usage, joined_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(groupId, user.userId, "leader", 1, now, now),
  ]);
  return json({ group: await socialGroupPayload(groupId, user.userId, env) }, env, 201);
}

async function getSocialGroup(request: Request, env: Env, groupId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  return json({ group: await requireSocialGroupPayload(groupId, user.userId, env) }, env);
}

async function createSocialGroupInvite(request: Request, env: Env, groupId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  const membership = await requireSocialGroupMembership(groupId, user.userId, env);
  if (membership.role !== "leader" && membership.role !== "officer") {
    throw new HttpError(403, "Only group leaders and officers can create invites.");
  }

  const body = await request.json().catch(() => undefined) as
    | { role?: unknown; maxUses?: unknown; expiresInDays?: unknown }
    | undefined;
  const role = normalizeSocialGroupRole(body?.role) ?? "member";
  if (role === "leader") throw new HttpError(400, "Invite role cannot be leader.", {}, "invalid_payload");
  const maxUses = normalizeInviteMaxUses(body?.maxUses);
  const expiresAt = inviteExpiresAt(body?.expiresInDays);
  const code = randomInviteCode();
  const codeHash = await hashToken(code);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO social_group_invites
       (invite_code_hash, group_id, created_by_user_id, role, max_uses, uses, expires_at, revoked_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`,
  ).bind(codeHash, groupId, user.userId, role, maxUses ?? null, expiresAt, now, now).run();
  return json({
    invite: {
      code,
      groupId,
      role,
      maxUses,
      uses: 0,
      expiresAt,
      createdAt: now,
    },
  }, env, 201);
}

async function createSocialGroupFriendInvite(request: Request, env: Env, groupId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  await requireSocialGroupManager(groupId, user.userId, env);
  const body = await request.json().catch(() => undefined) as
    | { userId?: unknown; role?: unknown }
    | undefined;
  const targetUserId = cleanShortText(body?.userId, 80);
  if (!targetUserId || targetUserId === user.userId) {
    throw new HttpError(400, "Friend invite target is invalid.", {}, "invalid_payload");
  }
  const target = await env.DB.prepare(
    "SELECT user_id AS userId FROM users WHERE user_id = ?",
  ).bind(targetUserId).first<{ userId?: string }>();
  if (!target?.userId) throw new HttpError(404, "User not found.");
  const role = normalizeSocialGroupRole(body?.role) ?? "member";
  if (role === "leader") throw new HttpError(400, "Invite role cannot be leader.", {}, "invalid_payload");
  const pair = orderedSocialUserPair(user.userId, targetUserId);
  const friendship = await socialFriendshipRow(pair.userLow, pair.userHigh, env);
  if (normalizeSocialFriendStatus(friendship?.status) !== "accepted") {
    throw new HttpError(403, "Only accepted friends can be invited directly.");
  }
  const existingMember = await socialGroupMembership(groupId, targetUserId, env);
  if (existingMember) throw new HttpError(409, "This friend is already in the group.");
  const existingRequest = await pendingSocialGroupJoinRequest(groupId, targetUserId, env);
  if (existingRequest) {
    return json({
      request: await socialGroupJoinRequestPayload(String(existingRequest.requestId), env),
      alreadyPending: true,
    }, env);
  }

  const now = new Date().toISOString();
  const requestId = `req_${randomToken().slice(0, 18)}`;
  await env.DB.prepare(
    `INSERT INTO social_group_join_requests
       (request_id, group_id, requester_user_id, invited_by_user_id, invite_code_hash,
        request_type, role, status, message, expires_at, created_at, updated_at, resolved_by_user_id, resolved_at)
     VALUES (?, ?, ?, ?, NULL, 'friend_invite', ?, 'pending', NULL, ?, ?, ?, NULL, NULL)`,
  ).bind(requestId, groupId, targetUserId, user.userId, role, null, now, now).run();
  return json({ request: await socialGroupJoinRequestPayload(requestId, env) }, env, 201);
}

async function listMySocialGroupRequests(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(
    `${socialGroupJoinRequestSelect()}
     WHERE r.requester_user_id = ?
       AND r.status = 'pending'
       AND (r.expires_at IS NULL OR r.expires_at > ?)
     ORDER BY r.updated_at DESC`,
  ).bind(user.userId, now).all<Record<string, unknown>>();
  const requests = (rows.results || []).map(socialGroupJoinRequestFromRow);
  return json({
    incomingInvites: requests.filter((item) => item.type === "friend_invite"),
    outgoingRequests: requests.filter((item) => item.type === "invite_code"),
    updatedAt: now,
  }, env);
}

async function acceptMySocialGroupRequest(request: Request, env: Env, requestId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  const targetRequestId = cleanShortText(requestId, 80);
  if (!targetRequestId) throw new HttpError(400, "Group invite request is invalid.", {}, "invalid_payload");
  const row = await pendingSocialGroupJoinRequestById(targetRequestId, env);
  if (!row || String(row.requesterUserId) !== user.userId) throw new HttpError(404, "Group invite request not found.");
  if (normalizeSocialGroupJoinRequestType(row.type) !== "friend_invite") {
    throw new HttpError(403, "Invite-code requests must be approved by the group.");
  }
  const groupId = String(row.groupId);
  const now = new Date().toISOString();
  const role = normalizeSocialGroupRole(row.role) === "officer" ? "officer" : "member";
  await env.DB.batch([
    socialGroupMemberInsertFromJoinRequest(groupId, user.userId, role, now, env),
    env.DB.prepare(
      `UPDATE social_group_join_requests
       SET status = 'approved', updated_at = ?, resolved_by_user_id = ?, resolved_at = ?
       WHERE request_id = ? AND status = 'pending'`,
    ).bind(now, user.userId, now, targetRequestId),
  ]);
  return json({
    group: await requireSocialGroupPayload(groupId, user.userId, env),
    request: await socialGroupJoinRequestPayload(targetRequestId, env),
  }, env);
}

async function declineMySocialGroupRequest(request: Request, env: Env, requestId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  const targetRequestId = cleanShortText(requestId, 80);
  if (!targetRequestId) throw new HttpError(400, "Group invite request is invalid.", {}, "invalid_payload");
  const row = await pendingSocialGroupJoinRequestById(targetRequestId, env);
  if (!row || String(row.requesterUserId) !== user.userId) throw new HttpError(404, "Group invite request not found.");
  const status: SocialGroupJoinRequestStatus =
    normalizeSocialGroupJoinRequestType(row.type) === "invite_code" ? "cancelled" : "declined";
  await resolveSocialGroupJoinRequest(row, status, user.userId, env);
  return json({ request: await socialGroupJoinRequestPayload(targetRequestId, env) }, env);
}

async function listSocialGroupJoinRequests(request: Request, env: Env, groupId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  await requireSocialGroupManager(groupId, user.userId, env);
  return json(await socialGroupModerationPayload(groupId, env), env);
}

async function approveSocialGroupJoinRequest(request: Request, env: Env, groupId: string, requestId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  await requireSocialGroupManager(groupId, user.userId, env);
  const targetRequestId = cleanShortText(requestId, 80);
  if (!targetRequestId) throw new HttpError(400, "Group join request is invalid.", {}, "invalid_payload");
  const row = await pendingSocialGroupJoinRequestById(targetRequestId, env);
  if (!row || String(row.groupId) !== groupId) throw new HttpError(404, "Group join request not found.");
  if (normalizeSocialGroupJoinRequestType(row.type) !== "invite_code") {
    throw new HttpError(409, "Friend invites must be accepted by the invited user.");
  }
  const requesterUserId = String(row.requesterUserId);
  const now = new Date().toISOString();
  const role = normalizeSocialGroupRole(row.role) === "officer" ? "officer" : "member";
  await env.DB.batch([
    socialGroupMemberInsertFromJoinRequest(groupId, requesterUserId, role, now, env),
    env.DB.prepare(
      `UPDATE social_group_join_requests
       SET status = 'approved', updated_at = ?, resolved_by_user_id = ?, resolved_at = ?
       WHERE request_id = ? AND status = 'pending'`,
    ).bind(now, user.userId, now, targetRequestId),
  ]);
  return json({
    group: await requireSocialGroupPayload(groupId, user.userId, env),
    request: await socialGroupJoinRequestPayload(targetRequestId, env),
  }, env);
}

async function declineSocialGroupJoinRequest(request: Request, env: Env, groupId: string, requestId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  await requireSocialGroupManager(groupId, user.userId, env);
  const targetRequestId = cleanShortText(requestId, 80);
  if (!targetRequestId) throw new HttpError(400, "Group join request is invalid.", {}, "invalid_payload");
  const row = await pendingSocialGroupJoinRequestById(targetRequestId, env);
  if (!row || String(row.groupId) !== groupId) throw new HttpError(404, "Group join request not found.");
  await resolveSocialGroupJoinRequest(row, "declined", user.userId, env);
  return json({ request: await socialGroupJoinRequestPayload(targetRequestId, env) }, env);
}

async function leaveSocialGroup(request: Request, env: Env, groupId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  await requireSocialGroupMembership(groupId, user.userId, env);
  const group = await env.DB.prepare(
    "SELECT owner_user_id AS ownerUserId FROM social_groups WHERE group_id = ?",
  ).bind(groupId).first<{ ownerUserId?: string }>();
  if (group && String(group.ownerUserId) === user.userId) {
    throw new HttpError(409, "Group owners must delete the group instead of leaving.");
  }
  await env.DB.prepare("DELETE FROM social_group_members WHERE group_id = ? AND user_id = ?")
    .bind(groupId, user.userId)
    .run();
  return json({ ok: true }, env);
}

async function setSocialGroupShareUsage(request: Request, env: Env, groupId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  await requireSocialGroupMembership(groupId, user.userId, env);
  const body = await request.json().catch(() => undefined) as { shareUsage?: unknown } | undefined;
  const shareUsage = body?.shareUsage === true ? 1 : 0;
  await env.DB.prepare(
    "UPDATE social_group_members SET share_usage = ?, updated_at = ? WHERE group_id = ? AND user_id = ?",
  ).bind(shareUsage, new Date().toISOString(), groupId, user.userId).run();
  return json({ group: await requireSocialGroupPayload(groupId, user.userId, env) }, env);
}

async function getSocialProfilePrivacy(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  return json({ privacy: await socialProfilePrivacyForUser(user.userId, env) }, env);
}

async function updateSocialProfilePrivacy(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  const current = await socialProfilePrivacyForUser(user.userId, env);
  const body = await request.json().catch(() => undefined) as Partial<SocialProfilePrivacy> | undefined;
  const next: SocialProfilePrivacy = {
    profileVisibility: normalizeSocialProfileVisibility(body?.profileVisibility) ?? current.profileVisibility,
    showLevel: typeof body?.showLevel === "boolean" ? body.showLevel : current.showLevel,
    showTokenTotal: typeof body?.showTokenTotal === "boolean" ? body.showTokenTotal : current.showTokenTotal,
    showActiveDays: typeof body?.showActiveDays === "boolean" ? body.showActiveDays : current.showActiveDays,
    showAchievements: typeof body?.showAchievements === "boolean" ? body.showAchievements : current.showAchievements,
    updatedAt: new Date().toISOString(),
  };
  await env.DB.prepare(
    `INSERT INTO social_profile_privacy
       (user_id, profile_visibility, show_level, show_token_total, show_active_days, show_achievements, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       profile_visibility = excluded.profile_visibility,
       show_level = excluded.show_level,
       show_token_total = excluded.show_token_total,
       show_active_days = excluded.show_active_days,
       show_achievements = excluded.show_achievements,
       updated_at = excluded.updated_at`,
  ).bind(
    user.userId,
    next.profileVisibility,
    next.showLevel ? 1 : 0,
    next.showTokenTotal ? 1 : 0,
    next.showActiveDays ? 1 : 0,
    next.showAchievements ? 1 : 0,
    next.updatedAt,
  ).run();
  return json({ privacy: next }, env);
}

async function getSocialProfile(request: Request, env: Env, targetUserId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  const target = cleanShortText(targetUserId, 80);
  if (!target) throw new HttpError(400, "Profile target is invalid.", {}, "invalid_payload");

  const isSelf = target === user.userId;
  const targetRow = await env.DB.prepare(
    "SELECT user_id AS userId, username, avatar_url AS avatarUrl, created_at AS createdAt FROM users WHERE user_id = ?",
  ).bind(target).first<Record<string, unknown>>();
  // A 404 on a missing user is indistinguishable from a 404 on "no relationship",
  // so a stranger's existence is never revealed.
  if (!targetRow) throw new HttpError(404, "Profile not found.");

  // Access gate: only self, accepted friends, or co-members may open the card.
  let isFriend = false;
  if (!isSelf) {
    const pair = orderedSocialUserPair(user.userId, target);
    const friendship = await socialFriendshipRow(pair.userLow, pair.userHigh, env);
    isFriend = normalizeSocialFriendStatus(friendship?.status) === "accepted";
  }
  const mutualGroupRow = isSelf
    ? undefined
    : await env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM social_group_members a
         JOIN social_group_members b ON b.group_id = a.group_id AND b.user_id = ?
         WHERE a.user_id = ?`,
      ).bind(target, user.userId).first<{ count?: number }>();
  const mutualGroupCount = numberOrZero(mutualGroupRow?.count);
  const privacy = await socialProfilePrivacyForUser(target, env);
  const canOpenProfile =
    isSelf ||
    (privacy.profileVisibility === "relations" && (isFriend || mutualGroupCount > 0)) ||
    (privacy.profileVisibility === "friends" && isFriend);
  if (!canOpenProfile) {
    throw new HttpError(404, "Profile not found.");
  }

  // Usage visibility honors the same consent signals the leaderboards use:
  // self, opted into the global board, or sharing usage in a group we both belong to.
  let usageVisible = isSelf;
  if (!usageVisible) {
    await ensureUsageVisibilityTable(env);
    const visibilityRow = await env.DB.prepare(
      "SELECT public_global AS publicGlobal FROM usage_visibility WHERE user_id = ?",
    ).bind(target).first<{ publicGlobal?: number }>();
    const publicGlobal = visibilityRow ? numberOrZero(visibilityRow.publicGlobal) > 0 : true;
    if (publicGlobal) {
      usageVisible = true;
    } else {
      const sharedRow = await env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM social_group_members viewer_member
         JOIN social_group_members target_member
           ON target_member.group_id = viewer_member.group_id
          AND target_member.user_id = ?
          AND target_member.share_usage > 0
         WHERE viewer_member.user_id = ?`,
      ).bind(target, user.userId).first<{ count?: number }>();
      usageVisible = numberOrZero(sharedRow?.count) > 0;
    }
  }

  const friendCountRow = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM social_friendships WHERE (user_low = ? OR user_high = ?) AND status = 'accepted'",
  ).bind(target, target).first<{ count?: number }>();
  const groupCountRow = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM social_group_members WHERE user_id = ?",
  ).bind(target).first<{ count?: number }>();

  const profile: Record<string, unknown> = {
    id: String(targetRow.userId),
    username: String(targetRow.username),
    avatarUrl: typeof targetRow.avatarUrl === "string" ? targetRow.avatarUrl : undefined,
    joinedAt: typeof targetRow.createdAt === "string" ? targetRow.createdAt : undefined,
    isSelf,
    isFriend,
    mutualGroupCount,
    friendCount: numberOrZero(friendCountRow?.count),
    groupCount: numberOrZero(groupCountRow?.count),
  };

  const levelVisible = usageVisible && (isSelf || privacy.showLevel);
  const tokenTotalVisible = usageVisible && (isSelf || privacy.showTokenTotal);
  const activeDaysVisible = usageVisible && (isSelf || privacy.showActiveDays);
  const achievementsVisible = usageVisible && (isSelf || privacy.showAchievements);
  profile.usageVisible = levelVisible || tokenTotalVisible || activeDaysVisible || achievementsVisible;
  profile.levelVisible = levelVisible;
  profile.tokenTotalVisible = tokenTotalVisible;
  profile.activeDaysVisible = activeDaysVisible;
  profile.achievementsVisible = achievementsVisible;

  if (usageVisible) {
    const usageTotals = await usageTotalsForUser(target, env);
    const totalTokens = usageTotals.tokens;
    if (levelVisible) profile.level = levelForProfileTokens(totalTokens);
    if (tokenTotalVisible) profile.totalTokens = totalTokens;
    if (activeDaysVisible) profile.daysActive = usageTotals.daysActive;

    if (achievementsVisible) {
      await ensureCloudTreeTables(env);
      const achievementRows = await env.DB.prepare(
        "SELECT achievement_id AS id, unlocked_at AS unlockedAt FROM tree_achievements WHERE user_id = ? ORDER BY unlocked_at ASC",
      ).bind(target).all<Record<string, unknown>>();
      profile.achievements = (achievementRows.results || []).map((row) => ({
        id: String(row.id),
        unlockedAt: typeof row.unlockedAt === "string" ? row.unlockedAt : undefined,
      }));
    }
  }

  return json({ profile }, env);
}

async function acceptSocialGroupInvite(request: Request, env: Env, code: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  const inviteCode = cleanInviteCode(code);
  if (!inviteCode) throw new HttpError(400, "Invite code is invalid.", {}, "invalid_payload");
  const now = new Date().toISOString();
  const codeHash = await hashToken(inviteCode);
  const invite = await env.DB.prepare(
    `SELECT invite_code_hash AS inviteCodeHash, group_id AS groupId, role, max_uses AS maxUses,
            uses, expires_at AS expiresAt, revoked_at AS revokedAt
     FROM social_group_invites
     WHERE invite_code_hash = ?`,
  ).bind(codeHash).first<Record<string, unknown>>();
  if (!invite) throw new HttpError(404, "Invite not found.");
  if (typeof invite.revokedAt === "string") throw new HttpError(410, "Invite has been revoked.");
  if (typeof invite.expiresAt === "string" && invite.expiresAt <= now) throw new HttpError(410, "Invite has expired.");
  const maxUses = optionalPositiveInteger(invite.maxUses);
  const uses = positiveInteger(invite.uses) ?? 0;
  if (maxUses !== undefined && uses >= maxUses) throw new HttpError(410, "Invite has been used up.");

  const groupId = String(invite.groupId);
  const existing = await socialGroupMembership(groupId, user.userId, env);
  if (existing) {
    return json({
      group: await requireSocialGroupPayload(groupId, user.userId, env),
      alreadyMember: true,
    }, env);
  }

  const existingRequest = await pendingSocialGroupJoinRequest(groupId, user.userId, env);
  if (existingRequest) {
    return json({
      request: await socialGroupJoinRequestPayload(String(existingRequest.requestId), env),
      alreadyPending: true,
    }, env);
  }

  const redemption = await env.DB.prepare(
    `INSERT OR IGNORE INTO social_group_invite_redemptions
       (invite_code_hash, user_id, group_id, created_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(codeHash, user.userId, groupId, now).run();
  if (!redemption.meta.changes) throw new HttpError(409, "Invite request was already submitted.");

  // Reserve an invite use while the approval request is pending. If the request
  // is declined or cancelled, the reservation is released.
  const claim = await env.DB.prepare(
    `UPDATE social_group_invites
     SET uses = uses + 1, updated_at = ?
     WHERE invite_code_hash = ?
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)
       AND (max_uses IS NULL OR uses < max_uses)`,
  ).bind(now, codeHash, now).run();
  if (!claim.meta.changes) {
    await env.DB.prepare(
      "DELETE FROM social_group_invite_redemptions WHERE invite_code_hash = ? AND user_id = ?",
    ).bind(codeHash, user.userId).run();
    throw new HttpError(410, "Invite has been used up.");
  }

  const role = normalizeSocialGroupRole(invite.role);
  const requestId = `req_${randomToken().slice(0, 18)}`;
  try {
    await env.DB.prepare(
      `INSERT INTO social_group_join_requests
         (request_id, group_id, requester_user_id, invited_by_user_id, invite_code_hash,
          request_type, role, status, message, expires_at, created_at, updated_at, resolved_by_user_id, resolved_at)
       VALUES (?, ?, ?, NULL, ?, 'invite_code', ?, 'pending', NULL, NULL, ?, ?, NULL, NULL)`,
    ).bind(requestId, groupId, user.userId, codeHash, role === "officer" ? "officer" : "member", now, now).run();
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM social_group_invite_redemptions WHERE invite_code_hash = ? AND user_id = ?",
      ).bind(codeHash, user.userId),
      env.DB.prepare(
        `UPDATE social_group_invites
         SET uses = CASE WHEN uses > 0 THEN uses - 1 ELSE 0 END, updated_at = ?
         WHERE invite_code_hash = ?`,
      ).bind(now, codeHash),
    ]);
    throw error;
  }

  return json({ request: await socialGroupJoinRequestPayload(requestId, env) }, env, 202);
}

async function getSocialGroupLeaderboard(request: Request, env: Env, groupId: string) {
  const user = await requireAuth(request, env);
  await ensureSocialTables(env);
  await ensureUsagePreferencesTable(env);
  await ensureHourlyUsageTable(env);
  await requireSocialGroupMembership(groupId, user.userId, env);
  const url = new URL(request.url);
  const range = normalizeRange(url.searchParams.get("range"));
  const basis = normalizeSocialGroupLeaderboardBasis(url.searchParams.get("basis"));
  return json(await socialGroupLeaderboardDataForRange(groupId, range, basis, user, env, new Date().toISOString()), env);
}

async function getCloudTree(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureCloudTreeTables(env);
  return json(await cloudTreePayload(user.userId, env), env);
}

async function getCloudTreeDelta(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureCloudTreeTables(env);
  const url = new URL(request.url);
  const since = normalizeSyncCursor(url.searchParams.get("since"));
  if (!since) throw new HttpError(400, "A valid since cursor is required.", {}, "invalid_payload");
  return json(await cloudTreePayload(user.userId, env, since), env);
}

async function cloudTreePayload(userId: string, env: Env, since?: string) {
  const cursor = new Date().toISOString();
  const eventQuery = since
    ? `SELECT event_id AS id, device_id AS deviceId, created_at AS createdAt, source,
              tokens, input_tokens AS inputTokens, output_tokens AS outputTokens,
              cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens
       FROM tree_events
       WHERE user_id = ? AND updated_at > ? AND updated_at <= ?
       ORDER BY updated_at ASC, event_id ASC`
    : `SELECT event_id AS id, device_id AS deviceId, created_at AS createdAt, source,
              tokens, input_tokens AS inputTokens, output_tokens AS outputTokens,
              cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens
       FROM tree_events
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50000`;
  const achievementQuery = since
    ? `SELECT achievement_id AS id, unlocked_at AS unlockedAt
       FROM tree_achievements
       WHERE user_id = ? AND updated_at > ? AND updated_at <= ?
       ORDER BY updated_at ASC, achievement_id ASC`
    : `SELECT achievement_id AS id, unlocked_at AS unlockedAt
       FROM tree_achievements
       WHERE user_id = ?
       ORDER BY unlocked_at ASC`;
  const modelStatQuery = since
    ? `SELECT device_id AS deviceId, date, source, model, tokens,
              input_tokens AS inputTokens, output_tokens AS outputTokens,
              cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens
       FROM tree_model_stats
       WHERE user_id = ? AND updated_at > ? AND updated_at <= ?
       ORDER BY updated_at ASC, date ASC, source ASC, model ASC
       LIMIT 5000`
    : `SELECT device_id AS deviceId, date, source, model, tokens,
              input_tokens AS inputTokens, output_tokens AS outputTokens,
              cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens
       FROM tree_model_stats
       WHERE user_id = ?
       ORDER BY date ASC, source ASC, model ASC
       LIMIT 5000`;
  const [eventRows, achievementRows, deviceRows, deviceTotalRows, modelStatRows] = await Promise.all([
    env.DB.prepare(
      eventQuery,
    ).bind(...(since ? [userId, since, cursor] : [userId])).all<Record<string, unknown>>(),
    env.DB.prepare(
      achievementQuery,
    ).bind(...(since ? [userId, since, cursor] : [userId])).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT device_id AS deviceId, alias, platform, last_synced_at AS lastSyncedAt,
              app_version AS appVersion
       FROM tree_devices
       WHERE user_id = ?`,
    ).bind(userId).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT device_id AS deviceId, entry_count AS entryCount, tokens, last_event_updated_at AS lastSyncedAt
       FROM tree_device_stats
       WHERE user_id = ?`,
    ).bind(userId).all<Record<string, unknown>>(),
    env.DB.prepare(
      modelStatQuery,
    ).bind(...(since ? [userId, since, cursor] : [userId])).all<Record<string, unknown>>(),
  ]);
  const entries = (eventRows.results || []).map((row) => ({
    id: String(row.id),
    deviceId: typeof row.deviceId === "string" ? row.deviceId : undefined,
    createdAt: String(row.createdAt),
    source: normalizeTreeEventSource(row.source, row.id),
    tokens: numberOrZero(row.tokens),
    inputTokens: optionalNumber(row.inputTokens),
    outputTokens: optionalNumber(row.outputTokens),
    cacheReadTokens: optionalNumber(row.cacheReadTokens),
    cacheWriteTokens: optionalNumber(row.cacheWriteTokens),
  }));
  const achievements = (achievementRows.results || []).map((row) => ({
    id: String(row.id),
    unlockedAt: String(row.unlockedAt),
  }));
  const deviceMeta = new Map(
    (deviceRows.results || []).map((row) => [
      String(row.deviceId),
      {
        alias: typeof row.alias === "string" ? row.alias : undefined,
        platform: typeof row.platform === "string" ? row.platform : undefined,
        lastSyncedAt: typeof row.lastSyncedAt === "string" ? row.lastSyncedAt : undefined,
        appVersion: typeof row.appVersion === "string" ? row.appVersion : undefined,
      },
    ]),
  );
  const deviceIds = new Set<string>([
    ...[...deviceMeta.keys()],
    ...(deviceTotalRows.results || [])
      .map((row) => (typeof row.deviceId === "string" ? row.deviceId : undefined))
      .filter((deviceId): deviceId is string => Boolean(deviceId)),
  ]);
  const deviceTotals = new Map(
    (deviceTotalRows.results || []).map((row) => [
      String(row.deviceId),
      {
        entryCount: numberOrZero(row.entryCount),
        tokens: numberOrZero(row.tokens),
        lastSyncedAt: typeof row.lastSyncedAt === "string" ? row.lastSyncedAt : undefined,
      },
    ]),
  );
  const devices = [...deviceIds]
    .map((deviceId) => {
      const meta = deviceMeta.get(deviceId);
      const totals = deviceTotals.get(deviceId);
      return {
        deviceId,
        alias: meta?.alias,
        platform: meta?.platform,
        lastSyncedAt: meta?.lastSyncedAt ?? totals?.lastSyncedAt,
        appVersion: meta?.appVersion,
        entryCount: totals?.entryCount ?? 0,
        tokens: totals?.tokens ?? 0,
      };
    })
    .sort((left, right) => right.tokens - left.tokens);
  const modelStats = (modelStatRows.results || []).map((row) => ({
    deviceId: String(row.deviceId),
    date: String(row.date),
    source: normalizeTreeEventSource(row.source),
    model: String(row.model),
    tokens: numberOrZero(row.tokens),
    inputTokens: optionalNumber(row.inputTokens),
    outputTokens: optionalNumber(row.outputTokens),
    cacheReadTokens: optionalNumber(row.cacheReadTokens),
    cacheWriteTokens: optionalNumber(row.cacheWriteTokens),
  }));
  return {
    entries,
    achievements,
    devices,
    modelStats,
    cursor,
    delta: Boolean(since),
    modelStatsFull: !since,
    devicesFull: true,
    summary: {
      hasRemoteTree: entries.length > 0 || achievements.length > 0 || devices.length > 0 || modelStats.length > 0,
      entryCount: entries.length,
      achievementCount: achievements.length,
      deviceCount: devices.length,
      modelStatCount: modelStats.length,
    },
  };
}

async function syncCloudTreeEvents(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureCloudTreeTables(env);
  const body = await request.json().catch(() => undefined) as
    | {
        deviceId?: string;
        device?: unknown;
        entries?: unknown[];
        modelStats?: unknown[];
        modelStatsEnabled?: boolean;
        appVersion?: string;
      }
    | undefined;
  const deviceId = cleanShortText(body?.deviceId, 80);
  if (!deviceId) throw new HttpError(400, "Device id is required.", {}, "invalid_payload");
  const appVersion = cleanShortText(body?.appVersion, 32) ?? null;
  const entries = Array.isArray(body?.entries) ? body.entries.slice(0, 500) : [];
  const now = new Date().toISOString();
  const eventStatements = entries.map((raw) => normalizeCloudTreeEvent(raw, user.userId, deviceId, appVersion, now, env)).filter(Boolean);
  const eventDeviceIds = new Set(
    entries
      .map((raw) => cleanShortText((raw as Record<string, unknown> | undefined)?.deviceId, 80) ?? deviceId)
      .filter((id): id is string => Boolean(id)),
  );
  const modelStats = normalizeCloudModelStatStatements(body, user.userId, deviceId, now, env);
  const statements = [
    upsertCloudTreeDevice(user.userId, deviceId, body?.device, appVersion, now, env),
    ...eventStatements,
    ...modelStats.statements,
  ];
  if (statements.length) {
    await env.DB.batch(statements as D1PreparedStatement[]);
    if (eventStatements.length) await dedupeCloudTreeEventsForUser(user.userId, env);
    if (eventStatements.length) await refreshCloudDeviceStats(user.userId, [...eventDeviceIds], env);
  }
  return json({ ok: true, synced: eventStatements.length, syncedModelStats: modelStats.count }, env);
}

async function syncCloudTreeAchievements(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureCloudTreeTables(env);
  const body = await request.json().catch(() => undefined) as
    | { achievements?: unknown[]; appVersion?: string }
    | undefined;
  const appVersion = cleanShortText(body?.appVersion, 32) ?? null;
  const achievements = Array.isArray(body?.achievements) ? body.achievements.slice(0, 500) : [];
  const now = new Date().toISOString();
  const statements = achievements
    .map((raw) => normalizeCloudTreeAchievement(raw, user.userId, appVersion, now, env))
    .filter(Boolean);
  if (statements.length) await env.DB.batch(statements as D1PreparedStatement[]);
  return json({ ok: true, synced: statements.length }, env);
}

async function syncDailyUsage(request: Request, env: Env) {
  const user = await requireAuth(request, env);

  const body = await request.json().catch(() => undefined) as
    | {
        days?: Array<{ date?: string; tokens?: number; xp?: number }>;
        hours?: Array<{ hourStartUtc?: string; hourStart?: string; tokens?: number; xp?: number }>;
        totalTokens?: number;
        totalXp?: number;
        totalDaysActive?: number;
        firstUsageDate?: string;
        appVersion?: string;
        usageStartDate?: string;
        forceSync?: boolean;
        usagePublic?: boolean;
        usagePreferencesPublic?: boolean;
        usagePreferences?: unknown[];
      }
    | undefined;
  if (body?.forceSync !== true) await enforceSyncCooldown(user.userId, env);
  const days = Array.isArray(body?.days) ? body.days.slice(0, MAX_BACKFILL_DAYS) : [];
  const hasHourlyUsage = Array.isArray(body?.hours);
  const hours = hasHourlyUsage ? body.hours?.slice(0, MAX_HOURLY_BACKFILL_HOURS + 2) ?? [] : [];
  const appVersion = typeof body?.appVersion === "string" ? body.appVersion.slice(0, 32) : null;
  const usageStartDate = normalizeUsageStartDate(body?.usageStartDate);
  const usagePublic = body?.usagePublic !== false;
  const usagePreferencesPublic = body?.usagePreferencesPublic === true;
  const usagePreferenceInput = Array.isArray(body?.usagePreferences) ? body.usagePreferences : [];
  const now = new Date().toISOString();
  const syncWindow = dailySyncWindow(usageStartDate);
  const hourWindow = hourlySyncWindow(new Date());
  const normalizedDays = normalizeDailyUsageRows(days, syncWindow);
  const normalizedHours = hasHourlyUsage ? normalizeHourlyUsageRows(hours, hourWindow) : [];
  const totalTokens = normalizeTokenCount(body?.totalXp ?? body?.totalTokens);
  const totalDaysActive = normalizeActiveDays(body?.totalDaysActive);
  const firstUsageDate = normalizeUsageStartDate(body?.firstUsageDate ?? body?.usageStartDate);
  const preferenceRows = usagePreferencesPublic ? normalizeUsagePreferenceRows(usagePreferenceInput) : [];
  const statements = normalizedDays.map((day) =>
    env.DB.prepare(
      `INSERT INTO daily_usage (user_id, date, xp, app_version, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET
         xp = excluded.xp,
         app_version = excluded.app_version,
         updated_at = excluded.updated_at`,
    ).bind(user.userId, day.date, day.xp, appVersion, now),
  );
  const hourlyStatements = normalizedHours.map((hour) =>
    env.DB.prepare(
      `INSERT INTO hourly_usage (user_id, hour_start_utc, tokens, app_version, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, hour_start_utc) DO UPDATE SET
         tokens = excluded.tokens,
         app_version = excluded.app_version,
         updated_at = excluded.updated_at`,
    ).bind(user.userId, hour.hourStartUtc, hour.tokens, appVersion, now),
  );
  const preferenceStatements = preferenceRows.map((preference) =>
    env.DB.prepare(
      `INSERT INTO usage_preferences (
         user_id, range, favorite_agent_label, favorite_agent_percent, favorite_model,
         favorite_period, favorite_period_start, favorite_period_end, peak_tokens_per_minute, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, range) DO UPDATE SET
         favorite_agent_label = excluded.favorite_agent_label,
         favorite_agent_percent = excluded.favorite_agent_percent,
         favorite_model = excluded.favorite_model,
         favorite_period = excluded.favorite_period,
         favorite_period_start = excluded.favorite_period_start,
         favorite_period_end = excluded.favorite_period_end,
         peak_tokens_per_minute = excluded.peak_tokens_per_minute,
         updated_at = excluded.updated_at`,
    ).bind(
      user.userId,
      preference.range,
      preference.favoriteAgentLabel ?? null,
      preference.favoriteAgentPercent ?? null,
      preference.favoriteModel ?? null,
      preference.favoritePeriod ?? null,
      preference.favoritePeriodStart ?? null,
      preference.favoritePeriodEnd ?? null,
      preference.peakTokensPerMinute ?? null,
      now,
    ),
  );

  await ensureUsagePreferencesTable(env);
  await ensureHourlyUsageTable(env);
  await ensureUsageVisibilityTable(env);
  await ensureUsageTotalsTable(env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM daily_usage WHERE user_id = ? AND date >= ? AND date <= ?")
      .bind(user.userId, syncWindow.earliest, syncWindow.latest),
    ...(hasHourlyUsage
      ? [
          env.DB.prepare("DELETE FROM hourly_usage WHERE user_id = ? AND hour_start_utc >= ? AND hour_start_utc <= ?")
            .bind(user.userId, hourWindow.earliest, hourWindow.latest),
          env.DB.prepare("DELETE FROM hourly_usage WHERE user_id = ? AND hour_start_utc < ?")
            .bind(user.userId, hourWindow.earliest),
        ]
      : []),
    ...(usageStartDate
      ? [env.DB.prepare("DELETE FROM daily_usage WHERE user_id = ? AND date < ?").bind(user.userId, usageStartDate)]
      : []),
    env.DB.prepare("DELETE FROM usage_preferences WHERE user_id = ?").bind(user.userId),
    ...statements,
    ...hourlyStatements,
    ...(totalTokens !== undefined
      ? [
          env.DB.prepare(
            `INSERT INTO usage_totals (user_id, tokens, days_active, first_usage_date, app_version, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               tokens = excluded.tokens,
               days_active = excluded.days_active,
               first_usage_date = excluded.first_usage_date,
               app_version = excluded.app_version,
               updated_at = excluded.updated_at`,
          ).bind(user.userId, totalTokens, totalDaysActive ?? 0, firstUsageDate ?? null, appVersion, now),
        ]
      : []),
    ...preferenceStatements,
    env.DB.prepare(
      `INSERT INTO sync_limits (user_id, last_synced_at)
       VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
    ).bind(user.userId, now),
    env.DB.prepare(
      `INSERT INTO usage_visibility (user_id, public_global, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         public_global = excluded.public_global,
         updated_at = excluded.updated_at`,
    ).bind(user.userId, usagePublic ? 1 : 0, now),
  ]);
  leaderboardCache.clear();
  return json(
    {
      ok: true,
      synced: statements.length,
      syncedHours: hourlyStatements.length,
      syncedPreferences: preferenceStatements.length,
      syncedTotals: totalTokens !== undefined ? 1 : 0,
      leaderboardType: "community",
      usageStartDate,
      safetyMaxDailyTokens: MAX_DAILY_ACCEPTED_TOKENS,
      nextSyncAfterSeconds: SYNC_COOLDOWN_SECONDS,
    },
    env,
  );
}

async function enforceSyncCooldown(userId: string, env: Env) {
  const row = await env.DB.prepare("SELECT last_synced_at AS lastSyncedAt FROM sync_limits WHERE user_id = ?")
    .bind(userId)
    .first<{ lastSyncedAt?: string }>();
  if (!row?.lastSyncedAt) return;

  const elapsedSeconds = Math.floor((Date.now() - Date.parse(row.lastSyncedAt)) / 1000);
  const retryAfterSeconds = SYNC_COOLDOWN_SECONDS - elapsedSeconds;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    throw new HttpError(
      429,
      `Sync is limited to once every ${SYNC_COOLDOWN_SECONDS} seconds. Try again in ${Math.ceil(retryAfterSeconds)} seconds.`,
      {
        retryAfterSeconds,
      },
      "sync_cooldown",
      { actorId: userId },
    );
  }
}

async function ensureUsagePreferencesTable(env: Env) {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS usage_preferences (
        user_id TEXT NOT NULL,
        range TEXT NOT NULL,
        favorite_agent_label TEXT,
        favorite_agent_percent INTEGER,
        favorite_model TEXT,
        favorite_period TEXT,
        favorite_period_start INTEGER,
        favorite_period_end INTEGER,
        peak_tokens_per_minute INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, range),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_usage_preferences_user ON usage_preferences(user_id)"),
  ]);
}

async function ensureHourlyUsageTable(env: Env) {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS hourly_usage (
        user_id TEXT NOT NULL,
        hour_start_utc TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        app_version TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, hour_start_utc),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_hourly_usage_hour ON hourly_usage(hour_start_utc)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_hourly_usage_user ON hourly_usage(user_id)"),
  ]);
}

async function ensureUsageVisibilityTable(env: Env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS usage_visibility (
      user_id TEXT PRIMARY KEY,
      public_global INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )`,
  ).run();
}

async function ensureUsageTotalsTable(env: Env) {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS usage_totals (
        user_id TEXT PRIMARY KEY,
        tokens INTEGER NOT NULL DEFAULT 0,
        days_active INTEGER NOT NULL DEFAULT 0,
        first_usage_date TEXT,
        app_version TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_usage_totals_tokens ON usage_totals(tokens)"),
  ]);
}

async function ensureCloudTreeTables(env: Env) {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS tree_events (
        user_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        device_id TEXT,
        created_at TEXT NOT NULL,
        source TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        app_version TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, event_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS tree_achievements (
        user_id TEXT NOT NULL,
        achievement_id TEXT NOT NULL,
        unlocked_at TEXT NOT NULL,
        app_version TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, achievement_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS tree_devices (
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        alias TEXT,
        platform TEXT,
        first_seen_at TEXT NOT NULL,
        last_synced_at TEXT NOT NULL,
        app_version TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, device_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS tree_device_stats (
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        entry_count INTEGER NOT NULL,
        tokens INTEGER NOT NULL,
        last_event_updated_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, device_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS tree_model_stats (
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        date TEXT NOT NULL,
        source TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, device_id, date, source, model),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tree_events_user_created ON tree_events(user_id, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tree_events_device ON tree_events(user_id, device_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tree_events_user_updated ON tree_events(user_id, updated_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tree_achievements_user ON tree_achievements(user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tree_achievements_user_updated ON tree_achievements(user_id, updated_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tree_devices_user ON tree_devices(user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tree_devices_user_updated ON tree_devices(user_id, updated_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tree_device_stats_user ON tree_device_stats(user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tree_device_stats_user_updated ON tree_device_stats(user_id, updated_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tree_model_stats_user ON tree_model_stats(user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tree_model_stats_device ON tree_model_stats(user_id, device_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tree_model_stats_user_updated ON tree_model_stats(user_id, updated_at)"),
  ]);
}

async function ensureSocialTables(env: Env) {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS social_friendships (
        user_low TEXT NOT NULL,
        user_high TEXT NOT NULL,
        requester_user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_low, user_high),
        FOREIGN KEY (user_low) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (user_high) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (requester_user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS social_groups (
        group_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        icon_emoji TEXT,
        visibility TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS social_group_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        share_usage INTEGER NOT NULL DEFAULT 1,
        joined_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (group_id, user_id),
        FOREIGN KEY (group_id) REFERENCES social_groups(group_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS social_group_invites (
        invite_code_hash TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        created_by_user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        max_uses INTEGER,
        uses INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (group_id) REFERENCES social_groups(group_id) ON DELETE CASCADE,
        FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS social_group_invite_redemptions (
        invite_code_hash TEXT NOT NULL,
        user_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (invite_code_hash, user_id),
        FOREIGN KEY (invite_code_hash) REFERENCES social_group_invites(invite_code_hash) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES social_groups(group_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS social_group_join_requests (
        request_id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        requester_user_id TEXT NOT NULL,
        invited_by_user_id TEXT,
        invite_code_hash TEXT,
        request_type TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_by_user_id TEXT,
        resolved_at TEXT,
        FOREIGN KEY (group_id) REFERENCES social_groups(group_id) ON DELETE CASCADE,
        FOREIGN KEY (requester_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (invited_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
        FOREIGN KEY (invite_code_hash) REFERENCES social_group_invites(invite_code_hash) ON DELETE SET NULL,
        FOREIGN KEY (resolved_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS social_profile_privacy (
        user_id TEXT PRIMARY KEY,
        profile_visibility TEXT NOT NULL DEFAULT 'relations',
        show_level INTEGER NOT NULL DEFAULT 1,
        show_token_total INTEGER NOT NULL DEFAULT 1,
        show_active_days INTEGER NOT NULL DEFAULT 1,
        show_achievements INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_friendships_requester ON social_friendships(requester_user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_friendships_status ON social_friendships(status)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_friendships_user_high ON social_friendships(user_high)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_groups_owner ON social_groups(owner_user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_group_members_user ON social_group_members(user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_group_members_group_role ON social_group_members(group_id, role)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_group_invites_group ON social_group_invites(group_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_group_invites_creator ON social_group_invites(created_by_user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_group_invites_expires ON social_group_invites(expires_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_group_invite_redemptions_user ON social_group_invite_redemptions(user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_group_join_requests_group_status ON social_group_join_requests(group_id, status)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_group_join_requests_requester_status ON social_group_join_requests(requester_user_id, status)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_social_group_join_requests_inviter ON social_group_join_requests(invited_by_user_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_social_group_join_requests_pending_user ON social_group_join_requests(group_id, requester_user_id) WHERE status = 'pending'"),
  ]);
}

async function socialFriendListPayload(userId: string, env: Env) {
  const rows = await env.DB.prepare(
    `SELECT f.user_low AS userLow, f.user_high AS userHigh, f.requester_user_id AS requesterUserId,
            f.status, f.created_at AS createdAt, f.updated_at AS updatedAt,
            u.user_id AS userId, u.username, u.avatar_url AS avatarUrl
     FROM social_friendships f
     JOIN users u ON u.user_id = CASE WHEN f.user_low = ? THEN f.user_high ELSE f.user_low END
     WHERE f.user_low = ? OR f.user_high = ?
     ORDER BY
       CASE f.status WHEN 'accepted' THEN 0 ELSE 1 END,
       f.updated_at DESC`,
  ).bind(userId, userId, userId).all<Record<string, unknown>>();
  return {
    friends: (rows.results || []).map((row) => socialFriendFromRow(row, userId)),
    updatedAt: new Date().toISOString(),
  };
}

async function socialFriendPayload(targetUserId: string, currentUserId: string, env: Env) {
  const pair = orderedSocialUserPair(targetUserId, currentUserId);
  const row = await env.DB.prepare(
    `SELECT f.user_low AS userLow, f.user_high AS userHigh, f.requester_user_id AS requesterUserId,
            f.status, f.created_at AS createdAt, f.updated_at AS updatedAt,
            u.user_id AS userId, u.username, u.avatar_url AS avatarUrl
     FROM social_friendships f
     JOIN users u ON u.user_id = ?
     WHERE f.user_low = ? AND f.user_high = ?`,
  ).bind(targetUserId, pair.userLow, pair.userHigh).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "Friend request not found.");
  return socialFriendFromRow(row, currentUserId);
}

function socialFriendFromRow(row: Record<string, unknown>, currentUserId: string) {
  const status = normalizeSocialFriendStatus(row.status) ?? "pending";
  const requestedByMe = String(row.requesterUserId) === currentUserId;
  return {
    userId: String(row.userId),
    username: String(row.username),
    avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : undefined,
    status,
    direction: status === "pending" ? (requestedByMe ? "outgoing" : "incoming") : undefined,
    requestedByMe,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

async function socialFriendshipRow(userLow: string, userHigh: string, env: Env) {
  return await env.DB.prepare(
    `SELECT user_low AS userLow, user_high AS userHigh, requester_user_id AS requesterUserId,
            status, created_at AS createdAt, updated_at AS updatedAt
     FROM social_friendships
     WHERE user_low = ? AND user_high = ?`,
  ).bind(userLow, userHigh).first<Record<string, unknown>>();
}

async function resolveSocialFriendTarget(
  body: { username?: unknown; userId?: unknown } | undefined,
  user: SessionUser,
  env: Env,
) {
  const userId = cleanShortText(body?.userId, 80);
  const username = cleanShortText(body?.username, 80);
  if (!userId && !username) throw new HttpError(400, "Friend username is required.", {}, "invalid_payload");
  const target = userId
    ? await env.DB.prepare(
        `SELECT user_id AS userId, username, avatar_url AS avatarUrl
         FROM users
         WHERE user_id = ?`,
      ).bind(userId).first<Record<string, unknown>>()
    : await env.DB.prepare(
        `SELECT user_id AS userId, username, avatar_url AS avatarUrl
         FROM users
         WHERE lower(username) = lower(?)
         ORDER BY updated_at DESC
         LIMIT 1`,
      ).bind(username).first<Record<string, unknown>>();
  if (!target) throw new HttpError(404, "User not found.");
  if (String(target.userId) === user.userId) throw new HttpError(400, "You cannot add yourself.", {}, "invalid_payload");
  return {
    userId: String(target.userId),
    username: String(target.username),
    avatarUrl: typeof target.avatarUrl === "string" ? target.avatarUrl : undefined,
  };
}

function orderedSocialUserPair(firstUserId: string, secondUserId: string) {
  return firstUserId < secondUserId
    ? { userLow: firstUserId, userHigh: secondUserId }
    : { userLow: secondUserId, userHigh: firstUserId };
}

async function requireSocialGroupPayload(groupId: string, userId: string, env: Env) {
  await requireSocialGroupMembership(groupId, userId, env);
  return await socialGroupPayload(groupId, userId, env);
}

async function socialGroupPayload(groupId: string, userId: string, env: Env) {
  const group = await env.DB.prepare(
    `SELECT g.group_id AS groupId, g.name, g.description, g.icon_emoji AS iconEmoji,
            g.visibility, g.owner_user_id AS ownerUserId, g.created_at AS createdAt,
            g.updated_at AS updatedAt, m.role, m.share_usage AS shareUsage,
            COUNT(all_members.user_id) AS memberCount
     FROM social_groups g
     JOIN social_group_members m ON m.group_id = g.group_id AND m.user_id = ?
     LEFT JOIN social_group_members all_members ON all_members.group_id = g.group_id
     WHERE g.group_id = ?
     GROUP BY g.group_id`,
  ).bind(userId, groupId).first<Record<string, unknown>>();
  if (!group) throw new HttpError(404, "Group not found.");

  const members = await env.DB.prepare(
    `SELECT u.user_id AS userId, u.username, u.avatar_url AS avatarUrl,
            m.role, m.share_usage AS shareUsage, m.joined_at AS joinedAt, m.updated_at AS updatedAt
     FROM social_group_members m
     JOIN users u ON u.user_id = m.user_id
     WHERE m.group_id = ?
     ORDER BY
       CASE m.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,
       m.joined_at ASC`,
  ).bind(groupId).all<Record<string, unknown>>();

  return {
    ...socialGroupSummaryFromRow(group),
    members: (members.results || []).map(socialGroupMemberFromRow),
  };
}

async function requireSocialGroupMembership(groupId: string, userId: string, env: Env) {
  const membership = await socialGroupMembership(groupId, userId, env);
  if (!membership) throw new HttpError(404, "Group not found.");
  return membership;
}

async function socialGroupMembership(groupId: string, userId: string, env: Env) {
  const row = await env.DB.prepare(
    `SELECT role, share_usage AS shareUsage, joined_at AS joinedAt, updated_at AS updatedAt
     FROM social_group_members
     WHERE group_id = ? AND user_id = ?`,
  ).bind(groupId, userId).first<Record<string, unknown>>();
  if (!row) return undefined;
  return {
    role: normalizeSocialGroupRole(row.role) ?? "member",
    shareUsage: numberOrZero(row.shareUsage) > 0,
    joinedAt: typeof row.joinedAt === "string" ? row.joinedAt : undefined,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
  };
}

async function requireSocialGroupManager(groupId: string, userId: string, env: Env) {
  const membership = await requireSocialGroupMembership(groupId, userId, env);
  if (membership.role !== "leader" && membership.role !== "officer") {
    throw new HttpError(403, "Only group leaders and officers can manage join requests.");
  }
  return membership;
}

function socialGroupMemberInsertFromJoinRequest(
  groupId: string,
  userId: string,
  role: Exclude<SocialGroupRole, "leader">,
  now: string,
  env: Env,
) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO social_group_members
       (group_id, user_id, role, share_usage, joined_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).bind(groupId, userId, role, now, now);
}

function socialGroupJoinRequestSelect() {
  return `SELECT r.request_id AS requestId, r.group_id AS groupId, g.name AS groupName,
                 g.icon_emoji AS groupIconEmoji, r.request_type AS type, r.status, r.role,
                 r.requester_user_id AS requesterUserId, requester.username AS requesterUsername,
                 requester.avatar_url AS requesterAvatarUrl,
                 r.invited_by_user_id AS invitedByUserId, inviter.username AS invitedByUsername,
                 inviter.avatar_url AS invitedByAvatarUrl,
                 r.invite_code_hash AS inviteCodeHash, r.expires_at AS expiresAt,
                 r.created_at AS createdAt, r.updated_at AS updatedAt
          FROM social_group_join_requests r
          JOIN social_groups g ON g.group_id = r.group_id
          JOIN users requester ON requester.user_id = r.requester_user_id
          LEFT JOIN users inviter ON inviter.user_id = r.invited_by_user_id`;
}

async function socialGroupJoinRequestPayload(requestId: string, env: Env) {
  const row = await env.DB.prepare(
    `${socialGroupJoinRequestSelect()}
     WHERE r.request_id = ?`,
  ).bind(requestId).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "Group join request not found.");
  return socialGroupJoinRequestFromRow(row);
}

async function pendingSocialGroupJoinRequest(groupId: string, requesterUserId: string, env: Env) {
  return await env.DB.prepare(
    `SELECT request_id AS requestId
     FROM social_group_join_requests
     WHERE group_id = ? AND requester_user_id = ? AND status = 'pending'
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).bind(groupId, requesterUserId).first<Record<string, unknown>>();
}

async function pendingSocialGroupJoinRequestById(requestId: string, env: Env) {
  return await env.DB.prepare(
    `${socialGroupJoinRequestSelect()}
     WHERE r.request_id = ? AND r.status = 'pending'`,
  ).bind(requestId).first<Record<string, unknown>>();
}

async function socialGroupModerationPayload(groupId: string, env: Env) {
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(
    `${socialGroupJoinRequestSelect()}
     WHERE r.group_id = ? AND r.status = 'pending'
     ORDER BY r.updated_at DESC`,
  ).bind(groupId).all<Record<string, unknown>>();
  return {
    requests: (rows.results || []).map(socialGroupJoinRequestFromRow),
    updatedAt: now,
  };
}

async function resolveSocialGroupJoinRequest(
  row: Record<string, unknown>,
  status: SocialGroupJoinRequestStatus,
  resolvedByUserId: string,
  env: Env,
) {
  const requestId = String(row.requestId);
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `UPDATE social_group_join_requests
       SET status = ?, updated_at = ?, resolved_by_user_id = ?, resolved_at = ?
       WHERE request_id = ? AND status = 'pending'`,
    ).bind(status, now, resolvedByUserId, now, requestId),
  ];
  if (status !== "approved") statements.push(...releaseJoinRequestInviteReservation(row, now, env));
  await env.DB.batch(statements);
}

function releaseJoinRequestInviteReservation(row: Record<string, unknown>, now: string, env: Env) {
  const type = normalizeSocialGroupJoinRequestType(row.type);
  const inviteCodeHash = typeof row.inviteCodeHash === "string" ? row.inviteCodeHash : undefined;
  const requesterUserId = cleanShortText(row.requesterUserId, 80);
  if (type !== "invite_code" || !inviteCodeHash || !requesterUserId) return [];
  return [
    env.DB.prepare(
      `UPDATE social_group_invites
       SET uses = CASE WHEN uses > 0 THEN uses - 1 ELSE 0 END, updated_at = ?
       WHERE invite_code_hash = ?
         AND EXISTS (
           SELECT 1 FROM social_group_invite_redemptions
           WHERE invite_code_hash = ? AND user_id = ?
         )`,
    ).bind(now, inviteCodeHash, inviteCodeHash, requesterUserId),
    env.DB.prepare(
      "DELETE FROM social_group_invite_redemptions WHERE invite_code_hash = ? AND user_id = ?",
    ).bind(inviteCodeHash, requesterUserId),
  ];
}

function socialGroupJoinRequestFromRow(row: Record<string, unknown>) {
  return {
    requestId: String(row.requestId),
    groupId: String(row.groupId),
    groupName: String(row.groupName),
    groupIconEmoji: typeof row.groupIconEmoji === "string" ? row.groupIconEmoji : undefined,
    type: normalizeSocialGroupJoinRequestType(row.type) ?? "invite_code",
    status: normalizeSocialGroupJoinRequestStatus(row.status) ?? "pending",
    role: normalizeSocialGroupRole(row.role) === "officer" ? "officer" : "member",
    requesterUserId: String(row.requesterUserId),
    requesterUsername: String(row.requesterUsername),
    requesterAvatarUrl: typeof row.requesterAvatarUrl === "string" ? row.requesterAvatarUrl : undefined,
    invitedByUserId: typeof row.invitedByUserId === "string" ? row.invitedByUserId : undefined,
    invitedByUsername: typeof row.invitedByUsername === "string" ? row.invitedByUsername : undefined,
    invitedByAvatarUrl: typeof row.invitedByAvatarUrl === "string" ? row.invitedByAvatarUrl : undefined,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
    expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : undefined,
  };
}

async function socialProfilePrivacyForUser(userId: string, env: Env): Promise<SocialProfilePrivacy> {
  const row = await env.DB.prepare(
    `SELECT profile_visibility AS profileVisibility, show_level AS showLevel,
            show_token_total AS showTokenTotal, show_active_days AS showActiveDays,
            show_achievements AS showAchievements, updated_at AS updatedAt
     FROM social_profile_privacy WHERE user_id = ?`,
  ).bind(userId).first<Record<string, unknown>>();
  return socialProfilePrivacyFromRow(row);
}

function socialProfilePrivacyFromRow(row: Record<string, unknown> | null | undefined): SocialProfilePrivacy {
  return {
    profileVisibility: normalizeSocialProfileVisibility(row?.profileVisibility) ?? "relations",
    showLevel: row?.showLevel === undefined ? true : numberOrZero(row.showLevel) > 0,
    showTokenTotal: row?.showTokenTotal === undefined ? true : numberOrZero(row.showTokenTotal) > 0,
    showActiveDays: row?.showActiveDays === undefined ? true : numberOrZero(row.showActiveDays) > 0,
    showAchievements: row?.showAchievements === undefined ? true : numberOrZero(row.showAchievements) > 0,
    updatedAt: typeof row?.updatedAt === "string" ? row.updatedAt : undefined,
  };
}

function normalizeSocialProfileVisibility(value: unknown): SocialProfileVisibility | undefined {
  return value === "relations" || value === "friends" || value === "private" ? value : undefined;
}

function levelForProfileTokens(totalXp: number) {
  let level = 1;
  let remaining = Math.max(0, Math.round(totalXp));
  let needed = Math.round(PROFILE_LEVEL_BASE * level ** PROFILE_LEVEL_EXPONENT);
  while (remaining >= needed && level < PROFILE_MAX_LEVEL) {
    remaining -= needed;
    level += 1;
    needed = Math.round(PROFILE_LEVEL_BASE * level ** PROFILE_LEVEL_EXPONENT);
  }
  return level;
}

async function usageTotalsForUser(userId: string, env: Env): Promise<UsageTotals> {
  await ensureUsageTotalsTable(env);
  const row = await env.DB.prepare(
    `WITH daily_totals AS (
       SELECT user_id, COALESCE(SUM(xp), 0) AS tokens,
              COALESCE(SUM(CASE WHEN xp > 0 THEN 1 ELSE 0 END), 0) AS daysActive
       FROM daily_usage
       WHERE user_id = ?
       GROUP BY user_id
     )
     SELECT COALESCE(t.tokens, d.tokens, 0) AS tokens,
            COALESCE(t.days_active, d.daysActive, 0) AS daysActive
     FROM (SELECT ? AS user_id) base
     LEFT JOIN usage_totals t ON t.user_id = base.user_id
     LEFT JOIN daily_totals d ON d.user_id = base.user_id`,
  ).bind(userId, userId).first<{ tokens?: number; daysActive?: number }>();
  return {
    tokens: numberOrZero(row?.tokens),
    daysActive: normalizeActiveDays(row?.daysActive) ?? 0,
  };
}

function socialGroupSummaryFromRow(row: Record<string, unknown>) {
  const group: SocialGroupRow = {
    groupId: String(row.groupId),
    name: String(row.name),
    description: typeof row.description === "string" ? row.description : undefined,
    iconEmoji: typeof row.iconEmoji === "string" ? row.iconEmoji : undefined,
    visibility: normalizeSocialGroupVisibility(row.visibility) ?? "invite",
    ownerUserId: String(row.ownerUserId),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    memberCount: numberOrZero(row.memberCount),
    role: normalizeSocialGroupRole(row.role),
    shareUsage: numberOrZero(row.shareUsage),
  };
  return {
    groupId: group.groupId,
    name: group.name,
    description: group.description,
    iconEmoji: group.iconEmoji,
    visibility: group.visibility,
    ownerUserId: group.ownerUserId,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    memberCount: group.memberCount ?? 0,
    role: group.role,
    shareUsage: (group.shareUsage ?? 0) > 0,
  };
}

function socialGroupMemberFromRow(row: Record<string, unknown>) {
  const member: SocialGroupMemberRow = {
    userId: String(row.userId),
    username: String(row.username),
    avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : undefined,
    role: normalizeSocialGroupRole(row.role) ?? "member",
    shareUsage: numberOrZero(row.shareUsage),
    joinedAt: String(row.joinedAt),
    updatedAt: String(row.updatedAt),
  };
  return {
    userId: member.userId,
    username: member.username,
    avatarUrl: member.avatarUrl,
    role: member.role,
    shareUsage: member.shareUsage > 0,
    joinedAt: member.joinedAt,
    updatedAt: member.updatedAt,
  };
}

function normalizeSocialFriendStatus(value: unknown): SocialFriendStatus | undefined {
  return value === "pending" || value === "accepted" ? value : undefined;
}

async function socialGroupLeaderboardDataForRange(
  groupId: string,
  range: LeaderboardRange,
  basis: SocialGroupLeaderboardBasis,
  requestUser: SessionUser,
  env: Env,
  updatedAt: string,
) {
  let result: D1Result<Record<string, unknown>>;
  const sinceJoin = basis === "since_join";
  const dailyJoinedAtFilter = sinceJoin ? " AND d.date >= date(m.joined_at)" : "";
  const hourlyJoinedAtFilter = sinceJoin ? " AND h.hour_start_utc >= date(m.joined_at)" : "";
  const allDaysJoinedAtFilter = sinceJoin ? " AND all_days.date >= date(m.joined_at)" : "";
  if (range === "all") {
    // Group boards are private-scope leaderboards: membership and share_usage gate
    // visibility. Total uses the compact lifetime aggregate; since_join uses
    // dated rows so it can apply the membership floor.
    if (!sinceJoin) {
      await ensureUsageTotalsTable(env);
      result = await env.DB.prepare(
        `WITH daily_totals AS (
           SELECT user_id, COALESCE(SUM(xp), 0) AS tokens,
                  COALESCE(SUM(CASE WHEN xp > 0 THEN 1 ELSE 0 END), 0) AS daysActive
           FROM daily_usage
           GROUP BY user_id
         ),
         combined_totals AS (
           SELECT user_id, tokens, days_active AS daysActive FROM usage_totals
           UNION ALL
           SELECT d.user_id, d.tokens, d.daysActive
           FROM daily_totals d
           WHERE NOT EXISTS (SELECT 1 FROM usage_totals t WHERE t.user_id = d.user_id)
         )
         SELECT u.user_id AS userId, u.username AS username, u.avatar_url AS avatarUrl,
                m.role, c.tokens AS tokens, c.daysActive AS daysActive
         FROM social_group_members m
         JOIN combined_totals c ON c.user_id = m.user_id
         JOIN users u ON u.user_id = m.user_id
         WHERE m.group_id = ? AND m.share_usage > 0 AND c.tokens > 0
         ORDER BY c.tokens DESC
         LIMIT 100`,
      ).bind(groupId).all<Record<string, unknown>>();
    } else {
      result = await env.DB.prepare(
        `SELECT u.user_id AS userId, u.username AS username, u.avatar_url AS avatarUrl,
                m.role, SUM(d.xp) AS tokens,
                (SELECT COUNT(*) FROM daily_usage all_days
                 WHERE all_days.user_id = u.user_id AND all_days.xp > 0${allDaysJoinedAtFilter}) AS daysActive
         FROM social_group_members m
         JOIN users u ON u.user_id = m.user_id
         JOIN daily_usage d ON d.user_id = m.user_id${dailyJoinedAtFilter}
         WHERE m.group_id = ? AND m.share_usage > 0
         GROUP BY u.user_id
         HAVING tokens > 0
         ORDER BY tokens DESC
         LIMIT 100`,
      ).bind(groupId).all<Record<string, unknown>>();
    }
  } else if (range === "24h") {
    const hourWindow = rollingLeaderboardHourWindow(new Date());
    const currentWindow = currentLocalDateWindow(new Date());
    const legacyUpdatedAfter = addUtcHours(floorUtcHour(new Date()), -LEGACY_DAILY_FALLBACK_HOURS).toISOString();
    result = await env.DB.prepare(
      `WITH hourly_any AS (
         SELECT DISTINCT user_id FROM hourly_usage
       ),
       hourly_totals AS (
         SELECT h.user_id, SUM(h.tokens) AS tokens
         FROM hourly_usage h
         JOIN social_group_members m ON m.user_id = h.user_id
         WHERE m.group_id = ? AND m.share_usage > 0
           AND h.hour_start_utc >= ? AND h.hour_start_utc <= ?
           ${hourlyJoinedAtFilter}
         GROUP BY h.user_id
       ),
       legacy_current_date AS (
         SELECT d.user_id, MAX(d.date) AS currentDate
         FROM daily_usage d
         JOIN social_group_members m ON m.user_id = d.user_id
         LEFT JOIN hourly_any h ON h.user_id = d.user_id
         WHERE m.group_id = ? AND m.share_usage > 0
           AND h.user_id IS NULL
           AND d.date >= ? AND d.date <= ?
           ${dailyJoinedAtFilter}
           AND d.updated_at >= ?
         GROUP BY d.user_id
       ),
       legacy_daily AS (
         SELECT c.user_id, SUM(d.xp) AS tokens
         FROM legacy_current_date c
         JOIN daily_usage d ON d.user_id = c.user_id AND d.date = c.currentDate
         GROUP BY c.user_id
       ),
       range_totals AS (
         SELECT user_id, tokens FROM hourly_totals
         UNION ALL
         SELECT user_id, tokens FROM legacy_daily
       )
       SELECT u.user_id AS userId, u.username AS username, u.avatar_url AS avatarUrl,
              m.role, SUM(r.tokens) AS tokens,
              (SELECT COUNT(*) FROM daily_usage all_days
               WHERE all_days.user_id = u.user_id AND all_days.xp > 0${allDaysJoinedAtFilter}) AS daysActive
       FROM range_totals r
       JOIN social_group_members m ON m.user_id = r.user_id AND m.group_id = ?
       JOIN users u ON u.user_id = r.user_id
       GROUP BY u.user_id
       HAVING tokens > 0
       ORDER BY tokens DESC
       LIMIT 100`,
    ).bind(
      groupId,
      hourWindow.earliest,
      hourWindow.latest,
      groupId,
      currentWindow.earliest,
      currentWindow.latest,
      legacyUpdatedAfter,
      groupId,
    ).all<Record<string, unknown>>();
  } else {
    const currentWindow = currentLocalDateWindow(new Date());
    result = await env.DB.prepare(
      `SELECT u.user_id AS userId, u.username AS username, u.avatar_url AS avatarUrl,
              m.role, SUM(d.xp) AS tokens,
              (SELECT COUNT(*) FROM daily_usage all_days
               WHERE all_days.user_id = u.user_id AND all_days.xp > 0${allDaysJoinedAtFilter}) AS daysActive
       FROM social_group_members m
       JOIN daily_usage d ON d.user_id = m.user_id${dailyJoinedAtFilter}
       JOIN users u ON u.user_id = m.user_id
       WHERE m.group_id = ? AND m.share_usage > 0
         AND d.date >= date(?, ?) AND d.date <= ?
       GROUP BY u.user_id
       HAVING tokens > 0
       ORDER BY tokens DESC
       LIMIT 100`,
    ).bind(groupId, currentWindow.latest, rangeDateModifier(range), currentWindow.latest).all<Record<string, unknown>>();
  }

  const entries = (result.results || []).map((row, index) => ({
    rank: index + 1,
    userId: String(row.userId),
    username: String(row.username),
    avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : undefined,
    role: normalizeSocialGroupRole(row.role) ?? "member",
    tokens: Math.max(0, Math.round(Number(row.tokens))),
    xp: Math.max(0, Math.round(Number(row.tokens))),
    daysActive: Math.max(0, Math.round(Number(row.daysActive))),
  }));
  return {
    groupId,
    range,
    basis,
    entries,
    updatedAt,
    me: entries.find((entry) => entry.userId === requestUser.userId),
  };
}

function normalizeCloudTreeEvent(
  raw: unknown,
  userId: string,
  fallbackDeviceId: string,
  appVersion: string | null,
  now: string,
  env: Env,
) {
  const input = raw as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object") return undefined;
  const eventId = cleanShortText(input.id, 160);
  const createdAt = typeof input.createdAt === "string" && Number.isFinite(Date.parse(input.createdAt))
    ? input.createdAt
    : "";
  const source = normalizeTreeEventSource(input.source, eventId);
  const tokens = normalizeTokenCount(input.tokens);
  if (!eventId || !createdAt || !source || tokens === undefined) return undefined;
  return env.DB.prepare(
    `INSERT INTO tree_events (
       user_id, event_id, device_id, created_at, source, tokens,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, app_version, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, event_id) DO UPDATE SET
       device_id = excluded.device_id,
       created_at = excluded.created_at,
       source = excluded.source,
       tokens = excluded.tokens,
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       cache_read_tokens = excluded.cache_read_tokens,
       cache_write_tokens = excluded.cache_write_tokens,
       app_version = excluded.app_version,
       updated_at = excluded.updated_at`,
  ).bind(
    userId,
    eventId,
    cleanShortText(input.deviceId, 80) ?? fallbackDeviceId,
    createdAt,
    source,
    tokens,
    normalizeTokenCount(input.inputTokens) ?? null,
    normalizeTokenCount(input.outputTokens) ?? null,
    normalizeTokenCount(input.cacheReadTokens) ?? null,
    normalizeTokenCount(input.cacheWriteTokens) ?? null,
    appVersion,
    now,
  );
}

function upsertCloudTreeDevice(
  userId: string,
  deviceId: string,
  rawDevice: unknown,
  appVersion: string | null,
  now: string,
  env: Env,
) {
  const input = rawDevice as Record<string, unknown> | undefined;
  const alias = cleanShortText(input?.alias, 64) ?? null;
  const platform = normalizeDevicePlatform(input?.platform) ?? null;
  return env.DB.prepare(
    `INSERT INTO tree_devices (
       user_id, device_id, alias, platform, first_seen_at, last_synced_at, app_version, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, device_id) DO UPDATE SET
       alias = COALESCE(excluded.alias, tree_devices.alias),
       platform = COALESCE(excluded.platform, tree_devices.platform),
       last_synced_at = excluded.last_synced_at,
       app_version = COALESCE(excluded.app_version, tree_devices.app_version),
       updated_at = excluded.updated_at`,
  ).bind(userId, deviceId, alias, platform, now, now, appVersion, now);
}

async function refreshCloudDeviceStats(userId: string, deviceIds: string[], env: Env) {
  const uniqueDeviceIds = [...new Set(deviceIds)].filter(Boolean);
  if (!uniqueDeviceIds.length) return;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const deviceId of uniqueDeviceIds) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO tree_device_stats (user_id, device_id, entry_count, tokens, last_event_updated_at, updated_at)
         SELECT ?, ?, COUNT(*), COALESCE(SUM(tokens), 0), MAX(updated_at), ?
         FROM tree_events
         WHERE user_id = ? AND device_id = ?
         ON CONFLICT(user_id, device_id) DO UPDATE SET
           entry_count = excluded.entry_count,
           tokens = excluded.tokens,
           last_event_updated_at = excluded.last_event_updated_at,
           updated_at = excluded.updated_at`,
      ).bind(userId, deviceId, now, userId, deviceId),
    );
  }
  await env.DB.batch(statements);
}

function normalizeCloudModelStatStatements(
  body: { modelStatsEnabled?: boolean; modelStats?: unknown[] } | undefined,
  userId: string,
  deviceId: string,
  now: string,
  env: Env,
) {
  const rawRows = Array.isArray(body?.modelStats) ? body.modelStats : undefined;
  if (!rawRows && body?.modelStatsEnabled !== false) {
    return { statements: [], count: 0 };
  }

  const rows = rawRows
    ? rawRows.slice(0, 1000).map(normalizeCloudModelStat).filter(Boolean)
    : [];
  return {
    statements: [
      env.DB.prepare("DELETE FROM tree_model_stats WHERE user_id = ? AND device_id = ?").bind(userId, deviceId),
      ...rows.map((row) =>
        env.DB.prepare(
          `INSERT INTO tree_model_stats (
             user_id, device_id, date, source, model, tokens,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, device_id, date, source, model) DO UPDATE SET
             tokens = excluded.tokens,
             input_tokens = excluded.input_tokens,
             output_tokens = excluded.output_tokens,
             cache_read_tokens = excluded.cache_read_tokens,
             cache_write_tokens = excluded.cache_write_tokens,
             updated_at = excluded.updated_at`,
        ).bind(
          userId,
          deviceId,
          row.date,
          row.source,
          row.model,
          row.tokens,
          row.inputTokens ?? null,
          row.outputTokens ?? null,
          row.cacheReadTokens ?? null,
          row.cacheWriteTokens ?? null,
          now,
        ),
      ),
    ],
    count: rows.length,
  };
}

function normalizeCloudModelStat(raw: unknown) {
  const input = raw as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object") return undefined;
  const date = typeof input.date === "string" && isDateKey(input.date) ? input.date : undefined;
  const source = normalizeTreeEventSource(input.source);
  const model = cleanShortText(input.model, 64);
  const tokens = normalizeTokenCount(input.tokens);
  if (!date || !model || source === "cloud-sync" || tokens === undefined || tokens <= 0) return undefined;
  return {
    date,
    source,
    model,
    tokens,
    inputTokens: normalizeTokenCount(input.inputTokens),
    outputTokens: normalizeTokenCount(input.outputTokens),
    cacheReadTokens: normalizeTokenCount(input.cacheReadTokens),
    cacheWriteTokens: normalizeTokenCount(input.cacheWriteTokens),
  };
}

function normalizeTreeEventSource(value: unknown, eventId?: unknown) {
  const source = typeof value === "string" ? value.trim() : "";
  if (SAFE_TREE_EVENT_SOURCES.has(source) && source !== "cloud-sync") return source;
  const inferred = sourceFromEventId(eventId);
  return inferred ?? (SAFE_TREE_EVENT_SOURCES.has(source) ? source : "cloud-sync");
}

function sourceFromEventId(eventId: unknown) {
  if (typeof eventId !== "string") return undefined;
  const delimiter = eventId.indexOf(":");
  if (delimiter <= 0) return undefined;
  const prefix = eventId.slice(0, delimiter);
  return SAFE_TREE_EVENT_SOURCES.has(prefix) && prefix !== "cloud-sync" ? prefix : undefined;
}

const SAFE_TREE_EVENT_SOURCES = new Set([
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

async function dedupeCloudTreeEventsForUser(userId: string, env: Env) {
  await env.DB.prepare(
    `DELETE FROM tree_events
     WHERE user_id = ?
       AND rowid NOT IN (
         SELECT MIN(rowid)
         FROM tree_events
         WHERE user_id = ?
         GROUP BY
           user_id,
           source,
           created_at,
           tokens,
           COALESCE(input_tokens, -1),
           COALESCE(output_tokens, -1),
           COALESCE(cache_read_tokens, -1),
           COALESCE(cache_write_tokens, -1)
       )`,
  ).bind(userId, userId).run();
}

function normalizeCloudTreeAchievement(
  raw: unknown,
  userId: string,
  appVersion: string | null,
  now: string,
  env: Env,
) {
  const input = raw as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object") return undefined;
  const achievementId = cleanShortText(input.id, 160);
  const unlockedAt = typeof input.unlockedAt === "string" && Number.isFinite(Date.parse(input.unlockedAt))
    ? input.unlockedAt
    : "";
  if (!achievementId || !unlockedAt) return undefined;
  return env.DB.prepare(
    `INSERT INTO tree_achievements (user_id, achievement_id, unlocked_at, app_version, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, achievement_id) DO UPDATE SET
       unlocked_at = excluded.unlocked_at,
       app_version = excluded.app_version,
       updated_at = excluded.updated_at`,
  ).bind(userId, achievementId, unlockedAt, appVersion, now);
}

function normalizeTokenCount(value: unknown) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 && number <= MAX_DAILY_ACCEPTED_TOKENS ? number : undefined;
}

function numberOrZero(value: unknown) {
  return normalizeTokenCount(value) ?? 0;
}

function optionalNumber(value: unknown) {
  return normalizeTokenCount(value);
}

function normalizeActiveDays(value: unknown) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 && number <= 100_000 ? number : undefined;
}

function normalizeDailyUsageRows(
  days: Array<{ date?: string; tokens?: number; xp?: number }>,
  window: { earliest: string; latest: string },
) {
  const byDate = new Map<string, number>();

  for (const day of days) {
    const date = typeof day.date === "string" && isDateKey(day.date) ? day.date : "";
    if (!date || date < window.earliest || date > window.latest) continue;

    const rawTokens = Math.round(Number(day.tokens ?? day.xp));
    if (!Number.isFinite(rawTokens) || rawTokens < 0) {
      throw new HttpError(400, "Tokens must be a non-negative integer.", {}, "invalid_payload");
    }
    if (rawTokens > MAX_DAILY_ACCEPTED_TOKENS) {
      throw new HttpError(400, `Daily tokens are above the accepted safety limit of ${MAX_DAILY_ACCEPTED_TOKENS}.`, {
        safetyMaxDailyTokens: MAX_DAILY_ACCEPTED_TOKENS,
      }, "invalid_payload");
    }

    byDate.set(date, Math.max(byDate.get(date) ?? 0, rawTokens));
  }

  return [...byDate.entries()].map(([date, tokens]) => ({
    date,
    tokens,
    xp: tokens,
  }));
}

function normalizeHourlyUsageRows(
  hours: Array<{ hourStartUtc?: string; hourStart?: string; tokens?: number; xp?: number }>,
  window: { earliest: string; latest: string },
) {
  const byHour = new Map<string, number>();

  for (const hour of hours) {
    const hourStartUtc = normalizeHourStartUtc(hour.hourStartUtc ?? hour.hourStart);
    if (!hourStartUtc || hourStartUtc < window.earliest || hourStartUtc > window.latest) continue;

    const rawTokens = Math.round(Number(hour.tokens ?? hour.xp));
    if (!Number.isFinite(rawTokens) || rawTokens < 0) {
      throw new HttpError(400, "Hourly tokens must be a non-negative integer.", {}, "invalid_payload");
    }
    if (rawTokens > MAX_DAILY_ACCEPTED_TOKENS) {
      throw new HttpError(400, `Hourly tokens are above the accepted safety limit of ${MAX_DAILY_ACCEPTED_TOKENS}.`, {
        safetyMaxDailyTokens: MAX_DAILY_ACCEPTED_TOKENS,
      }, "invalid_payload");
    }

    byHour.set(hourStartUtc, Math.max(byHour.get(hourStartUtc) ?? 0, rawTokens));
  }

  return [...byHour.entries()].map(([hourStartUtc, tokens]) => ({
    hourStartUtc,
    tokens,
  }));
}

function normalizeUsagePreferenceRows(rawRows: unknown[]) {
  const rows = new Map<LeaderboardRange, UsagePreferenceRow>();
  for (const raw of rawRows.slice(0, 4)) {
    const input = raw as Record<string, unknown> | undefined;
    if (!input || typeof input !== "object") continue;
    const range = normalizePreferenceRange(input.range);
    if (!range) continue;

    const favoriteAgent = input.favoriteAgent as Record<string, unknown> | undefined;
    const favoritePeriod = input.favoritePeriod as Record<string, unknown> | undefined;
    const row: UsagePreferenceRow = {
      range,
      favoriteAgentLabel: cleanShortText(favoriteAgent?.label, 64),
      favoriteAgentPercent: normalizePercent(favoriteAgent?.percent),
      favoriteModel: cleanShortText(input.favoriteModel, 64),
      favoritePeriod: normalizePreferencePeriod(favoritePeriod?.id),
      favoritePeriodStart: normalizeHour(favoritePeriod?.startHour, 0, 23),
      favoritePeriodEnd: normalizeHour(favoritePeriod?.endHour, 1, 24),
      peakTokensPerMinute: normalizePreferenceCount(input.peakTokensPerMinute),
    };

    if (
      !row.favoriteAgentLabel &&
      !row.favoriteModel &&
      !row.favoritePeriod &&
      row.peakTokensPerMinute === undefined
    ) {
      continue;
    }
    rows.set(range, row);
  }
  return [...rows.values()];
}

function dailySyncWindow(usageStartDate: string | undefined) {
  const today = localDateKey(new Date());
  const earliest = addDays(today, -(MAX_BACKFILL_DAYS - 1));
  const latest = addDays(today, 1);
  return {
    earliest: usageStartDate ? maxDateKey(earliest, usageStartDate) : earliest,
    latest,
  };
}

async function getLeaderboard(request: Request, env: Env) {
  await ensureUsagePreferencesTable(env);
  await ensureHourlyUsageTable(env);
  await ensureUsageVisibilityTable(env);
  await ensureUsageTotalsTable(env);
  const url = new URL(request.url);
  const rawRange = url.searchParams.get("range");
  const range = normalizeRange(url.searchParams.get("range"));
  const requestUser = await optionalAuth(request, env);
  const data = await leaderboardDataForRange(range, requestUser, env, new Date().toISOString());
  return json(rawRange === "today" ? { ...data, range: "today" } : data, env);
}

async function getLeaderboards(request: Request, env: Env) {
  await ensureUsagePreferencesTable(env);
  await ensureHourlyUsageTable(env);
  await ensureUsageVisibilityTable(env);
  await ensureUsageTotalsTable(env);
  const requestUser = await optionalAuth(request, env);
  const updatedAt = new Date().toISOString();
  const pairs = await Promise.all(
    LEADERBOARD_RANGES.map(
      async (range) => [range, await leaderboardDataForRange(range, requestUser, env, updatedAt)] as const,
    ),
  );
  const ranges = Object.fromEntries(pairs) as Record<
    LeaderboardRange,
    Awaited<ReturnType<typeof leaderboardDataForRange>>
  >;
  return json(
    {
      ranges: {
        today: { ...ranges["24h"], range: "today" },
        ...ranges,
      },
      updatedAt,
    },
    env,
  );
}

async function leaderboardDataForRange(
  range: LeaderboardRange,
  requestUser: SessionUser | undefined,
  env: Env,
  updatedAt: string,
) {
  const cached = leaderboardCache.get(range);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      range,
      entries: cached.entries,
      updatedAt: cached.updatedAt,
      me: requestUser ? cached.entries.find((entry) => entry.userId === requestUser.userId) : undefined,
    };
  }

  let result: D1Result<Record<string, unknown>>;
  if (range === "all") {
    result = await env.DB.prepare(
      `WITH daily_totals AS (
         SELECT user_id, COALESCE(SUM(xp), 0) AS tokens,
                COALESCE(SUM(CASE WHEN xp > 0 THEN 1 ELSE 0 END), 0) AS daysActive
         FROM daily_usage
         GROUP BY user_id
       ),
       combined_totals AS (
         SELECT user_id, tokens, days_active AS daysActive FROM usage_totals
         UNION ALL
         SELECT d.user_id, d.tokens, d.daysActive
         FROM daily_totals d
         WHERE NOT EXISTS (SELECT 1 FROM usage_totals t WHERE t.user_id = d.user_id)
       )
       SELECT u.user_id AS userId, u.username AS username, u.avatar_url AS avatarUrl,
         c.tokens AS tokens,
         c.daysActive AS daysActive,
         p.favorite_agent_label AS favoriteAgentLabel,
         p.favorite_agent_percent AS favoriteAgentPercent,
         p.favorite_model AS favoriteModel,
         p.favorite_period AS favoritePeriod,
         p.favorite_period_start AS favoritePeriodStart,
         p.favorite_period_end AS favoritePeriodEnd,
         p.peak_tokens_per_minute AS peakTokensPerMinute,
         p.updated_at AS preferenceUpdatedAt
       FROM combined_totals c
       JOIN users u ON u.user_id = c.user_id
       LEFT JOIN usage_preferences p ON p.user_id = u.user_id AND p.range = ?
       LEFT JOIN usage_visibility v ON v.user_id = u.user_id
       WHERE COALESCE(v.public_global, 1) = 1 AND c.tokens > 0
       ORDER BY c.tokens DESC
       LIMIT 100`,
    ).bind(range).all<Record<string, unknown>>();
  } else if (range === "24h") {
    const hourWindow = rollingLeaderboardHourWindow(new Date());
    const currentWindow = currentLocalDateWindow(new Date());
    const legacyUpdatedAfter = addUtcHours(floorUtcHour(new Date()), -LEGACY_DAILY_FALLBACK_HOURS).toISOString();
    result = await env.DB.prepare(
      `WITH hourly_any AS (
         SELECT DISTINCT user_id FROM hourly_usage
       ),
       hourly_totals AS (
         SELECT user_id, SUM(tokens) AS tokens
         FROM hourly_usage
         WHERE hour_start_utc >= ? AND hour_start_utc <= ?
         GROUP BY user_id
       ),
       legacy_current_date AS (
         SELECT d.user_id, MAX(d.date) AS currentDate
         FROM daily_usage d
         LEFT JOIN hourly_any h ON h.user_id = d.user_id
         WHERE h.user_id IS NULL
           AND d.date >= ? AND d.date <= ?
           AND d.updated_at >= ?
         GROUP BY d.user_id
       ),
       legacy_daily AS (
         SELECT c.user_id, SUM(d.xp) AS tokens
         FROM legacy_current_date c
         JOIN daily_usage d ON d.user_id = c.user_id AND d.date = c.currentDate
         GROUP BY c.user_id
       ),
       range_totals AS (
         SELECT user_id, tokens FROM hourly_totals
         UNION ALL
         SELECT user_id, tokens FROM legacy_daily
       )
       SELECT u.user_id AS userId, u.username AS username, u.avatar_url AS avatarUrl,
         SUM(r.tokens) AS tokens,
         (SELECT COUNT(*) FROM daily_usage all_days WHERE all_days.user_id = u.user_id AND all_days.xp > 0) AS daysActive,
         p.favorite_agent_label AS favoriteAgentLabel,
         p.favorite_agent_percent AS favoriteAgentPercent,
         p.favorite_model AS favoriteModel,
         p.favorite_period AS favoritePeriod,
         p.favorite_period_start AS favoritePeriodStart,
         p.favorite_period_end AS favoritePeriodEnd,
         p.peak_tokens_per_minute AS peakTokensPerMinute,
         p.updated_at AS preferenceUpdatedAt
       FROM range_totals r
       JOIN users u ON u.user_id = r.user_id
       LEFT JOIN usage_preferences p ON p.user_id = u.user_id AND p.range = ?
       LEFT JOIN usage_visibility v ON v.user_id = u.user_id
       WHERE COALESCE(v.public_global, 1) = 1
       GROUP BY u.user_id
       HAVING tokens > 0
       ORDER BY tokens DESC
       LIMIT 100`,
    ).bind(
      hourWindow.earliest,
      hourWindow.latest,
      currentWindow.earliest,
      currentWindow.latest,
      legacyUpdatedAfter,
      range,
    ).all<Record<string, unknown>>();
  } else {
    const currentWindow = currentLocalDateWindow(new Date());
    result = await env.DB.prepare(
      `SELECT u.user_id AS userId, u.username AS username, u.avatar_url AS avatarUrl,
         SUM(d.xp) AS tokens,
         (SELECT COUNT(*) FROM daily_usage all_days WHERE all_days.user_id = u.user_id AND all_days.xp > 0) AS daysActive,
         p.favorite_agent_label AS favoriteAgentLabel,
         p.favorite_agent_percent AS favoriteAgentPercent,
         p.favorite_model AS favoriteModel,
         p.favorite_period AS favoritePeriod,
         p.favorite_period_start AS favoritePeriodStart,
         p.favorite_period_end AS favoritePeriodEnd,
         p.peak_tokens_per_minute AS peakTokensPerMinute,
         p.updated_at AS preferenceUpdatedAt
       FROM daily_usage d
       JOIN users u ON u.user_id = d.user_id
       LEFT JOIN usage_preferences p ON p.user_id = u.user_id AND p.range = ?
       LEFT JOIN usage_visibility v ON v.user_id = u.user_id
       WHERE d.date >= date(?, ?) AND d.date <= ?
         AND COALESCE(v.public_global, 1) = 1
       GROUP BY u.user_id
       HAVING tokens > 0
       ORDER BY tokens DESC
       LIMIT 100`,
    ).bind(range, currentWindow.latest, rangeDateModifier(range), currentWindow.latest).all<Record<string, unknown>>();
  }
  const entries = (result.results || []).map((row, index) => ({
    rank: index + 1,
    userId: String(row.userId),
    username: String(row.username),
    avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : undefined,
    tokens: Math.max(0, Math.round(Number(row.tokens))),
    xp: Math.max(0, Math.round(Number(row.tokens))),
    daysActive: Math.max(0, Math.round(Number(row.daysActive))),
    usagePreference: rowToUsagePreference(row),
  }));
  leaderboardCache.set(range, {
    entries,
    updatedAt,
    expiresAt: Date.now() + LEADERBOARD_CACHE_TTL_MS,
  });
  return {
    range,
    entries,
    updatedAt,
    me: requestUser ? entries.find((entry) => entry.userId === requestUser.userId) : undefined,
  };
}

function rowToUsagePreference(row: Record<string, unknown>) {
  const favoriteAgentLabel = typeof row.favoriteAgentLabel === "string" ? row.favoriteAgentLabel : undefined;
  const favoriteAgentPercent = normalizePercent(row.favoriteAgentPercent);
  const favoriteModel = typeof row.favoriteModel === "string" ? row.favoriteModel : undefined;
  const favoritePeriod = normalizePreferencePeriod(row.favoritePeriod);
  const favoritePeriodStart = normalizeHour(row.favoritePeriodStart, 0, 23);
  const favoritePeriodEnd = normalizeHour(row.favoritePeriodEnd, 1, 24);
  const peakTokensPerMinute = normalizePreferenceCount(row.peakTokensPerMinute);
  const updatedAt =
    typeof row.preferenceUpdatedAt === "string" && Number.isFinite(Date.parse(row.preferenceUpdatedAt))
      ? row.preferenceUpdatedAt
      : undefined;
  const usagePreference = {
    favoriteAgent:
      favoriteAgentLabel && favoriteAgentPercent !== undefined
        ? { label: favoriteAgentLabel, percent: favoriteAgentPercent }
        : undefined,
    favoriteModel,
    favoritePeriod:
      favoritePeriod && favoritePeriodStart !== undefined && favoritePeriodEnd !== undefined
        ? { id: favoritePeriod, startHour: favoritePeriodStart, endHour: favoritePeriodEnd }
        : undefined,
    peakTokensPerMinute,
    updatedAt,
  };
  return usagePreference.favoriteAgent ||
    usagePreference.favoriteModel ||
    usagePreference.favoritePeriod ||
    usagePreference.peakTokensPerMinute !== undefined
    ? usagePreference
    : undefined;
}

async function requireAuth(request: Request, env: Env) {
  const user = await optionalAuth(request, env);
  if (!user) throw new HttpError(401, "Unauthorized");
  return user;
}

async function optionalAuth(request: Request, env: Env): Promise<SessionUser | undefined> {
  const token = authToken(request);
  if (!token) return undefined;
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT u.user_id AS userId, u.username AS username, u.avatar_url AS avatarUrl
     FROM sessions s
     JOIN users u ON u.user_id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(tokenHash, now)
    .first<Record<string, unknown>>();
  if (!row) return undefined;
  return {
    userId: String(row.userId),
    username: String(row.username),
    avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : undefined,
  };
}

function authToken(request: Request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
}

function toProfile(user: SessionUser) {
  return {
    id: user.userId,
    username: user.username,
    avatarUrl: user.avatarUrl,
  };
}

function assertConfigured(env: Env) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SECRET) {
    throw new Error("GitHub OAuth is not configured");
  }
}

async function exchangeGithubCode(code: string, redirectUri: string, env: Env) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Vibe Tree Leaderboard",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "GitHub token exchange failed");
  return data.access_token;
}

async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Vibe Tree Leaderboard",
    },
  });
  if (!response.ok) throw new Error("GitHub user request failed");
  const user = await response.json() as GithubUser;
  if (!user.id || !user.login) throw new Error("GitHub user response is invalid");
  return user;
}

async function signState(state: AuthState, env: Env) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(state)));
  const signature = await hmac(payload, env.SESSION_SECRET);
  return `${payload}.${signature}`;
}

async function verifyState(value: string, env: Env): Promise<AuthState | undefined> {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return undefined;
  const expected = await hmac(payload, env.SESSION_SECRET);
  if (signature !== expected) return undefined;
  const raw = base64UrlDecode(payload);
  return JSON.parse(new TextDecoder().decode(raw)) as AuthState;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

async function codeChallengeForVerifier(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function randomInviteCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function redirectBack(callback: string | undefined, state: string | undefined, code?: string, error?: string) {
  if (!callback) return new Response(error || "Login failed", { status: 400 });
  const url = new URL(callback);
  if (code) url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  if (error) url.searchParams.set("error", error);
  return Response.redirect(url.toString(), 302);
}

function isLocalCallback(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

function isPkceValue(value: string) {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return localDateKey(new Date(`${value}T00:00:00Z`)) === value;
}

function normalizeRange(value: string | null): LeaderboardRange {
  if (value === "today" || value === "24h") return "24h";
  return value === "30d" || value === "all" ? value : "7d";
}

function normalizeSocialGroupLeaderboardBasis(value: string | null): SocialGroupLeaderboardBasis {
  return value === "since_join" || value === "joined" ? "since_join" : "total";
}

function normalizePreferenceRange(value: unknown): LeaderboardRange | undefined {
  if (value === "today" || value === "24h") return "24h";
  return value === "7d" || value === "30d" || value === "all" ? value : undefined;
}

function normalizePreferencePeriod(value: unknown): UsagePreferencePeriod | undefined {
  return value === "early" || value === "morning" || value === "afternoon" || value === "evening" || value === "night"
    ? value
    : undefined;
}

function normalizeSocialGroupRole(value: unknown): SocialGroupRole | undefined {
  return value === "leader" || value === "officer" || value === "member" ? value : undefined;
}

function normalizeSocialGroupJoinRequestType(value: unknown): SocialGroupJoinRequestType | undefined {
  return value === "invite_code" || value === "friend_invite" ? value : undefined;
}

function normalizeSocialGroupJoinRequestStatus(value: unknown): SocialGroupJoinRequestStatus | undefined {
  return value === "pending" || value === "approved" || value === "declined" || value === "cancelled"
    ? value
    : undefined;
}

function normalizeSocialGroupVisibility(value: unknown): SocialGroupVisibility | undefined {
  return value === "closed" ? "closed" : value === "invite" ? "invite" : undefined;
}

function cleanShortText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function normalizeGroupIcon(value: unknown) {
  const icon = cleanShortText(value, 16);
  if (!icon) return null;
  return icon.replace(/\s+/g, "").slice(0, 16) || null;
}

function cleanInviteCode(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{12,64}$/.test(value) ? value : undefined;
}

function normalizeInviteMaxUses(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const count = Math.round(Number(value));
  return Number.isFinite(count) ? Math.max(1, Math.min(500, count)) : undefined;
}

function inviteExpiresAt(value: unknown) {
  const days = value === null || value === undefined || value === ""
    ? 14
    : Math.max(1, Math.min(90, Math.round(Number(value))));
  if (!Number.isFinite(days)) return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function positiveInteger(value: unknown) {
  const count = Math.round(Number(value));
  return Number.isFinite(count) && count > 0 ? count : undefined;
}

function optionalPositiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  return positiveInteger(value);
}

function normalizeDevicePlatform(value: unknown) {
  const platform = cleanShortText(value, 32);
  return platform === "mac" || platform === "windows" || platform === "linux" || platform === "unknown"
    ? platform
    : undefined;
}

function normalizePercent(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const percent = Math.round(Number(value));
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : undefined;
}

function normalizeHour(value: unknown, min: number, max: number) {
  if (value === null || value === undefined || value === "") return undefined;
  const hour = Math.round(Number(value));
  return Number.isFinite(hour) ? Math.max(min, Math.min(max, hour)) : undefined;
}

function normalizePreferenceCount(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const count = Math.round(Number(value));
  return Number.isFinite(count) ? Math.max(0, Math.min(MAX_DAILY_ACCEPTED_TOKENS, count)) : undefined;
}

function rangeDateModifier(range: LeaderboardRange) {
  if (range === "30d") return "-29 days";
  if (range === "7d") return "-6 days";
  return "-99999 days";
}

function rollingLeaderboardHourWindow(now: Date) {
  const latestHour = floorUtcHour(now);
  return {
    earliest: addUtcHours(latestHour, -23).toISOString(),
    latest: latestHour.toISOString(),
  };
}

function hourlySyncWindow(now: Date) {
  const latestHour = addUtcHours(floorUtcHour(now), 1);
  return {
    earliest: addUtcHours(latestHour, -MAX_HOURLY_BACKFILL_HOURS).toISOString(),
    latest: latestHour.toISOString(),
  };
}

function currentLocalDateWindow(now: Date) {
  const utcToday = localDateKey(now);
  return {
    earliest: addDays(utcToday, -1),
    latest: addDays(utcToday, 1),
  };
}

function normalizeUsageStartDate(value: unknown) {
  if (typeof value !== "string" || !isDateKey(value)) return undefined;
  const latest = addDays(localDateKey(new Date()), 1);
  return value <= latest ? value : undefined;
}

function normalizeHourStartUtc(value: unknown) {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const hourStartUtc = floorUtcHour(date).toISOString();
  return value === hourStartUtc || value === hourStartUtc.replace(".000Z", "Z") ? hourStartUtc : undefined;
}

function normalizeSyncCursor(value: unknown) {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const iso = date.toISOString();
  return iso <= new Date(Date.now() + 60_000).toISOString() ? iso : undefined;
}

function floorUtcHour(date: Date) {
  const hour = new Date(date);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}

function addUtcHours(date: Date, hours: number) {
  const next = new Date(date);
  next.setUTCHours(next.getUTCHours() + hours);
  return next;
}

function maxDateKey(left: string, right: string) {
  return left > right ? left : right;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return localDateKey(date);
}

function localDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
