// src/worker/routes/debug.ts
import { Hono } from "hono";
import { KvStore } from "../lib/kv";
import { sleeper } from "../lib/sleeper";
import { getEspnProjections } from "../lib/espnProjections";
import type { Env } from "../index";

export const debugRoute = new Hono<{ Bindings: Env }>();

/**
 * TEMPORARY — verifies the real shape of ESPN's projections response.
 * Delete this route (and this whole file) before deploying to production.
 */
debugRoute.get("/espn-projections", async (c) => {
  const season = c.req.query("season") ?? "2026";
  const week = Number(c.req.query("week") ?? "1");

  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/1?view=kona_player_info`;

  const res = await fetch(url, {
    headers: {
      "X-Fantasy-Filter": JSON.stringify({
        players: {
          limit: 50,
          sortPercOwned: { sortPriority: 4, sortAsc: false }
        }
      })
    }
  });

  const rawText = await res.text();
  let rawJson: unknown = null;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    // leave rawJson null if it's not valid JSON
  }

  let parsed: unknown = null;
  let parseError: string | null = null;
  try {
    parsed = await getEspnProjections(season, week);
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  return c.json({
    requestedUrl: url,
    httpStatus: res.status,
    rawResponseSample: rawJson ? JSON.stringify(rawJson).slice(0, 3000) : rawText.slice(0, 1000),
    parsedResult: parsed,
    parseError
  });
});

/**
 * TEMPORARY — fetches ESPN's live team list and resolves each $ref to build
 * a confirmed proTeamId -> abbreviation map.
 */
debugRoute.get("/espn-teams", async (c) => {
  const season = c.req.query("season") ?? "2026";
  const listUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/teams?limit=32`;

  const listRes = await fetch(listUrl);
  if (!listRes.ok) {
    return c.json({ error: `List fetch failed: HTTP ${listRes.status}` }, 500);
  }
  const listData = (await listRes.json()) as { items: Array<{ $ref: string }> };

  const teams = await
