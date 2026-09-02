import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Env } from "../index";

const SESSION_COOKIE = "duck_user";

/** Normalizes a Sleeper username into the key used to scope this user's KV data. */
export function normalizeUserKey(username: string): string {
  return username.trim().toLowerCase();
}

export function setSessionUser(c: Context<{ Bindings: Env }>, username: string): void {
  setCookie(c, SESSION_COOKIE, normalizeUserKey(username), {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 365
  });
}

/** Returns the current session's userKey, or null if no session cookie is set. */
export function getSessionUserKey(c: Context<{ Bindings: Env }>): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null;
}
