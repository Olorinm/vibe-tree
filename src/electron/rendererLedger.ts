import type { LedgerEntry, LedgerFile, RendererLedgerView } from "../shared/types.js";
import { countedTokenBreakdownForEntry } from "../shared/tokenAccounting.js";

const LIVE_ENTRY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Electron structured-clones IPC values into every renderer. The manager needs
 * the raw history, but the always-on pet and menu-bar only consume lifetime,
 * today/hour and live-window totals. Send those windows exact aggregate rows
 * instead of cloning the complete ledger into each Chromium process.
 */
export function ledgerForRenderer(ledger: LedgerFile, view: RendererLedgerView, now = new Date()): LedgerFile {
  if (view === "manager") return ledger;
  if (view === "toast") return { ...ledger, entries: [] };

  const liveAfter = now.getTime() - LIVE_ENTRY_WINDOW_MS;
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const liveEntries: LedgerEntry[] = [];
  const buckets = new Map<string, LedgerEntry>();

  for (const entry of ledger.entries) {
    const entryTime = Date.parse(entry.createdAt);
    if (!Number.isFinite(entryTime)) continue;
    if (entryTime >= liveAfter) {
      liveEntries.push(entry);
      continue;
    }

    const bucket = rendererBucket(view, entryTime, todayStart, yesterdayStart, ledger.installedAt);
    const source = rendererSource(entry);
    const key = `${bucket.key}\u0000${source}\u0000${entry.agent ?? ""}`;
    const breakdown = countedTokenBreakdownForEntry(entry);
    const tokens = breakdown.tokens;
    const representedEvents = Math.max(1, Math.round(entry.eventCount ?? 1));
    const existing = buckets.get(key);
    if (existing) {
      existing.tokens += tokens;
      existing.inputTokens = (existing.inputTokens ?? 0) + breakdown.inputTokens;
      existing.outputTokens = (existing.outputTokens ?? 0) + breakdown.outputTokens;
      existing.cacheReadTokens = (existing.cacheReadTokens ?? 0) + breakdown.cacheReadTokens;
      existing.cacheWriteTokens = (existing.cacheWriteTokens ?? 0) + breakdown.cacheWriteTokens;
      existing.eventCount = (existing.eventCount ?? 0) + representedEvents;
      continue;
    }

    buckets.set(key, {
      id: `renderer-summary:${view}:${bucket.key}:${source}:${entry.agent ?? "source"}`,
      createdAt: bucket.createdAt,
      source,
      tokens,
      agent: entry.agent,
      inputTokens: breakdown.inputTokens,
      outputTokens: breakdown.outputTokens,
      cacheReadTokens: breakdown.cacheReadTokens,
      cacheWriteTokens: breakdown.cacheWriteTokens,
      eventCount: representedEvents,
    });
  }

  return {
    ...ledger,
    entries: [...liveEntries, ...buckets.values()].sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    ),
  };
}

function rendererBucket(
  view: Exclude<RendererLedgerView, "manager" | "toast">,
  entryTime: number,
  todayStart: Date,
  yesterdayStart: Date,
  installedAt: string,
) {
  if (entryTime >= todayStart.getTime()) {
    if (view === "pet") return { key: "today", createdAt: todayStart.toISOString() };
    const hour = new Date(entryTime);
    hour.setMinutes(0, 0, 0);
    return { key: `hour-${localDateKey(hour)}-${hour.getHours()}`, createdAt: hour.toISOString() };
  }
  if (view === "menubar" && entryTime >= yesterdayStart.getTime()) {
    return { key: "yesterday", createdAt: yesterdayStart.toISOString() };
  }
  const historyTime = Date.parse(installedAt);
  return {
    key: "history",
    createdAt: new Date(Number.isFinite(historyTime) ? historyTime : 0).toISOString(),
  };
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rendererSource(entry: LedgerEntry) {
  if (entry.source !== "cloud-sync") return entry.source;
  const prefix = entry.id.includes(":") ? entry.id.slice(0, entry.id.indexOf(":")) : "";
  return SAFE_RENDERER_SOURCES.has(prefix) ? prefix : entry.source;
}

const SAFE_RENDERER_SOURCES = new Set([
  "manual",
  "codex-session",
  "claude-session",
  "openclaw-session",
  "pi-session",
  "opencode-session",
  "gemini-session",
  "hermes-session",
  "kimi-session",
  "deepseek-session",
]);
