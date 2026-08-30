import { Hono } from "hono";
import { getEspnProjections } from "../lib/espnProjections";
import type { Env } from "../index";

export const debugRoute = new Hono<{ Bindings: Env }>();

/**
 * TEMPORARY — fetches ESPN's live team list and resolves each $ref to build
 * a confirmed proTeamId -> abbreviation map. Delete this route once the
 * mapping is confirmed correct and hardcoded elsewhere.
 */
// in debug.ts
import { KvStore } from "../lib/kv";

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
