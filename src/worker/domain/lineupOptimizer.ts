export interface RosterSlot {
  slotLabel: string;
  eligiblePositions: Set<string>;
}

export interface CandidatePlayer {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  injuryStatus: string | null;
  projectedPoints: number;
}

export interface LineupSlotRecommendation {
  slotLabel: string;
  player: CandidatePlayer | null;
  reasoning: string;
  benchedAlternative: CandidatePlayer | null;
}

export function eligiblePositionsFor(slot: string): Set<string> {
  switch (slot) {
    case "QB":
      return new Set(["QB"]);
    case "RB":
      return new Set(["RB"]);
    case "WR":
      return new Set(["WR"]);
    case "TE":
      return new Set(["TE"]);
    case "FLEX":
      return new Set(["RB", "WR", "TE"]);
    case "SUPER_FLEX":
      return new Set(["QB", "RB", "WR", "TE"]);
    case "K":
      return new Set(["K"]);
    case "DEF":
      return new Set(["DEF"]);
    default:
      return new Set([slot]); // BN/IR/TAXI handled by isStartingSlot
  }
}

export function isStartingSlot(slot: string): boolean {
  return slot !== "BN" && slot !== "IR" && slot !== "TAXI";
}

/**
 * Greedy slot-assignment: fills the scarcest slots first (QB/TE before FLEX/SUPER_FLEX) with
 * the highest-projected eligible player still available. Not a globally optimal bipartite
 * match, but converges to the same result in the overwhelming majority of real rosters, and
 * it's easy to explain — see the Android README for the same tradeoff note.
 */
export function optimizeLineup(
  startingSlots: RosterSlot[],
  candidates: CandidatePlayer[]
): LineupSlotRecommendation[] {
  const available = [...candidates];
  const results: LineupSlotRecommendation[] = [];

  const orderedSlots = [...startingSlots].sort(
    (a, b) => a.eligiblePositions.size - b.eligiblePositions.size
  );

  for (const slot of orderedSlots) {
    const eligible = available
      .filter((c) => slot.eligiblePositions.has(c.position))
      .sort((a, b) => b.projectedPoints - a.projectedPoints);

    const starter = eligible[0];
    const runnerUp = eligible[1];

    if (!starter) {
      results.push({
        slotLabel: slot.slotLabel,
        player: null,
        reasoning: "No eligible player available for this slot — check your bench/waivers.",
        benchedAlternative: null
      });
      continue;
    }

    available.splice(available.indexOf(starter), 1);
    results.push({
      slotLabel: slot.slotLabel,
      player: starter,
      reasoning: buildReasoning(starter, runnerUp ?? null),
      benchedAlternative: runnerUp ?? null
    });
  }

  return results;
}

function buildReasoning(starter: CandidatePlayer, runnerUp: CandidatePlayer | null): string {
  const injuryNote =
    starter.injuryStatus && starter.injuryStatus !== "Healthy"
      ? ` Note: listed as ${starter.injuryStatus} — recheck before lock.`
      : "";

  if (!runnerUp) {
    return `Best available option at this position.${injuryNote}`;
  }

  const margin = starter.projectedPoints - runnerUp.projectedPoints;
  return (
    `Projected ${starter.projectedPoints.toFixed(1)} pts vs ${runnerUp.name}'s ` +
    `${runnerUp.projectedPoints.toFixed(1)} (+${margin.toFixed(1)}).${injuryNote}`
  );
}
