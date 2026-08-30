import { Hono } from "hono";
import { KvStore } from "../lib/kv";
import { sleeper } from "../lib/sleeper";
import { getEspnProjections } from "../lib/espnProjections";
import type { Env } from "../index";

export const debugRoute = new Hono<{ Bindings: Env }>();

// ...existing /espn-projections and /espn-teams routes unchanged...

debugRoute.get("/player-cache", async (c) => {
  const kv = new KvStore(c.env.DUCK_KV);
  const config = await kv.getLeagueConfig();
  if (!config) return c.json({ error: "not set up" }, 400);

  const rosters = await sleeper.getRosters(config.leagueId);
  const myRoster = rosters.find((r) => r.roster_id === config.rosterId);
  const playersCache = (await kv.getPlayersCache()) ?? {};

  const roster = (myRoster?.players ?? []).map((id) => ({
    sleeperId: id,
    cached: playersCache[id] ?? null
  }));

  return c.json({ roster });
});
