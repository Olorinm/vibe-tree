import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMacUserDataOverride } from "./macos-user-data.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = mkdtempSync(join(tmpdir(), "vibe-tree-mac-start-"));
const canonical = join(root, "Vibe Tree");
const legacy = join(root, "Electron");

try {
  assert(resolveMacUserDataOverride(root) === undefined, "fresh installs should use the packaged app data directory");

  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "ledger.json"), "{}\n");
  assert(resolveMacUserDataOverride(root) === legacy, "legacy settings ledgers should remain in use");
  rmSync(join(legacy, "ledger.json"));

  writeFileSync(join(legacy, "usage-events.jsonl"), "{}\n");
  assert(resolveMacUserDataOverride(root) === legacy, "legacy command-line ledgers should remain in use");

  mkdirSync(canonical, { recursive: true });
  writeFileSync(join(canonical, "usage-events.jsonl"), "{}\n");
  assert(resolveMacUserDataOverride(root) === undefined, "the packaged app ledger should take priority once it exists");

  assert(
    resolveMacUserDataOverride(root, "/tmp/vibe-tree-explicit") === "/tmp/vibe-tree-explicit",
    "an explicit data directory should take priority",
  );
} finally {
  rmSync(root, { force: true, recursive: true });
}

console.log("macOS start data selection tests passed");
