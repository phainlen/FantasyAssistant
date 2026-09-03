import { Hono } from "hono";
import { KvStore } from "../lib/kv";
import { getSessionUserKey } from "../lib/session";
import type { Env } from "../index";

export const pushRoute = new Hono<{ Bindings: Env }>();

pushRoute.post("/subscribe", async (c) => {
  const userKey = getSessionUserKey(c);
  if (!userKey) return c.json({ error: "Not set up yet" }, 401);
  const body = await c.req.json<{
    endpoint: string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  }>();
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.json({ error: "Invalid push subscription" }, 400);
  }
  const kv = new KvStore(c.env.DUCK_KV, userKey);
  await kv.addPushSubscription(body);
  return c.json({ ok: true });
});

pushRoute.post("/unsubscribe", async (c) => {
  const userKey = getSessionUserKey(c);
  if (!userKey) return c.json({ error: "Not set up yet" }, 401);
  const body = await c.req.json<{ endpoint: string }>();
  const kv = new KvStore(c.env.DUCK_KV, userKey);
  await kv.removePushSubscription(body.endpoint);
  return c.json({ ok: true });
});
