import { sleeper } from "./sleeper";
import { KvStore, type CachedPlayer } from "./kv";
import { eligiblePositionsFor, isStartingSlot, type CandidatePlayer, type RosterSlot } from "../domain/lineupOptimizer";
import { getEspnProjections } from "./espnProjections";
import { computeConsensusProjections, type ExternalProjection } from "./projectionSources";
import { ESPN_TEAM_ID_TO_SLEEPER_ABBREV } from "./espnTeamMap";

const PLAYER_CACHE_MAX_AGE_MILLIS = 24 * 60 * 60 * 1000;

// lib/sleeperRepo.ts — updated refreshPlayerCacheIfStale
export async function refreshPlayerCacheIfStale(kv: KvStore): Promise<void> {
  const age = await kv.playersCacheAgeMillis();
  if (age !== null && age < PLAYER_CACHE_MAX_AGE_MILLIS) return;
  const remote = await sleeper.getAllPlayers();
  const entries: Record<string, CachedPlayer> = {};
  for (const [id, p] of Object.entries(remote)) {
    if (!p.player_id) continue;

    // Team defenses have no full_name in Sleeper's data (confirmed) — synthesize
    // one from the team abbreviation so they aren't dropped from the cache.
    const isDefense = p.position === "DEF";
    const fullName = p.full_name ?? (isDefense ? `${p.team ?? id} Defense` : null);
    if (!fullName) continue;

    entries[id] = {
      playerId: p.player_id,
      fullName,
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
 * Normalizes a player name for fuzzy matching across sources: lowercase, strips
 * punctuation and common suffixes (Jr., Sr., II, III, IV). Not perfect — a last
 * resort for when espn_id isn't populated, which turns out to be most players
 * (confirmed live: espn_id is sparsely populated, skewing toward veteran players).
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEspnToSleeperMap(playersCache: Record<string, CachedPlayer>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [sleeperId, player] of Object.entries(playersCache)) {
    if (player.espnId) map.set(String(player.espnId), sleeperId);
  }
  return map;
}

/**
 * Fallback for when espn_id isn't populated: key = "normalizedName|team".
 * Built from Sleeper's cache; ESPN entries are looked up against it using their
 * own fullName + proTeamId (translated to Sleeper's abbreviation convention).
 */
function buildNameTeamMap(playersCache: Record<string, CachedPlayer>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [sleeperId, player] of Object.entries(playersCache)) {
    if (!player.team) continue;
    const key = `${normalizeName(player.fullName)}|${player.team}`;
    map.set(key, sleeperId);
  }
  return map;
}

function translateEspnDstId(espnProTeamId: number): string | undefined {
  return ESPN_TEAM_ID_TO_SLEEPER_ABBREV[espnProTeamId];
}

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

  const needsFallback = playerIds.some((id) => (scoresByPlayer.get(id) ?? []).length === 0);
  let consensusByPlayer = new Map<string, number>();

  if (needsFallback) {
    const espnToSleeper = buildEspnToSleeperMap(playersCache);
    const nameTeamToSleeper = buildNameTeamMap(playersCache);

    let espnProjections: ExternalProjection[] = [];
    try {
      const rawEspn = await getEspnProjections(season, week);
      espnProjections = rawEspn
        .map((p) => {
          if (p.position === "DST") {
            const sleeperId = p.proTeamId !== undefined ? translateEspnDstId(p.proTeamId) : undefined;
            return sleeperId ? { ...p, playerId: sleeperId } : null;
          }

          // Primary: espn_id match
          const byId = espnToSleeper.get(p.playerId);
          if (byId) return { ...p, playerId: byId };

          // Fallback: normalized name + team match
          if (p.fullName && p.proTeamId !== undefined) {
            const team = translateEspnDstId(p.proTeamId);
            if (team) {
              const key = `${normalizeName(p.fullName)}|${team}`;
              const byName = nameTeamToSleeper.get(key);
              if (byName) return { ...p, playerId: byName };
            }
          }

          return null;
        })
        .filter((p): p is ExternalProjection => p !== null);
    } catch (err) {
      console.error("ESPN projections fetch failed", err);
    }
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
