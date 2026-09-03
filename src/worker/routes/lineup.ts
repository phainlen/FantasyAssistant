import { Hono } from "hono";
import { KvStore } from "../lib/kv";
import { sleeper, resolveFantasyWeek } from "../lib/sleeper";
import { planLineup } from "../cron/planLineup";
import { getSessionUserKey } from "../lib/session";
import type { Env } from "../index";

export const lineupRoute = new Hono<{ Bindings: Env }>();

lineupRoute.get("/", async (c) => {
  const userKey = getSessionUserKey(c);
  if (!userKey) return c.json({ error: "Not set up yet" }, 401);
  const kv = new KvStore(c.env.DUCK_KV, userKey);
  const nflState = await sleeper.getNflState();
  const week = resolveFantasyWeek(nflState);
  const lineup = await kv.getLineupForWeek(week);
  return c.json({ week, lineup: lineup ?? [] });
});

lineupRoute.post("/refresh", async (c) => {
  const userKey = getSessionUserKey(c);
  if (!userKey) return c.json({ error: "Not set up yet" }, 401);
  const kv = new KvStore(c.env.DUCK_KV, userKey);
  await planLineup(kv);
  const nflState = await sleeper.getNflState();
  const week = resolveFantasyWeek(nflState);
  const lineup = await kv.getLineupForWeek(week);
  return c.json({ week, lineup: lineup ?? [] });
});
