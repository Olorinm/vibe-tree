# DeepSeek Harness integration

## Format and locations

Vibe Tree reads the DeepSeek Harness session-persistence artifacts; it does not
invoke the Harness runtime or upload prompts. The current Harness format is
version `0`: the first JSONL record is a `session` header, followed by events in
`{ type, seq, time, data }` envelopes. The configured persistence backend emits
either plain `session.jsonl` or concatenated independent Zstandard frames in
`session.jsonl.zstd`.

The format references used by this adapter are the upstream
[session types](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/session/src/types.ts),
[JSONL format](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/src/format.ts),
[Zstandard scanner](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/src/zstd.ts),
and [token-usage projection](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/token-meter/src/usage-projection.ts).

Default session roots are platform-independent Harness homes:

- macOS/Linux: `$HOME/.dsh/sessions`
- Windows: `%USERPROFILE%\.dsh\sessions`

The resolver precedence is Vibe Tree's Agent Paths setting, then
`VIBE_DEEPSEEK_SESSIONS_DIR`, then `DSH_HOME/sessions`, then the platform home
fallback above. A `~` entered in the settings field is expanded on both
platforms.

## Implementation map

- `src/electron/deepseekSessionWatcher.ts` performs recursive file discovery,
  incremental raw/Zstandard scanning, torn-tail handling, and restart-safe
  state persistence in `deepseek-session-watcher.json`.
- Usage samples are folded by `(session, turn, step)`. A later
  `assistant/message` sample replaces an earlier usage chunk; if a request fails,
  the latest usage chunk is finalized at `step/end`. `seedLength` excludes
  inherited seed events.
- The ledger event is `source: deepseek-session`, `agent: deepseek-harness`.
  `totalTokens` is uncached input plus output; cache read/write buckets remain
  separate and are counted by Vibe Tree's normal token accounting.
- Renderer source id is `deepseek`; cloud-sync and worker allowlists preserve
  the same source category.

Unknown versions, malformed rows, incomplete frames, and concurrent file
rotation are ignored without stopping other session files. No message content
is copied into ledger entries.

### Field mapping

| Concern | Vibe Tree value |
| --- | --- |
| UI source id | `deepseek` |
| Ledger event source | `deepseek-session` |
| Agent id | `deepseek-harness` |
| Settings path | `deepseekSessionsDir` |
| Status field | `deepseekSession` |
| Explicit path env | `VIBE_DEEPSEEK_SESSIONS_DIR` |
| History env | `VIBE_DEEPSEEK_IMPORT_HISTORY=today` |
| Watcher state | Electron user data `deepseek-session-watcher.json` |

DeepSeek Harness `TokenUsage` reports uncached input, output, cache read, and
cache write as separate buckets. Vibe Tree preserves those buckets; its
`totalTokens` field is input plus output, while normal ledger accounting counts
all four disjoint buckets.

## Development and verification

From the repository root:

```text
npm ci
npm run typecheck
npm run build
npm run test:deepseek-watcher
npm run test:codex-watcher
npm run test:leveling
npm run verify:cloud-sync
npm run smoke:electron
```

`scripts/test-deepseek-session-watcher.mjs` is a deterministic fixture suite.
It covers the real event envelope, raw JSONL, independent Zstandard frames,
torn-frame continuation, usage replacement, cache buckets, seed filtering,
failed-request fallback, provider/model changes, path resolution, restart
deduplication, and privacy (no prompt text in emitted events). CI runs the
fixture after the production build.

The Worker API verifier additionally needs a locally bootable Wrangler 3
installation. If `npm run verify:worker-api` times out before `/health`, retry
after installing or caching Wrangler; that timeout occurs before the API
assertions run.

For an optional live smoke test, use an isolated Vibe Tree user-data directory,
set `VIBE_DEEPSEEK_IMPORT_HISTORY=today`, start Vibe Tree, and run
`dsh --profile headless "Reply with exactly OK."` from a temporary project.
Wait for the watcher status/event count, restart Vibe Tree, and verify the same
session is not duplicated. This command may consume model credits and should
only be run when live Harness credentials are available.
