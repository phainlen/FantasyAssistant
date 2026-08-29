import { Hono } from "hono";
import { KvStore } from "../lib/kv";
import { sleeper } from "../lib/sleeper";
import { planLineup } from "../cron/planLineup";
import type { Env } from "../index";

export const lineupRoute = new Hono<{ Bindings: Env }>();

function resolveFantasyWeek(nflState: { week: number; season_type: string }): number {
  // Sleeper's `week` field tracks preseason weeks too during "pre" season_type.
  // Fantasy lineups don't apply until the regular season starts.
  return nflState.season_type === "regular" ? nflState.week : 1;
}

lineupRoute.get("/", async (c) => {
  const kv = new KvStore(c.env.DUCK_KV);
  const nflState = await sleeper.getNflState();
  const week = resolveFantasyWeek(nflState);
  const lineup = await kv.getLineupForWeek(week);
  return c.json({ week, lineup: lineup ?? [] });
});

lineupRoute.post("/refresh", async (c) => {
  const kv = new KvStore(c.env.DUCK_KV);
  await planLineup(kv);
  const nflState = await sleeper.getNflState();
  const week = resolveFantasyWeek(nflState);
  const lineup = await kv.getLineupForWeek(week);
  return c.json({ week, lineup: lineup ?? [] });
});
