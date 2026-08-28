import { buildPushPayload, type PushMessage, type PushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";
import type { PushSubscriptionRecord } from "./kv";

/**
 * IMPORTANT — verify before relying on this: buildPushPayload's return shape (assumed here to
 * be fetch-ready RequestInit-like options passed straight to `fetch(endpoint, payload)`) is
 * based on the library's documented usage pattern, not a live test run — this sandbox has no
 * network access to actually install and exercise the package. If the shape differs, check
 * https://github.com/block65/webcrypto-web-push's README/examples and adjust just this file;
 * nothing downstream (the cron jobs) depends on the internals, only on sendPush's return value.
 */
export interface PushEnv {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string; // e.g. "mailto:you@example.com"
}

/**
 * Sends one push notification. Returns "expired" if the push service says the subscription is
 * dead (404/410) — callers should remove that subscription from storage in that case.
 */
export async function sendPush(
  env: PushEnv,
  record: PushSubscriptionRecord,
  title: string,
  body: string
): Promise<"sent" | "expired" | "failed"> {
  const vapid: VapidKeys = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };

  const subscription: PushSubscription = {
    endpoint: record.endpoint,
    expirationTime: record.expirationTime,
    keys: record.keys
  };

  const message: PushMessage = {
    data: JSON.stringify({ title, body })
  };

  try {
    const payload = await buildPushPayload(message, subscription, vapid);
    const res = await fetch(subscription.endpoint, payload);
    if (res.status === 404 || res.status === 410) return "expired";
    return res.ok ? "sent" : "failed";
  } catch (err) {
    console.error("Push send failed", err);
    return "failed";
  }
}
