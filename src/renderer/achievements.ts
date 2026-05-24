import type { LedgerEntry } from "../shared/types";
import type { AchievementCategory, AchievementRarity } from "./i18n";

type HistorySourceId = "codex" | "openclaw" | "pi" | "opencode" | "claude" | "gemini" | "hermes";

interface AchievementStatsSnapshot {
  xp: number;
  weather: {
    tokensPerMinute: number;
  };
}

export interface AchievementDef {
  id: string;
  category: AchievementCategory;
  rarity: AchievementRarity;
  name: string;
  description: string;
  flavor?: string;
  hidden?: boolean;
  planned?: boolean;
  condition: (context: AchievementContext) => boolean;
  trigger?: (context: AchievementContext) => Record<string, unknown>;
}

export interface AchievementContext {
  stats: AchievementStatsSnapshot;
  entries: LedgerEntry[];
  stageIndex: number;
  peakTokensPerMinute: number;
  maxDailyXp: number;
  consecutiveDays: number;
  activeSources: Set<HistorySourceId>;
  maxSourcesOneDay: number;
  hasAgentSwitchWithinTenMinutes: boolean;
  sourceXp: Record<HistorySourceId, number>;
  hourSet: Set<number>;
  weekendWarrior: boolean;
  touchGrassReturn: boolean;
  coffeeOverdose: boolean;
  hasFibonacciSession: boolean;
  totalActiveDays: number;
  uniqueModels: number;
  dominantSourceRatio: number;
  hasNoonPeak: boolean;
  has5amTo9amStreak: boolean;
  longestInactiveDays: number;
  totalEntries: number;
  maxEntriesOneDay: number;
  hasHolidayCoding: boolean;
}

export const CATEGORY_ORDER: AchievementCategory[] = ["growth", "peak", "time", "agent", "hidden"];

export function rarityOrder(rarity: AchievementRarity): number {
  const order: Record<AchievementRarity, number> = { legendary: 0, epic: 1, rare: 2, hidden: 3, common: 4 };
  return order[rarity] ?? 5;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "sprout",
    category: "growth",
    rarity: "common",
    name: "破土而出",
    description: "小树发芽了",
    flavor: "每一棵大树，都曾是一粒种子。",
    condition: ({ stats }) => stats.xp >= 1_000,
  },
  {
    id: "sapling",
    category: "growth",
    rarity: "rare",
    name: "亭亭玉立",
    description: "长出像样的树冠",
    flavor: "你的树已经不再是路边的杂草了。",
    condition: ({ stageIndex }) => stageIndex >= 2,
  },
  {
    id: "big_tree",
    category: "growth",
    rarity: "legendary",
    name: "枝繁叶茂",
    description: "已经是一棵大树了",
    flavor: "鸟儿们开始考虑在你这里安家。",
    condition: ({ stageIndex }) => stageIndex >= 5,
  },
  {
    id: "xp_10k",
    category: "growth",
    rarity: "common",
    name: "万字打工人",
    description: "累计 10,000 Token",
    flavor: "一万个 token，都是汗水的结晶。",
    condition: ({ stats }) => stats.xp >= 10_000,
  },
  {
    id: "xp_100k",
    category: "growth",
    rarity: "rare",
    name: "十万军中取上将",
    description: "累计 100,000 Token",
    flavor: "十万大军中，你就是最亮的星。",
    condition: ({ stats }) => stats.xp >= 100_000,
  },
  {
    id: "xp_1m",
    category: "growth",
    rarity: "epic",
    name: "百万字灵魂",
    description: "累计 1,000,000 Token",
    flavor: "如果每个 token 是一步，你已经走了很远。",
    condition: ({ stats }) => stats.xp >= 1_000_000,
  },
  {
    id: "xp_10m",
    category: "growth",
    rarity: "epic",
    name: "千万字成精",
    description: "累计 10,000,000 Token",
    flavor: "传说修炼千万年可以成精，你用 token 做到了。",
    condition: ({ stats }) => stats.xp >= 10_000_000,
  },
  {
    id: "xp_100m",
    category: "growth",
    rarity: "legendary",
    name: "亿点点努力",
    description: "累计 100,000,000 Token",
    flavor: "亿点点？这明明是亿吨吨努力。",
    condition: ({ stats }) => stats.xp >= 100_000_000,
  },
  {
    id: "xp_1b",
    category: "growth",
    rarity: "legendary",
    name: "十亿树王",
    description: "累计 1,000,000,000 Token",
    flavor: "整片森林都得叫你一声大哥。",
    condition: ({ stats }) => stats.xp >= 1_000_000_000,
  },
  {
    id: "reborn",
    category: "growth",
    rarity: "hidden",
    hidden: true,
    planned: true,
    name: "涅槃",
    description: "重置后再次满级",
    flavor: "浴火重生，更胜从前。",
    condition: () => false,
  },
  {
    id: "daily_1k",
    category: "peak",
    rarity: "common",
    name: "热身完毕",
    description: "单日 Token 达到 1,000",
    flavor: "热身而已，真正的锻炼还没开始。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 1_000,
  },
  {
    id: "daily_10k",
    category: "peak",
    rarity: "common",
    name: "今天真拼了",
    description: "单日 Token 达到 10,000",
    flavor: "今天的你，值得一杯奶茶。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 10_000,
  },
  {
    id: "daily_50k",
    category: "peak",
    rarity: "rare",
    name: "疯狂星期四",
    description: "单日 Token 达到 50,000",
    flavor: "V 我 50k Token，谢谢。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 50_000,
  },
  {
    id: "daily_1m",
    category: "peak",
    rarity: "epic",
    name: "今日爆肝",
    description: "单日 Token 达到 1,000,000",
    flavor: "你的肝发来了求救信号。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 1_000_000,
  },
  {
    id: "daily_10m",
    category: "peak",
    rarity: "epic",
    name: "服务器发烫",
    description: "单日 Token 达到 10,000,000",
    flavor: "机房管理员已经拿起了灭火器。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 10_000_000,
  },
  {
    id: "daily_100m",
    category: "peak",
    rarity: "legendary",
    name: "天气系统失控",
    description: "单日 Token 达到 100,000,000",
    flavor: "气象局表示无法预测此次风暴。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 100_000_000,
  },
  {
    id: "streak_3",
    category: "growth",
    rarity: "common",
    name: "三天打鱼",
    description: "连续 3 天有 Token",
    flavor: "坚持三天已经超过了很多新年计划。",
    condition: ({ consecutiveDays }) => consecutiveDays >= 3,
  },
  {
    id: "streak_7",
    category: "growth",
    rarity: "rare",
    name: "不打鱼了",
    description: "连续 7 天有 Token",
    flavor: "两天晒网的日子一去不复返了。",
    condition: ({ consecutiveDays }) => consecutiveDays >= 7,
  },
  {
    id: "streak_30",
    category: "growth",
    rarity: "legendary",
    name: "月租户",
    description: "连续 30 天有 Token",
    flavor: "房东表示你可以考虑签长期合同了。",
    condition: ({ consecutiveDays }) => consecutiveDays >= 30,
  },
  {
    id: "burst_60",
    category: "peak",
    rarity: "common",
    name: "灵感爆发",
    description: "Token/min 达到 60",
    flavor: "灵感来了挡都挡不住。",
    condition: ({ peakTokensPerMinute }) => peakTokensPerMinute >= 60,
  },
  {
    id: "burst_10k",
    category: "peak",
    rarity: "rare",
    name: "手速起飞",
    description: "Token/min 达到 10,000",
    flavor: "你的键盘正在请求加薪。",
    condition: ({ peakTokensPerMinute }) => peakTokensPerMinute >= 10_000,
  },
  {
    id: "burst_100k",
    category: "peak",
    rarity: "epic",
    name: "雨云生成器",
    description: "Token/min 达到 100,000",
    flavor: "云层越来越厚，暴风雨即将来临。",
    condition: ({ peakTokensPerMinute }) => peakTokensPerMinute >= 100_000,
  },
  {
    id: "burst_1m",
    category: "peak",
    rarity: "legendary",
    name: "风暴召唤师",
    description: "Token/min 达到 1,000,000",
    flavor: "这不是 coding，这是召唤天气奇观。",
    condition: ({ peakTokensPerMinute }) => peakTokensPerMinute >= 1_000_000,
  },
  {
    id: "long_session",
    category: "growth",
    rarity: "epic",
    planned: true,
    name: "坐忘",
    description: "单 session 持续超过 4 小时",
    flavor: "你和椅子达成了高度同步。",
    condition: () => false,
  },
  {
    id: "midnight",
    category: "time",
    rarity: "common",
    name: "午夜写诗",
    description: "凌晨 0 点以后还在用",
    flavor: "夜色正好，代码也正好。",
    condition: ({ hourSet }) => hourSet.has(0),
  },
  {
    id: "deep_night",
    category: "time",
    rarity: "rare",
    name: "夜猫本猫",
    description: "凌晨 3 点还在 coding",
    flavor: "凌晨三点的代码，有种别样的浪漫。",
    condition: ({ hourSet }) => hourSet.has(3),
  },
  {
    id: "sunrise",
    category: "time",
    rarity: "rare",
    name: "看过日出",
    description: "凌晨 5 点还在 coding",
    flavor: "是通宵到天亮，不是早起看日出对吧？",
    condition: ({ hourSet }) => hourSet.has(5),
  },
  {
    id: "early_bird",
    category: "time",
    rarity: "common",
    name: "早起的鸟",
    description: "早上 6 点到 7 点有 Token",
    flavor: "早起的鸟儿有虫吃，早起的 coder 有 bug 修。",
    condition: ({ hourSet }) => hourSet.has(6),
  },
  {
    id: "all_nighter",
    category: "time",
    rarity: "epic",
    planned: true,
    name: "昼夜不分",
    description: "同一 session 跨越午夜",
    flavor: "对你来说，时间不过是屏幕右下角的数字。",
    condition: () => false,
  },
  {
    id: "weekend_warrior",
    category: "time",
    rarity: "rare",
    name: "周末不休",
    description: "周六周日各有 Token",
    flavor: "休息日只是换一种方式继续努力。",
    condition: ({ weekendWarrior }) => weekendWarrior,
  },
  {
    id: "codex_connected",
    category: "agent",
    rarity: "common",
    name: "Codex 接入",
    description: "Codex 有第一条事件",
    flavor: "欢迎 Codex 加入豪华午餐。",
    condition: ({ activeSources }) => activeSources.has("codex"),
  },
  {
    id: "claude_connected",
    category: "agent",
    rarity: "common",
    name: "Claude 接入",
    description: "Claude Code 有第一条事件",
    flavor: "Claude 已就位，请下达指令。",
    condition: ({ activeSources }) => activeSources.has("claude"),
  },
  {
    id: "openclaw_connected",
    category: "agent",
    rarity: "common",
    name: "Kiki 接入",
    description: "OpenClaw 有第一条事件",
    flavor: "Kiki 说这棵树可以养。",
    condition: ({ activeSources }) => activeSources.has("openclaw"),
  },
  {
    id: "pi_connected",
    category: "agent",
    rarity: "rare",
    name: "Pi Agent 接入",
    description: "Pi Agent 有第一条事件",
    flavor: "新的分支长出来了。",
    condition: ({ activeSources }) => activeSources.has("pi"),
  },
  {
    id: "opencode_connected",
    category: "agent",
    rarity: "rare",
    name: "OpenCode 接入",
    description: "OpenCode 有第一条事件",
    flavor: "阵容开始变得完整。",
    condition: ({ activeSources }) => activeSources.has("opencode"),
  },
  {
    id: "gemini_connected",
    category: "agent",
    rarity: "rare",
    name: "Gemini 接入",
    description: "Gemini 有第一条事件",
    flavor: "又多了一条思路。",
    condition: ({ activeSources }) => activeSources.has("gemini"),
  },
  {
    id: "hermes_connected",
    category: "agent",
    rarity: "rare",
    name: "Hermes 接入",
    description: "Hermes 有第一条事件",
    flavor: "消息送达，树也收到了。",
    condition: ({ activeSources }) => activeSources.has("hermes"),
  },
  {
    id: "all_agents",
    category: "agent",
    rarity: "legendary",
    name: "全家桶",
    description: "七种 agent 全部接入",
    flavor: "恭喜获得全家桶套餐，附赠加大可乐。",
    condition: ({ activeSources }) => activeSources.size >= 7,
  },
  {
    id: "multi_agent_day",
    category: "agent",
    rarity: "epic",
    name: "多线作战",
    description: "同一天用了 3 种 agent",
    flavor: "一个脑袋不够用，那就多开几条线。",
    condition: ({ maxSourcesOneDay }) => maxSourcesOneDay >= 3,
  },
  {
    id: "agent_switcher",
    category: "agent",
    rarity: "rare",
    name: "不忠诚",
    description: "10 分钟内切换了 agent",
    flavor: "花心不是你的错，是 agent 太多了。",
    condition: ({ hasAgentSwitchWithinTenMinutes }) => hasAgentSwitchWithinTenMinutes,
  },
  {
    id: "touch_grass",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    name: "去外面走走",
    description: "超过 7 天没有 Token 后再次回来",
    flavor: "小树以为你真的去晒太阳了。",
    condition: ({ touchGrassReturn }) => touchGrassReturn,
  },
  {
    id: "coffee_overdose",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    name: "咖啡因超载",
    description: "连续 8 小时不间断 Token 入账",
    flavor: "此成就不建议配合第三杯咖啡食用。",
    condition: ({ coffeeOverdose }) => coffeeOverdose,
  },
  {
    id: "xp_zero_day",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    planned: true,
    name: "摸鱼冠军",
    description: "某天 Token 为 0 但 app 开着",
    flavor: "今天的你选择了世界和平。",
    condition: () => false,
  },
  {
    id: "delete_regret",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    planned: true,
    name: "删了又装",
    description: "重新安装后读到历史数据",
    flavor: "我就知道你会回来的。",
    condition: () => false,
  },
  {
    id: "kiki_approved",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    name: "获得 Kiki 认证",
    description: "OpenClaw 贡献达到 500,000 Token",
    flavor: "Kiki 点了点头，事情开始变得正式。",
    condition: ({ sourceXp }) => sourceXp.openclaw >= 500_000,
  },
  {
    id: "tree_whisperer",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    planned: true,
    name: "树语者",
    description: "盯着小树超过 10 分钟没有动",
    flavor: "你们之间产生了一种安静的理解。",
    condition: () => false,
  },
  {
    id: "fibonacci",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    name: "数学家精神",
    description: "某次 session Token 恰好是斐波那契数",
    flavor: "1, 1, 2, 3, 5, 8, 13... 宇宙的密码藏在 session 里。",
    condition: ({ hasFibonacciSession }) => hasFibonacciSession,
  },

  // ── WoW-inspired: Exploration & Milestones ──────────────────────

  {
    id: "explorer_10d",
    category: "growth",
    rarity: "common",
    name: "初入艾泽拉斯",
    description: "累计活跃 10 天",
    flavor: "欢迎来到这个世界，冒险者。你的旅程才刚刚开始。",
    condition: ({ totalActiveDays }) => totalActiveDays >= 10,
  },
  {
    id: "explorer_50d",
    category: "growth",
    rarity: "rare",
    name: "世界探索者",
    description: "累计活跃 50 天",
    flavor: "你的足迹已遍布这片大陆的每一个角落。",
    condition: ({ totalActiveDays }) => totalActiveDays >= 50,
  },
  {
    id: "explorer_100d",
    category: "growth",
    rarity: "epic",
    name: "探路者",
    description: "累计活跃 100 天",
    flavor: "老兵不死，他们只是不再需要地图。",
    condition: ({ totalActiveDays }) => totalActiveDays >= 100,
  },
  {
    id: "explorer_365d",
    category: "growth",
    rarity: "legendary",
    name: "时光行者",
    description: "累计活跃 365 天",
    flavor: "整整一年。艾泽拉斯的四季，你都见过了。",
    condition: ({ totalActiveDays }) => totalActiveDays >= 365,
  },

  // ── WoW-inspired: Reputation / Mastery ──────────────────────────

  {
    id: "model_collector_3",
    category: "agent",
    rarity: "common",
    name: "初级驯兽师",
    description: "使用过 3 种不同模型",
    flavor: "你开始学会驾驭不同的坐骑了。",
    condition: ({ uniqueModels }) => uniqueModels >= 3,
  },
  {
    id: "model_collector_10",
    category: "agent",
    rarity: "rare",
    name: "稀有坐骑收集者",
    description: "使用过 10 种不同模型",
    flavor: "你的马厩已经比大多数NPC的都大了。",
    condition: ({ uniqueModels }) => uniqueModels >= 10,
  },
  {
    id: "model_collector_20",
    category: "agent",
    rarity: "epic",
    name: "坐骑大师",
    description: "使用过 20 种不同模型",
    flavor: "连奥格瑞玛的驯兽师都要向你请教。",
    condition: ({ uniqueModels }) => uniqueModels >= 20,
  },
  {
    id: "faction_loyalist",
    category: "agent",
    rarity: "rare",
    name: "阵营忠诚者",
    description: "单一 Agent 占总 Token 的 80% 以上",
    flavor: "为了部落！（或者联盟？）",
    condition: ({ dominantSourceRatio }) => dominantSourceRatio >= 0.8,
  },

  // ── WoW-inspired: PvE Raid-style Peaks ──────────────────────────

  {
    id: "raid_boss_5m",
    category: "peak",
    rarity: "epic",
    name: "团队副本：首杀",
    description: "单日 Token 达到 5,000,000",
    flavor: "BOSS 倒下了！DKP 分配开始。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 5_000_000,
  },
  {
    id: "raid_boss_50m",
    category: "peak",
    rarity: "legendary",
    name: "史诗难度：通关",
    description: "单日 Token 达到 50,000,000",
    flavor: "这不是普通的 raid，这是神话难度。你活下来了。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 50_000_000,
  },
  {
    id: "session_grinder",
    category: "peak",
    rarity: "rare",
    name: "日常刷怪达人",
    description: "单日交互次数超过 100",
    flavor: "你的击杀数已经让野怪瑟瑟发抖。",
    condition: ({ maxEntriesOneDay }) => maxEntriesOneDay >= 100,
  },
  {
    id: "session_marathon",
    category: "peak",
    rarity: "epic",
    name: "马拉松刷本",
    description: "单日交互次数超过 500",
    flavor: "副本已被你刷到冒烟，装备早就毕业了。",
    condition: ({ maxEntriesOneDay }) => maxEntriesOneDay >= 500,
  },

  // ── WoW-inspired: Time / Calendar Events ────────────────────────

  {
    id: "high_noon",
    category: "time",
    rarity: "common",
    name: "正午烈日",
    description: "12 点到 13 点有 Token 记录",
    flavor: "别人在吃午饭，你在和 AI 对话。",
    condition: ({ hasNoonPeak }) => hasNoonPeak,
  },
  {
    id: "dawn_patrol",
    category: "time",
    rarity: "epic",
    name: "黎明巡逻",
    description: "5 点到 9 点每小时都有 Token",
    flavor: "当整个服务器还在沉睡，你已经开始了晨间任务。",
    condition: ({ has5amTo9amStreak }) => has5amTo9amStreak,
  },
  {
    id: "holiday_hero",
    category: "time",
    rarity: "rare",
    name: "节日守护者",
    description: "在元旦或春节期间有 Token",
    flavor: "当别人在放烟花，你在放 token。节日快乐，勇士。",
    condition: ({ hasHolidayCoding }) => hasHolidayCoding,
  },

  // ── WoW-inspired: Feats of Strength (Hidden) ───────────────────

  {
    id: "resurrection",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    name: "灵魂治愈者",
    description: "中断超过 14 天后回归",
    flavor: "你在墓地跑了很久的尸，但最终还是复活了。",
    condition: ({ longestInactiveDays }) => longestInactiveDays >= 14,
  },
  {
    id: "thousand_cuts",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    name: "千刀万剐",
    description: "累计 1,000 次交互记录",
    flavor: "不是一刀暴击，是一千刀的执着。",
    condition: ({ totalEntries }) => totalEntries >= 1_000,
  },
  {
    id: "ten_thousand_cuts",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    name: "万刃归一",
    description: "累计 10,000 次交互记录",
    flavor: "刀刀入肉，你已经是传说中的剑圣了。",
    condition: ({ totalEntries }) => totalEntries >= 10_000,
  },
  {
    id: "streak_100",
    category: "growth",
    rarity: "legendary",
    name: "百日维新",
    description: "连续 100 天有 Token",
    flavor: "一百天不间断。你的意志已经超越了大部分勇士。",
    condition: ({ consecutiveDays }) => consecutiveDays >= 100,
  },
];
