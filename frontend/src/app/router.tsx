import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';

import { AppShell } from '@/components/shell/app-shell';
import { RouteErrorBoundary } from '@/app/route-error-boundary';
import { RouteFallback } from '@/components/states/route-fallback';
import { useAuth } from '@/features/auth/auth-context';
import { RequireAuth } from '@/features/auth/require-auth';
import { RequirePermission } from '@/features/auth/require-permission';
import { PortalHomePage } from '@/features/portal/portal-home-page';
import { PortalSubmitPage } from '@/features/portal/portal-submit-page';

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
const TicketDetailPage = lazy(async () => ({
  default: (await import('@/features/tickets/ticket-detail-page')).TicketDetailPage,
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

        {/*
          The customer portal — US-21.

          A branch of its own rather than routes inside the staff shell. A
          customer signing in lands here and never sees the sidebar, the queue
          badge or the staff dashboard, which is AC1 as written.

          `loginPath` sends an unauthenticated visitor to the portal form:
          bouncing them to the staff login would be exactly the "navigating the
          staff application" the story exists to avoid.
        */}
        <Route path="/portal/login" element={<LoginPage variant="portal" />} />

        <Route element={<RequireAuth loginPath="/portal/login" />}>
          <Route path="/portal" element={<PortalHomePage />} />
          <Route path="/portal/new" element={<PortalSubmitPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<ShellOutlet />}>
            <Route path="/dashboard" element={<DashboardPage />} />

            {/*
              US-42. The queue's own view tabs carry the filter in the query
              string, so `?view=mine` is the whole of "my tickets" — there is no
              second route for it.
            */}
            <Route element={<RequirePermission permission="ticket:view" />}>
              <Route path="/tickets" element={<TicketsQueuePage />} />
              <Route path="/tickets/:id" element={<TicketDetailPage />} />
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
