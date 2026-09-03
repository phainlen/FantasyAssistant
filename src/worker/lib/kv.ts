import type { LineupSlotRecommendation } from "../domain/lineupOptimizer";
import type { TrendAlert } from "../domain/trendModels";
import type { KickoffWave } from "../domain/kickoffWaveCalculator";

export interface LeagueConfig {
  sleeperUsername: string;
  sleeperUserId: string;
  leagueId: string;
  leagueName: string;
  rosterId: number;
}

export interface TrendAlertSettings {
  hotStreakMinGames: number;
  hotStreakMinPoints: number;
  targetShareSpikeMultiplier: number;
  targetShareMinJumpPct: number;
  snapCountSpikeMultiplier: number;
  snapCountMinJumpPct: number;
  lineupReminderHoursBeforeLock: number;
  swapAlertMinPointsEdge: number;
}

export const DEFAULT_TREND_SETTINGS: TrendAlertSettings = {
  hotStreakMinGames: 3,
  hotStreakMinPoints: 8,
  targetShareSpikeMultiplier: 1.4,
  targetShareMinJumpPct: 8,
  snapCountSpikeMultiplier: 1.3,
  snapCountMinJumpPct: 15,
  lineupReminderHoursBeforeLock: 3,
  swapAlertMinPointsEdge: 3
};

export interface CachedPlayer {
  playerId: string;
  fullName: string;
  position: string | null;
  team: string | null;
  status: string | null;
  injuryStatus: string | null;
  gsisId: string | null;
  espnId: string | null;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
  addedAtEpochMillis: number;
}

export interface StoredWave extends KickoffWave {
  week: number;
  reminderSent: boolean;
}

const GLOBAL_KEYS = {
  playersCache: "players_cache",
  playersCacheUpdatedAt: "players_cache_updated_at",
  registeredUsers: "registered_users"
} as const;

/**
 * Registry of every userKey (normalized Sleeper username) that has completed setup.
 * Not scoped to any single user — the scheduled cron handler reads this to know
 * which users to run planLineup/checkTrends/checkWaveReminders for.
 */
export async function getRegisteredUserKeys(kv: KVNamespace): Promise<string[]> {
  return (await kv.get<string[]>(GLOBAL_KEYS.registeredUsers, "json")) ?? [];
}

export async function registerUserKey(kv: KVNamespace, userKey: string): Promise<void> {
  const existing = await getRegisteredUserKeys(kv);
  if (existing.includes(userKey)) return;
  existing.push(userKey);
  await kv.put(GLOBAL_KEYS.registeredUsers, JSON.stringify(existing));
}

export class KvStore {
  /**
   * userKey scopes every per-user method below (league config, settings, lineup,
   * waves, trend alerts, push subscriptions) under this user's own KV keys. The
   * player directory cache is shared across all users and stays unprefixed.
   */
  constructor(private kv: KVNamespace, private userKey: string) {}

  private key(name: string): string {
    return `user:${this.userKey}:${name}`;
  }

  async getLeagueConfig(): Promise<LeagueConfig | null> {
    return this.kv.get<LeagueConfig>(this.key("league_config"), "json");
  }

  async saveLeagueConfig(config: LeagueConfig): Promise<void> {
    await this.kv.put(this.key("league_config"), JSON.stringify(config));
  }

  async getTrendSettings(): Promise<TrendAlertSettings> {
    const stored = await this.kv.get<TrendAlertSettings>(this.key("trend_settings"), "json");
    return stored ?? DEFAULT_TREND_SETTINGS;
  }

  async saveTrendSettings(settings: TrendAlertSettings): Promise<void> {
    await this.kv.put(this.key("trend_settings"), JSON.stringify(settings));
  }

  /** Shared across all users — Sleeper's master player directory, not user-specific. */
  async getPlayersCache(): Promise<Record<string, CachedPlayer> | null> {
    return this.kv.get<Record<string, CachedPlayer>>(GLOBAL_KEYS.playersCache, "json");
  }

  async savePlayersCache(players: Record<string, CachedPlayer>): Promise<void> {
    await this.kv.put(GLOBAL_KEYS.playersCache, JSON.stringify(players));
    await this.kv.put(GLOBAL_KEYS.playersCacheUpdatedAt, String(Date.now()));
  }

  async playersCacheAgeMillis(): Promise<number | null> {
    const updatedAt = await this.kv.get(GLOBAL_KEYS.playersCacheUpdatedAt);
    if (!updatedAt) return null;
    return Date.now() - Number(updatedAt);
  }

  async getLineupForWeek(week: number): Promise<LineupSlotRecommendation[] | null> {
    return this.kv.get<LineupSlotRecommendation[]>(this.key(`lineup_week_${week}`), "json");
  }

  async saveLineupForWeek(week: number, lineup: LineupSlotRecommendation[]): Promise<void> {
    await this.kv.put(this.key(`lineup_week_${week}`), JSON.stringify(lineup));
  }

  async getWavesForWeek(week: number): Promise<StoredWave[]> {
    return (await this.kv.get<StoredWave[]>(this.key(`waves_week_${week}`), "json")) ?? [];
  }

  async saveWavesForWeek(week: number, waves: StoredWave[]): Promise<void> {
    await this.kv.put(this.key(`waves_week_${week}`), JSON.stringify(waves));
  }

  async markWaveReminderSent(week: number, waveIndex: number): Promise<void> {
    const waves = await this.getWavesForWeek(week);
    if (waves[waveIndex]) {
      waves[waveIndex].reminderSent = true;
      await this.saveWavesForWeek(week, waves);
    }
  }

  async alreadyFiredTrendAlert(playerId: string, week: number, trigger: string): Promise<boolean> {
    const val = await this.kv.get(this.key(`trend_alert_${playerId}_${week}_${trigger}`));
    return val !== null;
  }

  async recordTrendAlert(alert: TrendAlert): Promise<void> {
    await this.kv.put(
      this.key(`trend_alert_${alert.playerId}_${alert.week}_${alert.triggerType}`),
      "1",
      { expirationTtl: 60 * 60 * 24 * 30 }
    );
    const recent = await this.getRecentTrendAlerts();
    recent.unshift(alert);
    await this.kv.put(this.key("trend_alerts_recent"), JSON.stringify(recent.slice(0, 50)));
  }

  async getRecentTrendAlerts(): Promise<TrendAlert[]> {
    return (await this.kv.get<TrendAlert[]>(this.key("trend_alerts_recent"), "json")) ?? [];
  }

  async getPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
    return (await this.kv.get<PushSubscriptionRecord[]>(this.key("push_subscriptions"), "json")) ?? [];
  }

  async addPushSubscription(sub: Omit<PushSubscriptionRecord, "addedAtEpochMillis">): Promise<void> {
    const existing = await this.getPushSubscriptions();
    if (existing.some((s) => s.endpoint === sub.endpoint)) return;
    existing.push({ ...sub, addedAtEpochMillis: Date.now() });
    await this.kv.put(this.key("push_subscriptions"), JSON.stringify(existing));
  }

  async removePushSubscription(endpoint: string): Promise<void> {
    const existing = await this.getPushSubscriptions();
    await this.kv.put(
      this.key("push_subscriptions"),
      JSON.stringify(existing.filter((s) => s.endpoint !== endpoint))
    );
  }
}
