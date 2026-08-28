/** Turns a raw Sleeper stat line into fantasy points using the league's own scoring_settings. */
export function calculatePoints(
  rawStats: Record<string, number>,
  scoringSettings: Record<string, number>
): number {
  let total = 0;
  for (const [statKey, value] of Object.entries(rawStats)) {
    const weight = scoringSettings[statKey] ?? 0;
    total += value * weight;
  }
  return total;
}
