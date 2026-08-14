# Privacy & Data Handling / 隐私与数据处理

Vibe Tree is local-first. It reads local AI coding agent usage records to calculate token totals, growth, weather, charts, achievements, and share cards.

Vibe Tree does **not** upload prompts, code, conversation logs, local filenames, local paths, raw session files, or full hourly heatmaps by default.

---

## 简体中文

### 本地读取什么

Vibe Tree 会从本机的 agent 使用记录中提取 token 计数字段、时间、来源、provider / model 等用于统计的字段。默认数据源如下：

| Agent | 默认读取位置 | 文件类型 / 备注 |
| --- | --- | --- |
| Codex | `~/.codex/sessions/**/*.jsonl` | Codex 本地 session 日志 |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Claude Code 本地 project session 日志 |
| OpenClaw | `~/.openclaw/agents/**/sessions/*.jsonl` | OpenClaw 本地 session 日志 |
| Pi Agent | `~/.pi/agent/sessions/**/*.jsonl` | 也支持 `PI_AGENT_DIR` / `PI_CODING_AGENT_DIR` 相关路径 |
| OpenCode | `~/.local/share/opencode/opencode.db` | Windows 下默认是 `%LOCALAPPDATA%\opencode\opencode.db`；兼容旧版 `storage/message/**/*.json` |
| Gemini | `~/.gemini/tmp` | 本地 Gemini session JSON / JSONL |
| Hermes | `~/.hermes/state.db` | Hermes 本地状态数据库 |
| Kimi Code | `~/.kimi-code/sessions/**/wire.jsonl` | Kimi Code 本地 usage 记录 |
| DeepSeek Harness | macOS/Linux `$HOME/.dsh/sessions/**/session.jsonl[.zstd]`；Windows `%USERPROFILE%\.dsh\sessions\**\session.jsonl[.zstd]` | DeepSeek Harness 本地 session usage 记录；也支持 `$DSH_HOME/sessions` |

这些默认路径可以在设置面板的 Agent 路径中覆盖。相关环境变量如 `VIBE_CODEX_SESSIONS_DIR`、`VIBE_CLAUDE_SESSIONS_DIR`、`VIBE_OPENCODE_SESSIONS_DIR`、`VIBE_DEEPSEEK_SESSIONS_DIR` 等也可以覆盖默认路径；DeepSeek Harness 未指定自定义路径时还会遵循 `DSH_HOME`。

### 本地保存什么

Vibe Tree 会在 Electron 的应用数据目录中保存本地统计和设置，例如：

- token ledger：时间、来源、agent、provider、model、input / output / cache token 计数；
- 本地设置：语言、主题、窗口位置、Agent 路径、是否加入排行榜等；
- watcher 状态：已读取文件的偏移量、去重状态和必要的本地路径引用，用于避免重复计数；
- 排行榜登录状态：如果你登录 GitHub 加入排行榜，会在本地保存排行榜 session token 和 GitHub profile 摘要。

这些本地文件用于让 Vibe Tree 在重启后继续工作。

### 默认不会上传什么

默认情况下，Vibe Tree 不会上传：

- prompt / 输入内容；
- 生成或编辑的代码；
- 对话全文、原始 session 记录或消息内容；
- 本地文件名、本地目录路径、项目路径；
- 每次请求的原始明细；
- 完整的 7 x 24 小时热力图；
- 模型使用明细列表。

如果启用了更新检查，应用会访问 GitHub release 信息来判断是否有新版本，但不会把本地使用记录发给 GitHub。

### 加入排行榜时会上传什么

排行榜是可选功能，默认关闭。加入排行榜需要通过 GitHub 登录，OAuth scope 使用 `read:user`，用于识别你的 GitHub 用户。

加入排行榜后，远端服务会保存：

- GitHub 用户 ID、用户名、头像 URL、profile URL；
- 经过哈希处理的排行榜 session token；
- 每日 token 总量和 24h 小时级 token 汇总，用于计算 24h、7 天、30 天和全部排行榜；
- app version。

同步请求会发送本地首次使用日期，用于清理安装日前的历史行；也可能包含时区信息。当前 Worker 不会把首次使用日期或时区持久化为独立数据库字段。

如果你主动开启“公开使用偏好”，才会额外上传按排行榜范围聚合后的偏好数据：

- 最常用 Agent 及占比；
- 常用模型；
- 偏爱时段；
- token 峰值。

这些偏好数据只用于排行榜展示。关闭“公开使用偏好”后，后续同步会清除远端的偏好展示数据。

### 安全与滥用防护日志

排行榜 Worker 会记录必要的安全事件来做限流和排障。非普通限流事件可能写入 D1：

- 请求路径、方法、状态码；
- GitHub 用户 ID（如果能识别）；
- 哈希后的 IP；
- Cloudflare 提供的国家 / 地区；
- User-Agent；
- 简短错误元数据。

这些日志不包含 prompt、代码、本地文件名、本地路径或原始 session 内容。

### 如何关闭

- **关闭排行榜**：在设置里退出排行榜。退出会请求远端删除你的排行榜账号、session、同步状态、排行榜聚合 token 数据、公开偏好数据，以及和该用户关联的安全事件。
- **关闭公开偏好**：关闭“公开使用偏好”开关，并再次同步。之后排行榜只保留聚合 token 数据。
- **排除某个 Agent 的统计**：在设置面板的 Agent 路径区域取消勾选对应来源。未勾选的来源不会计入成长、图表或排行榜同步。
- **控制读取位置**：在设置面板中把某个 Agent 的路径改成你明确选择的目录或文件。
- **删除本地数据**：退出 Vibe Tree 后删除系统中的 Vibe Tree 应用数据目录。目录名和位置由 Electron / 操作系统决定。

---

## English

### What Vibe Tree Reads Locally

Vibe Tree extracts token accounting fields, timestamps, source, provider, and model metadata from local agent usage records. Default sources are:

| Agent | Default location | File type / notes |
| --- | --- | --- |
| Codex | `~/.codex/sessions/**/*.jsonl` | Codex local session logs |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Claude Code local project session logs |
| OpenClaw | `~/.openclaw/agents/**/sessions/*.jsonl` | OpenClaw local session logs |
| Pi Agent | `~/.pi/agent/sessions/**/*.jsonl` | Also supports `PI_AGENT_DIR` / `PI_CODING_AGENT_DIR`-based paths |
| OpenCode | `~/.local/share/opencode/opencode.db` | On Windows, `%LOCALAPPDATA%\opencode\opencode.db`; legacy `storage/message/**/*.json` is also supported |
| Gemini | `~/.gemini/tmp` | Local Gemini session JSON / JSONL |
| Hermes | `~/.hermes/state.db` | Hermes local state database |
| Kimi Code | `~/.kimi-code/sessions/**/wire.jsonl` | Local Kimi Code usage records |
| DeepSeek Harness | macOS/Linux `$HOME/.dsh/sessions/**/session.jsonl[.zstd]`; Windows `%USERPROFILE%\.dsh\sessions\**\session.jsonl[.zstd]` | Local DeepSeek Harness session usage records; `$DSH_HOME/sessions` is also supported |

These paths can be overridden in the Agent Paths settings. Environment variables such as `VIBE_CODEX_SESSIONS_DIR`, `VIBE_CLAUDE_SESSIONS_DIR`, `VIBE_OPENCODE_SESSIONS_DIR`, and `VIBE_DEEPSEEK_SESSIONS_DIR` can also override defaults; DeepSeek Harness also follows `DSH_HOME` when no custom path is set.

### What Vibe Tree Stores Locally

Vibe Tree stores local state in Electron's app data directory, including:

- token ledger entries: time, source, agent, provider, model, input / output / cache token counts;
- local settings: language, theme, window position, agent paths, leaderboard opt-in state;
- watcher state: file offsets, deduplication state, and local path references needed to avoid double-counting;
- leaderboard auth state: if you sign in with GitHub, a leaderboard session token and a GitHub profile summary.

These files let Vibe Tree continue working across restarts.

### What Is Not Uploaded By Default

By default, Vibe Tree does not upload:

- prompts or input text;
- generated or edited code;
- full conversations, raw session records, or message contents;
- local filenames, local directory paths, or project paths;
- raw per-request event details;
- complete 7 x 24 hour heatmaps;
- full model usage lists.

If update checks are enabled, the app contacts GitHub releases to check for a newer version, but it does not send local usage records to GitHub.

### What Is Uploaded When Joining The Leaderboard

The leaderboard is optional and off by default. Joining it uses GitHub OAuth with the `read:user` scope to identify your GitHub user.

After joining, the remote service stores:

- GitHub user ID, username, avatar URL, and profile URL;
- a hashed leaderboard session token;
- daily token totals and recent hourly token aggregates used for 24h, 7-day, 30-day, and all-time rankings;
- app version.

Sync requests send the local first-use date to clean rows before the local install date, and may include timezone information. The current Worker does not persist first-use date or timezone as standalone database fields.

If you explicitly enable "Public usage preferences", Vibe Tree also uploads range-scoped aggregate preference data:

- favorite agent and percentage;
- favorite model;
- favorite coding period;
- peak token rate.

These preference fields are used only for leaderboard display. Turning "Public usage preferences" off and syncing again clears remote preference rows.

### Security And Abuse-Prevention Logs

The leaderboard Worker records limited security events for rate limiting and debugging. Non-routine security events may be written to D1:

- request path, method, and status;
- GitHub user ID, if known;
- hashed IP;
- Cloudflare country / region;
- User-Agent;
- short error metadata.

These logs do not include prompts, code, local filenames, local paths, or raw session contents.

### How To Turn Things Off

- **Leave the leaderboard**: use the settings UI to leave the leaderboard. This requests remote deletion of your leaderboard account, sessions, sync state, aggregate leaderboard token rows, public preference rows, and security events linked to that user.
- **Disable public preferences**: turn off "Public usage preferences" and sync again. The leaderboard will keep only aggregate token rows.
- **Exclude an agent from stats**: uncheck that source in the Agent Paths settings. Unchecked sources are excluded from growth, charts, and leaderboard sync.
- **Control source locations**: set an agent path to a directory or file you explicitly choose.
- **Delete local data**: quit Vibe Tree and remove the Vibe Tree app data directory created by Electron / your operating system.
