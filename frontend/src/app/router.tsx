import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';

import { AppShell } from '@/components/shell/app-shell';
import { RouteErrorBoundary } from '@/app/route-error-boundary';
import { RouteFallback } from '@/components/states/route-fallback';
import { useAuth } from '@/features/auth/auth-context';
import { RequireAuth } from '@/features/auth/require-auth';
import { RequirePermission } from '@/features/auth/require-permission';

/**
 * Feature routes are code-split — US-25, AC2.
 *
 * The login screen is **not**: it is the first thing an unauthenticated visitor
 * sees, and making them wait for a second network round trip to be shown a
 * password field is a poor trade for a few kilobytes.
 */
const LoginPage = lazy(async () => ({
  default: (await import('@/features/auth/login-page')).LoginPage,
}));
const DashboardPage = lazy(async () => ({
  default: (await import('@/features/dashboard/dashboard-page')).DashboardPage,
}));
const TicketsQueuePage = lazy(async () => ({
  default: (await import('@/features/tickets/tickets-queue-page')).TicketsQueuePage,
}));
const AdminPage = lazy(async () => ({
  default: (await import('@/features/admin/admin-page')).AdminPage,
}));
const DesignSystemPage = lazy(async () => ({
  default: (await import('@/features/design-system/design-system-page')).DesignSystemPage,
}));
const NotFoundPage = lazy(async () => ({
  default: (await import('@/features/not-found/not-found-page')).NotFoundPage,
}));

/**
 * The routes P03 needs.
 *
 * The error boundary and the suspense fallback sit **inside** the shell, so a
 * page that fails to load or throws leaves the sidebar and header standing and
 * the user can navigate away. Wrapping the whole app instead turns one broken
 * screen into a blank page.
 */
function ShellOutlet(): React.JSX.Element {
  return (
    <AppShell>
      <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </RouteErrorBoundary>
    </AppShell>
  );
}

export function AppRoutes(): React.JSX.Element {
  const { isAuthenticated } = useAuth();

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<ShellOutlet />}>
            <Route path="/dashboard" element={<DashboardPage />} />

            {/*
              US-42. `/tickets/mine` is the same screen with the view tab
              preselected — the sidebar links to it, and one screen answering
              both is better than two that drift apart.
            */}
            <Route element={<RequirePermission permission="ticket:view" />}>
              <Route path="/tickets" element={<TicketsQueuePage />} />
              <Route path="/tickets/mine" element={<Navigate to="/tickets?view=mine" replace />} />
            </Route>

            <Route path="/design-system" element={<DesignSystemPage />} />

            {/*
              Nested inside RequireAuth, so an unauthenticated visitor is sent
              to sign in rather than told they lack a permission — they might
              well have it. Only once we know who they are is "denied" honest.
            */}
            <Route element={<RequirePermission permission="user:manage" />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>

        <Route
          path="/"
          element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />}
        />
      </Routes>
    </Suspense>
  );
}
