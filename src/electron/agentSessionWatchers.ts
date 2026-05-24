import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { SessionMonitorStatus, UsageEvent } from "../shared/types.js";

interface SessionWatcherOptions {
  userDataPath: string;
  sessionsRoot?: string;
  historyStartAt?: string;
  onUsage: (event: UsageEvent) => void;
  onStatus?: (status: SessionMonitorStatus) => void;
}

interface WatchState {
  files: Record<string, number>;
  events: Record<string, boolean>;
  sessions: Record<string, UsageSnapshot>;
  historyStartAt?: string;
}

interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface AgentConfig {
  source: "claude-session" | "openclaw-session" | "pi-session";
  agent: "claude-code" | "openclaw" | "pi-agent";
  sessionsRoot: string;
  importHistoryEnv: string;
  stateFileName: string;
  pollIntervalMs: number;
  parseLine: (line: string, filePath: string, lineOffset: number) => UsageEvent | undefined;
}

interface JsonAgentConfig {
  source: "opencode-session" | "gemini-session";
  agent: "opencode" | "gemini";
  sessionsRoot: string;
  importHistoryEnv: string;
  stateFileName: string;
  pollIntervalMs: number;
  fileExtensions: string[];
  parseFile: (filePath: string) => UsageEvent | UsageEvent[] | undefined;
}

interface HermesSessionRow {
  id: string;
  source?: string;
  model?: string;
  billing_provider?: string;
  started_at?: number;
  ended_at?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
}

interface OpenCodeMessageRow {
  id: string;
  session_id: string;
  time_created: number;
  data_id?: string;
  data_session_id?: string;
  data_session_id_legacy?: string;
  provider_id?: string;
  provider_id_legacy?: string;
  model_id?: string;
  model_id_legacy?: string;
  agent?: string;
  created_at?: string | number;
  completed_at?: string | number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
}

const READ_CHUNK_SIZE = 64 * 1024;
const DEFAULT_CLAUDE_ROOT = join(homedir(), ".claude", "projects");
const DEFAULT_OPENCLAW_ROOT = join(homedir(), ".openclaw", "agents");
const DEFAULT_PI_ROOT = defaultPiSessionsRoot();
const DEFAULT_OPENCODE_DB = defaultOpenCodeDbPath();
const DEFAULT_OPENCODE_MESSAGES_ROOT = defaultOpenCodeMessagesRoot();
const DEFAULT_GEMINI_ROOT = join(homedir(), ".gemini", "tmp");
const DEFAULT_HERMES_STATE_DB = join(homedir(), ".hermes", "state.db");

export function startClaudeSessionWatcher(options: SessionWatcherOptions) {
  return startAgentSessionWatcher(options, {
    source: "claude-session",
    agent: "claude-code",
    sessionsRoot: options.sessionsRoot || process.env.VIBE_CLAUDE_SESSIONS_DIR || DEFAULT_CLAUDE_ROOT,
    importHistoryEnv: "VIBE_CLAUDE_IMPORT_HISTORY",
    stateFileName: "claude-session-watcher.json",
    pollIntervalMs: 10_000,
    parseLine: parseClaudeLine,
  });
}

export function startOpenClawSessionWatcher(options: SessionWatcherOptions) {
  return startAgentSessionWatcher(options, {
    source: "openclaw-session",
    agent: "openclaw",
    sessionsRoot: options.sessionsRoot || process.env.VIBE_OPENCLAW_SESSIONS_DIR || DEFAULT_OPENCLAW_ROOT,
    importHistoryEnv: "VIBE_OPENCLAW_IMPORT_HISTORY",
    stateFileName: "openclaw-session-watcher.json",
    pollIntervalMs: 10_000,
    parseLine: parseOpenClawLine,
  });
}

export function startPiSessionWatcher(options: SessionWatcherOptions) {
  return startAgentSessionWatcher(options, {
    source: "pi-session",
    agent: "pi-agent",
    sessionsRoot:
      options.sessionsRoot || process.env.VIBE_PI_AGENT_SESSIONS_DIR || process.env.VIBE_PI_SESSIONS_DIR || DEFAULT_PI_ROOT,
    importHistoryEnv: "VIBE_PI_IMPORT_HISTORY",
    stateFileName: "pi-session-watcher.json",
    pollIntervalMs: 10_000,
    parseLine: parsePiLine,
  });
}

export function startOpenCodeSessionWatcher(options: SessionWatcherOptions) {
  const target = openCodeWatcherTarget(options.sessionsRoot || process.env.VIBE_OPENCODE_SESSIONS_DIR);
  if (target.kind === "json") {
    return startJsonAgentSessionWatcher(options, {
      source: "opencode-session",
      agent: "opencode",
      sessionsRoot: target.path,
      importHistoryEnv: "VIBE_OPENCODE_IMPORT_HISTORY",
      stateFileName: "opencode-session-watcher.json",
      pollIntervalMs: 10_000,
      fileExtensions: [".json"],
      parseFile: parseOpenCodeFile,
    });
  }
  return startOpenCodeDbSessionWatcher(options, target.path);
}

function startOpenCodeDbSessionWatcher(options: SessionWatcherOptions, dbPath: string) {
  const historyStartAtMs = timestampMs(options.historyStartAt);
  const importHistory = process.env.VIBE_OPENCODE_IMPORT_HISTORY === "today" || Boolean(historyStartAtMs);
  const statePath = join(options.userDataPath, "opencode-session-watcher.json");
  const state = readState(statePath);
  if (state.historyStartAt !== options.historyStartAt) {
    state.files = {};
    state.events = {};
    state.historyStartAt = options.historyStartAt;
  }
  const watcherStartedAt = Date.now();
  const status: SessionMonitorStatus = {
    running: true,
    sessionsRoot: dbPath,
    exists: existsSync(dbPath),
    filesWatched: 0,
    eventsImported: 0,
    importHistory,
    historyStartAt: options.historyStartAt,
  };

  let closed = false;

  const poll = () => {
    if (closed) return;
    status.exists = existsSync(dbPath);
    status.filesWatched = status.exists ? 1 : 0;
    status.lastScanAt = new Date().toISOString();
    if (!status.exists) {
      options.onStatus?.(status);
      return;
    }

    const imported = scanOpenCodeDb(dbPath, state, statePath, { importHistory, watcherStartedAt, historyStartAtMs }, options.onUsage);
    if (imported > 0) {
      status.eventsImported += imported;
      status.lastEventAt = new Date().toISOString();
    }
    options.onStatus?.(status);
  };

  poll();
  const timer = setInterval(poll, 10_000);

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

export function startGeminiSessionWatcher(options: SessionWatcherOptions) {
  return startJsonAgentSessionWatcher(options, {
    source: "gemini-session",
    agent: "gemini",
    sessionsRoot: options.sessionsRoot || process.env.VIBE_GEMINI_SESSIONS_DIR || DEFAULT_GEMINI_ROOT,
    importHistoryEnv: "VIBE_GEMINI_IMPORT_HISTORY",
    stateFileName: "gemini-session-watcher.json",
    pollIntervalMs: 10_000,
    fileExtensions: [".json", ".jsonl"],
    parseFile: parseGeminiFile,
  });
}

export function startHermesSessionWatcher(options: SessionWatcherOptions) {
  const stateDbPath = hermesStateDbPath(options.sessionsRoot || process.env.VIBE_HERMES_SESSIONS_DIR);
  const historyStartAtMs = timestampMs(options.historyStartAt);
  const importHistory = process.env.VIBE_HERMES_IMPORT_HISTORY === "today" || Boolean(historyStartAtMs);
  const statePath = join(options.userDataPath, "hermes-session-watcher.json");
  const state = readState(statePath);
  if (state.historyStartAt !== options.historyStartAt) {
    state.files = {};
    state.events = {};
    state.sessions = {};
    state.historyStartAt = options.historyStartAt;
  }
  const watcherStartedAt = Date.now();
  const status: SessionMonitorStatus = {
    running: true,
    sessionsRoot: stateDbPath,
    exists: existsSync(stateDbPath),
    filesWatched: 0,
    eventsImported: 0,
    importHistory,
    historyStartAt: options.historyStartAt,
  };

  let closed = false;

  const poll = () => {
    if (closed) return;
    status.exists = existsSync(stateDbPath);
    status.filesWatched = status.exists ? 1 : 0;
    status.lastScanAt = new Date().toISOString();
    if (!status.exists) {
      options.onStatus?.(status);
      return;
    }

    const imported = scanHermesStateDb(
      stateDbPath,
      state,
      statePath,
      { importHistory, watcherStartedAt, historyStartAtMs },
      options.onUsage,
    );
    if (imported > 0) {
      status.eventsImported += imported;
      status.lastEventAt = new Date().toISOString();
    }
    options.onStatus?.(status);
  };

  poll();
  const timer = setInterval(poll, 10_000);

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

function startAgentSessionWatcher(options: SessionWatcherOptions, config: AgentConfig) {
  const historyStartAtMs = timestampMs(options.historyStartAt);
  const importHistory = process.env[config.importHistoryEnv] === "today" || Boolean(historyStartAtMs);
  const statePath = join(options.userDataPath, config.stateFileName);
  const state = readState(statePath);
  if (state.historyStartAt !== options.historyStartAt) {
    state.files = {};
    state.events = {};
    state.historyStartAt = options.historyStartAt;
  }
  const watcherStartedAt = Date.now();
  const status: SessionMonitorStatus = {
    running: true,
    sessionsRoot: config.sessionsRoot,
    exists: existsSync(config.sessionsRoot),
    filesWatched: 0,
    eventsImported: 0,
    importHistory,
    historyStartAt: options.historyStartAt,
  };

  let closed = false;

  const poll = () => {
    if (closed) return;
    status.exists = existsSync(config.sessionsRoot);
    status.lastScanAt = new Date().toISOString();
    if (!status.exists) {
      options.onStatus?.(status);
      return;
    }

    const files = listJsonlFiles(config.sessionsRoot);
    status.filesWatched = files.length;
    for (const filePath of files) {
      const imported = scanFile(
        filePath,
        state,
        statePath,
        config,
        { importHistory, watcherStartedAt, historyStartAtMs },
        options.onUsage,
      );
      if (imported > 0) {
        status.eventsImported += imported;
        status.lastEventAt = new Date().toISOString();
      }
    }
    options.onStatus?.(status);
  };

  poll();
  const timer = setInterval(poll, config.pollIntervalMs);

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

function startJsonAgentSessionWatcher(options: SessionWatcherOptions, config: JsonAgentConfig) {
  const historyStartAtMs = timestampMs(options.historyStartAt);
  const importHistory = process.env[config.importHistoryEnv] === "today" || Boolean(historyStartAtMs);
  const statePath = join(options.userDataPath, config.stateFileName);
  const state = readState(statePath);
  if (state.historyStartAt !== options.historyStartAt) {
    state.files = {};
    state.events = {};
    state.historyStartAt = options.historyStartAt;
  }
  const watcherStartedAt = Date.now();
  const status: SessionMonitorStatus = {
    running: true,
    sessionsRoot: config.sessionsRoot,
    exists: existsSync(config.sessionsRoot),
    filesWatched: 0,
    eventsImported: 0,
    importHistory,
    historyStartAt: options.historyStartAt,
  };

  let closed = false;

  const poll = () => {
    if (closed) return;
    status.exists = existsSync(config.sessionsRoot);
    status.lastScanAt = new Date().toISOString();
    if (!status.exists) {
      options.onStatus?.(status);
      return;
    }

    const files = listJsonFiles(config.sessionsRoot, config.fileExtensions);
    status.filesWatched = files.length;
    for (const filePath of files) {
      const imported = scanJsonFile(
        filePath,
        state,
        statePath,
        config,
        { importHistory, watcherStartedAt, historyStartAtMs },
        options.onUsage,
      );
      if (imported > 0) {
        status.eventsImported += imported;
        status.lastEventAt = new Date().toISOString();
      }
    }
    options.onStatus?.(status);
  };

  poll();
  const timer = setInterval(poll, config.pollIntervalMs);

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
  config: AgentConfig,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number },
  onUsage: (event: UsageEvent) => void,
) {
  let imported = 0;
  const stats = statSync(filePath);
  const previousOffset = state.files[filePath];
  const offset = previousOffset ?? initialOffset(filePath, stats, settings);

  if (stats.size <= offset) {
    state.files[filePath] = stats.size;
    return imported;
  }

  imported += scanNewLines(filePath, offset, stats.size, (line, lineOffset) => {
    const event = config.parseLine(line, filePath, lineOffset);
    if (!event || !usageEventHasTokens(event)) return 0;
    if (isBeforeHistoryStart(event.createdAt, settings.historyStartAtMs)) return 0;
    onUsage(event);
    return 1;
  });

  state.files[filePath] = stats.size;
  writeState(statePath, state);
  return imported;
}

function scanJsonFile(
  filePath: string,
  state: WatchState,
  statePath: string,
  config: JsonAgentConfig,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number },
  onUsage: (event: UsageEvent) => void,
) {
  const stats = statSync(filePath);
  const previousMtime = state.files[filePath];
  if (previousMtime !== undefined && stats.mtimeMs <= previousMtime) {
    return 0;
  }

  if (previousMtime === undefined && shouldSkipInitialJsonFile(filePath, stats, settings)) {
    state.files[filePath] = stats.mtimeMs;
    writeState(statePath, state);
    return 0;
  }

  state.files[filePath] = stats.mtimeMs;
  writeState(statePath, state);

  const events = toUsageEvents(config.parseFile(filePath));
  let imported = 0;
  for (const event of events) {
    if (!usageEventHasTokens(event)) continue;
    if (isBeforeHistoryStart(event.createdAt, settings.historyStartAtMs)) {
      state.events[event.id] = true;
      continue;
    }
    if (state.events[event.id]) continue;
    state.events[event.id] = true;
    onUsage(event);
    imported += 1;
  }
  if (imported > 0 || events.length > 0) writeState(statePath, state);
  return imported;
}

function scanHermesStateDb(
  stateDbPath: string,
  state: WatchState,
  statePath: string,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number },
  onUsage: (event: UsageEvent) => void,
) {
  const stats = statSync(stateDbPath);
  const previousMtime = state.files[stateDbPath];
  if (previousMtime !== undefined && stats.mtimeMs <= previousMtime) {
    return 0;
  }

  const rows = readHermesSessionRows(stateDbPath);
  if (!rows) {
    return 0;
  }
  state.files[stateDbPath] = stats.mtimeMs;

  let imported = 0;
  for (const row of rows) {
    const sessionId = stringValue(row.id);
    if (!sessionId) continue;

    const snapshot = hermesUsageSnapshot(row);
    if (usageSnapshotTotal(snapshot) <= 0) {
      state.sessions[sessionId] = maxSnapshot(snapshot, state.sessions[sessionId]);
      continue;
    }

    const createdAt = timestampToIso(row.ended_at) || timestampToIso(row.started_at) || new Date().toISOString();
    const isHistorical = isBeforeHistoryStart(createdAt, settings.historyStartAtMs);
    const previous = state.sessions[sessionId];
    state.sessions[sessionId] = maxSnapshot(snapshot, previous);

    if (isHistorical) continue;

    const delta = previous ? diffSnapshot(snapshot, previous) : initialHermesSnapshotDelta(snapshot, row, settings);
    if (!delta || usageSnapshotTotal(delta) <= 0) continue;

    const eventCreatedAt = previous
      ? timestampToIso(row.ended_at) || new Date().toISOString()
      : timestampToIso(row.ended_at) || timestampToIso(row.started_at) || new Date().toISOString();
    const event: UsageEvent = {
      id: `hermes-session:${hash(`${sessionId}:${snapshot.inputTokens}:${snapshot.outputTokens}:${snapshot.cacheReadTokens}:${snapshot.cacheWriteTokens}`)}`,
      createdAt: eventCreatedAt,
      source: "hermes-session",
      agent: "hermes",
      provider: stringValue(row.billing_provider) || stringValue(row.source) || "hermes",
      model: stringValue(row.model),
      inputTokens: delta.inputTokens,
      outputTokens: delta.outputTokens,
      cacheReadTokens: delta.cacheReadTokens,
      cacheWriteTokens: delta.cacheWriteTokens,
      totalTokens: delta.inputTokens + delta.outputTokens,
      streaming: false,
    };
    if (!usageEventHasTokens(event) || state.events[event.id]) continue;
    state.events[event.id] = true;
    onUsage(event);
    imported += 1;
  }

  writeState(statePath, state);
  return imported;
}

function scanOpenCodeDb(
  dbPath: string,
  state: WatchState,
  statePath: string,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number },
  onUsage: (event: UsageEvent) => void,
) {
  const currentMtime = sqliteDbScanMtime(dbPath);
  const previousMtime = state.files[dbPath];
  if (previousMtime !== undefined && currentMtime <= previousMtime) {
    return 0;
  }

  const rows = readOpenCodeMessageRows(dbPath);
  if (!rows) {
    return 0;
  }
  state.files[dbPath] = currentMtime;

  let imported = 0;
  for (const row of rows) {
    const event = parseOpenCodeMessageRow(row);
    if (!event || !usageEventHasTokens(event)) continue;

    if (state.events[event.id]) continue;
    state.events[event.id] = true;
    if (!shouldImportOpenCodeDbEvent(event.createdAt, previousMtime === undefined, settings)) continue;
    onUsage(event);
    imported += 1;
  }

  writeState(statePath, state);
  return imported;
}

function readOpenCodeMessageRows(dbPath: string): OpenCodeMessageRow[] | undefined {
  const query = `
    SELECT
      id,
      session_id,
      time_created,
      json_extract(data, '$.id') AS data_id,
      json_extract(data, '$.sessionId') AS data_session_id,
      json_extract(data, '$.sessionID') AS data_session_id_legacy,
      json_extract(data, '$.providerId') AS provider_id,
      json_extract(data, '$.providerID') AS provider_id_legacy,
      json_extract(data, '$.modelId') AS model_id,
      json_extract(data, '$.modelID') AS model_id_legacy,
      json_extract(data, '$.agent') AS agent,
      json_extract(data, '$.time.created') AS created_at,
      json_extract(data, '$.time.completed') AS completed_at,
      json_extract(data, '$.tokens.input') AS input_tokens,
      json_extract(data, '$.tokens.output') AS output_tokens,
      json_extract(data, '$.tokens.reasoning') AS reasoning_tokens,
      json_extract(data, '$.tokens.cache.read') AS cache_read_tokens,
      json_extract(data, '$.tokens.cache.write') AS cache_write_tokens
    FROM message
    WHERE json_extract(data, '$.role') = 'assistant'
      AND (
        json_extract(data, '$.tokens.input') > 0
        OR json_extract(data, '$.tokens.output') > 0
        OR json_extract(data, '$.tokens.reasoning') > 0
        OR json_extract(data, '$.tokens.cache.read') > 0
        OR json_extract(data, '$.tokens.cache.write') > 0
      )
    ORDER BY time_created ASC, id ASC
  `;
  try {
    const output = execFileSync("sqlite3", ["-json", dbPath, query], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const parsed = JSON.parse(output || "[]");
    return Array.isArray(parsed) ? (parsed as OpenCodeMessageRow[]) : [];
  } catch {
    return undefined;
  }
}

function parseOpenCodeMessageRow(row: OpenCodeMessageRow): UsageEvent | undefined {
  const inputTokens = numberValue(row.input_tokens);
  const outputTokens = numberValue(row.output_tokens) + numberValue(row.reasoning_tokens);
  const cacheReadTokens = numberValue(row.cache_read_tokens);
  const cacheWriteTokens = numberValue(row.cache_write_tokens);
  const totalTokens = inputTokens + outputTokens;
  if (totalTokens + cacheReadTokens + cacheWriteTokens <= 0) return undefined;

  const messageId = stringValue(row.data_id) || stringValue(row.id);
  const sessionId = stringValue(row.data_session_id) || stringValue(row.data_session_id_legacy) || stringValue(row.session_id);
  const provider = stringValue(row.provider_id) || stringValue(row.provider_id_legacy) || "opencode";
  const model = stringValue(row.model_id) || stringValue(row.model_id_legacy);
  const agentName = stringValue(row.agent);

  return {
    id: `opencode-session:${hash(`${sessionId ?? "unknown"}:${messageId}`)}`,
    createdAt: timestampToIso(row.completed_at) || timestampToIso(row.created_at) || timestampToIso(row.time_created) || new Date().toISOString(),
    source: "opencode-session",
    agent: agentName ? `opencode:${agentName}` : "opencode",
    provider,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    streaming: false,
  };
}

function shouldImportOpenCodeDbEvent(
  createdAt: string,
  isInitialScan: boolean,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number },
) {
  if (isBeforeHistoryStart(createdAt, settings.historyStartAtMs)) return false;
  if (!isInitialScan) return true;

  const createdAtMs = timestampMs(createdAt);
  if (!createdAtMs) return false;
  if (settings.historyStartAtMs) return createdAtMs >= settings.historyStartAtMs - 5_000;
  if (settings.importHistory) return isTodayTimestamp(createdAtMs);
  return createdAtMs >= settings.watcherStartedAt - 5_000;
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

function parseClaudeLine(line: string, filePath: string, lineOffset: number): UsageEvent | undefined {
  const parsed = parseJson(line);
  if (!parsed || parsed.type !== "assistant") return undefined;

  const message = asRecord(parsed.message);
  if (!message) return undefined;
  if (!message.stop_reason) return undefined;

  const usage = asRecord(message.usage);
  const tokens = parseStandardUsage(usage);
  if (!tokens || tokens.outputTokens <= 0) return undefined;

  const messageId = stringValue(message.id) || hash(`${filePath}:${lineOffset}`);
  const model = stringValue(message.model);
  const agentId = stringValue(parsed.agentId);

  return {
    id: `claude-session:${messageId}`,
    createdAt: stringValue(parsed.timestamp) || new Date().toISOString(),
    source: "claude-session",
    agent: agentId ? `claude-code:${agentId}` : "claude-code",
    provider: "anthropic",
    model,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    cacheWriteTokens: tokens.cacheWriteTokens,
    totalTokens: tokens.inputTokens + tokens.outputTokens,
    streaming: true,
  };
}

function parseOpenClawLine(line: string, filePath: string, lineOffset: number): UsageEvent | undefined {
  const parsed = parseJson(line);
  if (!parsed || parsed.type !== "message") return undefined;

  const message = asRecord(parsed.message);
  if (!message || message.role !== "assistant") return undefined;

  const usage = asRecord(message.usage);
  const tokens = parseOpenClawUsage(usage);
  if (!tokens) return undefined;

  const messageId = stringValue(parsed.id) || stringValue(message.responseId) || hash(`${filePath}:${lineOffset}`);
  const provider = stringValue(message.provider) || "openclaw";
  const model = stringValue(message.model);

  return {
    id: `openclaw-session:${hash(`${filePath}:${messageId}`)}`,
    createdAt: stringValue(parsed.timestamp) || new Date().toISOString(),
    source: "openclaw-session",
    agent: "openclaw",
    provider,
    model,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    cacheWriteTokens: tokens.cacheWriteTokens,
    totalTokens: tokens.inputTokens + tokens.outputTokens,
    streaming: false,
  };
}

function parsePiLine(line: string, filePath: string, lineOffset: number): UsageEvent | undefined {
  const parsed = parseJson(line);
  if (!parsed || parsed.type !== "message") return undefined;

  const message = asRecord(parsed.message);
  if (!message || message.role !== "assistant") return undefined;

  const usage = asRecord(message.usage);
  const tokens = parseOpenClawUsage(usage);
  if (!tokens) return undefined;

  const messageId = stringValue(parsed.id) || hash(`${filePath}:${lineOffset}`);
  const provider = stringValue(message.provider) || "pi-agent";
  const model = stringValue(message.model);

  return {
    id: `pi-session:${hash(`${filePath}:${messageId}`)}`,
    createdAt: stringValue(parsed.timestamp) || new Date().toISOString(),
    source: "pi-session",
    agent: "pi-agent",
    provider,
    model,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    cacheWriteTokens: tokens.cacheWriteTokens,
    totalTokens: tokens.inputTokens + tokens.outputTokens,
    streaming: false,
  };
}

function parseOpenCodeFile(filePath: string): UsageEvent | undefined {
  const parsed = readJsonFile(filePath);
  if (!parsed || parsed.role !== "assistant") return undefined;

  const tokens = asRecord(parsed.tokens);
  if (!tokens) return undefined;

  const cache = asRecord(tokens.cache);
  const inputTokens = numberValue(tokens.input);
  const outputTokens = numberValue(tokens.output) + numberValue(tokens.reasoning);
  const cacheReadTokens = numberValue(cache?.read);
  const cacheWriteTokens = numberValue(cache?.write);
  const totalTokens = inputTokens + outputTokens;
  if (totalTokens <= 0) return undefined;

  const messageId = stringValue(parsed.id) || hash(filePath);
  const sessionId = stringValue(parsed.sessionID) || stringValue(parsed.sessionId);
  const provider = stringValue(parsed.providerID) || stringValue(parsed.providerId) || "opencode";
  const model = stringValue(parsed.modelID) || stringValue(parsed.modelId);
  const agentName = stringValue(parsed.agent);
  const time = asRecord(parsed.time);

  return {
    id: `opencode-session:${hash(`${sessionId ?? "unknown"}:${messageId}`)}`,
    createdAt: timestampToIso(time?.completed) || timestampToIso(time?.created) || new Date().toISOString(),
    source: "opencode-session",
    agent: agentName ? `opencode:${agentName}` : "opencode",
    provider,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    streaming: false,
  };
}

function parseGeminiFile(filePath: string): UsageEvent[] | undefined {
  if (!basename(filePath).startsWith("session-")) return undefined;
  const content = readTextFile(filePath);
  if (!content) return undefined;

  if (filePath.endsWith(".jsonl")) {
    return parseGeminiJsonl(content, filePath);
  }

  const parsed = parseJson(content);
  if (!parsed) return undefined;
  const messages = Array.isArray(parsed.messages) ? parsed.messages : undefined;
  if (!messages) return undefined;

  const sessionId = stringValue(parsed.sessionId) || hash(filePath);
  const events: UsageEvent[] = [];
  messages.forEach((item, index) => {
    const event = parseGeminiMessage(item, sessionId, index);
    if (event) events.push(event);
  });

  return events.length > 0 ? events : undefined;
}

function parseGeminiJsonl(content: string, filePath: string): UsageEvent[] | undefined {
  const rows = content
    .split("\n")
    .map((line) => parseJson(line))
    .filter((row): row is Record<string, unknown> => Boolean(row));
  const sessionId = rows.map((row) => stringValue(row.sessionId)).find(Boolean) || hash(filePath);
  const events: UsageEvent[] = [];
  rows.forEach((row, index) => {
    const event = parseGeminiMessage(row, sessionId, index);
    if (event) events.push(event);
  });
  return events.length > 0 ? events : undefined;
}

function parseGeminiMessage(item: unknown, sessionId: string, index: number): UsageEvent | undefined {
  const message = asRecord(item);
  if (!message || message.type !== "gemini") return undefined;

  const tokens = asRecord(message.tokens);
  if (!tokens) return undefined;

  const inputTokens = numberValue(tokens.input);
  const outputTokens = numberValue(tokens.output) + numberValue(tokens.thoughts);
  const cacheReadTokens = numberValue(tokens.cached);
  const totalTokens = inputTokens + outputTokens;
  if (totalTokens + cacheReadTokens <= 0) return undefined;

  const messageId = stringValue(message.id) || String(index);
  const model = stringValue(message.model);
  return {
    id: `gemini-session:${hash(`${sessionId}:${messageId}`)}`,
    createdAt: stringValue(message.timestamp) || new Date().toISOString(),
    source: "gemini-session",
    agent: "gemini",
    provider: "google",
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens: 0,
    totalTokens,
    streaming: true,
  };
}

function parseStandardUsage(usage: Record<string, unknown> | undefined) {
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  const cacheReadTokens = numberValue(usage.cache_read_input_tokens);
  const cacheWriteTokens = numberValue(usage.cache_creation_input_tokens);
  if (inputTokens + outputTokens <= 0) return undefined;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

function parseOpenClawUsage(usage: Record<string, unknown> | undefined) {
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input);
  const outputTokens = numberValue(usage.output);
  const cacheReadTokens = numberValue(usage.cacheRead);
  const cacheWriteTokens = numberValue(usage.cacheWrite);
  const totalTokens = numberValue(usage.totalTokens) || inputTokens + outputTokens;
  if (totalTokens <= 0) return undefined;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

function toUsageEvents(result: UsageEvent | UsageEvent[] | undefined) {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

function usageEventHasTokens(event: UsageEvent) {
  return event.inputTokens + event.outputTokens + event.cacheReadTokens + event.cacheWriteTokens > 0;
}

function readHermesSessionRows(stateDbPath: string): HermesSessionRow[] | undefined {
  const query = `
    SELECT id, source, model, billing_provider, started_at, ended_at,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens
    FROM sessions
    WHERE input_tokens > 0
       OR output_tokens > 0
       OR cache_read_tokens > 0
       OR cache_write_tokens > 0
       OR reasoning_tokens > 0
  `;
  try {
    const output = execFileSync("sqlite3", ["-json", stateDbPath, query], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    const parsed = JSON.parse(output || "[]");
    return Array.isArray(parsed) ? (parsed as HermesSessionRow[]) : [];
  } catch {
    return undefined;
  }
}

function hermesUsageSnapshot(row: HermesSessionRow): UsageSnapshot {
  return {
    inputTokens: numberValue(row.input_tokens),
    outputTokens: numberValue(row.output_tokens) + numberValue(row.reasoning_tokens),
    cacheReadTokens: numberValue(row.cache_read_tokens),
    cacheWriteTokens: numberValue(row.cache_write_tokens),
  };
}

function initialHermesSnapshotDelta(
  snapshot: UsageSnapshot,
  row: HermesSessionRow,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number },
) {
  const startedAtMs = timestampMs(timestampToIso(row.started_at));
  const endedAtMs = timestampMs(timestampToIso(row.ended_at));
  const activeAtMs = endedAtMs ?? startedAtMs;
  if (settings.historyStartAtMs && activeAtMs && activeAtMs >= settings.historyStartAtMs - 5_000) {
    return snapshot;
  }
  if (settings.importHistory && activeAtMs && isTodayTimestamp(activeAtMs)) {
    return snapshot;
  }
  if (activeAtMs && activeAtMs >= settings.watcherStartedAt - 5_000) {
    return snapshot;
  }
  return undefined;
}

function diffSnapshot(next: UsageSnapshot, previous: UsageSnapshot): UsageSnapshot | undefined {
  const delta = {
    inputTokens: Math.max(0, next.inputTokens - previous.inputTokens),
    outputTokens: Math.max(0, next.outputTokens - previous.outputTokens),
    cacheReadTokens: Math.max(0, next.cacheReadTokens - previous.cacheReadTokens),
    cacheWriteTokens: Math.max(0, next.cacheWriteTokens - previous.cacheWriteTokens),
  };
  return usageSnapshotTotal(delta) > 0 ? delta : undefined;
}

function maxSnapshot(next: UsageSnapshot, previous: UsageSnapshot | undefined): UsageSnapshot {
  if (!previous) return next;
  return {
    inputTokens: Math.max(next.inputTokens, previous.inputTokens),
    outputTokens: Math.max(next.outputTokens, previous.outputTokens),
    cacheReadTokens: Math.max(next.cacheReadTokens, previous.cacheReadTokens),
    cacheWriteTokens: Math.max(next.cacheWriteTokens, previous.cacheWriteTokens),
  };
}

function usageSnapshotTotal(snapshot: UsageSnapshot) {
  return snapshot.inputTokens + snapshot.outputTokens + snapshot.cacheReadTokens + snapshot.cacheWriteTokens;
}

function hermesStateDbPath(value: string | undefined) {
  if (!value) return DEFAULT_HERMES_STATE_DB;
  return value.endsWith(".db") ? value : join(value, "state.db");
}

function readJsonFile(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readTextFile(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function listJsonlFiles(root: string) {
  const result: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl") && !entry.name.endsWith(".trajectory.jsonl")) {
        result.push(fullPath);
      }
    }
  };
  visit(root);
  return result;
}

function listJsonFiles(root: string, fileExtensions: string[]) {
  const result: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && fileExtensions.some((extension) => entry.name.endsWith(extension))) {
        result.push(fullPath);
      }
    }
  };
  visit(root);
  return result;
}

function initialOffset(
  filePath: string,
  stats: Stats,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number },
) {
  if (settings.historyStartAtMs && stats.mtimeMs >= settings.historyStartAtMs - 5_000) {
    return 0;
  }
  if (settings.importHistory && isTodaySessionPath(filePath)) {
    return 0;
  }
  if (stats.mtimeMs >= settings.watcherStartedAt - 5_000) {
    return 0;
  }
  return stats.size;
}

function shouldSkipInitialJsonFile(
  filePath: string,
  stats: Stats,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number },
) {
  if (settings.historyStartAtMs && stats.mtimeMs >= settings.historyStartAtMs - 5_000) {
    return false;
  }
  if (settings.importHistory && isTodaySessionPath(filePath)) {
    return false;
  }
  return stats.mtimeMs < settings.watcherStartedAt - 5_000;
}

function readState(path: string): WatchState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WatchState>;
    return {
      files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
      events: parsed.events && typeof parsed.events === "object" ? parsed.events : {},
      sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
      historyStartAt: typeof parsed.historyStartAt === "string" ? parsed.historyStartAt : undefined,
    };
  } catch {
    return { files: {}, events: {}, sessions: {} };
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

function timestampToIso(value: unknown) {
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
  return new Date(milliseconds).toISOString();
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

function isTodayTimestamp(value: number) {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function isTodaySessionPath(filePath: string) {
  const now = new Date();
  const parts = filePath.split(/[\\/]+/);
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  for (let index = 0; index < parts.length - 2; index += 1) {
    if (parts[index] === year && parts[index + 1] === month && parts[index + 2] === day) {
      return true;
    }
  }
  return false;
}

function openCodeWatcherTarget(configuredPath: string | undefined): { kind: "sqlite" | "json"; path: string } {
  if (configuredPath) {
    const directoryDbPath = join(configuredPath, "opencode.db");
    if (isSqliteDbPath(configuredPath) || isFile(configuredPath)) {
      return { kind: "sqlite", path: configuredPath };
    }
    if (existsSync(directoryDbPath)) {
      return { kind: "sqlite", path: directoryDbPath };
    }
    return { kind: "json", path: configuredPath };
  }

  if (existsSync(DEFAULT_OPENCODE_DB) || !existsSync(DEFAULT_OPENCODE_MESSAGES_ROOT)) {
    return { kind: "sqlite", path: DEFAULT_OPENCODE_DB };
  }
  return { kind: "json", path: DEFAULT_OPENCODE_MESSAGES_ROOT };
}

function sqliteDbScanMtime(dbPath: string) {
  let mtimeMs = statSync(dbPath).mtimeMs;
  for (const siblingPath of [`${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!existsSync(siblingPath)) continue;
    mtimeMs = Math.max(mtimeMs, statSync(siblingPath).mtimeMs);
  }
  return mtimeMs;
}

function isSqliteDbPath(path: string) {
  return /\.db(?:3|)$/i.test(path);
}

function isFile(path: string) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function defaultOpenCodeDbPath() {
  if (process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, "opencode", "opencode.db");
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "opencode", "opencode.db");
  }
  return join(homedir(), ".local", "share", "opencode", "opencode.db");
}

function defaultOpenCodeMessagesRoot() {
  if (process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, "opencode", "storage", "message");
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "opencode", "storage", "message");
  }
  return join(homedir(), ".local", "share", "opencode", "storage", "message");
}

function defaultPiSessionsRoot() {
  const piAgentDir = process.env.PI_AGENT_DIR?.trim();
  if (piAgentDir) return piAgentDir;
  const piCodingAgentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (piCodingAgentDir) return join(piCodingAgentDir, "sessions");
  return join(homedir(), ".pi", "agent", "sessions");
}
