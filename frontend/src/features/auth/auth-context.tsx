import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  AuthenticatedUser,
  EffectivePermissions,
  LoginResponse,
  TokenAudience,
} from '@crm/shared';

import {
  getSession,
  publishSession,
  setSession as storeSession,
  subscribeToSession,
} from '../../lib/session-store';
import { refreshSession } from '../../lib/refresh-client';

export interface AuthState {
  accessToken: string | null;
  user: AuthenticatedUser | null;
  permissions: EffectivePermissions | null;
  isAuthenticated: boolean;
  /**
   * True while the boot-time refresh is still in flight.
   *
   * `isAuthenticated` is false during it — there is genuinely no token yet —
   * so anything that would otherwise bounce the user to the login screen has
   * to wait for this to clear first. That is the whole reason it exists.
   */
  isRestoring: boolean;
  /**
   * Which application this session belongs to, or null when signed out.
   *
   * Reported by the server at sign-in and carried through every refresh. Read
   * it to decide where somebody belongs; never to decide what they may do —
   * that is what permissions are for, and the server checks them again.
   */
  audience: TokenAudience | null;
  signIn: (response: LoginResponse) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Holds the session for the life of the tab — US-14.
 *
 * **The access token lives in React state and nowhere else.** Not
 * `localStorage`, not `sessionStorage`, not a non-httpOnly cookie: every one of
 * those is readable by any script that gets onto the page, and an access token
 * is a bearer credential — whoever holds it *is* the user until it expires.
 *
 * The cost is real and deliberate: a browser refresh loses the token and
 * returns to the login screen. **US-15 is what fixes that**, by exchanging the
 * httpOnly refresh cookie for a new access token on load. The cookie can do
 * that safely precisely because script cannot read it.
 *
 * There is a test asserting nothing is written to either store, so that the
 * refresh behaviour cannot be "fixed" by reintroducing the vulnerability.
 */
export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // Initialised **from the store**, not from null. A silent refresh that
  // completes before this component mounts would otherwise have published to
  // nobody, and the app would render signed out while holding a live session.
  const [accessToken, setAccessToken] = useState<string | null>(
    () => getSession()?.accessToken ?? null,
  );
  const [user, setUser] = useState<AuthenticatedUser | null>(() => getSession()?.user ?? null);
  const [permissions, setPermissions] = useState<EffectivePermissions | null>(
    () => getSession()?.permissions ?? null,
  );
  const [audience, setAudience] = useState<TokenAudience | null>(
    () => getSession()?.audience ?? null,
  );

  const signIn = useCallback((response: LoginResponse) => {
    setAccessToken(response.accessToken);
    setUser(response.user);
    setPermissions(response.permissions);
    setAudience(response.audience);
    // The axios interceptor is not a component and cannot read this state, so
    // the session is mirrored where it can reach it. Still memory only.
    storeSession(response);
  }, []);

  const signOut = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setPermissions(null);
    setAudience(null);
    storeSession(null);
  }, []);

  /**
   * Whether the boot-time refresh is still deciding — see the effect below.
   *
   * Starts true **only when there is no session in memory**. A tab that
   * already holds one has nothing to restore, and starting true there would
   * flash a loading state over every client-side navigation.
   */
  const [isRestoring, setIsRestoring] = useState(() => getSession() === null);

  /**
   * Restoring the session after a browser refresh — US-15, the half that was
   * missing.
   *
   * The access token lives in memory and nowhere else, which is deliberate and
   * documented above. The consequence is that F5 throws it away. US-15 answers
   * that by exchanging the httpOnly refresh cookie for a new one — but until
   * now the only thing that called `refreshSession()` was the 401 interceptor,
   * and **the interceptor never got a chance**: `RequireAuth` saw no token and
   * redirected to the login screen before the application made a single
   * request. So a refresh looked exactly like being signed out.
   *
   * One attempt, on mount, and only when there is nothing in memory:
   *
   * - **A 401 is the expected answer** for somebody who is not signed in, and
   *   it costs one request. There is no way to check for an httpOnly cookie
   *   from script, which is the point of it being httpOnly.
   * - `refreshSession()` is single-flight, so this cannot race the
   *   interceptor into two rotations of the same token — which the server
   *   would treat as a replay and would answer by killing the family.
   * - It publishes through the session store rather than setting state here,
   *   so the subscription below is the single path a session arrives by.
   */
  useEffect(() => {
    if (getSession() !== null) {
      setIsRestoring(false);
      return;
    }

    let cancelled = false;

    void refreshSession()
      .then((session) => {
        if (!cancelled) {
          // **Published**, not merely stored: this session was obtained outside
          // React, so the subscription below is what tells the tree about it.
          // `setSession` deliberately does not notify, and using it here was
          // the difference between restoring a session and appearing not to.
          publishSession(session);
        }
      })
      .catch(() => {
        // Nothing to restore: no cookie, or one the server would not honour.
        // Not an error state — it is what an anonymous visitor looks like.
      })
      .finally(() => {
        if (!cancelled) {
          setIsRestoring(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A silent refresh happens inside an interceptor, underneath React — US-15.
   *
   * Without this subscription the client would hold a new token while the UI
   * went on rendering the old session, and a refresh that *failed* would leave
   * the user looking at an application they could no longer make a request
   * from. Both are the kind of bug that only shows up fifteen minutes in.
   */
  useEffect(
    () =>
      subscribeToSession((session) => {
        setAccessToken(session?.accessToken ?? null);
        setUser(session?.user ?? null);
        setPermissions(session?.permissions ?? null);
        setAudience(session?.audience ?? null);

        if (session !== null) {
          // However it arrived, there is nothing left to wait for.
          setIsRestoring(false);
        }
      }),
    [],
  );

  const value = useMemo<AuthState>(
    () => ({
      accessToken,
      user,
      permissions,
      isAuthenticated: accessToken !== null,
      isRestoring,
      audience,
      signIn,
      signOut,
    }),
    [accessToken, user, permissions, isRestoring, audience, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }

  return context;
}
