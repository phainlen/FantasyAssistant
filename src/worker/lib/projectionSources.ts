export interface ExternalProjection {
  playerId: string;
  position: string;
  espnPoints?: number;
  fantasyProsRank?: number;
}

// Rough points-per-position ceiling used to convert a 0-100 consensus score
// back into a plausible point value. Tune these once real Week 1 data is in.
const POSITION_POINT_CEILING: Record<string, number> = {
  QB: 28,
  RB: 24,
  WR: 22,
  TE: 16,
  K: 12,
  DEF: 14
};

function normalizePoints(value: number, min: number, max: number): number {
  if (max === min) return 50; // no spread in this group; treat as average
  return ((value - min) / (max - min)) * 100;
}

function normalizeRank(rank: number, worstRank: number): number {
  if (worstRank <= 1) return 50;
  return ((worstRank - rank) / (worstRank - 1)) * 100;
}

export function computeConsensusProjections(
  raw: ExternalProjection[]
): Map<string, number> {
  const byPosition = new Map<string, ExternalProjection[]>();
  for (const p of raw) {
    if (!byPosition.has(p.position)) byPosition.set(p.position, []);
    byPosition.get(p.position)!.push(p);
  }

  const result = new Map<string, number>();

  for (const [position, players] of byPosition) {
    const pointsValues = players.map((p) => p.espnPoints).filter((v): v is number => v !== undefined);
    const ranks = players.map((p) => p.fantasyProsRank).filter((v): v is number => v !== undefined);
    const minPoints = pointsValues.length ? Math.min(...pointsValues) : 0;
    const maxPoints = pointsValues.length ? Math.max(...pointsValues) : 0;
    const worstRank = ranks.length ? Math.max(...ranks) : 1;

    for (const p of players) {
      const scores: number[] = [];
      if (p.espnPoints !== undefined) scores.push(normalizePoints(p.espnPoints, minPoints, maxPoints));
      if (p.fantasyProsRank !== undefined) scores.push(normalizeRank(p.fantasyProsRank, worstRank));
      if (scores.length === 0) continue; // no external data at all; caller falls back to 0

      const consensusScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const ceiling = POSITION_POINT_CEILING[position] ?? 15;
      result.set(p.playerId, (consensusScore / 100) * ceiling);
    }
  }

  return result;
}
