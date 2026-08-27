/**
 * US-14 — where the access token is allowed to live.
 *
 * The important test in this file is the one asserting it is *not* persisted.
 * A browser refresh losing the session is a known, deliberate cost that US-15
 * removes properly; "fixing" it by writing the token to `localStorage` would
 * hand it to any script that ever gets onto the page.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import type { LoginResponse } from '@crm/shared';

import { AppProviders } from '../../app/providers';
import { http } from '../../lib/api-client';
import { refreshHttp, resetRefreshState } from '../../lib/refresh-client';
import { publishSession, resetSessionStore } from '../../lib/session-store';
import { RequireAuth } from './require-auth';
import { Route, Routes } from 'react-router';
import { useAuth } from './auth-context';

const RESPONSE: LoginResponse = {
  accessToken: 'a.very.secret.token',
  expiresIn: 900,
  audience: 'crm-staff',
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

/**
 * The boot-time refresh answers before any of these reach their verdict, so
 * every test installs an adapter for it. Left to reach the real network it
 * would hang for the whole suite and every redirect would be a race.
 */
const realRefreshAdapter = refreshHttp.defaults.adapter;
const realAdapter = http.defaults.adapter;

/** No cookie to restore from — what an anonymous visitor looks like. */
function refreshFails(): void {
  refreshHttp.defaults.adapter = (config) =>
    Promise.reject(
      new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, {}, {
        data: {
          error: {
            statusCode: 401,
            code: 'UNAUTHENTICATED',
            message: 'refused',
            requestId: 'test-request-id',
            timestamp: new Date().toISOString(),
          },
        },
        status: 401,
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse),
    );
}

/** A live cookie: the server hands back a session. */
function refreshSucceeds(session: LoginResponse = RESPONSE): void {
  refreshHttp.defaults.adapter = (config) =>
    Promise.resolve({
      data: { data: session },
      status: 200,
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse);
}

beforeEach(() => {
  resetSessionStore();
  resetRefreshState();
  refreshFails();

  // Nothing in here should reach the API for anything but the refresh.
  http.defaults.adapter = (config) =>
    Promise.resolve({
      data: { data: [] },
      status: 200,
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse);
});

afterEach(() => {
  resetSessionStore();
  resetRefreshState();

  if (realRefreshAdapter === undefined) {
    delete refreshHttp.defaults.adapter;
  } else {
    refreshHttp.defaults.adapter = realRefreshAdapter;
  }

  if (realAdapter === undefined) {
    delete http.defaults.adapter;
  } else {
    http.defaults.adapter = realAdapter;
  }
});

function renderProtected(): void {
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
}

describe('RequireAuth', () => {
  test('sends an unauthenticated visitor to the login screen', async () => {
    renderProtected();

    // Awaited rather than immediate: the cookie exchange gets its turn first,
    // and that pause is the whole fix for "a browser refresh signs me out".
    expect(await screen.findByText('login screen')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  test('waits for the boot-time refresh rather than redirecting through it', () => {
    // A refresh that never settles, so the intermediate state can be observed
    // at all. In life it lasts one round trip.
    refreshHttp.defaults.adapter = () => new Promise(() => undefined);

    renderProtected();

    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });
});

// -------------------------------------------------------------------------
// US-15 — the half that was missing: restoring a session on load
// -------------------------------------------------------------------------

describe('a browser refresh', () => {
  test('restores the session from the cookie instead of signing the user out', async () => {
    // Exactly what F5 leaves behind: nothing in memory, a cookie on the
    // browser. Nothing in the app can read that cookie — the point of it being
    // httpOnly — so it asks the server once, on load.
    refreshSucceeds();

    renderProtected();

    expect(await screen.findByText('protected content')).toBeInTheDocument();
    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
  });

  test('a tab that already holds a session does not wait for anything', () => {
    publishSession(RESPONSE);

    // The adapter installed above would fail if it were called. It is not:
    // there is nothing to restore, so the page renders on the first frame.
    renderProtected();

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  test('a restored session is still not written anywhere script can read it', async () => {
    refreshSucceeds();

    renderProtected();

    await screen.findByText('protected content');

    // The reason the cookie exists at all. Restoring must not become an excuse
    // to persist the access token.
    await waitFor(() => {
      expect(localStorage.length).toBe(0);
    });

    expect(sessionStorage.length).toBe(0);
  });
});
