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

  const teams = await Promise.all(
    listData.items.map(async (item) => {
      try {
        const res = await fetch(item.$ref);
        if (!res.ok) return { ref: item.$ref, error: `HTTP ${res.status}` };
        const team = (await res.json()) as {
          id: string;
          abbreviation: string;
          displayName: string;
        };
        return { id: team.id, abbreviation: team.abbreviation, displayName: team.displayName };
      } catch (err) {
        return { ref: item.$ref, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  teams.sort((a, b) => Number((a as any).id ?? 0) - Number((b as any).id ?? 0));

  return c.json({ season, teamCount: teams.length, teams });
});

/**
 * TEMPORARY — inspects the current player cache against a live roster, to
 * verify which cross-reference ID fields (espn_id, gsis_id) are populated.
 */
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

/**
 * TEMPORARY — verifies the real shape of DynastyProcess's free mirror of
 * FantasyPros draft/preseason ECR rankings.
 */
debugRoute.get("/dp-rankings", async (c) => {
  const url = "https://github.com/dynastyprocess/data/raw/master/files/db_fpecr_latest.csv";

  const res = await fetch(url);
  const rawText = await res.text();

  // Parse just enough to list distinct (fp_page, page_type, ecr_type) combos,
  // since this file bundles multiple ranking sets (redraft/dynasty/best-ball/etc.)
  const lines = rawText.split("\n").filter(Boolean);
  const header = lines[0].split(",");
  const fpPageIdx = header.indexOf("fp_page");
  const pageTypeIdx = header.indexOf("page_type");
  const ecrTypeIdx = header.indexOf("ecr_type");

  const combos = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    combos.add(`${cols[fpPageIdx]} | ${cols[pageTypeIdx]} | ${cols[ecrTypeIdx]}`);
  }

  return c.json({
    requestedUrl: url,
    httpStatus: res.status,
    totalRows: lines.length - 1,
    distinctCombos: Array.from(combos).sort()
  });
});
