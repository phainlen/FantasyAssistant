import { Hono } from "hono";
import { getEspnProjections } from "../lib/espnProjections";
import type { Env } from "../index";

export const debugRoute = new Hono<{ Bindings: Env }>();

/**
 * TEMPORARY — fetches ESPN's live team list and resolves each $ref to build
 * a confirmed proTeamId -> abbreviation map. Delete this route once the
 * mapping is confirmed correct and hardcoded elsewhere.
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

  // Sort numerically by id for easy comparison against the community-sourced table
  teams.sort((a, b) => Number((a as any).id ?? 0) - Number((b as any).id ?? 0));

  return c.json({ season, teamCount: teams.length, teams });
});
