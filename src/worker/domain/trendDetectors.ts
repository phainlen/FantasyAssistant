/**
 * "Hot streak over two games" is interpreted as more than two — a streak spanning at least
 * three consecutive weeks — matching the same reasoning documented in the Android version.
 */
export interface HotStreakResult {
  streakGames: number;
  weeklyPoints: number[];
}

export function evaluateHotStreak(
  weeklyPointsOldestFirst: number[],
  minStreakGames: number,
  minPointsThreshold: number
): HotStreakResult | null {
  if (weeklyPointsOldestFirst.length < minStreakGames) return null;

  const recent = weeklyPointsOldestFirst.slice(-minStreakGames);
  const allAboveThreshold = recent.every((p) => p >= minPointsThreshold);
  const nonDecreasing = recent.every((p, i) => i === 0 || p >= recent[i - 1]);

  return allAboveThreshold && nonDecreasing ? { streakGames: recent.length, weeklyPoints: recent } : null;
}

/**
 * Generic "did the latest value spike vs. recent baseline" check, shared by target share and
 * snap count detection.
 */
export interface SpikeResult {
  current: number;
  baselineAverage: number;
  delta: number;
}

export function evaluateSpike(
  valuesOldestFirst: number[],
  minBaselineGames: number,
  spikeMultiplier: number,
  minAbsoluteJump: number
): SpikeResult | null {
  if (valuesOldestFirst.length < minBaselineGames + 1) return null;

  const current = valuesOldestFirst[valuesOldestFirst.length - 1];
  const baseline = valuesOldestFirst.slice(-(minBaselineGames + 1), -1);
  const baselineAverage = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const delta = current - baselineAverage;

  const isSpike =
    baselineAverage > 0 && current >= baselineAverage * spikeMultiplier && delta >= minAbsoluteJump;

  return isSpike ? { current, baselineAverage, delta } : null;
}

/** Target share only means something for pass-catchers: RB, WR, TE. */
export function evaluateTargetShareSpike(
  weeklyTargetShareOldestFirst: number[],
  spikeMultiplier: number,
  minAbsoluteJump: number
): SpikeResult | null {
  return evaluateSpike(weeklyTargetShareOldestFirst, 2, spikeMultiplier, minAbsoluteJump);
}

/**
 * Offensive snap percentage. Applicable to QB, RB, WR, TE — not K (no offensive snaps) or DEF
 * (defenses play nearly every defensive snap regardless of role, so % isn't a useful signal).
 */
export function evaluateSnapCountJump(
  weeklyOffenseSnapPctOldestFirst: number[],
  spikeMultiplier: number,
  minAbsoluteJump: number
): SpikeResult | null {
  return evaluateSpike(weeklyOffenseSnapPctOldestFirst, 2, spikeMultiplier, minAbsoluteJump);
}
