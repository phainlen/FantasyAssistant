import { KvStore } from "../lib/kv";
import { sleeper } from "../lib/sleeper";
import { refreshPlayerCacheIfStale } from "../lib/sleeperRepo";
import { findNewTrendAlerts } from "../lib/trendRepo";
import { sendPush, type PushEnv } from "../lib/push";
import { describeOwnership, type TrendAlert } from "../domain/trendModels";

const TRIGGER_LABELS: Record<TrendAlert["triggerType"], string> = {
  HOT_STREAK: "Hot streak",
  TARGET_SHARE_SPIKE: "Target share spike",
  SNAP_COUNT_JUMP: "Snap count jump"
};

export async function checkTrends(kv: KvStore, env: PushEnv): Promise<void> {
  const config = await kv.getLeagueConfig();
  if (!config) return;

  await refreshPlayerCacheIfStale(kv);

  const nflState = await sleeper.getNflState();
  const league = await sleeper.getLeague(config.leagueId);
  const settings = await kv.getTrendSettings();

  const newAlerts = await findNewTrendAlerts(
    kv,
    config.leagueId,
    nflState.season,
    nflState.week,
    config.rosterId,
    league.scoring_settings,
    settings
  );

  if (newAlerts.length === 0) return;

  const subscriptions = await kv.getPushSubscriptions();
  for (const alert of newAlerts) {
    const title = `${TRIGGER_LABELS[alert.triggerType]}: ${alert.playerName} (${alert.position}${alert.nflTeam ? ` - ${alert.nflTeam}` : ""})`;
    const body = `${alert.detail} ${describeOwnership(alert.ownership)}.`;

    for (const sub of subscriptions) {
      const result = await sendPush(env, sub, title, body);
      if (result === "expired") await kv.removePushSubscription(sub.endpoint);
    }
  }
}
