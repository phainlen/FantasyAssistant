import { Hono } from "hono";
import { getEspnProjections } from "../lib/espnProjections";
import type { Env } from "../index";

export const debugRoute = new Hono<{ Bindings: Env }>();

debugRoute.get("/espn-teams", async (c) => {
  const season = c.req.query("season") ?? "2026";
  const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/teams?limit=32`;

  const res = await fetch(url);
  const rawText = await res.text();

  let rawJson: unknown = null;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    // leave null if not valid JSON
  }

  return c.json({
    requestedUrl: url,
    httpStatus: res.status,
    rawResponseSample: rawJson ? JSON.stringify(rawJson).slice(0, 3000) : rawText.slice(0, 1000)
  });
});
