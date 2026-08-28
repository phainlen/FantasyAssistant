# Duck Assistant (Web)

The Cloudflare-hosted counterpart to the Android app — same two features (weekly optimal
lineup + free-agent/bench trend alerts), delivered as push notifications in the browser
instead of Android notifications. Single Worker, no separate frontend build step.

## Architecture

- **One Cloudflare Worker** (`src/worker/index.ts`, via [Hono](https://hono.dev)) serves both
  the JSON API (`/api/*`) and the static frontend (`public/` — plain HTML/CSS/JS, no bundler).
- **KV** (`DUCK_KV`) holds everything: league config, cached players, weekly lineups, trend
  alert dedup, push subscriptions, and tunable thresholds — flattened version of the Android
  app's Room+DataStore split.
- **3 Cron Triggers** (the free-tier cap per Worker, and exactly what this needs):
  - `0 */6 * * *` — replan the lineup + recompute this week's kickoff waves
  - `*/15 * * * *` — poll: is any kickoff wave's reminder due yet?
  - `10 */6 * * *` — check for new trend alerts
- **Push** via [`@block65/webcrypto-web-push`](https://github.com/block65/webcrypto-web-push) —
  Node's `web-push` package doesn't run on Workers (it needs `https.request`/Node crypto);
  this one uses WebCrypto instead and has an official Workers example.

## Why polling instead of scheduling exact reminder times

The Android version scheduled one exact WorkManager job per kickoff wave. Cloudflare Cron
Triggers don't support arbitrary one-off delays — only fixed recurring schedules — so
`checkWaveReminders` instead polls every 15 minutes and fires when "now" has crossed the
reminder threshold for any wave that hasn't been notified yet. Practical effect: a reminder
can arrive up to ~15 minutes later than the exact configured lead time. That's the deliberate
trade for staying on the free tier.

## Setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Log in to Cloudflare**
   ```
   npx wrangler login
   ```

3. **Create the KV namespace**
   ```
   npx wrangler kv namespace create DUCK_KV
   ```
   Copy the `id` it prints into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.
   For local dev with `wrangler dev`, also run `npx wrangler kv namespace create DUCK_KV --preview`
   and add the resulting id as `preview_id` under the same `[[kv_namespaces]]` block.

4. **Generate VAPID keys** (used to authenticate this server to push services)
   ```
   npx web-push generate-vapid-keys
   ```
   This is the standard `web-push` package's key-generation CLI — only used here to generate
   the key pair, not to send anything. The output format (base64url public/private strings)
   is what `@block65/webcrypto-web-push` expects; this wasn't verified against a live deploy,
   so if the push library rejects the keys, check its README for the exact format it wants.

5. **Set secrets**
   ```
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_SUBJECT
   ```
   `VAPID_SUBJECT` should be `mailto:you@example.com` — push services use it to contact you if
   your server is misbehaving.

6. **Deploy**
   ```
   npx wrangler deploy
   ```
   Wrangler prints the `*.workers.dev` URL. Open it, fill in your Sleeper username and league
   name on the setup screen, then tap **Enable notifications** on the Lineup tab.

## Verify before relying on this

This sandbox has no network access, so nothing here has been through `npm install`,
`tsc --noEmit`, or `wrangler dev` — there could be small type errors or import issues that
only surface on your first real build. Run `npm install && npm run typecheck` before your
first `wrangler dev`/`deploy` and fix anything that comes up; the architecture and logic have
been thought through carefully, but "never executed" is a real gap, not a formality.

Two integration points specifically weren't confirmed against live services:

Same caveat as the Android build's `NflverseRepository`, carried over unchanged in
`src/worker/lib/nflverse.ts`: the nflverse release tags and CSV column names were not
confirmed against a live fetch. Hit both endpoints once early in the season and check the
CSV header row against the column-name constants at the top of that file.

Also worth knowing: GitHub's REST API allows 60 unauthenticated requests/hour per IP, and
this Worker calls it up to twice per trend check (once per nflverse release tag). At the
current cron cadence (every ~6 hours) this is nowhere near the limit, but if you tighten the
trend-check schedule a lot, that's the wall you'd hit first.

`@block65/webcrypto-web-push`'s exact return shape from `buildPushPayload` (see the doc
comment in `src/worker/lib/push.ts`) is based on its documented usage pattern, not a live
test — same "verify against the real thing" caveat as nflverse above.

## Tuning

Alert thresholds are editable in-app under the **Settings** tab — no redeploy needed. They're
stored in KV via `TrendAlertSettings` and read fresh by every cron run.

## What's different from the Android app, on purpose

- No in-app history beyond the most recent 50 trend alerts (KV-friendly cap; raise
  `getRecentTrendAlerts`'s slice size in `kv.ts` if you want more).
- A single shared set of push subscriptions, not per-user accounts — this was built for one
  person's league, not a multi-tenant product. Multiple browsers/devices can each subscribe
  (e.g. phone + laptop) and all will get notified.
