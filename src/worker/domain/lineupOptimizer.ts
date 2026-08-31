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
      return new Set([slot]);
  }
}

export function isStartingSlot(slot: string): boolean {
  return slot !== "BN" && slot !== "IR" && slot !== "TAXI";
}

// Statuses severe enough that a player shouldn't be recommended as a starter
// at all, regardless of projection. Sourced from Sleeper's injury_status values.
const HARD_EXCLUDE_STATUSES = new Set(["Out", "IR", "PUP", "Suspended", "NFI", "COV"]);

// Statuses that carry real but non-disqualifying risk — projections are
// discounted for ranking purposes only (not overwritten/displayed) so a
// risky player needs a genuine edge over a healthy alternative to still win
// the slot, rather than being ranked as if fully healthy.
const RISK_DISCOUNT: Record<string, number> = {
  Doubtful: 0.5,
  Questionable: 0.85
};

function effectiveScore(player: CandidatePlayer): number {
  const discount = player.injuryStatus ? (RISK_DISCOUNT[player.injuryStatus] ?? 1) : 1;
  return player.projectedPoints * discount;
}

/**
 * Greedy slot-assignment: fills the scarcest slots first (QB/TE before FLEX/SUPER_FLEX) with
 * the highest-effective-score eligible player still available. Players with a hard-exclude
 * injury status (Out/IR/PUP/Suspended/etc.) are never considered as starters or bench
 * alternatives. Questionable/Doubtful players are discounted for ranking purposes so they
 * need a real edge over a healthy alternative, but their displayed projectedPoints and
 * benchedAlternative comparisons still show the real (undiscounted) numbers.
 */
export function optimizeLineup(
  startingSlots: RosterSlot[],
  candidates: CandidatePlayer[]
): LineupSlotRecommendation[] {
  const available = candidates.filter(
    (c) => !c.injuryStatus || !HARD_EXCLUDE_STATUSES.has(c.injuryStatus)
  );
  const results: LineupSlotRecommendation[] = [];
  const orderedSlots = [...startingSlots].sort(
    (a, b) => a.eligiblePositions.size - b.eligiblePositions.size
  );

  for (const slot of orderedSlots) {
    const eligible = available
      .filter((c) => slot.eligiblePositions.has(c.position))
      .sort((a, b) => effectiveScore(b) - effectiveScore(a));
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
  const discount = starter.injuryStatus ? RISK_DISCOUNT[starter.injuryStatus] : undefined;
  const injuryNote =
    starter.injuryStatus && starter.injuryStatus !== "Healthy"
      ? discount
        ? ` Note: listed as ${starter.injuryStatus} — projection discounted ${Math.round((1 - discount) * 100)}% for risk when ranking; recheck before lock.`
        : ` Note: listed as ${starter.injuryStatus} — recheck before lock.`
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
