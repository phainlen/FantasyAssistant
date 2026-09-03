import { Hono } from "hono";
import { KvStore, DEFAULT_TREND_SETTINGS, type TrendAlertSettings } from "../lib/kv";
import { planLineup } from "../cron/planLineup";
import { getSessionUserKey } from "../lib/session";
import type { Env } from "../index";

export const settingsRoute = new Hono<{ Bindings: Env }>();

settingsRoute.get("/", async (c) => {
  const userKey = getSessionUserKey(c);
  if (!userKey) return c.json({ error: "Not set up yet" }, 401);
  const kv = new KvStore(c.env.DUCK_KV, userKey);
  return c.json(await kv.getTrendSettings());
});

settingsRoute.post("/", async (c) => {
  const userKey = getSessionUserKey(c);
  if (!userKey) return c.json({ error: "Not set up yet" }, 401);
  const body = await c.req.json<Partial<TrendAlertSettings>>();
  const kv = new KvStore(c.env.DUCK_KV, userKey);
  const merged: TrendAlertSettings = { ...DEFAULT_TREND_SETTINGS, ...(await kv.getTrendSettings()), ...body };
  await kv.saveTrendSettings(merged);
  c.executionCtx.waitUntil(planLineup(kv).catch((err) => console.error("Replan after settings change failed", err)));
  return c.json(merged);
});
