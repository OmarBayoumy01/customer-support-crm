import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthenticatedUser, EffectivePermissions, LoginResponse } from '@crm/shared';

import { setAccessToken as storeAccessToken, subscribeToSession } from '../../lib/session-store';

export interface AuthState {
  accessToken: string | null;
  user: AuthenticatedUser | null;
  permissions: EffectivePermissions | null;
  isAuthenticated: boolean;
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
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [permissions, setPermissions] = useState<EffectivePermissions | null>(null);

  const signIn = useCallback((response: LoginResponse) => {
    setAccessToken(response.accessToken);
    setUser(response.user);
    setPermissions(response.permissions);
    // The axios interceptor is not a component and cannot read this state, so
    // the token is mirrored where it can reach it. Still memory only.
    storeAccessToken(response.accessToken);
  }, []);

  const signOut = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setPermissions(null);
    storeAccessToken(null);
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
      }),
    [],
  );

  const value = useMemo<AuthState>(
    () => ({
      accessToken,
      user,
      permissions,
      isAuthenticated: accessToken !== null,
      signIn,
      signOut,
    }),
    [accessToken, user, permissions, signIn, signOut],
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
