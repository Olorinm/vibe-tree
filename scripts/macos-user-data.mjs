import { existsSync } from "node:fs";
import { join } from "node:path";

function hasUsageLedger(directory) {
  return existsSync(join(directory, "usage-events.jsonl"));
}

function hasVibeTreeData(directory) {
  return ["ledger.json", "device-settings.json", "usage-meta.json", "achievements.json"].some((name) =>
    existsSync(join(directory, name)),
  );
}

export function resolveMacUserDataOverride(appSupportDir, explicit) {
  if (explicit?.trim()) return explicit.trim();

  const canonical = join(appSupportDir, "Vibe Tree");
  const legacy = join(appSupportDir, "Electron");
  if (hasUsageLedger(canonical)) return undefined;
  if (hasUsageLedger(legacy)) return legacy;
  if (hasVibeTreeData(canonical)) return undefined;
  if (hasVibeTreeData(legacy)) return legacy;
  return undefined;
}
