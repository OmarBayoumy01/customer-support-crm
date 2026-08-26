import type { CookieOptions } from 'express';

/**
 * The refresh cookie, in one place.
 *
 * US-15 refreshes with it and US-16 clears it, and if those three set the flags
 * separately they will eventually disagree — a cookie cleared with a different
 * `path` than it was set with is simply not cleared, and the bug looks like
 * "sign out sometimes doesn't work".
 */
export const REFRESH_COOKIE = 'crm_refresh_token';

/**
 * Scoped to `/auth` so the browser does not attach a long-lived credential to
 * every API call it makes. Only refresh and logout live under that path, and
 * they are the only two things that need it.
 */
const REFRESH_COOKIE_PATH = '/auth';

/**
 * `httpOnly` and `sameSite: 'strict'` come straight from the story's technical
 * note, and they are the reason the refresh token is a cookie at all: script on
 * the page cannot read it, and the browser will not send it cross-site.
 *
 * `secure` is configurable only so that a developer on plain `http://localhost`
 * receives the cookie at all — with it forced on, login would appear to succeed
 * while silently issuing no session, which is a miserable thing to debug. It is
 * true in every deployed environment.
 */
export function refreshCookieOptions(secure: boolean, maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeSeconds * 1_000,
  };
}

/**
 * The same flags without `maxAge`, for clearing. `clearCookie` only matches a
 * cookie whose `path`, `sameSite` and `secure` agree with what was set.
 */
export function clearRefreshCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: REFRESH_COOKIE_PATH,
  };
}
