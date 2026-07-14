import type { TreeAsset } from "../shared/types";
import { VIBE_TREE_LEVEL_CURVE } from "../shared/leveling";
import type { GameBalance, PureSvgManifest } from "./types";

export const DEFAULT_PURE_SVG_MANIFEST: PureSvgManifest = {
  stages: [
    { id: "sprout", label: "01 sprout", asset: "/assets/trees/vibe-bonsai/pure-svg/01-sprout-layered-idle.svg" },
    { id: "seedling", label: "02 seedling", asset: "/assets/trees/vibe-bonsai/pure-svg/02-seedling-layered-idle.svg" },
    { id: "young", label: "03 young", asset: "/assets/trees/vibe-bonsai/pure-svg/03-young-layered-idle.svg" },
    { id: "medium", label: "04 medium", asset: "/assets/trees/vibe-bonsai/pure-svg/04-medium-layered-idle.svg" },
    { id: "lush", label: "05 lush", asset: "/assets/trees/vibe-bonsai/pure-svg/05-lush-layered-idle.svg" },
    { id: "full", label: "06 full", asset: "/assets/trees/vibe-bonsai/pure-svg/06-full-layered-idle.svg" },
  ],
};

export const DEFAULT_GAME_BALANCE: GameBalance = {
  xp: { ...VIBE_TREE_LEVEL_CURVE },
  weather: {
    rateWindowSeconds: 60,
    thresholds: [
      { id: "clear", label: "晴朗", minXpPerMinute: 0 },
      { id: "breeze", label: "微风", minXpPerMinute: 10_000 },
      { id: "drizzle", label: "细雨", minXpPerMinute: 50_000 },
      { id: "rain", label: "大雨", minXpPerMinute: 150_000 },
      { id: "thunder", label: "雷雨", minXpPerMinute: 500_000 },
      { id: "storm", label: "风暴", minXpPerMinute: 1_000_000 },
    ],
  },
  activity: {
    activeWindowSeconds: 90,
    peakWindowSeconds: 300,
  },
  stages: [
    { minLevel: 1, id: "sprout", label: "新芽" },
    { minLevel: 20, id: "seedling", label: "幼苗" },
    { minLevel: 40, id: "young", label: "小树" },
    { minLevel: 60, id: "medium", label: "成长期" },
    { minLevel: 80, id: "lush", label: "茂盛" },
    { minLevel: 100, id: "full", label: "完全体" },
  ],
};

export function buildTreeAsset(manifest: PureSvgManifest): TreeAsset {
  const labels: Record<string, string> = {
    sprout: "新芽",
    seedling: "幼苗",
    young: "小树",
    medium: "成长期",
    lush: "繁茂",
    full: "完全体",
  };

  return {
    id: "vibe-bonsai",
    displayName: "Vibe Tree",
    baseSize: { width: 96, height: 96 },
    defaultScale: 2,
    palette: {
      leaf: "#5bbf7a",
      rain: "#78b7d8",
      storm: "#fff2a8",
      soilGlow: "#f2a541",
      wind: "#d7f7d0",
    },
    stages: manifest.stages.map((stage) => ({
      id: stage.id,
      label: labels[stage.id] ?? stage.label,
      image: stage.asset,
    })),
  };
}

export function treeStatsSignature(asset: TreeAsset, balance: GameBalance) {
  return [
    asset.stages.map((stage) => `${stage.id}:${stage.image}`).join(","),
    balance.xp.levelBase,
    balance.xp.levelExponent,
    balance.weather.rateWindowSeconds,
    balance.activity.activeWindowSeconds,
    balance.activity.peakWindowSeconds,
    balance.stages.map((stage) => `${stage.id}:${stage.minLevel}`).join(","),
  ].join("|");
}
