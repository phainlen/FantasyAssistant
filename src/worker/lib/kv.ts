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
  targetShareMinJumpPct: number; // percentage points, e.g. 8 == 8%
  snapCountSpikeMultiplier: number;
  snapCountMinJumpPct: number;
  lineupReminderHoursBeforeLock: number;
}

export const DEFAULT_TREND_SETTINGS: TrendAlertSettings = {
  hotStreakMinGames: 3,
  hotStreakMinPoints: 8,
  targetShareSpikeMultiplier: 1.4,
  targetShareMinJumpPct: 8,
  snapCountSpikeMultiplier: 1.3,
  snapCountMinJumpPct: 15,
  lineupReminderHoursBeforeLock: 3
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

const KEYS = {
  leagueConfig: "league_config",
  trendSettings: "trend_settings",
  playersCache: "players_cache",
  playersCacheUpdatedAt: "players_cache_updated_at",
  lineupForWeek: (week: number) => `lineup_week_${week}`,
  wavesForWeek: (week: number) => `waves_week_${week}`,
  trendAlertFired: (playerId: string, week: number, trigger: string) =>
    `trend_alert_${playerId}_${week}_${trigger}`,
  recentTrendAlerts: "trend_alerts_recent",
  pushSubscriptions: "push_subscriptions"
} as const;

export class KvStore {
  constructor(private kv: KVNamespace) {}

  async getLeagueConfig(): Promise<LeagueConfig | null> {
    return this.kv.get<LeagueConfig>(KEYS.leagueConfig, "json");
  }

  async saveLeagueConfig(config: LeagueConfig): Promise<void> {
    await this.kv.put(KEYS.leagueConfig, JSON.stringify(config));
  }

  async getTrendSettings(): Promise<TrendAlertSettings> {
    const stored = await this.kv.get<TrendAlertSettings>(KEYS.trendSettings, "json");
    return stored ?? DEFAULT_TREND_SETTINGS;
  }

  async saveTrendSettings(settings: TrendAlertSettings): Promise<void> {
    await this.kv.put(KEYS.trendSettings, JSON.stringify(settings));
  }

  /** ~5MB payload, same as the Android player directory cache — refresh at most daily. */
  async getPlayersCache(): Promise<Record<string, CachedPlayer> | null> {
    return this.kv.get<Record<string, CachedPlayer>>(KEYS.playersCache, "json");
  }

  async savePlayersCache(players: Record<string, CachedPlayer>): Promise<void> {
    await this.kv.put(KEYS.playersCache, JSON.stringify(players));
    await this.kv.put(KEYS.playersCacheUpdatedAt, String(Date.now()));
  }

  async playersCacheAgeMillis(): Promise<number | null> {
    const updatedAt = await this.kv.get(KEYS.playersCacheUpdatedAt);
    if (!updatedAt) return null;
    return Date.now() - Number(updatedAt);
  }

  async getLineupForWeek(week: number): Promise<LineupSlotRecommendation[] | null> {
    return this.kv.get<LineupSlotRecommendation[]>(KEYS.lineupForWeek(week), "json");
  }

  async saveLineupForWeek(week: number, lineup: LineupSlotRecommendation[]): Promise<void> {
    await this.kv.put(KEYS.lineupForWeek(week), JSON.stringify(lineup));
  }

  async getWavesForWeek(week: number): Promise<StoredWave[]> {
    return (await this.kv.get<StoredWave[]>(KEYS.wavesForWeek(week), "json")) ?? [];
  }

  async saveWavesForWeek(week: number, waves: StoredWave[]): Promise<void> {
    await this.kv.put(KEYS.wavesForWeek(week), JSON.stringify(waves));
  }

  async markWaveReminderSent(week: number, waveIndex: number): Promise<void> {
    const waves = await this.getWavesForWeek(week);
    if (waves[waveIndex]) {
      waves[waveIndex].reminderSent = true;
      await this.saveWavesForWeek(week, waves);
    }
  }

  async alreadyFiredTrendAlert(playerId: string, week: number, trigger: string): Promise<boolean> {
    const val = await this.kv.get(KEYS.trendAlertFired(playerId, week, trigger));
    return val !== null;
  }

  async recordTrendAlert(alert: TrendAlert): Promise<void> {
    await this.kv.put(
      KEYS.trendAlertFired(alert.playerId, alert.week, alert.triggerType),
      "1",
      { expirationTtl: 60 * 60 * 24 * 30 } // auto-expire dedup markers after a month
    );

    const recent = await this.getRecentTrendAlerts();
    recent.unshift(alert);
    await this.kv.put(KEYS.recentTrendAlerts, JSON.stringify(recent.slice(0, 50)));
  }

  async getRecentTrendAlerts(): Promise<TrendAlert[]> {
    return (await this.kv.get<TrendAlert[]>(KEYS.recentTrendAlerts, "json")) ?? [];
  }

  async getPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
    return (await this.kv.get<PushSubscriptionRecord[]>(KEYS.pushSubscriptions, "json")) ?? [];
  }

  async addPushSubscription(sub: Omit<PushSubscriptionRecord, "addedAtEpochMillis">): Promise<void> {
    const existing = await this.getPushSubscriptions();
    if (existing.some((s) => s.endpoint === sub.endpoint)) return;
    existing.push({ ...sub, addedAtEpochMillis: Date.now() });
    await this.kv.put(KEYS.pushSubscriptions, JSON.stringify(existing));
  }

  async removePushSubscription(endpoint: string): Promise<void> {
    const existing = await this.getPushSubscriptions();
    await this.kv.put(
      KEYS.pushSubscriptions,
      JSON.stringify(existing.filter((s) => s.endpoint !== endpoint))
    );
  }
}
