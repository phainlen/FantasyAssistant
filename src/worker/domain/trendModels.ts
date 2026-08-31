export type TrendTriggerType = "HOT_STREAK" | "TARGET_SHARE_SPIKE" | "SNAP_COUNT_JUMP";

export type PlayerOwnership =
  | { kind: "FREE_AGENT" }
  | { kind: "OPPONENT_BENCH"; managerName: string };

export function describeOwnership(ownership: PlayerOwnership): string {
  return ownership.kind === "FREE_AGENT" ? "Free agent" : `On ${ownership.managerName}'s bench`;
}

export interface SwapCandidate {
  playerId: string;
  playerName: string;
  position: string;
  recentAvgPoints: number;
}

export interface TrendAlert {
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  week: number;
  triggerType: TrendTriggerType;
  detail: string;
  ownership: PlayerOwnership;
  firedAtEpochMillis: number;
  // Only populated for FREE_AGENT alerts where at least one of your roster players
  // (starter or bench) is beaten by swapAlertMinPointsEdge or more. Weakest first.
  suggestedSwaps?: SwapCandidate[];
}
