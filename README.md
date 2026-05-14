# 🌳 Vibe Tree

简体中文 | [English](README.en.md)

**你的 coding agent 每消耗一个 token，桌面上的小树就长一点。**

Vibe Tree 是一个桌面常驻的 token 天气树——把 vibe coding 的消耗、节奏和活跃度，变成一棵可以养成的像素盆栽。

<p align="center">
  <img src="previews/weather-showcase.png" width="900" alt="Vibe Tree 四种天气组图" />
</p>

<p align="center">
  <img src="previews/manager-window.png" width="900" alt="Vibe Tree 主页管理面板" />
</p>

---

## 快速开始

```bash
npm ci
npm start
```

> 支持 macOS / Windows / Linux。开发模式：`npm run dev`

如果 Electron 二进制从 GitHub 下载较慢，可以临时使用国内镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
npm_config_electron_mirror=https://npmmirror.com/mirrors/electron/ \
npm ci
```

也可以写进本地 `.npmrc`，以后不用每次手敲：

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
```

---

## 为什么用 Vibe Tree？

### 🌱 让编程有生命感
透明悬浮窗常驻桌面，小树随着 token 消耗实时生长。累计 Token 决定等级，最近活跃度决定天气——编码越多，树越茂盛。

### 📊 看见你的 token 去向
管理面板展示来源统计、模型占比、最近 7 天图表。支持按 agent 拆分或查看单个 agent 的 input / output / cache 明细。

### 🏅 解锁传说成就
内置成就系统会记录你的连续活跃、累计消耗和使用节奏，关键时刻用像素弹窗给你一点小小的反馈。

### 🏆 和全球 vibe coder 比一比
可选的全球排行榜，GitHub 登录即可加入。仅上传每日 token 消耗总量，不上传任何代码或会话内容。

---

## 支持的 Agent

| Agent | 状态 | 数据来源 |
|-------|------|----------|
| Claude Code | ✅ | `~/.claude/projects/**/*.jsonl` |
| Codex | ✅ | `~/.codex/sessions/**/*.jsonl` |
| OpenClaw | ✅ | `~/.openclaw/agents/**/sessions/*.jsonl` |
| OpenCode | ✅ | `~/.local/share/opencode/storage/message/**/*.json` |

安装后自动检测，零配置即可开始。来源路径也可在设置中自定义。

---

## 功能一览

- **桌面宠物窗口** — 透明、置顶、可拖动、可锁定
- **管理面板** — 等级、天气、活跃会话、来源统计、7 天图表
- **等级牌** — 3D 翻牌动效，可配置显示等级 / 累计 token / token/s
- **全球排行榜** — GitHub 登录，可随时加入或退出
- **自动更新** — 启动后检测 GitHub 最新版本，支持终端一键更新
- **中英文切换** — 设置面板一键切换语言
- **开机启动 & 静默模式** — 安静地陪你写代码

---

## 更新记录

查看 [CHANGELOG.md](CHANGELOG.md)。

---

<details>
<summary><strong>📖 Token 规则</strong></summary>

```
计入 Token = inputTokens + outputTokens；对 Anthropic 来源，还会加上单独上报的 cacheWriteTokens。
```

部分 provider 会把缓存输入包含在 `inputTokens` 里；Anthropic 会单独上报 cache read/write。Vibe Tree 会把 Claude Code 的 cache write 视为本次新创建的输入并计入累计 Token，cache read 则作为复用上下文展示，不计入成长总量。

默认从安装当天开始统计，安装日前的历史不会计入。

</details>

<details>
<summary><strong>🔧 高级配置</strong></summary>

### 导入历史数据

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

### 排行榜服务

排行榜默认关闭。线上版本使用已部署的 Worker，本地调试可覆盖：

```bash
VIBE_TREE_LEADERBOARD_API_URL=https://your-worker.workers.dev npm start
```

后端模板：`server/leaderboard-worker/`

隐私保证：仅上传近 30 日每日 token 总量，不上传提示词、文件、会话记录或模型信息。

</details>

<details>
<summary><strong>🎮 Game Balance</strong></summary>

成长、天气和活跃窗口由此文件配置：

```
public/assets/trees/vibe-bonsai/config/game-balance.json
```

包含：Token 等级曲线、天气阈值、成长阶段阈值、活跃窗口参数。

</details>

<details>
<summary><strong>💾 数据持久化</strong></summary>

Electron 数据目录保存：

- `usage-events.jsonl` — append-only 事件库
- `usage-meta.json` — 安装日期等元信息
- `device-settings.json` — 本机设置
- `*-session-watcher.json` — 各 agent 的 watcher 状态

</details>

---

## 产品方向

Vibe Tree 不是单纯的 token dashboard。目标是让 vibe coding 的消耗和节奏通过桌面宠物可感知——先把本地多 agent 读取做稳，再持续打磨桌宠表现、天气反馈和养成数值。

---

## License

MIT
