import type { LoginResponse } from '@crm/shared';

/**
 * The access token, outside React — US-15.
 *
 * Still **in memory only**; a module variable is no more persistent than React
 * state, and nothing here touches `localStorage`. What it buys is reachability:
 * the axios interceptor has to attach the token and replace it after a silent
 * refresh, and an interceptor is not a component, so it cannot read a hook.
 *
 * `AuthProvider` is the owner. It writes here on sign-in and sign-out, and
 * subscribes so a refresh that happens under an interceptor still moves React
 * state — otherwise the UI would keep rendering a session the client had
 * already replaced.
 */
let accessToken: string | null = null;

type SessionListener = (session: LoginResponse | null) => void;

const listeners = new Set<SessionListener>();

export function getAccessToken(): string | null {
  return accessToken;
}

/** Called by `AuthProvider`; does not notify, because the provider already knows. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Publishes a session the interceptor obtained on its own — a silent refresh
 * (pass the new session) or a refresh that failed (pass `null`, meaning the
 * user has to sign in again).
 */
export function publishSession(session: LoginResponse | null): void {
  accessToken = session?.accessToken ?? null;

  for (const listener of listeners) {
    listener(session);
  }
}

export function subscribeToSession(listener: SessionListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Test seam. */
export function resetSessionStore(): void {
  accessToken = null;
  listeners.clear();
}
