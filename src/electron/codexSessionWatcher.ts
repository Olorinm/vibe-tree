import { createHash } from "node:crypto";
import {
  existsSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { UsageEvent, UsageStatus } from "../shared/types.js";

interface CodexSessionWatcherOptions {
  userDataPath: string;
  sessionsRoot?: string;
  historyStartAt?: string;
  onUsage: (event: UsageEvent) => void;
  onStatus?: (status: UsageStatus["codexSession"]) => void;
}

interface WatchState {
  version?: number;
  files: Record<string, number>;
  cumulativeTokens: Record<string, CumulativeUsage | number>;
  acceptedCumulativeKeys: Record<string, boolean>;
  currentModels: Record<string, string>;
  historyStartAt?: string;
}

interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface CumulativeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

interface ParsedTokenEvent extends UsageEvent {
  cumulativeKey: string;
  cumulativeUsage?: CumulativeUsage;
  deltaUsage?: CumulativeUsage;
}

const POLL_INTERVAL_MS = 10_000;
const READ_CHUNK_SIZE = 64 * 1024;
const DEFAULT_SESSIONS_ROOT = join(homedir(), ".codex", "sessions");
const WATCH_STATE_VERSION = 6;
const SESSION_META_READ_LIMIT = 2 * 1024 * 1024;
const PARENT_CUMULATIVE_TAIL_READ_LIMIT = 16 * 1024 * 1024;
const PARENT_CUMULATIVE_TAIL_CHUNK_SIZE = 256 * 1024;

export function startCodexSessionWatcher(options: CodexSessionWatcherOptions) {
  const sessionsRoot = options.sessionsRoot || process.env.VIBE_CODEX_SESSIONS_DIR || DEFAULT_SESSIONS_ROOT;
  const historyStartAtMs = timestampMs(options.historyStartAt);
  const importHistory = process.env.VIBE_CODEX_IMPORT_HISTORY === "today" || Boolean(historyStartAtMs);
  const statePath = join(options.userDataPath, "codex-session-watcher.json");
  const state = readState(statePath);
  if (state.version !== WATCH_STATE_VERSION || state.historyStartAt !== options.historyStartAt) {
    state.files = {};
    state.cumulativeTokens = {};
    state.acceptedCumulativeKeys = {};
    state.currentModels = {};
    state.historyStartAt = options.historyStartAt;
    state.version = WATCH_STATE_VERSION;
  }
  const watcherStartedAt = Date.now();
  const status: UsageStatus["codexSession"] = {
    running: true,
    sessionsRoot,
    exists: existsSync(sessionsRoot),
    filesWatched: 0,
    eventsImported: 0,
    importHistory,
    historyStartAt: options.historyStartAt,
  };

  let closed = false;

  const poll = () => {
    if (closed) return;
    status.exists = existsSync(sessionsRoot);
    status.lastScanAt = new Date().toISOString();
    if (!status.exists) {
      options.onStatus?.(status);
      return;
    }
    const files = listJsonlFiles(sessionsRoot);
    status.filesWatched = files.length;
    for (const filePath of files) {
      const imported = scanFile(filePath, state, statePath, options, {
        importHistory,
        watcherStartedAt,
        historyStartAtMs,
        sessionsRoot,
      });
      if (imported > 0) {
        status.eventsImported += imported;
        status.lastEventAt = new Date().toISOString();
      }
    }
    options.onStatus?.(status);
  };

  poll();
  const timer = setInterval(poll, POLL_INTERVAL_MS);

  return {
    close: () => {
      closed = true;
      status.running = false;
      clearInterval(timer);
      writeState(statePath, state);
      options.onStatus?.(status);
    },
    getStatus: () => status,
  };
}

function scanFile(
  filePath: string,
  state: WatchState,
  statePath: string,
  options: CodexSessionWatcherOptions,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number; sessionsRoot: string },
): number {
  let imported = 0;
  const stats = statSync(filePath);
  const previousOffset = state.files[filePath];
  if ((previousOffset === undefined || stats.size > previousOffset) && isArchivedCodexSession(filePath)) {
    state.files[filePath] = stats.size;
    writeState(statePath, state);
    return imported;
  }
  const forkBaseline = seedForkCumulativeBaseline(filePath, state, settings.sessionsRoot);
  const offset =
    previousOffset ??
    initialOffset(filePath, stats, {
      importHistory: settings.importHistory,
      watcherStartedAt: settings.watcherStartedAt,
      historyStartAtMs: settings.historyStartAtMs,
      hasForkBaseline: Boolean(forkBaseline),
    });

  if (stats.size <= offset) {
    state.files[filePath] = stats.size;
    return imported;
  }

  let currentModel = state.currentModels[filePath];
  imported += scanNewLines(filePath, offset, stats.size, (line, lineOffset) => {
    const turnContext = parseCodexTurnContextLine(line);
    if (turnContext) {
      currentModel = turnContext.model ?? currentModel;
    }
    const event = parseCodexTokenCountLine(line, filePath, lineOffset, currentModel);
    if (event) {
      if (isBeforeHistoryStart(event.createdAt, settings.historyStartAtMs)) {
        const baselineUsage = event.cumulativeUsage ?? event.deltaUsage;
        if (baselineUsage) {
          state.cumulativeTokens[event.cumulativeKey] = baselineUsage;
        }
        return 0;
      }

      const exactPreviousTotal = normalizeStoredUsage(state.cumulativeTokens[event.cumulativeKey]);
      const legacyPreviousTotal = undefined;
      const previousTotal = exactPreviousTotal ?? legacyPreviousTotal;
      const hasAcceptedKey = Boolean(state.acceptedCumulativeKeys[event.cumulativeKey]);
      if (!hasAcceptedKey) {
        const baselineUsage = event.cumulativeUsage ?? event.deltaUsage;
        if (baselineUsage) {
          state.cumulativeTokens[event.cumulativeKey] = baselineUsage;
        }
        state.acceptedCumulativeKeys[event.cumulativeKey] = true;
        return 0;
      }
      const deltaUsage = previousTotal
        ? getDeltaUsage(event, exactPreviousTotal, legacyPreviousTotal)
        : event.deltaUsage ?? event.cumulativeUsage;
      if (event.cumulativeUsage) {
        state.cumulativeTokens[event.cumulativeKey] = maxUsage(event.cumulativeUsage, previousTotal);
      } else if (event.deltaUsage) {
        state.cumulativeTokens[event.cumulativeKey] = event.deltaUsage;
      }
      if (!deltaUsage) return 0;
      const totalTokens = usageTotal(deltaUsage);
      if (totalTokens <= 0) return 0;
      options.onUsage({
        ...event,
        inputTokens: deltaUsage.inputTokens,
        outputTokens: deltaUsage.outputTokens,
        cacheReadTokens: deltaUsage.cacheReadTokens,
        totalTokens,
      });
      return 1;
    }
    return 0;
  });

  state.files[filePath] = stats.size;
  if (currentModel) state.currentModels[filePath] = currentModel;
  writeState(statePath, state);
  return imported;
}

function scanNewLines(filePath: string, start: number, end: number, onLine: (line: string, lineOffset: number) => number) {
  const fd = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(READ_CHUNK_SIZE);
  const decoder = new StringDecoder("utf8");
  let position = start;
  let pending = "";
  let pendingOffset = start;
  let imported = 0;

  try {
    while (position < end) {
      const bytesToRead = Math.min(READ_CHUNK_SIZE, end - position);
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, position);
      if (bytesRead <= 0) break;
      position += bytesRead;
      pending += decoder.write(buffer.subarray(0, bytesRead));

      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        const rawLine = pending.slice(0, newlineIndex);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line.trim()) {
          imported += onLine(line, pendingOffset);
        }
        pendingOffset += Buffer.byteLength(`${rawLine}\n`, "utf8");
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf("\n");
      }
    }

    pending += decoder.end();
    if (pending.trim()) {
      imported += onLine(pending, pendingOffset);
    }
  } finally {
    closeSync(fd);
  }

  return imported;
}

function initialOffset(
  filePath: string,
  stats: Stats,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number; hasForkBaseline?: boolean },
) {
  if (settings.hasForkBaseline) {
    return 0;
  }
  if (shouldBaselineInitialCodexSession(filePath)) {
    return stats.size;
  }
  if (settings.historyStartAtMs && stats.mtimeMs >= settings.historyStartAtMs - 5_000) {
    return 0;
  }
  if (settings.importHistory && isTodaySessionPath(filePath)) {
    return 0;
  }
  if (stats.mtimeMs >= settings.watcherStartedAt - 5_000 && shouldImportRecentlyUpdatedSession(filePath)) {
    return 0;
  }
  return stats.size;
}

function shouldImportRecentlyUpdatedSession(filePath: string) {
  const sessionDate = sessionPathDateKey(filePath);
  return !sessionDate || sessionDate === todayDateKey();
}

function shouldBaselineInitialCodexSession(filePath: string) {
  if (isArchivedCodexSession(filePath)) return true;
  if (isForkedCodexSession(filePath)) return true;
  const sessionDate = sessionPathDateKey(filePath);
  return Boolean(sessionDate && sessionDate !== todayDateKey());
}

function isArchivedCodexSession(filePath: string) {
  return /[\\/]archived_sessions[\\/]/.test(filePath);
}

function isForkedCodexSession(filePath: string) {
  return Boolean(readCodexSessionMeta(filePath)?.forkedFromId);
}

function readCodexSessionMeta(filePath: string) {
  const firstLine = readFirstLine(filePath, SESSION_META_READ_LIMIT);
  if (!firstLine) return undefined;
  const parsed = parseJson(firstLine);
  if (parsed?.type !== "session_meta") return undefined;
  const payload = asRecord(parsed?.payload);
  return {
    createdAtMs: typeof parsed.timestamp === "string" ? timestampMs(parsed.timestamp) : undefined,
    forkedFromId: typeof payload?.forked_from_id === "string" ? payload.forked_from_id : undefined,
  };
}

function seedForkCumulativeBaseline(filePath: string, state: WatchState, sessionsRoot: string | undefined) {
  const meta = readCodexSessionMeta(filePath);
  if (!meta?.forkedFromId || !sessionsRoot) return undefined;
  const cumulativeKey = `${filePath}:total`;
  const existingUsage = normalizeStoredUsage(state.cumulativeTokens[cumulativeKey]);
  if (state.acceptedCumulativeKeys[cumulativeKey] && existingUsage) {
    return existingUsage;
  }

  const baselineUsage = resolveForkParentCumulativeUsage(meta.forkedFromId, sessionsRoot, state, meta.createdAtMs);
  if (!baselineUsage) return undefined;

  const nextBaseline = maxUsage(baselineUsage, existingUsage);
  state.cumulativeTokens[cumulativeKey] = nextBaseline;
  state.acceptedCumulativeKeys[cumulativeKey] = true;
  return nextBaseline;
}

function resolveForkParentCumulativeUsage(
  parentSessionId: string,
  sessionsRoot: string,
  state: WatchState,
  latestAtMs: number | undefined,
) {
  const parentFilePath = findCodexSessionFileById(parentSessionId, sessionsRoot, state);
  if (!parentFilePath) return undefined;

  const fileUsage = readLatestCumulativeUsageFromFile(parentFilePath, latestAtMs);
  if (fileUsage) return fileUsage;
  return normalizeStoredUsage(state.cumulativeTokens[`${parentFilePath}:total`]);
}

function findCodexSessionFileById(parentSessionId: string, sessionsRoot: string, state: WatchState) {
  for (const key of Object.keys(state.cumulativeTokens)) {
    if (key.endsWith(":total") && key.includes(parentSessionId)) {
      return key.slice(0, -":total".length);
    }
  }
  if (!existsSync(sessionsRoot)) return undefined;
  return listJsonlFiles(sessionsRoot).find((candidate) => candidate.includes(parentSessionId));
}

function readLatestCumulativeUsageFromFile(filePath: string, latestAtMs: number | undefined) {
  if (!existsSync(filePath)) return undefined;
  const stats = statSync(filePath);
  const fd = openSync(filePath, "r");
  const maxBytes = Math.min(stats.size, PARENT_CUMULATIVE_TAIL_READ_LIMIT);
  const buffer = Buffer.allocUnsafe(Math.min(PARENT_CUMULATIVE_TAIL_CHUNK_SIZE, maxBytes || 1));
  let remaining = maxBytes;
  let position = stats.size;
  let carry = Buffer.alloc(0);

  try {
    while (remaining > 0) {
      const bytesToRead = Math.min(buffer.length, remaining);
      position -= bytesToRead;
      remaining -= bytesToRead;
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, position);
      if (bytesRead <= 0) break;
      const data = Buffer.concat([buffer.subarray(0, bytesRead), carry]);
      let lineEnd = data.length;
      for (let index = data.length - 1; index >= 0; index -= 1) {
        if (data[index] !== 10) continue;
        const line = data.subarray(index + 1, lineEnd).toString("utf8").trim();
        const usage = cumulativeUsageFromParentLine(line, filePath, latestAtMs);
        if (usage) return usage;
        lineEnd = index;
      }
      carry = data.subarray(0, lineEnd);
    }

    const line = carry.toString("utf8").trim();
    return cumulativeUsageFromParentLine(line, filePath, latestAtMs);
  } finally {
    closeSync(fd);
  }
}

function cumulativeUsageFromParentLine(line: string, filePath: string, latestAtMs: number | undefined) {
  if (!line || !line.includes("\"token_count\"")) return undefined;
  const event = parseCodexTokenCountLine(line, filePath, 0, undefined);
  if (!event?.cumulativeUsage) return undefined;
  const eventMs = timestampMs(event.createdAt);
  if (latestAtMs && eventMs && eventMs > latestAtMs) return undefined;
  return event.cumulativeUsage;
}

function readFirstLine(filePath: string, maxBytes: number) {
  let fd: number | undefined;
  const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_SIZE, maxBytes));
  const decoder = new StringDecoder("utf8");
  let position = 0;
  let pending = "";

  try {
    fd = openSync(filePath, "r");
    while (position < maxBytes) {
      const bytesToRead = Math.min(buffer.length, maxBytes - position);
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, position);
      if (bytesRead <= 0) break;
      position += bytesRead;
      pending += decoder.write(buffer.subarray(0, bytesRead));
      const newlineIndex = pending.indexOf("\n");
      if (newlineIndex >= 0) {
        const rawLine = pending.slice(0, newlineIndex);
        return rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      }
    }
    pending += decoder.end();
    return pending.trim() ? pending : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function parseCodexTurnContextLine(line: string) {
  if (!line.includes("\"turn_context\"")) return undefined;
  const parsed = parseJson(line);
  if (!parsed || parsed.type !== "turn_context") return undefined;
  const payload = asRecord(parsed.payload);
  return {
    createdAt: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
    model: stringValue(payload?.model) || stringValue(asRecord(payload?.info)?.model),
  };
}

function parseCodexTokenCountLine(
  line: string,
  filePath: string,
  lineOffset: number,
  currentModel: string | undefined,
): ParsedTokenEvent | undefined {
  const parsed = parseJson(line);
  if (!parsed || parsed.type !== "event_msg") return undefined;

  const payload = asRecord(parsed.payload);
  if (payload?.type !== "token_count") return undefined;

  const rateLimits = asRecord(payload.rate_limits);
  const limitId = typeof rateLimits?.limit_id === "string" ? rateLimits.limit_id : "";
  const limitName = typeof rateLimits?.limit_name === "string" ? rateLimits.limit_name : undefined;

  const info = asRecord(payload.info);
  const usage = parseUsage(asRecord(info?.last_token_usage) as TokenUsage | undefined);
  const totalUsage = parseUsage(asRecord(info?.total_token_usage) as TokenUsage | undefined);
  if (!usage && !totalUsage) return undefined;

  const createdAt = typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString();
  const model =
    stringValue(info?.model) ||
    stringValue(info?.model_name) ||
    stringValue(payload.model) ||
    currentModel ||
    limitName ||
    (limitId && limitId !== "codex" ? limitId : undefined);
  const cumulativeKey = totalUsage ? `${filePath}:total` : `${filePath}:last`;
  const hashBasis = `${filePath}:${lineOffset}:${model}:${usage ? usageTotal(usage) : 0}:${
    totalUsage ? usageTotal(totalUsage) : 0
  }`;

  return {
    id: `codex-session:${hash(hashBasis)}`,
    createdAt,
    source: "codex-session",
    agent: "codex-desktop",
    provider: "chatgpt-login",
    model,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: 0,
    totalTokens: usage ? usageTotal(usage) : 0,
    streaming: false,
    cumulativeKey,
    cumulativeUsage: totalUsage,
    deltaUsage: usage,
  };
}

function parseUsage(usage: TokenUsage | undefined): CumulativeUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  const cacheReadTokens = Math.min(
    inputTokens,
    numberValue(usage.cached_input_tokens) || numberValue(usage.cache_read_input_tokens),
  );
  const totalTokens = numberValue(usage.total_tokens) || inputTokens + outputTokens;
  if (totalTokens <= 0 && cacheReadTokens <= 0) return undefined;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
  };
}

function usageTotal(usage: CumulativeUsage) {
  return usage.inputTokens + usage.outputTokens;
}

function getDeltaUsage(
  event: ParsedTokenEvent,
  exactPreviousTotal: CumulativeUsage | undefined,
  legacyPreviousTotal: CumulativeUsage | undefined,
): CumulativeUsage | undefined {
  if (event.cumulativeUsage && exactPreviousTotal) {
    return subtractUsage(event.cumulativeUsage, exactPreviousTotal);
  }
  if (event.deltaUsage) {
    if (exactPreviousTotal && usageTotal(event.deltaUsage) >= usageTotal(exactPreviousTotal)) {
      return subtractUsage(event.deltaUsage, exactPreviousTotal);
    }
    return event.deltaUsage;
  }
  if (event.cumulativeUsage && legacyPreviousTotal) {
    return subtractUsage(event.cumulativeUsage, legacyPreviousTotal);
  }
  return event.cumulativeUsage;
}

function subtractUsage(current: CumulativeUsage, previous: CumulativeUsage | undefined): CumulativeUsage {
  if (!previous) return current;
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    cacheReadTokens: Math.max(0, current.cacheReadTokens - previous.cacheReadTokens),
  };
}

function maxUsage(current: CumulativeUsage, previous: CumulativeUsage | undefined): CumulativeUsage {
  if (!previous) return current;
  return {
    inputTokens: Math.max(current.inputTokens, previous.inputTokens),
    outputTokens: Math.max(current.outputTokens, previous.outputTokens),
    cacheReadTokens: Math.max(current.cacheReadTokens, previous.cacheReadTokens),
  };
}

function bestKnownCumulativeUsageForFile(
  cumulativeTokens: Record<string, CumulativeUsage | number>,
  filePath: string,
): CumulativeUsage | undefined {
  let best: CumulativeUsage | undefined;
  for (const [key, value] of Object.entries(cumulativeTokens)) {
    if (key !== filePath && !key.startsWith(`${filePath}:`)) continue;
    const usage = normalizeStoredUsage(value);
    if (usage) best = maxUsage(usage, best);
  }
  return best;
}

function normalizeStoredUsage(value: CumulativeUsage | number | undefined): CumulativeUsage | undefined {
  if (typeof value === "number") {
    return { inputTokens: value, outputTokens: 0, cacheReadTokens: 0 };
  }
  if (!value || typeof value !== "object") return undefined;
  return {
    inputTokens: numberValue(value.inputTokens),
    outputTokens: numberValue(value.outputTokens),
    cacheReadTokens: numberValue(value.cacheReadTokens),
  };
}

function listJsonlFiles(root: string) {
  const result: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        result.push(fullPath);
      }
    }
  };
  visit(root);
  return result;
}

function readState(path: string): WatchState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WatchState>;
    return {
      files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
      cumulativeTokens:
        parsed.cumulativeTokens && typeof parsed.cumulativeTokens === "object" ? parsed.cumulativeTokens : {},
      acceptedCumulativeKeys:
        parsed.acceptedCumulativeKeys && typeof parsed.acceptedCumulativeKeys === "object"
          ? (parsed.acceptedCumulativeKeys as Record<string, boolean>)
          : {},
      currentModels: parsed.currentModels && typeof parsed.currentModels === "object" ? parsed.currentModels : {},
      historyStartAt: typeof parsed.historyStartAt === "string" ? parsed.historyStartAt : undefined,
      version: numberValue(parsed.version),
    };
  } catch {
    return {
      version: WATCH_STATE_VERSION,
      files: {},
      cumulativeTokens: {},
      acceptedCumulativeKeys: {},
      currentModels: {},
    };
  }
}

function writeState(path: string, state: WatchState) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(tempPath, path);
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function timestampMs(value: string | undefined) {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function isBeforeHistoryStart(createdAt: string, historyStartAtMs: number | undefined) {
  if (!historyStartAtMs) return false;
  const time = Date.parse(createdAt);
  return Number.isFinite(time) && time < historyStartAtMs;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export const __test = {
  scanFile,
  readState,
  writeState,
};

function isTodaySessionPath(filePath: string) {
  return sessionPathDateKey(filePath) === todayDateKey();
}

function todayDateKey() {
  const now = new Date();
  return [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function sessionPathDateKey(filePath: string) {
  const parts = filePath.split(/[\\/]+/);
  for (let index = 0; index < parts.length - 2; index += 1) {
    if (/^\d{4}$/.test(parts[index]) && /^\d{2}$/.test(parts[index + 1]) && /^\d{2}$/.test(parts[index + 2])) {
      return `${parts[index]}-${parts[index + 1]}-${parts[index + 2]}`;
    }
  }
  return undefined;
}
