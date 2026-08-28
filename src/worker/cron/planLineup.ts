import { KvStore } from "../lib/kv";
import { sleeper } from "../lib/sleeper";
import { getWeekSchedule } from "../lib/espnSchedule";
import { refreshPlayerCacheIfStale, startingSlotsFor, buildCandidates, teamsForPlayers } from "../lib/sleeperRepo";
import { optimizeLineup } from "../domain/lineupOptimizer";
import { computeWaves } from "../domain/kickoffWaveCalculator";
import type { StoredWave } from "../lib/kv";

export async function planLineup(kv: KvStore): Promise<void> {
  const config = await kv.getLeagueConfig();
  if (!config) return; // not set up yet

  await refreshPlayerCacheIfStale(kv);

  const nflState = await sleeper.getNflState();
  const week = nflState.week;
  const season = nflState.season;

  const league = await sleeper.getLeague(config.leagueId);
  const rosters = await sleeper.getRosters(config.leagueId);
  const myRoster = rosters.find((r) => r.roster_id === config.rosterId);
  if (!myRoster) return;

  const playerIds = myRoster.players ?? [];
  const candidates = await buildCandidates(kv, config.leagueId, season, playerIds, week, league.scoring_settings);
  const slots = startingSlotsFor(league);
  const recommendation = optimizeLineup(slots, candidates);

  await kv.saveLineupForWeek(week, recommendation);

  const starterIds = recommendation.map((r) => r.player?.playerId).filter((id): id is string => !!id);
  const teams = await teamsForPlayers(kv, starterIds);
  const weekEvents = await getWeekSchedule(week);
  const waves = computeWaves(teams, weekEvents);

  const storedWaves: StoredWave[] = waves.map((w) => ({ ...w, week, reminderSent: false }));
  await kv.saveWavesForWeek(week, storedWaves);
}
