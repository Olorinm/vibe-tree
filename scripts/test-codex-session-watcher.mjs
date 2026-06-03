import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { __test } from "../dist/electron/codexSessionWatcher.js";

const { scanFile } = __test;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeJsonl(filePath, lines) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
}

function appendJsonl(filePath, lines) {
  appendFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
}

function meta(timestamp, payload = {}) {
  return { timestamp, type: "session_meta", payload };
}

function token(timestamp, total, last = total) {
  return {
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: last,
          output_tokens: 0,
          total_tokens: last,
        },
        total_token_usage: {
          input_tokens: total,
          output_tokens: 0,
          total_tokens: total,
        },
      },
    },
  };
}

function newState() {
  return {
    version: 6,
    files: {},
    cumulativeTokens: {},
    acceptedCumulativeKeys: {},
    currentModels: {},
  };
}

function runScan(filePath, state, statePath, sessionsRoot) {
  const events = [];
  const imported = scanFile(
    filePath,
    state,
    statePath,
    {
      userDataPath: join(sessionsRoot, "..", "user-data"),
      sessionsRoot,
      onUsage: (event) => events.push(event),
    },
    {
      importHistory: false,
      watcherStartedAt: Date.parse("2026-06-04T00:00:00.000Z"),
      sessionsRoot,
    },
  );
  return { imported, events };
}

function makeSessionPath(root, date, id) {
  const [year, month, day] = date.split("-");
  return join(root, year, month, day, `rollout-${date}T00-00-00-${id}.jsonl`);
}

function runKnownParentForkTest(root) {
  const sessionsRoot = join(root, "sessions-known-parent");
  const statePath = join(root, "known-parent-state.json");
  const parentId = "019e72e7-8395-7572-b6b8-8f480d6909bb";
  const childId = "019f0000-0000-7000-8000-000000000001";
  const parentPath = makeSessionPath(sessionsRoot, "2026-05-29", parentId);
  const childPath = makeSessionPath(sessionsRoot, "2026-06-04", childId);
  const state = newState();

  writeJsonl(parentPath, [
    meta("2026-05-29T16:00:00.000Z"),
    token("2026-05-29T16:01:00.000Z", 100, 100),
    token("2026-05-29T16:02:00.000Z", 200, 100),
  ]);
  writeJsonl(childPath, [
    meta("2026-06-04T14:15:09.000Z", { forked_from_id: parentId }),
    token("2026-06-04T14:15:09.100Z", 50, 50),
    token("2026-06-04T14:15:09.200Z", 200, 150),
    token("2026-06-04T14:20:00.000Z", 260, 60),
  ]);

  const { imported, events } = runScan(childPath, state, statePath, sessionsRoot);
  assert(imported === 1, `known parent fork should import 1 event, got ${imported}`);
  assert(events[0]?.totalTokens === 60, `known parent fork should import 60 tokens, got ${events[0]?.totalTokens}`);
}

function runHalfWrittenForkTest(root) {
  const sessionsRoot = join(root, "sessions-half-written");
  const statePath = join(root, "half-written-state.json");
  const parentId = "019e72e7-8395-7572-b6b8-8f480d6909bc";
  const childId = "019f0000-0000-7000-8000-000000000002";
  const parentPath = makeSessionPath(sessionsRoot, "2026-05-29", parentId);
  const childPath = makeSessionPath(sessionsRoot, "2026-06-04", childId);
  const state = newState();

  writeJsonl(parentPath, [
    meta("2026-05-29T16:00:00.000Z"),
    token("2026-05-29T16:01:00.000Z", 500, 500),
    token("2026-05-29T16:02:00.000Z", 1000, 500),
  ]);
  writeJsonl(childPath, [
    meta("2026-06-04T14:15:09.000Z", { forked_from_id: parentId }),
    token("2026-06-04T14:15:09.100Z", 100, 100),
    token("2026-06-04T14:15:09.200Z", 500, 400),
  ]);

  const first = runScan(childPath, state, statePath, sessionsRoot);
  assert(first.imported === 0, `half-written replay first scan should import 0, got ${first.imported}`);

  appendJsonl(childPath, [
    token("2026-06-04T14:15:09.300Z", 1000, 500),
    token("2026-06-04T14:20:00.000Z", 1150, 150),
  ]);
  const second = runScan(childPath, state, statePath, sessionsRoot);
  assert(second.imported === 1, `half-written replay second scan should import 1, got ${second.imported}`);
  assert(second.events[0]?.totalTokens === 150, `half-written replay should import 150 tokens, got ${second.events[0]?.totalTokens}`);
}

function runMissingParentForkTest(root) {
  const sessionsRoot = join(root, "sessions-missing-parent");
  const statePath = join(root, "missing-parent-state.json");
  const missingParentId = "019e72e7-8395-7572-b6b8-8f480d6909bd";
  const childId = "019f0000-0000-7000-8000-000000000003";
  const childPath = makeSessionPath(sessionsRoot, "2026-06-04", childId);
  const state = newState();

  writeJsonl(childPath, [
    meta("2026-06-04T14:15:09.000Z", { forked_from_id: missingParentId }),
    token("2026-06-04T14:15:09.100Z", 50, 50),
    token("2026-06-04T14:15:09.200Z", 200, 150),
  ]);

  const first = runScan(childPath, state, statePath, sessionsRoot);
  assert(first.imported === 0, `missing parent fork should conservatively import 0, got ${first.imported}`);

  appendJsonl(childPath, [token("2026-06-04T14:20:00.000Z", 260, 60)]);
  const second = runScan(childPath, state, statePath, sessionsRoot);
  assert(second.imported === 0, `missing parent first live append should establish baseline, got ${second.imported}`);

  appendJsonl(childPath, [token("2026-06-04T14:21:00.000Z", 320, 60)]);
  const third = runScan(childPath, state, statePath, sessionsRoot);
  assert(third.imported === 1, `missing parent second live append should import 1, got ${third.imported}`);
  assert(third.events[0]?.totalTokens === 60, `missing parent second live append should import 60, got ${third.events[0]?.totalTokens}`);
}

function runParentTailBaselineTest(root) {
  const sessionsRoot = join(root, "sessions-parent-tail");
  const statePath = join(root, "parent-tail-state.json");
  const parentId = "019e72e7-8395-7572-b6b8-8f480d6909be";
  const childId = "019f0000-0000-7000-8000-000000000004";
  const parentPath = makeSessionPath(sessionsRoot, "2026-05-29", parentId);
  const childPath = makeSessionPath(sessionsRoot, "2026-06-04", childId);
  const state = newState();

  writeJsonl(parentPath, [meta("2026-05-29T16:00:00.000Z")]);
  appendFileSync(parentPath, `${JSON.stringify({ timestamp: "2026-05-29T16:00:30.000Z", type: "event_msg", payload: { type: "note", text: "x".repeat(512 * 1024) } })}\n`, "utf8");
  appendJsonl(parentPath, [token("2026-05-29T16:02:00.000Z", 900, 900)]);
  writeJsonl(childPath, [
    meta("2026-06-04T14:15:09.000Z", { forked_from_id: parentId }),
    token("2026-06-04T14:15:09.100Z", 100, 100),
    token("2026-06-04T14:20:00.000Z", 950, 50),
  ]);

  const { imported, events } = runScan(childPath, state, statePath, sessionsRoot);
  assert(imported === 1, `parent tail baseline should import 1 event, got ${imported}`);
  assert(events[0]?.totalTokens === 50, `parent tail baseline should import 50 tokens, got ${events[0]?.totalTokens}`);
}

const root = mkdtempSync(join(tmpdir(), "vibe-tree-codex-watcher-"));
try {
  runKnownParentForkTest(root);
  runHalfWrittenForkTest(root);
  runMissingParentForkTest(root);
  runParentTailBaselineTest(root);
  console.log("codex session watcher fork tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
