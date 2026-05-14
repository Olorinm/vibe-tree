import type { LedgerEntry } from "./types.js";

export function countedTokensForEntry(entry: LedgerEntry) {
  if (!hasTokenBreakdown(entry)) return safeTokens(entry.tokens);

  const baseTokens = safeTokens(entry.inputTokens ?? 0) + safeTokens(entry.outputTokens ?? 0);
  if (!usesSplitAnthropicCacheAccounting(entry)) return baseTokens;

  return baseTokens + safeTokens(entry.cacheWriteTokens ?? 0);
}

function hasTokenBreakdown(entry: LedgerEntry) {
  return (
    entry.inputTokens !== undefined ||
    entry.outputTokens !== undefined ||
    entry.cacheReadTokens !== undefined ||
    entry.cacheWriteTokens !== undefined
  );
}

function usesSplitAnthropicCacheAccounting(entry: LedgerEntry) {
  return entry.provider === "anthropic" || entry.source === "claude-session";
}

function safeTokens(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
