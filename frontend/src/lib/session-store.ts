import type { LoginResponse } from '@crm/shared';

/**
 * The session, outside React — US-15 and US-23.
 *
 * Still **in memory only**; a module variable is no more persistent than React
 * state, and nothing here touches `localStorage`. What it buys is reachability:
 * the axios interceptor has to attach the token and replace it after a silent
 * refresh, and an interceptor is not a component, so it cannot read a hook.
 *
 * It holds the whole session rather than just the token because `AuthProvider`
 * **initialises from it**. A refresh that completes before the provider mounts
 * — which is what a boot-time silent refresh is — would otherwise publish to
 * nobody, and the app would render as signed out while holding a valid session.
 */
let session: LoginResponse | null = null;

type SessionListener = (session: LoginResponse | null) => void;

const listeners = new Set<SessionListener>();

export function getSession(): LoginResponse | null {
  return session;
}

export function getAccessToken(): string | null {
  return session?.accessToken ?? null;
}

/**
 * Records a session without notifying.
 *
 * Called by `AuthProvider` when *it* is the one that changed something, so it
 * does not tell itself what it already knows.
 */
export function setSession(next: LoginResponse | null): void {
  session = next;
}

/**
 * Publishes a session obtained outside React — a silent refresh (pass the new
 * session) or a refresh that failed (pass `null`, meaning sign in again).
 */
export function publishSession(next: LoginResponse | null): void {
  session = next;

  for (const listener of listeners) {
    listener(next);
  }
}

export function subscribeToSession(listener: SessionListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Updates user fields on the active session and notifies AuthProvider listeners. */
export function updateSessionUser(userPatch: Partial<LoginResponse['user']>): void {
  if (session === null) {
    return;
  }

  const next: LoginResponse = {
    ...session,
    user: {
      ...session.user,
      ...userPatch,
    },
  };

  publishSession(next);
}

/** Test seam. */
export function resetSessionStore(): void {
  session = null;
  listeners.clear();
}
