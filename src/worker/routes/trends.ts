import { Hono } from "hono";
import { KvStore } from "../lib/kv";
import { getSessionUserKey } from "../lib/session";
import type { Env } from "../index";

export const trendsRoute = new Hono<{ Bindings: Env }>();

trendsRoute.get("/", async (c) => {
  const userKey = getSessionUserKey(c);
  if (!userKey) return c.json({ error: "Not set up yet" }, 401);
  const kv = new KvStore(c.env.DUCK_KV, userKey);
  return c.json({ alerts: await kv.getRecentTrendAlerts() });
});
