import assert from "node:assert/strict";
import { ledgerForRenderer } from "../dist/electron/rendererLedger.js";

const now = new Date(2026, 8, 2, 15, 30, 0);
const at = (daysAgo, hour, minute = 0) => {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute, 0);
  return date.toISOString();
};
const ledger = {
  installedAt: at(30, 0),
  settings: {},
  entries: [
    { id: "live", createdAt: new Date(now.getTime() - 60_000).toISOString(), source: "codex-session", agent: "Codex", tokens: 5 },
    { id: "today-a", createdAt: at(0, 9, 5), source: "codex-session", agent: "Codex", tokens: 10, inputTokens: 10 },
    { id: "today-b", createdAt: at(0, 9, 15), source: "codex-session", agent: "Codex", tokens: 20, inputTokens: 20, eventCount: 2 },
    { id: "yesterday", createdAt: at(1, 10), source: "codex-session", agent: "Codex", tokens: 30 },
    { id: "history", createdAt: at(10, 11), source: "codex-session", agent: "Codex", tokens: 40 },
  ],
};

const manager = ledgerForRenderer(ledger, "manager", now);
const toast = ledgerForRenderer(ledger, "toast", now);
const pet = ledgerForRenderer(ledger, "pet", now);
const menubar = ledgerForRenderer(ledger, "menubar", now);

assert.equal(manager, ledger, "manager should retain the exact raw ledger object");
assert.equal(toast.entries.length, 0, "toast should not receive usage history");
assert.equal(pet.entries.length, 3, "pet should receive live, today and history rows only");
assert.equal(menubar.entries.length, 4, "menu bar should retain today's hour plus yesterday/history summaries");
for (const compact of [pet, menubar]) {
  assert.equal(compact.entries.reduce((sum, entry) => sum + entry.tokens, 0), 105, "compaction must preserve tokens");
  assert.equal(
    compact.entries.reduce((sum, entry) => sum + (entry.inputTokens ?? 0), 0),
    30,
    "compaction must preserve token breakdowns",
  );
  assert.equal(
    compact.entries.reduce((sum, entry) => sum + (entry.eventCount ?? 1), 0),
    6,
    "compaction must preserve represented event counts",
  );
}

console.log("Renderer ledger compaction verified: manager fidelity and pet/menu/toast aggregate invariants passed.");
