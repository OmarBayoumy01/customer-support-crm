/**
 * US-23 — the interface shows only what the role permits.
 *
 * AC1 (protected routes preserve the destination), AC2 (navigation gating),
 * AC3 (action gating), AC4 (direct URL to a restricted page), AC5 (permissions
 * travel with the session).
 *
 * Every assertion here is about **not offering an action that would fail**.
 * None of it is a security boundary — US-22 is, and there is a backend test
 * suite that says so.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, test } from 'vitest';
import type { EffectivePermissions, LoginResponse } from '@crm/shared';

import i18n from '../../i18n';
import { AppNav } from '../../components/app-nav';
import { AppProviders } from '../../app/providers';
import { publishSession, resetSessionStore } from '../../lib/session-store';
import { AdminPage } from '../admin/admin-page';
import { DashboardPage } from '../dashboard/dashboard-page';
import { RequireAuth } from './require-auth';
import { RequirePermission } from './require-permission';

const USER_ID = '01923456-89ab-7cde-8f01-234567890abc';

function sessionWith(permissions: EffectivePermissions['permissions']): LoginResponse {
  return {
    accessToken: 'a.test.token',
    expiresIn: 900,
    user: {
      id: USER_ID,
      email: 'agent@crm.local',
      firstName: 'Aisha',
      lastName: 'Haddad',
      locale: 'EN',
      roles: ['agent'],
    },
    permissions: { userId: USER_ID, roles: ['agent'], permissions },
  };
}

const AGENT = sessionWith({ 'ticket:view': ['ASSIGNED'] });
const ADMIN = sessionWith({ 'ticket:view': ['ALL'], 'user:manage': ['ALL'] });

/** The real route table, so the tests exercise the wiring and not a copy. */
function renderAt(path: string, session: LoginResponse | null): void {
  // Seeded BEFORE render: AuthProvider initialises from the store, and a
  // publish during render would reach a provider that has not subscribed yet.
  if (session !== null) {
    publishSession(session);
  }

  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <Routes>
          <Route path="/login" element={<div>login screen</div>} />
          <Route element={<RequireAuth />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route element={<RequirePermission permission="user:manage" />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Route>
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  resetSessionStore();
  await i18n.changeLanguage('en');
});

describe('AC1 — protected routes', () => {
  test('an unauthenticated visitor is sent to the login screen', () => {
    renderAt('/dashboard', null);

    expect(screen.getByText('login screen')).toBeInTheDocument();
  });

  test('the intended destination is preserved for after sign-in', () => {
    // `RequireAuth` puts it in route state; `useLogin` reads it back. Someone
    // who followed a link to a ticket should arrive at that ticket, not at a
    // dashboard they then have to search from.
    render(
      <MemoryRouter initialEntries={['/admin?tab=users']}>
        <AppProviders>
          <Routes>
            <Route path="/login" element={<LocationProbe />} />
            <Route element={<RequireAuth />}>
              <Route path="/admin" element={<div>admin</div>} />
            </Route>
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('from')).toHaveTextContent('/admin?tab=users');
  });
});

describe('AC2 — navigation gating', () => {
  test('an agent sees Administration locked, not missing', () => {
    renderAt('/dashboard', AGENT);

    const locked = screen.getByTitle('You do not have permission for this');

    expect(locked).toHaveTextContent('Administration');
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    // It is not a link, so there is nothing to click and be refused.
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
  });

  test('the lock is conveyed by text as well as an icon, never colour alone', () => {
    renderAt('/dashboard', AGENT);

    const locked = screen.getByTitle('You do not have permission for this');

    // A screen reader gets the explanation; so does anyone who cannot
    // distinguish the muted colour.
    expect(locked.textContent).toContain('You do not have permission for this');
  });

  test('an administrator gets a real link', () => {
    renderAt('/dashboard', ADMIN);

    expect(screen.getByRole('link', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.queryByTitle('You do not have permission for this')).not.toBeInTheDocument();
  });
});

describe('AC4 — typing the URL of a restricted page', () => {
  test('an agent sees the permission-denied screen, not a broken page', () => {
    renderAt('/admin', AGENT);

    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument();
    // Bouncing them silently to the dashboard would read as a broken link, and
    // they would simply try again.
    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
  });

  test('the denied screen names no permission key', () => {
    renderAt('/admin', AGENT);

    // "You need `user:manage`" is a sentence for a developer, and it hands
    // anyone probing the app the vocabulary of its internals.
    expect(document.body.textContent).not.toContain('user:manage');
  });

  test('an administrator reaches the page', () => {
    renderAt('/admin', ADMIN);

    expect(screen.getByText(/Administration screens arrive/)).toBeInTheDocument();
  });

  test('an unauthenticated visitor is sent to sign in rather than told they lack access', () => {
    renderAt('/admin', null);

    // They might well hold the permission — we do not know who they are yet, so
    // "denied" would be a guess.
    expect(screen.getByText('login screen')).toBeInTheDocument();
  });
});

describe('AC5 — permissions travel with the session', () => {
  test('the set published with the session is what the gating reads', () => {
    renderAt('/dashboard', ADMIN);

    // No separate fetch: the permissions arrived with the login (or refresh)
    // response and are held in memory.
    expect(screen.getByRole('link', { name: 'Administration' })).toBeInTheDocument();
  });

  test('a session with no permissions at all gates everything off', () => {
    renderAt('/dashboard', sessionWith({}));

    expect(screen.getByTitle('You do not have permission for this')).toBeInTheDocument();
  });
});

describe('the nav in isolation', () => {
  test('Dashboard needs no permission and is always a link', () => {
    publishSession(sessionWith({}));

    render(
      <MemoryRouter>
        <AppProviders>
          <AppNav />
        </AppProviders>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
  });
});

/** Renders whatever `RequireAuth` recorded, so the test can assert on it. */
function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '';

  return <span data-testid="from">{from}</span>;
}
