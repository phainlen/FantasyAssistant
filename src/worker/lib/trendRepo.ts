import { sleeper, leagueUserTeamName, type SleeperLeagueUser, type SleeperRoster } from "./sleeper";
import { KvStore, type CachedPlayer, type TrendAlertSettings } from "./kv";
import { calculatePoints } from "../domain/scoring";
import { evaluateHotStreak, evaluateTargetShareSpike, evaluateSnapCountJump } from "../domain/trendDetectors";
import type { PlayerOwnership, TrendAlert, TrendTriggerType } from "../domain/trendModels";
import { getWeeklyTargetShare, getWeeklySnapPercentage } from "./nflverse";

const MONITORED_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
const PASS_CATCHER_POSITIONS = new Set(["RB", "WR", "TE"]);
const SNAP_TRACKED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const LOOKBACK_WEEKS = 5;

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
    if (ownershipByPlayer.has(playerId)) continue; // already covered as opponent bench
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
  if (monitoredIds.length === 0) return [];

  // Weekly fantasy points per player, from Sleeper's raw stats + this league's scoring.
  const weeklyPointsByPlayer = new Map<string, number[]>();
  for (const week of lookbackWeeks) {
    let rawStats: Record<string, Record<string, number>>;
    try {
      rawStats = await sleeper.getWeeklyStats(season, week);
    } catch {
      continue; // best-effort: one bad week shouldn't kill the whole pass
    }
    for (const playerId of monitoredIds) {
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
        `${hotStreak.streakGames} straight weeks scoring ${Math.min(...hotStreak.weeklyPoints).toFixed(1)}+ pts, trending up.`);
    }

    if (player.position && PASS_CATCHER_POSITIONS.has(player.position) && player.gsisId) {
      const series = lookbackWeeks.map((w) => targetShareByWeek.get(w)?.get(player.gsisId!)).filter(
        (v): v is number => v !== undefined
      );
      const spike = evaluateTargetShareSpike(series, settings.targetShareSpikeMultiplier, settings.targetShareMinJumpPct / 100);
      if (spike) {
        await maybeAdd(kv, newAlerts, player, ownership, currentWeek, "TARGET_SHARE_SPIKE",
          `Target share jumped to ${(spike.current * 100).toFixed(0)}% (was ${(spike.baselineAverage * 100).toFixed(0)}% avg).`);
      }
    }

    if (player.position && SNAP_TRACKED_POSITIONS.has(player.position) && player.gsisId) {
      const series = lookbackWeeks.map((w) => snapPctByWeek.get(w)?.get(player.gsisId!)).filter(
        (v): v is number => v !== undefined
      );
      const jump = evaluateSnapCountJump(series, settings.snapCountSpikeMultiplier, settings.snapCountMinJumpPct / 100);
      if (jump) {
        await maybeAdd(kv, newAlerts, player, ownership, currentWeek, "SNAP_COUNT_JUMP",
          `Snap share jumped to ${(jump.current * 100).toFixed(0)}% (was ${(jump.baselineAverage * 100).toFixed(0)}% avg).`);
      }
    }
  }

  return newAlerts;
}

async function maybeAdd(
  kv: KvStore,
  acc: TrendAlert[],
  player: CachedPlayer,
  ownership: PlayerOwnership,
  week: number,
  trigger: TrendTriggerType,
  detail: string
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
    firedAtEpochMillis: Date.now()
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
    if (roster.roster_id === myRosterId) continue; // never alert on your own roster
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
