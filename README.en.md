# 🌳 Vibe Tree

[简体中文](README.md) | English

**Every token your coding agent spends makes the tiny tree on your desktop grow.**

Vibe Tree is a desktop token weather tree for AI coding. It reads local usage records from your coding agents and turns token spend, active rhythm, model preference, and streaks into a pixel bonsai you can keep on your desktop.

It is not just a token dashboard. It is a small companion that makes your coding pace visible, collectible, and shareable.

## Screenshots

### Live Growth Dashboard

Track total tokens, today's growth, level progress, agent sources, and the recent 7-day trend.

![Vibe Tree dashboard](docs/images/vibe-tree-dashboard.png)

### Shareable Growth Report

Export one of three visual templates with level, total tokens, favorite agent, a 7 × 24 hour heatmap, and a GitHub QR code.

![Vibe Tree share export](docs/images/vibe-tree-share-export.png)

### Global Leaderboard

Opt into the leaderboard with GitHub. By default, only aggregated token ranking data is public. Usage preferences are shown only when the user explicitly enables them.

![Vibe Tree leaderboard](docs/images/vibe-tree-leaderboard.png)

## Highlights

- **Desktop pixel tree**: always-on-top, draggable, scalable, lockable, and quiet on startup.
- **Live token weather**: total tokens drive level growth; current token/min drives weather.
- **Multi-agent sources**: Codex, Claude Code, OpenClaw, Pi Agent, OpenCode, Gemini, and Hermes.
- **Source and model breakdowns**: inspect input, output, cache, and model distribution by agent.
- **Recent 7-day chart**: filter token trends by source.
- **Achievements**: unlock milestones for totals, peaks, streaks, time habits, and agent usage.
- **Share image export**: choose from three templates and export a high-resolution PNG.
- **Three UI themes**: day, night, and soft, aligned with the share-card visual system.
- **Leaderboard privacy controls**: joining is optional; public usage preferences are opt-in.
- **Chinese and English UI**: switch language in settings.

## Quick Start

```bash
npm ci
npm start
```

Development:

```bash
npm run dev
```

Checks:

```bash
npm run typecheck
npm run build
```

If Electron downloads slowly from GitHub, temporarily use a mirror:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
npm_config_electron_mirror=https://npmmirror.com/mirrors/electron/ \
npm ci
```

Or save it in `.npmrc`:

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
```

## Supported Agents

| Agent | Status | Default source |
| --- | --- | --- |
| Codex | ✅ | `~/.codex/sessions/**/*.jsonl` |
| Claude Code | ✅ | `~/.claude/projects/**/*.jsonl` |
| OpenClaw | ✅ | `~/.openclaw/agents/**/sessions/*.jsonl` |
| Pi Agent | ✅ | `~/.pi/agent/sessions/**/*.jsonl` |
| OpenCode | ✅ | `~/.local/share/opencode/opencode.db` (legacy `storage/message/**/*.json` remains supported) |
| Gemini | ✅ | local Gemini session directory |
| Hermes | ✅ | local Hermes session directory |

Vibe Tree auto-detects the default paths after installation. You can customize source paths or disable sources in settings.

## Data And Privacy

Vibe Tree is local-first. By default, it does not upload code, prompts, filenames, paths, conversation logs, or complete hourly heatmaps.

When joining the leaderboard, it syncs daily token totals and the local first-use date so the service can compute today, 7-day, 30-day, and all-time rankings. If "Public usage preferences" is enabled, it additionally syncs four aggregated fields:

- Favorite agent
- Favorite model
- Favorite coding period
- Peak token rate

These fields are used only for leaderboard display.

## Token Accounting

```text
Counted Token = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
```

Some providers include cached input in `inputTokens`; Anthropic reports cache read / write separately. Vibe Tree counts total token consumption per request and counts cached input only once when it is already included in `inputTokens`.

By default, statistics start from the installation day. Older history is ignored unless explicitly imported with environment variables.

## Import History

macOS / Linux:

```bash
VIBE_CODEX_IMPORT_HISTORY=today \
VIBE_CLAUDE_IMPORT_HISTORY=today \
VIBE_OPENCLAW_IMPORT_HISTORY=today \
VIBE_OPENCODE_IMPORT_HISTORY=today \
npm start
```

Windows PowerShell:

```powershell
$env:VIBE_CODEX_IMPORT_HISTORY="today"
$env:VIBE_CLAUDE_IMPORT_HISTORY="today"
$env:VIBE_OPENCLAW_IMPORT_HISTORY="today"
$env:VIBE_OPENCODE_IMPORT_HISTORY="today"
npm start
```

## Leaderboard Service

The hosted app uses the configured Cloudflare Worker by default. For local testing or self-hosting:

```bash
VIBE_TREE_LEADERBOARD_API_URL=https://your-worker.workers.dev npm start
```

Worker template:

```text
server/leaderboard-worker/
```

## Game Balance

Growth, weather, and activity windows are configured in:

```text
public/assets/trees/vibe-bonsai/config/game-balance.json
```

It contains token level curves, weather thresholds, growth-stage thresholds, and activity-window parameters.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
