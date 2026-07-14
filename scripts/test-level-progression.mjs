import { levelProgressForXp, VIBE_TREE_LEVEL_CURVE } from "../dist/shared/leveling.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pastOldCap = levelProgressForXp(12_341_396_271, VIBE_TREE_LEVEL_CURVE);
assert(pastOldCap.level === 121, `XP past the old cap should reach level 121, got ${pastOldCap.level}`);
assert(pastOldCap.levelXp === 0, `level 121 boundary should start at 0 XP, got ${pastOldCap.levelXp}`);

const highLevel = levelProgressForXp(535_827_833_592, VIBE_TREE_LEVEL_CURVE);
assert(highLevel.level === 500, `high lifetime XP should reach level 500, got ${highLevel.level}`);
assert(highLevel.levelXp === 1_419_941_693, `level 500 progress should preserve remainder, got ${highLevel.levelXp}`);
assert(highLevel.nextLevelXp === 2_839_883_387, `level 500 should keep a next-level target, got ${highLevel.nextLevelXp}`);

const veryHighLevel = levelProgressForXp(3_358_756_056_540, VIBE_TREE_LEVEL_CURVE);
assert(veryHighLevel.level === 1_000, `level progression should remain open at 1000, got ${veryHighLevel.level}`);
assert(veryHighLevel.progress === 0, `exact level 1000 boundary should start at 0% progress, got ${veryHighLevel.progress}`);

const level20001Boundary = levelProgressForXp(9_430_015_053_621_388, VIBE_TREE_LEVEL_CURVE);
assert(level20001Boundary.level === 20_001, `level 20001 boundary should not lag at the high-level transition, got ${level20001Boundary.level}`);
const level25000Boundary = levelProgressForXp(17_032_254_236_041_104, VIBE_TREE_LEVEL_CURVE);
assert(level25000Boundary.level === 25_000, `level 25000 boundary should preserve discrete progression, got ${level25000Boundary.level}`);
const exactHighRangeBoundary = levelProgressForXp(671_057_725_398_452_400, VIBE_TREE_LEVEL_CURVE);
assert(
  exactHighRangeBoundary.level === 100_001,
  `level 100001 boundary should cross the exact/high-range seam, got ${exactHighRangeBoundary.level}`,
);

const maxSafeInput = levelProgressForXp(Number.MAX_SAFE_INTEGER, VIBE_TREE_LEVEL_CURVE);
const largeInput = levelProgressForXp(1e20, VIBE_TREE_LEVEL_CURVE);
const hugeInput = levelProgressForXp(1e30, VIBE_TREE_LEVEL_CURVE);
assert(largeInput.level > maxSafeInput.level, "levels should keep growing beyond JavaScript's exact integer range");
assert(hugeInput.level > largeInput.level, "larger finite XP should always produce a higher uncapped level");
assert(Number.isFinite(hugeInput.nextLevelXp) && hugeInput.nextLevelXp > 0, "huge XP should keep a finite next-level target");

const invalidCurve = levelProgressForXp(12_341_396_271, { levelBase: 0, levelExponent: Number.NaN });
assert(invalidCurve.level === 121, `invalid curves should fall back safely, got level ${invalidCurve.level}`);

const smallLinearCurve = levelProgressForXp(3, { levelBase: 1, levelExponent: 1 });
assert(smallLinearCurve.level === 3, `valid small linear curves should be preserved, got level ${smallLinearCurve.level}`);

console.log("unlimited level progression tests passed");
