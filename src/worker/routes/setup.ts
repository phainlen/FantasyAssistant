import { Hono } from "hono";
import { KvStore, registerUserKey } from "../lib/kv";
import { sleeper } from "../lib/sleeper";
import { planLineup } from "../cron/planLineup";
import { getSessionUserKey, normalizeUserKey, setSessionUser } from "../lib/session";
import type { Env } from "../index";

export const setupRoute = new Hono<{ Bindings: Env }>();

setupRoute.get("/", async (c) => {
  const userKey = getSessionUserKey(c);
  if (!userKey) return c.json({ config: null });
  const kv = new KvStore(c.env.DUCK_KV, userKey);
  const config = await kv.getLeagueConfig();
  return c.json({ config });
});

setupRoute.post("/", async (c) => {
  const body = await c.req.json<{ username: string; leagueName: string }>();
  if (!body.username || !body.leagueName) {
    return c.json({ error: "username and leagueName are required" }, 400);
  }

  const userKey = normalizeUserKey(body.username);
  const kv = new KvStore(c.env.DUCK_KV, userKey);

  try {
    const nflState = await sleeper.getNflState();
    const user = await sleeper.getUser(body.username);
    const leagues = await sleeper.getLeaguesForUser(user.user_id, nflState.season);
    const league = leagues.find((l) => l.name.trim().toLowerCase() === body.leagueName.trim().toLowerCase());
    if (!league) {
      return c.json({ error: `No league named "${body.leagueName}" found for ${body.username}` }, 404);
    }
    const rosters = await sleeper.getRosters(league.league_id);
    const myRoster = rosters.find((r) => r.owner_id === user.user_id);
    if (!myRoster) {
      return c.json({ error: `Couldn't find your roster in "${league.name}"` }, 404);
    }

    const config = {
      sleeperUsername: body.username,
      sleeperUserId: user.user_id,
      leagueId: league.league_id,
      leagueName: league.name,
      rosterId: myRoster.roster_id
    };
    await kv.saveLeagueConfig(config);
    await registerUserKey(c.env.DUCK_KV, userKey);
    setSessionUser(c, body.username);

    c.executionCtx.waitUntil(planLineup(kv).catch((err) => console.error("Initial plan failed", err)));
    return c.json({ config });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Setup failed" }, 500);
  }
});
