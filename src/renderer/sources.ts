import type { LedgerEntry, UsageStatus } from "../shared/types";
import { countedInputTokensForEntry, countedTokensForEntry } from "../shared/tokenAccounting";
import type { AgentSource, HistorySourceId, SourceBreakdown, SourceVisibility } from "./types";

export const AGENT_SOURCES = [
  { id: "codex", label: "Codex", statusKey: "codexSession" },
  { id: "openclaw", label: "OpenClaw", statusKey: "openclawSession" },
  { id: "pi", label: "Pi Agent", statusKey: "piSession" },
  { id: "opencode", label: "OpenCode", statusKey: "opencodeSession" },
  { id: "claude", label: "Claude Code", statusKey: "claudeSession" },
  { id: "gemini", label: "Gemini", statusKey: "geminiSession" },
  { id: "hermes", label: "Hermes", statusKey: "hermesSession" },
] as const satisfies ReadonlyArray<AgentSource>;

export const ALL_HISTORY_SOURCE_IDS = AGENT_SOURCES.map((source) => source.id);
const ALL_HISTORY_SOURCE_ID_SET = new Set<HistorySourceId>(ALL_HISTORY_SOURCE_IDS);

export function allStatsSourceIds(): HistorySourceId[] {
  return [...ALL_HISTORY_SOURCE_IDS];
}

export function isHistorySourceId(value: unknown): value is HistorySourceId {
  return typeof value === "string" && ALL_HISTORY_SOURCE_ID_SET.has(value as HistorySourceId);
}

export function enabledStatsSourceIds(raw: unknown): HistorySourceId[] {
  if (!Array.isArray(raw)) return allStatsSourceIds();
  return [...new Set(raw)].filter(isHistorySourceId);
}

export function enabledStatsSourceSet(raw: unknown) {
  return new Set(enabledStatsSourceIds(raw));
}

export function sourceMonitorStatus(usageStatus: UsageStatus | null, sourceId: HistorySourceId) {
  const source = AGENT_SOURCES.find((item) => item.id === sourceId);
  return source && usageStatus ? usageStatus[source.statusKey] : undefined;
}

export function isStatsSourceInstalled(usageStatus: UsageStatus | null, sourceId: HistorySourceId) {
  const status = sourceMonitorStatus(usageStatus, sourceId);
  if (!status) return true;
  return status.exists && status.filesWatched > 0;
}

export function sourceVisibility(usageStatus: UsageStatus | null, enabledSourceIds: unknown): SourceVisibility {
  const enabled = enabledStatsSourceSet(enabledSourceIds);
  const visible = AGENT_SOURCES.filter((source) => enabled.has(source.id) && isStatsSourceInstalled(usageStatus, source.id)).map(
    (source) => source.id,
  );
  return {
    enabled,
    visible,
    visibleSet: new Set(visible),
  };
}

export function historySourceId(entry: LedgerEntry): HistorySourceId | undefined {
  if (entry.source === "codex-session" || entry.agent === "codex-desktop") return "codex";
  if (entry.source === "openclaw-session" || entry.agent === "openclaw") return "openclaw";
  if (entry.source === "pi-session" || entry.agent === "pi-agent") return "pi";
  if (entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"))) {
    return "opencode";
  }
  if (entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"))) return "claude";
  if (entry.source === "gemini-session" || entry.agent === "gemini") return "gemini";
  if (entry.source === "hermes-session" || entry.agent === "hermes") return "hermes";
  return undefined;
}

export function xpForEntry(entry: LedgerEntry, enabledSources = new Set(ALL_HISTORY_SOURCE_IDS)) {
  const sourceId = historySourceId(entry);
  if (sourceId && !enabledSources.has(sourceId)) return 0;
  return countedTokensForEntry(entry);
}

export function getSourceBreakdown(
  entries: LedgerEntry[],
  enabledSources: Set<HistorySourceId>,
  labelForEntry: (id: string, source: string) => string,
): SourceBreakdown[] {
  const rows = new Map<string, SourceBreakdown>();
  for (const entry of entries) {
    const id = entry.source === "manual" ? "manual" : entry.agent || entry.source;
    const existing =
      rows.get(id) ??
      {
        id,
        label: labelForEntry(id, entry.source),
        xp: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
    existing.inputTokens += countedInputTokensForEntry(entry);
    existing.outputTokens += safeTokens(entry.outputTokens ?? 0);
    existing.cacheReadTokens += safeTokens(entry.cacheReadTokens ?? 0);
    existing.cacheWriteTokens += safeTokens(entry.cacheWriteTokens ?? 0);
    existing.xp += xpForEntry(entry, enabledSources);
    rows.set(id, existing);
  }
  return [...rows.values()].sort((a, b) => b.xp - a.xp);
}

export function sourceMatchesBreakdownRow(row: SourceBreakdown, sourceId: HistorySourceId) {
  if (sourceId === "codex") return row.id === "codex-desktop" || row.id === "codex-session" || row.label === "Codex";
  if (sourceId === "claude") {
    return row.id === "claude-code" || row.id === "claude-session" || row.label === "Claude Code" || row.id.startsWith("claude-code:");
  }
  if (sourceId === "openclaw") return row.id === "openclaw" || row.id === "openclaw-session" || row.label === "OpenClaw";
  if (sourceId === "pi") return row.id === "pi-agent" || row.id === "pi-session" || row.label === "Pi Agent";
  if (sourceId === "opencode") {
    return row.id === "opencode" || row.id === "opencode-session" || row.label === "OpenCode" || row.id.startsWith("opencode:");
  }
  if (sourceId === "gemini") return row.id === "gemini" || row.id === "gemini-session" || row.label === "Gemini";
  if (sourceId === "hermes") return row.id === "hermes" || row.id === "hermes-session" || row.label === "Hermes";
  return false;
}

export function combineSourceRows(label: string, rows: SourceBreakdown[]): SourceBreakdown {
  return rows.reduce(
    (total, row) => ({
      ...total,
      xp: total.xp + row.xp,
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      cacheReadTokens: total.cacheReadTokens + row.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + row.cacheWriteTokens,
    }),
    { id: label, label, xp: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
}

export function entryMatchesSourceKey(entry: LedgerEntry, sourceKey: string) {
  if (sourceKey === "codex") return entry.source === "codex-session" || entry.agent === "codex-desktop";
  if (sourceKey === "claude") return entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"));
  if (sourceKey === "openclaw") return entry.source === "openclaw-session" || entry.agent === "openclaw";
  if (sourceKey === "pi") return entry.source === "pi-session" || entry.agent === "pi-agent";
  if (sourceKey === "opencode") {
    return entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"));
  }
  if (sourceKey === "gemini") return entry.source === "gemini-session" || entry.agent === "gemini";
  if (sourceKey === "hermes") return entry.source === "hermes-session" || entry.agent === "hermes";
  if (sourceKey.startsWith("source:")) {
    const id = sourceKey.slice("source:".length);
    const entryId = entry.source === "manual" ? "manual" : entry.agent || entry.source;
    return entryId === id;
  }
  return false;
}

export function defaultSourceLabel(id: string, source: string, manualLabel: string) {
  if (source === "manual") return manualLabel;
  if (id.startsWith("claude-code:")) return `Claude ${id.replace("claude-code:", "")}`;
  if (id === "claude-code" || source === "claude-session") return "Claude Code";
  if (id === "codex-desktop" || source === "codex-session") return "Codex";
  if (id === "openclaw" || source === "openclaw-session") return "OpenClaw";
  if (id === "pi-agent" || source === "pi-session") return "Pi Agent";
  if (id.startsWith("opencode:")) return `OpenCode ${id.replace("opencode:", "")}`;
  if (id === "opencode" || source === "opencode-session") return "OpenCode";
  if (id === "gemini" || source === "gemini-session") return "Gemini";
  if (id === "hermes" || source === "hermes-session") return "Hermes";
  return id;
}

export function emptySourceTotals(): Record<HistorySourceId, number> {
  return { codex: 0, openclaw: 0, pi: 0, opencode: 0, claude: 0, gemini: 0, hermes: 0 };
}

export function safeTokens(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
