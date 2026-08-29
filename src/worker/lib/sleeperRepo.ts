import { sleeper } from "./sleeper";
import { KvStore, type CachedPlayer } from "./kv";
import { eligiblePositionsFor, isStartingSlot, type CandidatePlayer, type RosterSlot } from "../domain/lineupOptimizer";
import { getEspnProjections } from "./espnProjections";
import { computeConsensusProjections, type ExternalProjection } from "./projectionSources";

const PLAYER_CACHE_MAX_AGE_MILLIS = 24 * 60 * 60 * 1000;

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
 * Maps ESPN player IDs back to Sleeper player IDs using the espn_id field Sleeper
 * includes on each cached player. Not every player has espn_id populated (seen empty
 * on at least some Sleeper records), so this is best-effort — unmatched ESPN entries
 * are dropped rather than guessed at.
 */
function buildEspnToSleeperMap(playersCache: Record<string, CachedPlayer>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [sleeperId, player] of Object.entries(playersCache)) {
    if (player.espnId) map.set(player.espnId, sleeperId);
  }
  return map;
}

/**
 * Builds candidate players with a trailing-3-game-average projection, pulled from this
 * league's own scored matchup history. Sleeper has no projections endpoint — same honest
 * placeholder as the Android app; swap in a real feed by replacing this function's projection
 * source, everything downstream (the optimizer) is unaffected.
 *
 * When trailing data is unavailable (Week 1 / preseason), falls back to a consensus
 * projection blended from external sources (currently ESPN; more can be added to
 * projectionSources.ts).
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
      continue;
    }
    for (const matchup of matchups) {
      for (const [playerId, points] of Object.entries(matchup.players_points ?? {})) {
        if (!playerIds.includes(playerId)) continue;
        if (!scoresByPlayer.has(playerId)) scoresByPlayer.set(playerId, []);
        scoresByPlayer.get(playerId)!.push(points);
      }
    }
  }

  // Only fetch/build consensus projections if at least one candidate will actually need
  // the fallback — avoids the ESPN call entirely once real trailing data exists.
  const needsFallback = playerIds.some((id) => (scoresByPlayer.get(id) ?? []).length === 0);
  let consensusByPlayer = new Map<string, number>();

  if (needsFallback) {
    const espnToSleeper = buildEspnToSleeperMap(playersCache);
    let espnProjections: ExternalProjection[] = [];
    try {
      const rawEspn = await getEspnProjections(season, week);
      espnProjections = rawEspn
        .map((p) => {
          const sleeperId = espnToSleeper.get(p.playerId);
          return sleeperId ? { ...p, playerId: sleeperId } : null;
        })
        .filter((p): p is ExternalProjection => p !== null);
    } catch (err) {
      console.error("ESPN projections fetch failed", err);
    }
    // More sources (e.g. FantasyPros) get merged into this same array once added.
    consensusByPlayer = computeConsensusProjections(espnProjections);
  }

  const candidates: CandidatePlayer[] = [];
  for (const playerId of playerIds) {
    const cached = playersCache[playerId];
    if (!cached || !cached.position) continue;

    const recent = (scoresByPlayer.get(playerId) ?? []).slice(-3);
    const projection =
      recent.length > 0
        ? recent.reduce((a, b) => a + b, 0) / recent.length
        : (consensusByPlayer.get(playerId) ?? 0);

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
