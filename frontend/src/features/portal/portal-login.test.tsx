/**
 * US-21 — portal sign-in, the client half.
 *
 * AC1 lands on the portal home, never the staff dashboard · AC2 a staff account
 * is refused with a pointer to the staff login · AC4 a preserved destination
 * wins · plus the loading and error states, and protected portal routing.
 *
 * The server half — the `crm-portal` audience and the 422 — is asserted in
 * `backend/src/auth/portal-login.test.ts`.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { LoginResponse } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { publishSession, resetSessionStore } from '@/lib/session-store';
import { LoginPage } from '@/features/auth/login-page';
import { RequireAuth } from '@/features/auth/require-auth';
import { PortalHomePage } from './portal-home-page';

const realAdapter = http.defaults.adapter;

const USER_ID = '01923456-89ab-7cde-8f01-234567890abc';

const SESSION: LoginResponse = {
  accessToken: 'a.test.token',
  expiresIn: 900,
  user: {
    id: USER_ID,
    email: 'nadia@example.com',
    firstName: 'Nadia',
    lastName: 'Saeed',
    locale: 'EN',
    roles: ['customer'],
  },
  permissions: { userId: USER_ID, roles: ['customer'], permissions: { 'ticket:view': ['OWN'] } },
};

let sent: InternalAxiosRequestConfig[] = [];

const posts = (): string[] =>
  sent.filter((request) => request.method?.toLowerCase() === 'post').map((r) => r.url ?? '');

/** Answers the login POST with the given status. */
function respondWith(status: number, code?: string): void {
  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    if (status >= 400) {
      const response = {
        // The full envelope: `ApiErrorSchema` is parsed, and a partial one is
        // discarded — which is how the code goes missing and every failure reads
        // as 'something went wrong'.
        data: {
          error: {
            statusCode: status,
            code,
            message: 'refused',
            requestId: 'test-request-id',
            timestamp: new Date().toISOString(),
          },
        },
        status,
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse;

      // A real AxiosError, which is what the response interceptor checks for —
      // a decorated plain Error falls through to INTERNAL_ERROR and the code
      // never reaches the error map.
      return Promise.reject(
        new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, {}, response),
      );
    }

    return Promise.resolve({
      data: { data: SESSION },
      status,
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse);
  };

  http.defaults.adapter = adapter;
}

/** Shows where the router ended up, so a redirect can be asserted directly. */
function Where(): React.JSX.Element {
  const location = useLocation();

  return <div data-testid="path">{location.pathname}</div>;
}

/** The real portal routes, so the test exercises the wiring rather than a copy. */
function renderAt(path: string, state?: { from: string }): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <AppProviders>
        <Where />
        <Routes>
          <Route path="/login" element={<div>staff login screen</div>} />
          <Route path="/dashboard" element={<div>staff dashboard</div>} />
          <Route path="/portal/login" element={<LoginPage variant="portal" />} />
          <Route element={<RequireAuth loginPath="/portal/login" />}>
            <Route path="/portal" element={<PortalHomePage />} />
            <Route path="/portal/requests/:id" element={<div>one request</div>} />
          </Route>
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

async function signIn(): Promise<void> {
  const user = userEvent.setup();

  await user.type(screen.getByLabelText('Email'), 'nadia@example.com');
  await user.type(screen.getByLabelText('Password'), 'PortalPassw0rd!');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(async () => {
  sent = [];
  resetSessionStore();
  await i18n.changeLanguage('en');
  respondWith(200);
});

afterEach(() => {
  resetSessionStore();

  if (realAdapter === undefined) {
    delete http.defaults.adapter;
  } else {
    http.defaults.adapter = realAdapter;
  }
});

// ---------------------------------------------------------------------------
// AC1 — portal login
// ---------------------------------------------------------------------------

describe('AC1 — landing on the portal', () => {
  test('a successful sign-in posts to the portal endpoint and lands on /portal', async () => {
    renderAt('/portal/login');

    await signIn();

    await waitFor(() => {
      // The audience is decided by which endpoint is called, so this assertion
      // is what keeps the portal form off the staff door.
      expect(posts()).toEqual(['/auth/portal/login']);
    });

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/portal');
    });

    // AC1's "never on the staff dashboard".
    expect(screen.queryByText('staff dashboard')).not.toBeInTheDocument();
    expect(await screen.findByText(/Hello, Nadia/)).toBeInTheDocument();
  });

  test('the portal form is its own screen, not the staff one', async () => {
    renderAt('/portal/login');

    // The customer-facing copy, and a way across to the staff form for somebody
    // who arrived at the wrong one.
    expect(await screen.findByRole('link', { name: 'Use the staff sign-in' })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});

// ---------------------------------------------------------------------------
// AC2 — audience isolation
// ---------------------------------------------------------------------------

describe('AC2 — a staff account on the portal form', () => {
  test('is refused with a message pointing at the staff sign-in', async () => {
    respondWith(422, 'UNPROCESSABLE');

    renderAt('/portal/login');

    await signIn();

    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent(/staff account/i);
    // And the pointer is a link, not just a sentence.
    expect(screen.getByRole('link', { name: 'Use the staff sign-in' })).toBeInTheDocument();

    // Still on the form, not signed in.
    expect(screen.getByTestId('path')).toHaveTextContent('/portal/login');
  });
});

// ---------------------------------------------------------------------------
// Invalid credentials, loading and error states
// ---------------------------------------------------------------------------

describe('states', () => {
  test('invalid credentials show the generic message and leave the form usable', async () => {
    respondWith(401, 'UNAUTHENTICATED');

    renderAt('/portal/login');

    await signIn();

    const alert = await screen.findByRole('alert');

    // The same wording as the staff form: which of the two was wrong must stay
    // indistinguishable.
    expect(alert).toHaveTextContent(/Email or password/i);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  test('the submit button reports that it is working, and is disabled while it does', async () => {
    let release: (() => void) | undefined;

    http.defaults.adapter = (config) => {
      sent.push(config);

      return new Promise((resolve) => {
        release = () =>
          resolve({
            data: { data: SESSION },
            status: 200,
            statusText: '',
            headers: {},
            config,
          } as AxiosResponse);
      });
    };

    renderAt('/portal/login');

    await signIn();

    const button = await screen.findByRole('button', { name: 'Signing in…' });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    release?.();
  });

  test('a network failure says so rather than blaming the credentials', async () => {
    http.defaults.adapter = (config) => {
      sent.push(config);

      return Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {}));
    };

    renderAt('/portal/login');

    await signIn();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/staff account/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Protected routing, and AC4
// ---------------------------------------------------------------------------

describe('protected portal routes', () => {
  test('an unauthenticated visit to /portal goes to the portal sign-in, not the staff one', async () => {
    renderAt('/portal');

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/portal/login');
    });

    // Bouncing a customer into the staff form is the thing this story exists to
    // avoid.
    expect(screen.queryByText('staff login screen')).not.toBeInTheDocument();
  });

  test('an authenticated customer reaches the portal home', async () => {
    publishSession(SESSION);

    renderAt('/portal');

    expect(await screen.findByText(/Hello, Nadia/)).toBeInTheDocument();
  });

  test('AC4 — a preserved destination wins over the portal home', async () => {
    renderAt('/portal/login', { from: '/portal/requests/abc' });

    await signIn();

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/portal/requests/abc');
    });

    expect(await screen.findByText('one request')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Arabic
// ---------------------------------------------------------------------------

describe('Arabic', () => {
  test('the portal sign-in renders in Arabic with no physical-direction classes', async () => {
    await i18n.changeLanguage('ar');

    const { container } = render(
      <MemoryRouter initialEntries={['/portal/login']}>
        <AppProviders>
          <Routes>
            <Route path="/portal/login" element={<LoginPage variant="portal" />} />
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'استخدم دخول الموظفين' })).toBeInTheDocument();

    for (const element of container.querySelectorAll('*')) {
      const classes = element.className;

      if (typeof classes !== 'string') {
        continue;
      }

      expect(classes).not.toMatch(/\b-?(ml|mr|pl|pr)-/);
      expect(classes).not.toMatch(/\b(left|right)-/);
    }

    await i18n.changeLanguage('en');
  });
});
