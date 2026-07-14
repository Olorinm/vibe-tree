export interface LevelCurve {
  levelBase: number;
  levelExponent: number;
}

export interface LevelProgress {
  level: number;
  levelXp: number;
  nextLevelXp: number;
  progress: number;
}

export const VIBE_TREE_LEVEL_CURVE: Readonly<LevelCurve> = {
  levelBase: 100_000,
  levelExponent: 1.65,
};

const EXACT_LEVEL_LIMIT = 100_000;

export function levelProgressForXp(totalXp: number, curve: LevelCurve = VIBE_TREE_LEVEL_CURVE): LevelProgress {
  const safeXp = Number.isFinite(totalXp) && totalXp > 0 ? totalXp : 0;
  const safeCurve = normalizeCurve(curve);
  let level = 1;
  let consumed = 0;
  let needed = xpForNextLevel(level, safeCurve);

  while (level < EXACT_LEVEL_LIMIT && safeXp >= consumed + needed) {
    consumed += needed;
    level += 1;
    needed = xpForNextLevel(level, safeCurve);
  }
  const reachesHighRange = safeXp >= consumed + needed;
  const rawRemaining = safeXp - consumed;
  // At this magnitude, subtracting two nearby IEEE-754 numbers can lose a few
  // XP. Preserve the boundary decision made before the subtraction so the
  // exact/high-range seam does not report the previous level.
  const remaining = reachesHighRange ? Math.max(rawRemaining, needed) : rawRemaining;

  if (reachesHighRange) {
    return approximateHighLevelProgress(level, remaining, safeCurve);
  }

  return {
    level,
    levelXp: remaining,
    nextLevelXp: needed,
    progress: Math.max(0, Math.min(1, remaining / needed)),
  };
}

export function xpForNextLevel(level: number, curve: LevelCurve) {
  const safeLevel = Number.isFinite(level) && level > 0 ? Math.floor(level) : 1;
  return Math.round(curve.levelBase * safeLevel ** curve.levelExponent);
}

function normalizeCurve(curve: LevelCurve): LevelCurve {
  const levelBase = Number.isFinite(curve.levelBase) && curve.levelBase > 0 ? curve.levelBase : VIBE_TREE_LEVEL_CURVE.levelBase;
  const levelExponent =
    Number.isFinite(curve.levelExponent) && curve.levelExponent > 0
      ? curve.levelExponent
      : VIBE_TREE_LEVEL_CURVE.levelExponent;
  const normalized = { levelBase, levelExponent };
  const firstLevelCost = xpForNextLevel(1, normalized);
  return Number.isFinite(firstLevelCost) && firstLevelCost >= 1 ? normalized : { ...VIBE_TREE_LEVEL_CURVE };
}

function approximateHighLevelProgress(anchorLevel: number, remainingXp: number, curve: LevelCurve): LevelProgress {
  const power = curve.levelExponent + 1;
  const anchor = anchorLevel - 0.5;
  const logScaledXp = Math.log(remainingXp) - Math.log(curve.levelBase) + Math.log(power);
  const logAnchorPower = power * Math.log(anchor);
  const largestLog = Math.max(logScaledXp, logAnchorPower);
  const logTargetPower =
    largestLog + Math.log(Math.exp(logScaledXp - largestLog) + Math.exp(logAnchorPower - largestLog));
  const estimatedAdvance = Math.max(0, Math.floor(Math.exp(logTargetPower / power) - anchor));
  let advanced = estimatedAdvance;
  let spent = approximateXpForLevels(anchorLevel, advanced, curve);

  while (advanced > 0 && spent > remainingXp && Number.isSafeInteger(advanced)) {
    advanced -= 1;
    spent = approximateXpForLevels(anchorLevel, advanced, curve);
  }
  let nextBoundary = approximateXpForLevels(anchorLevel, advanced + 1, curve);
  while (nextBoundary <= remainingXp && Number.isSafeInteger(advanced)) {
    advanced += 1;
    spent = nextBoundary;
    nextBoundary = approximateXpForLevels(anchorLevel, advanced + 1, curve);
  }

  const level = anchorLevel + advanced;
  const levelXp = Math.max(0, remainingXp - spent);
  const approximateNextCost = nextBoundary - spent;
  const nextLevelXp = Math.max(
    1,
    Number.isFinite(approximateNextCost) && approximateNextCost > 0
      ? approximateNextCost
      : xpForNextLevel(level, curve),
  );
  return {
    level,
    levelXp,
    nextLevelXp,
    progress: Math.max(0, Math.min(1, levelXp / nextLevelXp)),
  };
}

function approximateXpForLevels(anchorLevel: number, levelCount: number, curve: LevelCurve) {
  if (levelCount <= 0) return 0;
  const exponent = curve.levelExponent;
  const power = exponent + 1;
  const start = anchorLevel;
  const end = anchorLevel + levelCount - 1;
  if (start === end) return xpForNextLevel(start, curve);

  const integral = (curve.levelBase * (end ** power - start ** power)) / power;
  const endpoints = (curve.levelBase * (start ** exponent + end ** exponent)) / 2;
  const firstDerivativeCorrection =
    (curve.levelBase * exponent * (end ** (exponent - 1) - start ** (exponent - 1))) / 12;
  const thirdDerivativeCorrection =
    (-curve.levelBase * exponent * (exponent - 1) * (exponent - 2) *
      (end ** (exponent - 3) - start ** (exponent - 3))) /
    720;
  return integral + endpoints + firstDerivativeCorrection + thirdDerivativeCorrection;
}
