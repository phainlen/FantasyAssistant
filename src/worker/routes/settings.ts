import { Hono } from "hono";
import { KvStore, DEFAULT_TREND_SETTINGS, type TrendAlertSettings } from "../lib/kv";
import { planLineup } from "../cron/planLineup";
import type { Env } from "../index";

export const settingsRoute = new Hono<{ Bindings: Env }>();

settingsRoute.get("/", async (c) => {
  const kv = new KvStore(c.env.DUCK_KV);
  return c.json(await kv.getTrendSettings());
});

settingsRoute.post("/", async (c) => {
  const body = await c.req.json<Partial<TrendAlertSettings>>();
  const kv = new KvStore(c.env.DUCK_KV);
  const merged: TrendAlertSettings = { ...DEFAULT_TREND_SETTINGS, ...(await kv.getTrendSettings()), ...body };
  await kv.saveTrendSettings(merged);

  // Reschedule so a changed lock-reminder lead time takes effect on the next check rather
  // than waiting for the next periodic replan.
  c.executionCtx.waitUntil(planLineup(kv).catch((err) => console.error("Replan after settings change failed", err)));

  return c.json(merged);
});
