import { sleeper } from "./sleeper";
import { KvStore, type CachedPlayer } from "./kv";
import { eligiblePositionsFor, isStartingSlot, type CandidatePlayer, type RosterSlot } from "../domain/lineupOptimizer";

const PLAYER_CACHE_MAX_AGE_MILLIS = 24 * 60 * 60 * 1000; // refresh at most daily, per Sleeper's guidance

export async function refreshPlayerCacheIfStale(kv: KvStore): Promise<void> {
  const age = await kv.playersCacheAgeMillis();
  if (age !== null && age < PLAYER_CACHE_MAX_AGE_MILLIS) return;

  const remote = await sleeper.getAllPlayers();
  const entries: Record<string, CachedPlayer> = {};
  for (const [id, p] of Object.entries(remote)) {
    if (!p.player_id || !p.full_name) continue;
    entries[id] = {
      playerId: p.player_id,
      fullName: p.full_name,
      position: p.position,
      team: p.team,
      status: p.status,
      injuryStatus: p.injury_status,
      gsisId: p.gsis_id,
      espnId: p.espn_id
    };
  }
  await kv.savePlayersCache(entries);
}

export function startingSlotsFor(league: { roster_positions: string[] }): RosterSlot[] {
  return league.roster_positions
    .filter(isStartingSlot)
    .map((slot) => ({ slotLabel: slot, eligiblePositions: eligiblePositionsFor(slot) }));
}

/**
 * Builds candidate players with a trailing-3-game-average projection, pulled from this
 * league's own scored matchup history. Sleeper has no projections endpoint — same honest
 * placeholder as the Android app; swap in a real feed by replacing this function's projection
 * source, everything downstream (the optimizer) is unaffected.
 */
export async function buildCandidates(
  kv: KvStore,
  leagueId: string,
  season: string,
  playerIds: string[],
  week: number,
  scoringSettings: Record<string, number>
): Promise<CandidatePlayer[]> {
  const playersCache = (await kv.getPlayersCache()) ?? {};

  const lookbackWeeks = Array.from({ length: 4 }, (_, i) => week - 1 - i).filter((w) => w >= 1);
  const scoresByPlayer = new Map<string, number[]>();

  for (const w of lookbackWeeks.sort((a, b) => a - b)) {
    let matchups: Array<{ players_points: Record<string, number> | null }>;
    try {
      matchups = (await fetch(
        `https://api.sleeper.app/v1/league/${leagueId}/matchups/${w}`
      ).then((r) => r.json())) as typeof matchups;
    } catch {
      continue; // best-effort: one bad week shouldn't kill the whole build
    }
    for (const matchup of matchups) {
      for (const [playerId, points] of Object.entries(matchup.players_points ?? {})) {
        if (!playerIds.includes(playerId)) continue;
        if (!scoresByPlayer.has(playerId)) scoresByPlayer.set(playerId, []);
        scoresByPlayer.get(playerId)!.push(points);
      }
    }
  }

  const candidates: CandidatePlayer[] = [];
  for (const playerId of playerIds) {
    const cached = playersCache[playerId];
    if (!cached || !cached.position) continue;

    const recent = (scoresByPlayer.get(playerId) ?? []).slice(-3);
    const projection = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;

    candidates.push({
      playerId,
      name: cached.fullName,
      position: cached.position,
      nflTeam: cached.team,
      injuryStatus: cached.injuryStatus,
      projectedPoints: projection
    });
  }
  return candidates;
}

export async function teamsForPlayers(kv: KvStore, playerIds: string[]): Promise<Record<string, string>> {
  const playersCache = (await kv.getPlayersCache()) ?? {};
  const result: Record<string, string> = {};
  for (const id of playerIds) {
    const team = playersCache[id]?.team;
    if (team) result[id] = team;
  }
  return result;
}
