import { sleeper, leagueUserTeamName, type SleeperLeagueUser, type SleeperRoster } from "./sleeper";
import { KvStore, type CachedPlayer, type TrendAlertSettings } from "./kv";
import { calculatePoints } from "../domain/scoring";
import { evaluateHotStreak, evaluateTargetShareSpike, evaluateSnapCountJump } from "../domain/trendDetectors";
import type { PlayerOwnership, SwapCandidate, TrendAlert, TrendTriggerType } from "../domain/trendModels";
import { getWeeklyTargetShare, getWeeklySnapPercentage } from "./nflverse";

const MONITORED_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
const PASS_CATCHER_POSITIONS = new Set(["RB", "WR", "TE"]);
const SNAP_TRACKED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const FLEX_GROUP = new Set(["RB", "WR", "TE"]);
const LOOKBACK_WEEKS = 5;
const RECENT_FORM_WEEKS = 3; // window used for the free-agent-vs-roster swap comparison
const MAX_SUGGESTED_SWAPS = 3;

function isEligibleForSwapComparison(freeAgentPos: string, rosterPlayerPos: string): boolean {
  if (freeAgentPos === rosterPlayerPos) return true;
  return FLEX_GROUP.has(freeAgentPos) && FLEX_GROUP.has(rosterPlayerPos);
}

function recentAverage(weeklyPoints: number[]): number | null {
  if (weeklyPoints.length === 0) return null;
  const recent = weeklyPoints.slice(-RECENT_FORM_WEEKS);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

export async function findNewTrendAlerts(
  kv: KvStore,
  leagueId: string,
  season: string,
  currentWeek: number,
  myRosterId: number,
  scoringSettings: Record<string, number>,
  settings: TrendAlertSettings
): Promise<TrendAlert[]> {
  if (currentWeek <= 1) return [];

  const throughWeek = currentWeek - 1;
  const startWeek = Math.max(1, throughWeek - LOOKBACK_WEEKS + 1);
  if (startWeek > throughWeek) return [];
  const lookbackWeeks: number[] = [];
  for (let w = startWeek; w <= throughWeek; w++) lookbackWeeks.push(w);

  const rosters = await sleeper.getRosters(leagueId);
  const leagueUsers = await sleeper.getLeagueUsers(leagueId);
  const allRosteredPlayerIds = new Set(rosters.flatMap((r) => r.players ?? []));

  const ownershipByPlayer = buildOwnershipMap(rosters, leagueUsers, myRosterId);

  const playersCache = (await kv.getPlayersCache()) ?? {};
  for (const [playerId, player] of Object.entries(playersCache)) {
    if (ownershipByPlayer.has(playerId)) continue;
    if (!player.position || !MONITORED_POSITIONS.has(player.position)) continue;
    if (player.status && player.status !== "Active") continue;
    if (!allRosteredPlayerIds.has(playerId)) {
      ownershipByPlayer.set(playerId, { kind: "FREE_AGENT" });
    }
  }

  const monitoredIds = [...ownershipByPlayer.keys()].filter((id) => {
    const p = playersCache[id];
    return p?.position && MONITORED_POSITIONS.has(p.position);
  });

  // Your own roster (starters + bench) also needs recent-form data so hot free
  // agents can be compared against it — tracked separately from monitoredIds
  // since we never fire trend alerts on your own players.
  const myRoster = rosters.find((r) => r.roster_id === myRosterId);
  const myRosterIds = myRoster?.players ?? [];

  if (monitoredIds.length === 0 && myRosterIds.length === 0) return [];

  const weeklyPointsByPlayer = new Map<string, number[]>();
  for (const week of lookbackWeeks) {
    let rawStats: Record<string, Record<string, number>>;
    try {
      rawStats = await sleeper.getWeeklyStats(season, week);
    } catch {
      continue;
    }
    for (const playerId of [...monitoredIds, ...myRosterIds]) {
      const points = rawStats[playerId] ? calculatePoints(rawStats[playerId], scoringSettings) : 0;
      if (!weeklyPointsByPlayer.has(playerId)) weeklyPointsByPlayer.set(playerId, []);
      weeklyPointsByPlayer.get(playerId)!.push(points);
    }
  }

  const targetShareByWeek = await getWeeklyTargetShare(season, throughWeek);
  const snapPctByWeek = await getWeeklySnapPercentage(season, throughWeek);

  const newAlerts: TrendAlert[] = [];

  for (const playerId of monitoredIds) {
    const player = playersCache[playerId];
    const ownership = ownershipByPlayer.get(playerId);
    if (!player || !ownership) continue;

    const weeklyPoints = weeklyPointsByPlayer.get(playerId) ?? [];
    const hotStreak = evaluateHotStreak(weeklyPoints, settings.hotStreakMinGames, settings.hotStreakMinPoints);
    if (hotStreak) {
      await maybeAdd(kv, newAlerts, player, ownership, currentWeek, "HOT_STREAK",
        `${hotStreak.streakGames} straight weeks scoring ${Math.min(...hotStreak.weeklyPoints).toFixed(1)}+ pts, trending up.`,
        computeSuggestedSwaps(player, ownership, weeklyPoints, playersCache, myRosterIds, weeklyPointsByPlayer, settings));
    }

    if (player.position && PASS_CATCHER_POSITIONS.has(player.position) && player.gsisId) {
      const series = lookbackWeeks.map((w) => targetShareByWeek.get(w)?.get(player.gsisId!)).filter(
        (v): v is number => v !== undefined
      );
      const spike = evaluateTargetShareSpike(series, settings.targetShareSpikeMultiplier, settings.targetShareMinJumpPct / 100);
      if (spike) {
        await maybeAdd(kv, newAlerts, player, ownership, currentWeek, "TARGET_SHARE_SPIKE",
          `Target share jumped to ${(spike.current * 100).toFixed(0)}% (was ${(spike.baselineAverage * 100).toFixed(0)}% avg).`,
          computeSuggestedSwaps(player, ownership, weeklyPoints, playersCache, myRosterIds, weeklyPointsByPlayer, settings));
      }
    }

    if (player.position && SNAP_TRACKED_POSITIONS.has(player.position) && player.gsisId) {
      const series = lookbackWeeks.map((w) => snapPctByWeek.get(w)?.get(player.gsisId!)).filter(
        (v): v is number => v !== undefined
      );
      const jump = evaluateSnapCountJump(series, settings.snapCountSpikeMultiplier, settings.snapCountMinJumpPct / 100);
      if (jump) {
        await maybeAdd(kv, newAlerts, player, ownership, currentWeek, "SNAP_COUNT_JUMP",
          `Snap share jumped to ${(jump.current * 100).toFixed(0)}% (was ${(jump.baselineAverage * 100).toFixed(0)}% avg).`,
          computeSuggestedSwaps(player, ownership, weeklyPoints, playersCache, myRosterIds, weeklyPointsByPlayer, settings));
      }
    }
  }

  return newAlerts;
}

/**
 * Only compares against free agents (per product decision — you can't add an
 * opponent's rostered player, so a swap suggestion there wouldn't be actionable).
 * Returns your weakest eligible roster players (starter or bench) that the free
 * agent's recent form beats by at least settings.swapAlertMinPointsEdge, weakest
 * first, capped at MAX_SUGGESTED_SWAPS. Undefined if none clear the bar.
 */
function computeSuggestedSwaps(
  freeAgent: CachedPlayer,
  ownership: PlayerOwnership,
  freeAgentWeeklyPoints: number[],
  playersCache: Record<string, CachedPlayer>,
  myRosterIds: string[],
  weeklyPointsByPlayer: Map<string, number[]>,
  settings: TrendAlertSettings
): SwapCandidate[] | undefined {
  if (ownership.kind !== "FREE_AGENT" || !freeAgent.position) return undefined;

  const freeAgentAvg = recentAverage(freeAgentWeeklyPoints);
  if (freeAgentAvg === null) return undefined;

  const candidates: SwapCandidate[] = [];
  for (const rosterPlayerId of myRosterIds) {
    const rosterPlayer = playersCache[rosterPlayerId];
    if (!rosterPlayer?.position) continue;
    if (!isEligibleForSwapComparison(freeAgent.position, rosterPlayer.position)) continue;

    const rosterAvg = recentAverage(weeklyPointsByPlayer.get(rosterPlayerId) ?? []);
    if (rosterAvg === null) continue;
    if (freeAgentAvg - rosterAvg < settings.swapAlertMinPointsEdge) continue;

    candidates.push({
      playerId: rosterPlayer.playerId,
      playerName: rosterPlayer.fullName,
      position: rosterPlayer.position,
      recentAvgPoints: rosterAvg
    });
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => a.recentAvgPoints - b.recentAvgPoints); // weakest first — best swap candidates
  return candidates.slice(0, MAX_SUGGESTED_SWAPS);
}

async function maybeAdd(
  kv: KvStore,
  acc: TrendAlert[],
  player: CachedPlayer,
  ownership: PlayerOwnership,
  week: number,
  trigger: TrendTriggerType,
  detail: string,
  suggestedSwaps: SwapCandidate[] | undefined
): Promise<void> {
  if (await kv.alreadyFiredTrendAlert(player.playerId, week, trigger)) return;

  const alert: TrendAlert = {
    playerId: player.playerId,
    playerName: player.fullName,
    position: player.position ?? "?",
    nflTeam: player.team,
    week,
    triggerType: trigger,
    detail,
    ownership,
    firedAtEpochMillis: Date.now(),
    suggestedSwaps
  };
  await kv.recordTrendAlert(alert);
  acc.push(alert);
}

function buildOwnershipMap(
  rosters: SleeperRoster[],
  leagueUsers: SleeperLeagueUser[],
  myRosterId: number
): Map<string, PlayerOwnership> {
  const managerNameByUserId = new Map(leagueUsers.map((u) => [u.user_id, leagueUserTeamName(u)]));
  const ownership = new Map<string, PlayerOwnership>();

  for (const roster of rosters) {
    if (roster.roster_id === myRosterId) continue;
    const managerName = managerNameByUserId.get(roster.owner_id ?? "") ?? "Unknown manager";
    const starters = new Set(roster.starters ?? []);
    for (const playerId of roster.players ?? []) {
      if (!starters.has(playerId)) {
        ownership.set(playerId, { kind: "OPPONENT_BENCH", managerName });
      }
    }
  }
  return ownership;
}
