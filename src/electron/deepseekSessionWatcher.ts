import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import type { SessionMonitorStatus, UsageEvent } from "../shared/types.js";

const POLL_INTERVAL_MS = 10_000;
const INITIAL_SCAN_DELAY_MS = 100;
const STATE_VERSION = 1;
const ZSTD_MAGIC = 0xfd2fb528;
const DEFAULT_PROVIDER = "deepseek-harness";

type JsonRecord = Record<string, unknown>;

interface UsageBuckets {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface Route {
  provider: string;
  model?: string;
}

interface PendingStep {
  turn: number;
  step: number;
  usage: UsageBuckets;
  usageSeq: number;
  createdAt: string;
  route: Route;
}

interface FileState {
  encoding: "raw" | "zstd";
  committedBytes: number;
  lastSize?: number;
  lastMtimeMs?: number;
  fileIdentity?: string;
  sessionId?: string;
  headerIdentity?: string;
  seedLength: number;
  route: Route;
  openStep?: { turn: number; step: number };
  pending?: PendingStep;
  zstdRemainder?: string;
}

interface PersistedState {
  version: number;
  historyStartAt?: string;
  files: Record<string, FileState>;
  emitted: Record<string, true>;
}

interface SessionHeader {
  id: string;
  version: number;
  createdAt?: number;
  cwd?: string;
  seedLength: number;
}

interface ScannedFrame {
  start: number;
  end: number;
}

interface FrameScanResult {
  frames: ScannedFrame[];
  completeBytes: number;
  invalid?: boolean;
}

interface WatcherOptions {
  userDataPath: string;
  sessionsRoot?: string;
  historyStartAt?: string;
  onUsage: (event: UsageEvent) => void;
  onStatus?: (status: SessionMonitorStatus) => void;
}

export interface DeepSeekSessionWatcher {
  close: () => void;
  getStatus: () => SessionMonitorStatus;
  scanNow: () => Promise<number>;
}

export function resolveDeepSeekSessionsRoot(explicitRoot?: string) {
  const explicit = explicitRoot?.trim();
  if (explicit) return resolve(expandHome(explicit));
  const envRoot = process.env.VIBE_DEEPSEEK_SESSIONS_DIR?.trim();
  if (envRoot) return resolve(expandHome(envRoot));
  const dshHome = process.env.DSH_HOME?.trim();
  return resolve(join(expandHome(dshHome || join(homedir(), ".dsh")), "sessions"));
}

function expandHome(value: string) {
  return value.replace(/^~(?=$|[\\/])/, homedir());
}

export function startDeepSeekSessionWatcher(options: WatcherOptions): DeepSeekSessionWatcher {
  const sessionsRoot = resolveDeepSeekSessionsRoot(options.sessionsRoot);
  const statePath = join(options.userDataPath, "deepseek-session-watcher.json");
  const historyStartAt = effectiveHistoryStartAt(options.historyStartAt);
  const importHistory = Boolean(historyStartAt);
  const initialScanStartedAt = Date.now();
  let state = loadState(statePath, historyStartAt);
  let closed = false;
  let scanning = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let eventsImported = 0;
  let lastScanAt: string | undefined;
  let lastEventAt: string | undefined;
  let filesWatched = 0;
  let exists = existsSync(sessionsRoot);

  const status = (): SessionMonitorStatus => ({
    running: !closed,
    sessionsRoot,
    exists,
    filesWatched,
    eventsImported,
    importHistory,
    historyStartAt,
    lastScanAt,
    lastEventAt,
  });

  const publishStatus = () => options.onStatus?.(status());

  const scanNow = async () => {
    if (closed || scanning) return 0;
    scanning = true;
    let importedThisScan = 0;
    try {
      exists = existsSync(sessionsRoot);
      const paths = exists ? listSessionFiles(sessionsRoot) : [];
      filesWatched = paths.length;
      const present = new Set(paths);
      for (const knownPath of Object.keys(state.files)) {
        if (!present.has(knownPath)) delete state.files[knownPath];
      }
      for (const filePath of paths) {
        try {
          importedThisScan += scanFile(filePath, state, {
            historyStartAt,
            initialScanStartedAt,
            onUsage: (event) => {
              eventsImported += 1;
              lastEventAt = event.createdAt;
              options.onUsage(event);
            },
          });
        } catch {
          // A concurrent rotation or malformed artifact must not stop other sessions.
        }
      }
      lastScanAt = new Date().toISOString();
      persistState(statePath, state);
      publishStatus();
      return importedThisScan;
    } finally {
      scanning = false;
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    persistState(statePath, state);
    publishStatus();
  };

  publishStatus();
  timer = setInterval(() => void scanNow(), POLL_INTERVAL_MS);
  setTimeout(() => void scanNow(), INITIAL_SCAN_DELAY_MS);

  return { close, getStatus: status, scanNow };
}

function scanFile(
  filePath: string,
  state: PersistedState,
  options: {
    historyStartAt?: string;
    initialScanStartedAt: number;
    onUsage: (event: UsageEvent) => void;
  },
) {
  let fileStat: ReturnType<typeof statSync>;
  try {
    fileStat = statSync(filePath);
  } catch {
    return 0;
  }
  const encoding = filePath.endsWith(".zstd") ? "zstd" : "raw";
  let fileState = state.files[filePath];
  const fileIdentity = `${String(fileStat.dev ?? "")}:${String(fileStat.ino ?? "")}`;
  const replacedInPlace =
    Boolean(fileState?.lastMtimeMs !== undefined && fileState.lastMtimeMs !== fileStat.mtimeMs && fileState.lastSize === fileStat.size);
  if (
    !fileState ||
    fileState.encoding !== encoding ||
    fileState.committedBytes > fileStat.size ||
    (fileState.fileIdentity && fileState.fileIdentity !== fileIdentity) ||
    replacedInPlace
  ) {
    fileState = newFileState(encoding);
    state.files[filePath] = fileState;
  }
  fileState.route ??= { provider: DEFAULT_PROVIDER };
  fileState.committedBytes = Number.isFinite(fileState.committedBytes) ? Math.max(0, Math.floor(fileState.committedBytes)) : 0;
  fileState.seedLength = Number.isFinite(fileState.seedLength) ? Math.max(0, Math.floor(fileState.seedLength)) : 0;
  const bytes = readFromOffset(filePath, fileState.committedBytes, fileStat.size);
  if (!bytes.length) return 0;
  const result = encoding === "zstd" ? scanZstdBytes(bytes) : scanRawBytes(bytes);
  if (result.invalid) {
    // Leave the offset unchanged so a transient/torn write can be retried.
    return 0;
  }
  const records = encoding === "zstd" ? decodeFrames(bytes, result.frames, fileState) : decodeRaw(bytes, result.completeBytes);
  let imported = 0;
  let localOffset = fileState.committedBytes;
  for (const record of records) {
    const parsed = processRecord(record, fileState, state, options);
    if (parsed.imported) imported += 1;
  }
  localOffset += result.completeBytes;
  fileState.committedBytes = localOffset;
  fileState.lastSize = fileStat.size;
  fileState.lastMtimeMs = fileStat.mtimeMs;
  fileState.fileIdentity = fileIdentity;
  return imported;
}

function processRecord(
  record: JsonRecord,
  fileState: FileState,
  state: PersistedState,
  options: {
    historyStartAt?: string;
    initialScanStartedAt: number;
    onUsage: (event: UsageEvent) => void;
  },
) {
  const type = typeof record.type === "string" ? record.type : "";
  // DSH stores events as `{ type, seq, time, data }`. Keep a flattened
  // fallback for hand-authored diagnostic logs and older fixtures.
  const data = asRecord(record.data) ?? record;
  const seq = numberValue(record.seq) ?? 0;
  if (type === "session") {
    const header = parseSessionHeader(record);
    if (!header) return { imported: false };
    const identity = `${header.id}:${header.createdAt ?? ""}`;
    if (fileState.sessionId && fileState.sessionId !== header.id) {
      fileState.pending = undefined;
      fileState.openStep = undefined;
    }
    fileState.sessionId = header.id;
    fileState.headerIdentity = identity;
    fileState.seedLength = header.seedLength;
    return { imported: false };
  }
  if (!fileState.sessionId) return { imported: false };

  if (type === "step/start") {
    const turn = numberValue(data.turn);
    const step = numberValue(data.step);
    if (turn !== undefined && step !== undefined) {
      if (fileState.pending && (fileState.pending.turn !== turn || fileState.pending.step !== step)) {
        const imported = finalizePending(fileState, state, options);
        fileState.openStep = { turn, step };
        return { imported };
      }
      fileState.openStep = { turn, step };
    }
    return { imported: false };
  }
  if (type === "step/end") {
    const turn = numberValue(data.turn);
    const step = numberValue(data.step);
    const imported = turn !== undefined && step !== undefined
      ? finalizePending(fileState, state, options, turn, step)
      : finalizePending(fileState, state, options);
    if (!fileState.pending || (turn === fileState.pending.turn && step === fileState.pending.step)) fileState.openStep = undefined;
    return { imported };
  }
  if (type === "request/header") {
    const header = asRecord(data.header);
    const config = asRecord(header?.config);
    const route = routeFrom(config) ?? routeFrom(header);
    if (route) fileState.route = route;
    return { imported: false };
  }
  if (type === "request/context") {
    const route = routeFrom(data);
    if (route) fileState.route = route;
    return { imported: false };
  }
  if (type === "assistant/chunk") {
    const turn = numberValue(data.turn);
    const step = numberValue(data.step);
    const chunk = asRecord(data.chunk);
    const usage = usageFrom(chunk?.usage ?? chunk);
    if (turn === undefined || step === undefined || !usage) return { imported: false };
    let imported = false;
    if (fileState.pending && (fileState.pending.turn !== turn || fileState.pending.step !== step)) {
      imported = finalizePending(fileState, state, options);
    }
    fileState.pending = {
      turn,
      step,
      usage,
      usageSeq: seq,
      createdAt: recordTimestamp(record),
      route: { ...fileState.route },
    };
    return { imported };
  }
  if (type === "assistant/message") {
    const turn = numberValue(data.turn);
    const step = numberValue(data.step);
    if (turn === undefined || step === undefined) return { imported: false };
    const usage = usageFrom(data.usage ?? asRecord(data.message)?.usage);
    if (!usage) return { imported: false };
    fileState.pending = {
      turn,
      step,
      usage,
      usageSeq: seq,
      createdAt: recordTimestamp(record),
      route: { ...fileState.route },
    };
    return { imported: finalizePending(fileState, state, options, turn, step) };
  }
  if (type === "turn/end") {
    const turn = numberValue(data.turn);
    if (turn === undefined || !fileState.pending || fileState.pending.turn !== turn) return { imported: false };
    return { imported: finalizePending(fileState, state, options, turn, fileState.pending.step) };
  }
  return { imported: false };
}

function finalizePending(
  fileState: FileState,
  state: PersistedState,
  options: {
    historyStartAt?: string;
    initialScanStartedAt: number;
    onUsage: (event: UsageEvent) => void;
  },
  turn?: number,
  step?: number,
) {
  const pending = fileState.pending;
  if (!pending || (turn !== undefined && pending.turn !== turn) || (step !== undefined && pending.step !== step)) return false;
  fileState.pending = undefined;
  const id = stableEventId(fileState, pending);
  if (state.emitted[id]) return false;
  state.emitted[id] = true;
  if (pending.usageSeq < fileState.seedLength) return false;
  if (!isImportable(pending.createdAt, options.historyStartAt, options.initialScanStartedAt)) return false;
  const totalTokens = pending.usage.inputTokens + pending.usage.outputTokens;
  const countedTokens = totalTokens + pending.usage.cacheReadTokens + pending.usage.cacheWriteTokens;
  if (countedTokens <= 0) return false;
  options.onUsage({
    id,
    createdAt: pending.createdAt,
    source: "deepseek-session",
    agent: "deepseek-harness",
    provider: pending.route.provider || DEFAULT_PROVIDER,
    model: pending.route.model,
    inputTokens: pending.usage.inputTokens,
    outputTokens: pending.usage.outputTokens,
    cacheReadTokens: pending.usage.cacheReadTokens,
    cacheWriteTokens: pending.usage.cacheWriteTokens,
    totalTokens,
    streaming: false,
  });
  return true;
}

function newFileState(encoding: "raw" | "zstd"): FileState {
  return { encoding, committedBytes: 0, seedLength: 0, route: { provider: DEFAULT_PROVIDER } };
}

function parseSessionHeader(record: JsonRecord): SessionHeader | undefined {
  if (record.type !== "session" || typeof record.id !== "string" || !record.id.trim()) return undefined;
  const version = numberValue(record.version);
  if (version !== 0) return undefined;
  return {
    id: record.id,
    version,
    createdAt: numberValue(record.createdAt),
    cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    seedLength: Math.max(0, Math.floor(numberValue(record.seedLength) ?? 0)),
  };
}

function routeFrom(record: JsonRecord | undefined): Route | undefined {
  if (!record) return undefined;
  const provider = stringValue(record.provider) ?? stringValue(record.providerId);
  const model = stringValue(record.model) ?? stringValue(record.modelId);
  if (!provider && !model) return undefined;
  return { provider: provider || DEFAULT_PROVIDER, model };
}

function usageFrom(value: unknown): UsageBuckets | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  const inputTokens = nonNegativeNumber(usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens);
  const outputTokens = nonNegativeNumber(
    usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens,
  );
  const cacheReadTokens = nonNegativeNumber(usage.cacheReadTokens ?? usage.cache_read_tokens ?? usage.cachedInputTokens ?? usage.cached_input_tokens);
  const cacheWriteTokens = nonNegativeNumber(usage.cacheWriteTokens ?? usage.cache_write_tokens);
  if (inputTokens === undefined && outputTokens === undefined && cacheReadTokens === undefined && cacheWriteTokens === undefined) {
    return undefined;
  }
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cacheReadTokens: cacheReadTokens ?? 0,
    cacheWriteTokens: cacheWriteTokens ?? 0,
  };
}

function stableEventId(fileState: FileState, pending: PendingStep) {
  const identity = fileState.headerIdentity || fileState.sessionId || "unknown-session";
  return `deepseek-session:${createHash("sha256").update(`${identity}:${pending.turn}:${pending.step}`).digest("hex").slice(0, 32)}`;
}

function recordTimestamp(record: JsonRecord) {
  const value = record.time ?? record.timestamp ?? record.createdAt;
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function isImportable(createdAt: string, historyStartAt: string | undefined, initialScanStartedAt: number) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return true;
  if (historyStartAt) return timestamp >= Date.parse(historyStartAt);
  return timestamp >= initialScanStartedAt - 5_000;
}

function effectiveHistoryStartAt(configured?: string) {
  if (process.env.VIBE_DEEPSEEK_IMPORT_HISTORY?.trim().toLowerCase() === "today") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.toISOString();
  }
  const parsed = configured ? Date.parse(configured) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function listSessionFiles(root: string): string[] {
  const result: string[] = [];
  const walk = (dir: string) => {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" }) as unknown as Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && (entry.name === "session.jsonl" || entry.name === "session.jsonl.zstd")) result.push(path);
    }
  };
  walk(root);
  return result.sort();
}

function readFromOffset(filePath: string, offset: number, size: number) {
  const length = Math.max(0, size - offset);
  if (!length) return Buffer.alloc(0);
  const fd = openSync(filePath, "r");
  const buffer = Buffer.alloc(length);
  try {
    readSync(fd, buffer, 0, length, offset);
    return buffer;
  } finally {
    closeSync(fd);
  }
}

function scanRawBytes(bytes: Buffer) {
  const lastNewline = bytes.lastIndexOf(0x0a);
  if (lastNewline < 0) return { frames: [], completeBytes: 0 } as FrameScanResult;
  return { frames: [], completeBytes: lastNewline + 1 } as FrameScanResult;
}

function decodeRaw(bytes: Buffer, completeBytes: number): JsonRecord[] {
  const text = bytes.subarray(0, completeBytes).toString("utf8");
  const records: JsonRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      const record = asRecord(value);
      if (record) records.push(record);
    } catch {
      // A malformed line must not stop later session records from being imported.
    }
  }
  return records;
}

function scanZstdBytes(bytes: Buffer): FrameScanResult {
  const frames: ScannedFrame[] = [];
  let cursor = 0;
  let completeBytes = 0;
  while (cursor < bytes.length) {
    if (bytes.length - cursor < 4) break;
    if (bytes.readUInt32LE(cursor) !== ZSTD_MAGIC) {
      const nextMagic = findZstdMagic(bytes, cursor + 1);
      if (nextMagic < 0) break;
      cursor = nextMagic;
    }
    const frameEnd = scanOneZstdFrame(bytes, cursor);
    if (frameEnd === undefined) break;
    frames.push({ start: cursor, end: frameEnd });
    cursor = frameEnd;
    completeBytes = cursor;
  }
  return {
    frames,
    completeBytes,
    invalid: frames.length === 0 && bytes.length >= 4 && findZstdMagic(bytes, 0) < 0,
  };
}

function findZstdMagic(bytes: Buffer, from: number) {
  for (let index = Math.max(0, from); index <= bytes.length - 4; index += 1) {
    if (bytes.readUInt32LE(index) === ZSTD_MAGIC) return index;
  }
  return -1;
}

function scanOneZstdFrame(bytes: Buffer, start: number) {
  let offset = start + 4;
  if (offset >= bytes.length) return undefined;
  const descriptor = bytes[offset++];
  if ((descriptor & 0x08) !== 0 || (descriptor & 0x10) !== 0) return undefined;
  const singleSegment = (descriptor & 0x20) !== 0;
  const checksum = (descriptor & 0x04) !== 0;
  const dictFlag = descriptor & 0x03;
  if (!singleSegment) {
    if (offset >= bytes.length) return undefined;
    offset += 1;
  }
  const dictBytes = [0, 1, 2, 4][dictFlag];
  const fcsFlag = descriptor >>> 6;
  // With FCS flag 0, a single-segment frame stores a one-byte content size;
  // a windowed/non-single-segment frame stores no content-size field at all.
  // The latter is common for large Harness append batches.
  const fcsBytes = fcsFlag === 0 ? (singleSegment ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8;
  offset += dictBytes + fcsBytes;
  if (offset > bytes.length) return undefined;
  while (true) {
    if (offset + 3 > bytes.length) return undefined;
    const blockHeader = bytes.readUIntLE(offset, 3);
    offset += 3;
    const last = (blockHeader & 1) !== 0;
    const blockType = (blockHeader >>> 1) & 3;
    const blockSize = blockHeader >>> 3;
    if (blockType === 3) return undefined;
    const payloadBytes = blockType === 1 ? 1 : blockSize;
    offset += payloadBytes;
    if (offset > bytes.length) return undefined;
    if (last) break;
  }
  if (checksum) offset += 4;
  return offset <= bytes.length ? offset : undefined;
}

function decodeFrames(bytes: Buffer, frames: ScannedFrame[], fileState: FileState): JsonRecord[] {
  const records: JsonRecord[] = [];
  let text = fileState.zstdRemainder ?? "";
  for (const frame of frames) {
    try {
      text += zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString("utf8");
    } catch {
      // Ignore a frame that cannot be decoded and keep the committed offset safe.
    }
  }
  const lines = text.split(/\r?\n/);
  fileState.zstdRemainder = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const record = asRecord(JSON.parse(line));
      if (record) records.push(record);
    } catch {
      // Ignore malformed JSON within a valid frame.
    }
  }
  return records;
}

function loadState(path: string, historyStartAt?: string): PersistedState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PersistedState>;
    if (parsed.version === STATE_VERSION && parsed.historyStartAt === historyStartAt && parsed.files && parsed.emitted) {
      return parsed as PersistedState;
    }
  } catch {
    // First run or a partially written state file.
  }
  return { version: STATE_VERSION, historyStartAt, files: {}, emitted: {} };
}

function persistState(path: string, state: PersistedState) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify(state), "utf8");
    renameSync(temporary, path);
  } catch {
    // Persistence is best effort; ledger-level ids still protect the current run.
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegativeNumber(value: unknown) {
  const number = numberValue(value);
  return number === undefined ? undefined : Math.max(0, Math.round(number));
}
