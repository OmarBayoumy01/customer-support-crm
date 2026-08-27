import { Navigate, Outlet, useLocation } from 'react-router';

import { RouteFallback } from '@/components/states/route-fallback';
import { useAuth } from './auth-context';

/**
 * Keeps unauthenticated visitors off the application routes.
 *
 * **This is a convenience, not a security boundary.** Anyone can edit the
 * bundle; what actually protects data is the backend guard US-14 registered
 * globally and the permission checks US-22 adds on top of it. This exists so
 * users are not shown a screen that would fail every request it made.
 */
export function RequireAuth({
  /**
   * Which sign-in to send an unauthenticated visitor to.
   *
   * There is only one now — the audience is decided from the account rather
   * than from which form was used — so nothing overrides this. It stays a
   * parameter because a second entrance (an invite link, a magic link) would
   * otherwise have to reach in here to add one.
   */
  loginPath = '/login',
}: {
  loginPath?: string;
} = {}): React.JSX.Element {
  const { isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();

  /**
   * Wait for the boot-time refresh before deciding — US-15.
   *
   * On a browser refresh there is no token in memory yet and the cookie is
   * still being exchanged for one. Redirecting on that half-second is what
   * made F5 look like a sign-out, and it also loses the page the user was on:
   * the redirect below records `from`, but by then they have already seen a
   * login form they did not ask for.
   */
  if (isRestoring) {
    return <RouteFallback />;
  }

  if (!isAuthenticated) {
    // The attempted path is carried along so US-15 can return the user to it
    // once a silent refresh has restored their session.
    return (
      <Navigate to={loginPath} replace state={{ from: location.pathname + location.search }} />
    );
  }

  return <Outlet />;
}
