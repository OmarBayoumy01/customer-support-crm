import { Navigate, Outlet, useLocation } from 'react-router';

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
   * Which sign-in to send an unauthenticated visitor to — US-21.
   *
   * Defaults to the staff login, so every existing route is unchanged. Portal
   * routes pass `/portal/login`: bouncing a customer into the staff form would
   * be the "navigating the staff application" the story exists to avoid.
   */
  loginPath = '/login',
}: {
  loginPath?: string;
} = {}): React.JSX.Element {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // The attempted path is carried along so US-15 can return the user to it
    // once a silent refresh has restored their session.
    return (
      <Navigate to={loginPath} replace state={{ from: location.pathname + location.search }} />
    );
  }

  return <Outlet />;
}
