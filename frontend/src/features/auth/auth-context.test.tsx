/**
 * US-14 — where the access token is allowed to live.
 *
 * The important test in this file is the one asserting it is *not* persisted.
 * A browser refresh losing the session is a known, deliberate cost that US-15
 * removes properly; "fixing" it by writing the token to `localStorage` would
 * hand it to any script that ever gets onto the page.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import type { LoginResponse } from '@crm/shared';

import { AppProviders } from '../../app/providers';
import { RequireAuth } from './require-auth';
import { Route, Routes } from 'react-router';
import { useAuth } from './auth-context';

const RESPONSE: LoginResponse = {
  accessToken: 'a.very.secret.token',
  expiresIn: 900,
  user: {
    id: '01923456-89ab-7cde-8f01-234567890abc',
    email: 'agent@crm.local',
    firstName: 'Aisha',
    lastName: 'Haddad',
    locale: 'EN',
    roles: ['agent'],
  },
  permissions: {
    userId: '01923456-89ab-7cde-8f01-234567890abc',
    roles: ['agent'],
    permissions: { 'ticket:view': ['ASSIGNED'] },
  },
};

function Probe(): React.JSX.Element {
  const { isAuthenticated, user, permissions, signIn, signOut } = useAuth();

  return (
    <div>
      <span data-testid="state">{isAuthenticated ? 'in' : 'out'}</span>
      <span data-testid="user">{user?.email ?? '-'}</span>
      <span data-testid="scopes">{permissions?.permissions['ticket:view']?.join(',') ?? '-'}</span>
      <button
        type="button"
        onClick={() => {
          signIn(RESPONSE);
        }}
      >
        sign in
      </button>
      <button type="button" onClick={signOut}>
        sign out
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  test('starts signed out', () => {
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );

    expect(screen.getByTestId('state')).toHaveTextContent('out');
  });

  test('signing in stores the user and their effective permissions', async () => {
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'sign in' }));

    expect(screen.getByTestId('state')).toHaveTextContent('in');
    expect(screen.getByTestId('user')).toHaveTextContent('agent@crm.local');
    // Carried so US-23 can gate the UI without a second round trip.
    expect(screen.getByTestId('scopes')).toHaveTextContent('ASSIGNED');
  });

  test('signing out clears everything', async () => {
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'sign in' }));
    await user.click(screen.getByRole('button', { name: 'sign out' }));

    expect(screen.getByTestId('state')).toHaveTextContent('out');
    expect(screen.getByTestId('user')).toHaveTextContent('-');
  });

  test('the access token is never written to localStorage or sessionStorage', async () => {
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'sign in' }));

    const stored = JSON.stringify({ ...localStorage, ...sessionStorage });

    // An access token is a bearer credential: whoever holds it *is* the user
    // until it expires. Anything readable by script on the page is readable by
    // an XSS. If this test starts failing, the fix is US-15's silent refresh,
    // not persistence.
    expect(stored).not.toContain(RESPONSE.accessToken);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('RequireAuth', () => {
  test('redirects an unauthenticated visitor to the login screen', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppProviders>
          <Routes>
            <Route path="/login" element={<div>login screen</div>} />
            <Route element={<RequireAuth />}>
              <Route path="/dashboard" element={<div>protected content</div>} />
            </Route>
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    expect(screen.getByText('login screen')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });
});
