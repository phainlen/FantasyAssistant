import { KvStore } from "../lib/kv";
import { reminderTimeMillis } from "../domain/kickoffWaveCalculator";
import { sendPush, type PushEnv } from "../lib/push";
import { sleeper } from "../lib/sleeper";

/**
 * Runs every 15 minutes. Vercel-style "schedule one job per wave" isn't available on
 * Cloudflare Cron Triggers (no arbitrary one-off delays), so instead this polls: for each
 * wave that hasn't been notified yet, check whether now has crossed the reminder threshold
 * (kickoff minus the configured lead time). A 15-minute poll interval means the reminder can
 * fire up to ~15 minutes later than the exact configured time — an acceptable trade for a
 * free-tier, poll-based design.
 */
export async function checkWaveReminders(kv: KvStore, env: PushEnv): Promise<void> {
  const config = await kv.getLeagueConfig();
  if (!config) return;

  const nflState = await sleeper.getNflState();
  const week = nflState.week;
  const settings = await kv.getTrendSettings();

  const waves = await kv.getWavesForWeek(week);
  if (waves.length === 0) return;

  const lineup = await kv.getLineupForWeek(week);
  if (!lineup) return;

  const now = Date.now();
  const subscriptions = await kv.getPushSubscriptions();
  if (subscriptions.length === 0) return;

  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i];
    if (wave.reminderSent) continue;

    const reminderAt = reminderTimeMillis(wave, settings.lineupReminderHoursBeforeLock);
    if (now < reminderAt) continue; // not due yet

    const lockingSlots = lineup.filter((slot) => slot.player && wave.playerIdsLocking.includes(slot.player.playerId));
    if (lockingSlots.length === 0) {
      await kv.markWaveReminderSent(week, i);
      continue;
    }

    const title =
      lockingSlots.length === 1
        ? `Lineup lock soon: ${lockingSlots[0].player!.name}`
        : `Lineup lock soon (${lockingSlots.length} starters)`;
    const body = lockingSlots.map((s) => `${s.slotLabel}: ${s.player!.name} — ${s.reasoning}`).join("\n");

    for (const sub of subscriptions) {
      const result = await sendPush(env, sub, title, body);
      if (result === "expired") await kv.removePushSubscription(sub.endpoint);
    }

    await kv.markWaveReminderSent(week, i);
  }
}
