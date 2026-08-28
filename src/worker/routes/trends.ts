import { Hono } from "hono";
import { KvStore } from "../lib/kv";
import type { Env } from "../index";

export const trendsRoute = new Hono<{ Bindings: Env }>();

trendsRoute.get("/", async (c) => {
  const kv = new KvStore(c.env.DUCK_KV);
  return c.json({ alerts: await kv.getRecentTrendAlerts() });
});
