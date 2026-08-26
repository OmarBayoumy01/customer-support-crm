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
import { Sidebar } from '@/components/shell/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
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

/** The sidebar on its own — it is where nav gating lives since US-28. */
function renderSidebar(session: LoginResponse): void {
  publishSession(session);

  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AppProviders>
        <TooltipProvider>
          <Sidebar />
        </TooltipProvider>
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('AC2 — navigation gating', () => {
  test('an agent sees the administration items locked, not missing', () => {
    renderSidebar(AGENT);

    const locked = screen
      .getAllByText('Users')
      .map((node) => node.closest('[aria-disabled="true"]'))
      .filter((node) => node !== null);

    expect(locked.length).toBeGreaterThan(0);
    // It is a span, not a link, so there is nothing to click and be refused by.
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  test('the lock is conveyed by text as well as an icon, never colour alone', () => {
    renderSidebar(AGENT);

    const users = screen
      .getAllByText('Users')
      .map((node) => node.closest('[aria-disabled="true"]'))
      .find((node) => node !== null);

    expect(users).not.toBeNull();
    // A screen reader gets the explanation; so does anyone who cannot
    // distinguish the muted colour.
    expect(users?.textContent).toContain('You do not have permission for this');
  });

  test('an administrator gets a real link', () => {
    renderSidebar(ADMIN);

    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
  });

  test('the sidebar shows the grouped sections the story asks for', () => {
    // AC1 of US-28. Grouping is the structure, so it is asserted rather than
    // left to look right.
    renderSidebar(ADMIN);

    for (const section of ['Workspace', 'Knowledge', 'Analytics', 'Administration', 'Account']) {
      expect(screen.getByRole('heading', { name: section })).toBeInTheDocument();
    }
  });

  test('an item everyone may reach is never locked', () => {
    renderSidebar(sessionWith({}));

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
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
    renderSidebar(ADMIN);

    // No separate fetch: the permissions arrived with the login (or refresh)
    // response and are held in memory.
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
  });

  test('a session with no permissions at all gates every restricted item off', () => {
    renderSidebar(sessionWith({}));

    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'All tickets' })).not.toBeInTheDocument();
  });
});

/** Renders whatever `RequireAuth` recorded, so the test can assert on it. */
function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '';

  return <span data-testid="from">{from}</span>;
}
