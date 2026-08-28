import { Hono } from "hono";
import { KvStore } from "../lib/kv";
import { sleeper } from "../lib/sleeper";
import { planLineup } from "../cron/planLineup";
import type { Env } from "../index";

export const lineupRoute = new Hono<{ Bindings: Env }>();

lineupRoute.get("/", async (c) => {
  const kv = new KvStore(c.env.DUCK_KV);
  const nflState = await sleeper.getNflState();
  const lineup = await kv.getLineupForWeek(nflState.week);
  return c.json({ week: nflState.week, lineup: lineup ?? [] });
});

lineupRoute.post("/refresh", async (c) => {
  const kv = new KvStore(c.env.DUCK_KV);
  await planLineup(kv);
  const nflState = await sleeper.getNflState();
  const lineup = await kv.getLineupForWeek(nflState.week);
  return c.json({ week: nflState.week, lineup: lineup ?? [] });
});
