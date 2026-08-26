import { Navigate, Route, Routes } from 'react-router';

import { useAuth } from '../features/auth/auth-context';
import { LoginPage } from '../features/auth/login-page';
import { RequireAuth } from '../features/auth/require-auth';
import { DashboardPage } from '../features/dashboard/dashboard-page';

/**
 * The routes US-14 needs, and no more.
 *
 * Kept as elements rather than a data router because there is nothing here that
 * loaders or actions would earn yet; P03 owns the application shell and can
 * decide that with the full route table in front of it.
 */
export function AppRoutes(): React.JSX.Element {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<DashboardPage />} />
      </Route>

      {/* Whichever of the two the visitor is entitled to. */}
      <Route
        path="/"
        element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />}
      />

      {/*
        An unknown path is not an error worth its own screen in this story —
        send the visitor somewhere real. P03 replaces this with a proper 404.
      */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
