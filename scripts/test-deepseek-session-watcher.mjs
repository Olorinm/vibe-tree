import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { resolveDeepSeekSessionsRoot, startDeepSeekSessionWatcher } from "../dist/electron/deepseekSessionWatcher.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function line(record) {
  return `${JSON.stringify(record)}\n`;
}

function frame(records) {
  return zstdCompressSync(Buffer.from(records.map(line).join(""), "utf8"));
}

function emptyNonSingleSegmentFrame() {
  // Standard Zstandard frame with FCS flag 0 and a window descriptor, followed
  // by one empty raw block. This catches scanners that incorrectly consume a
  // two-byte content-size field for non-single-segment frames.
  return Buffer.from([
    0x28, 0xb5, 0x2f, 0xfd,
    0x00,
    0x00,
    0x01, 0x00, 0x00,
  ]);
}

function appendFrame(filePath, records) {
  appendFileSync(filePath, frame(records));
}

function sessionHeader(id, seedLength = 0) {
  return { type: "session", version: 0, id, createdAt: Date.now(), seedLength, delegationDepth: 0 };
}

function usage(inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0) {
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

function event(type, seq, time, data) {
  return { type, seq, time, data };
}

function stepRecords(turn, step, time, input, output, seq = 1) {
  return [
    event("step/start", seq - 1, time, { turn, step }),
    event("request/header", seq - 1, time, { header: { config: { provider: "deepseek", model: "deepseek-chat" } } }),
    event("assistant/chunk", seq, time, { turn, step, chunk: { type: "usage", usage: usage(input, output, 3, 2) } }),
  ];
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const root = mkdtempSync(join(tmpdir(), "vibe-tree-deepseek-watcher-"));
const sessionsRoot = join(root, "sessions");
const userDataPath = join(root, "user-data");
const previousDshHome = process.env.DSH_HOME;
const previousVibeRoot = process.env.VIBE_DEEPSEEK_SESSIONS_DIR;
delete process.env.VIBE_DEEPSEEK_SESSIONS_DIR;
process.env.DSH_HOME = join(root, "custom-dsh-home");
assert(resolveDeepSeekSessionsRoot().endsWith("custom-dsh-home\\sessions") || resolveDeepSeekSessionsRoot().endsWith("custom-dsh-home/sessions"), "DSH_HOME should control the default root");
assert(resolveDeepSeekSessionsRoot("~/.dsh/sessions").endsWith(".dsh\\sessions") || resolveDeepSeekSessionsRoot("~/.dsh/sessions").endsWith(".dsh/sessions"), "tilde paths should expand on both platforms");
if (previousDshHome === undefined) delete process.env.DSH_HOME;
else process.env.DSH_HOME = previousDshHome;
if (previousVibeRoot === undefined) delete process.env.VIBE_DEEPSEEK_SESSIONS_DIR;
else process.env.VIBE_DEEPSEEK_SESSIONS_DIR = previousVibeRoot;
mkdirSync(sessionsRoot, { recursive: true });
mkdirSync(userDataPath, { recursive: true });
const zstdPath = join(sessionsRoot, "--fixture--", "session.jsonl.zstd");
const rawPath = join(sessionsRoot, "--fixture-raw--", "session.jsonl");
mkdirSync(join(sessionsRoot, "--fixture--"), { recursive: true });
mkdirSync(join(sessionsRoot, "--fixture-raw--"), { recursive: true });

const events = [];
const watcher = startDeepSeekSessionWatcher({
  userDataPath,
  sessionsRoot,
  historyStartAt: "2020-01-01T00:00:00.000Z",
  onUsage: (event) => events.push(event),
});

try {
  const now = Date.now();
  const sessionId = "fixture-zstd";
  writeFileSync(zstdPath, Buffer.concat([
    emptyNonSingleSegmentFrame(),
    frame([
      sessionHeader(sessionId, 1),
      ...stepRecords(0, 0, now, 100, 40, 1),
    ]),
  ]));
  await delay(150);
  await watcher.scanNow();
  assert(events.length === 0, "a complete frame without step end must remain pending");

  // A torn frame must wait for the next scan; its remaining bytes are appended
  // later, so the scanner can reassemble the magic/header from the saved offset.
  const finalTime = now + 1000;
  const finalFrame = frame([
    event("assistant/chunk", 2, finalTime, { turn: 0, step: 0, chunk: { type: "usage", usage: usage(120, 55, 8, 4) } }),
    event("assistant/message", 3, finalTime, { turn: 0, step: 0, usage: usage(120, 55, 8, 4) }),
    event("step/end", 4, finalTime, { turn: 0, step: 0 }),
  ]);
  appendFileSync(zstdPath, finalFrame.subarray(0, 3));
  await watcher.scanNow();
  assert(events.length === 0, "a torn zstd frame must not emit partial records");
  appendFileSync(zstdPath, finalFrame.subarray(3));
  await watcher.scanNow();
  assert(events.length === 1, `zstd session should emit one final usage event, got ${events.length}`);
  assert(events[0].inputTokens === 120 && events[0].outputTokens === 55, "final usage must replace chunk sample");
  assert(events[0].cacheReadTokens === 8 && events[0].cacheWriteTokens === 4, "cache buckets must be preserved");
  assert(events[0].totalTokens === 175, "totalTokens must exclude cache buckets");
  assert(events[0].provider === "deepseek" && events[0].model === "deepseek-chat", "request route must be retained");
  assert(!JSON.stringify(events[0]).includes("prompt"), "usage event must not contain prompt text");

  writeFileSync(rawPath, [
    line(sessionHeader("fixture-raw", 1)),
    line(event("step/start", 0, now, { turn: 1, step: 0 })),
    line(event("assistant/chunk", 0, now, { turn: 1, step: 0, chunk: { type: "usage", usage: usage(999, 999) } })),
    line(event("assistant/message", 0, now, { turn: 1, step: 0, usage: usage(999, 999) })),
    line(event("step/end", 0, now, { turn: 1, step: 0 })),
    line(event("step/start", 1, now, { turn: 1, step: 1 })),
    line(event("request/context", 0, now, { provider: "deepseek", model: "deepseek-reasoner" })),
    line(event("assistant/chunk", 2, now, { turn: 1, step: 1, chunk: { type: "usage", usage: usage(12, 7) } })),
  ].join(""), "utf8");
  await watcher.scanNow();
  assert(events.length === 1, "seed history and raw pending usage must not emit before finalization");
  appendFileSync(rawPath, [
    line(event("assistant/message", 3, now + 2000, { turn: 1, step: 1, usage: usage(14, 9) })),
    line(event("step/end", 4, now + 2000, { turn: 1, step: 1 })),
  ].join(""), "utf8");
  await watcher.scanNow();
  assert(events.length === 2, "raw session should emit one finalized usage event");
  assert(events[1].model === "deepseek-reasoner" && events[1].totalTokens === 23, "raw session route and usage should parse");
  appendFileSync(rawPath, [
    line(event("step/start", 5, now + 3000, { turn: 1, step: 2 })),
    line(event("assistant/chunk", 6, now + 3000, { turn: 1, step: 2, chunk: { type: "usage", usage: usage(5, 3) } })),
    line(event("step/end", 7, now + 3000, { turn: 1, step: 2 })),
  ].join(""), "utf8");
  await watcher.scanNow();
  assert(events.length === 3 && events[2].totalTokens === 8, "failed request chunk should fall back at step/end");

  watcher.close();
  const restartEvents = [];
  const restarted = startDeepSeekSessionWatcher({
    userDataPath,
    sessionsRoot,
    historyStartAt: "2020-01-01T00:00:00.000Z",
    onUsage: (event) => restartEvents.push(event),
  });
  await delay(150);
  await restarted.scanNow();
  assert(restartEvents.length === 0, "restart must not re-import finalized sessions");

  appendFrame(zstdPath, [
    sessionHeader("fixture-zstd-second"),
    ...stepRecords(2, 0, finalTime + 1000, 30, 11, 1),
    event("assistant/message", 2, finalTime + 1000, { turn: 2, step: 0, usage: usage(30, 11) }),
    event("step/end", 3, finalTime + 1000, { turn: 2, step: 0 }),
  ]);
  await restarted.scanNow();
  assert(restartEvents.length === 1, "a newly appended session should import after restart");
  assert(restartEvents[0].totalTokens === 41, "new session usage should be counted once");
  restarted.close();

  const persistedState = JSON.parse(readFileSync(join(userDataPath, "deepseek-session-watcher.json"), "utf8"));
  assert(persistedState.version === 1 && Object.keys(persistedState.files).length === 2, "watcher state must persist both files");
  console.log("deepseek session watcher fixture tests passed");
} finally {
  watcher.close();
  rmSync(root, { recursive: true, force: true });
}
