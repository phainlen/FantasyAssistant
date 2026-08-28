import { Hono } from "hono";
import { setupRoute } from "./routes/setup";
import { settingsRoute } from "./routes/settings";
import { lineupRoute } from "./routes/lineup";
import { trendsRoute } from "./routes/trends";
import { pushRoute } from "./routes/push";
import { KvStore } from "./lib/kv";
import { planLineup } from "./cron/planLineup";
import { checkWaveReminders } from "./cron/checkWaveReminders";
import { checkTrends } from "./cron/checkTrends";

export interface Env {
  DUCK_KV: KVNamespace;
  ASSETS: Fetcher;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}

const app = new Hono<{ Bindings: Env }>();

app.route("/api/setup", setupRoute);
app.route("/api/settings", settingsRoute);
app.route("/api/lineup", lineupRoute);
app.route("/api/trends", trendsRoute);
app.route("/api/push", pushRoute);

// Anything that isn't an /api/* route falls through to the static frontend (public/).
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  /**
   * Cron schedule is defined in wrangler.toml. Dispatches on cron string rather than a
   * separate Worker per job, since Cloudflare's free tier caps Cron Triggers at 3 per Worker
   * and this app needs exactly 3.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const kv = new KvStore(env.DUCK_KV);
    const pushEnv = { VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY, VAPID_SUBJECT: env.VAPID_SUBJECT };

    switch (event.cron) {
      case "0 */6 * * *":
        ctx.waitUntil(planLineup(kv));
        break;
      case "*/15 * * * *":
        ctx.waitUntil(checkWaveReminders(kv, pushEnv));
        break;
      case "10 */6 * * *":
        ctx.waitUntil(checkTrends(kv, pushEnv));
        break;
      default:
        console.warn("Unrecognized cron trigger:", event.cron);
    }
  }
};
