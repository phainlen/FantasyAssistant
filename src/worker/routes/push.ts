import { Hono } from "hono";
import { KvStore } from "../lib/kv";
import type { Env } from "../index";

export const pushRoute = new Hono<{ Bindings: Env }>();

// pushRoute.get("/vapid-public-key", (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY }));

pushRoute.post("/subscribe", async (c) => {
  const body = await c.req.json<{
    endpoint: string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  }>();
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.json({ error: "Invalid push subscription" }, 400);
  }
  const kv = new KvStore(c.env.DUCK_KV);
  await kv.addPushSubscription(body);
  return c.json({ ok: true });
});

pushRoute.post("/unsubscribe", async (c) => {
  const body = await c.req.json<{ endpoint: string }>();
  const kv = new KvStore(c.env.DUCK_KV);
  await kv.removePushSubscription(body.endpoint);
  return c.json({ ok: true });
});
