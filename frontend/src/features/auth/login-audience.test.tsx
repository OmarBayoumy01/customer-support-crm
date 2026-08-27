/**
 * One login form, and the server says where you belong — the client half.
 *
 * Replaces the portal sign-in suite. There is no portal form any more: the token
 * audience is decided from the **account**, so this asserts that one form sends a
 * customer to the portal and a staff member to the dashboard, that the old portal
 * path still resolves, and that a customer is never carried on to a staff route.
 *
 * US-21's AC1 survives intact — *"lands on the portal, never the staff
 * dashboard"*. Its AC2 (a staff account refused on the portal form) is
 * superseded: there is no second form to refuse anybody at.
 *
 * The server half — which audience each account gets, and that a token is
 * refused by the other application — is asserted in
 * `backend/src/auth/login-audience.test.ts`.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { LoginResponse, TokenAudience } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { publishSession, resetSessionStore } from '@/lib/session-store';
import { LoginPage } from '@/features/auth/login-page';
import { RequireAuth } from '@/features/auth/require-auth';
import { PortalHomePage } from '@/features/portal/portal-home-page';

const realAdapter = http.defaults.adapter;

const USER_ID = '01923456-89ab-7cde-8f01-234567890abc';

function sessionFor(audience: TokenAudience): LoginResponse {
  return {
    accessToken: 'a.test.token',
    expiresIn: 900,
    audience,
    user: {
      id: USER_ID,
      email: audience === 'crm-portal' ? 'nadia@example.com' : 'aisha@crm.local',
      firstName: audience === 'crm-portal' ? 'Nadia' : 'Aisha',
      lastName: audience === 'crm-portal' ? 'Saeed' : 'Haddad',
      locale: 'EN',
      roles: [audience === 'crm-portal' ? 'customer' : 'agent'],
    },
    permissions: {
      userId: USER_ID,
      roles: [audience === 'crm-portal' ? 'customer' : 'agent'],
      permissions: { 'ticket:view': [audience === 'crm-portal' ? 'OWN' : 'ASSIGNED'] },
    },
  };
}

const CUSTOMER = sessionFor('crm-portal');
const STAFF = sessionFor('crm-staff');

let sent: InternalAxiosRequestConfig[] = [];

const posts = (): string[] =>
  sent
    .filter((request) => request.method?.toLowerCase() === 'post')
    .map((request) => request.url ?? '');

/** Answers the login POST with a session, or with a failure envelope. */
function respondWith(options: { session?: LoginResponse; status?: number; code?: string }): void {
  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    const status = options.status ?? 200;

    // Anything that is not the login itself is the page the user landed on
    // asking for its own data. Answering those with a login envelope makes the
    // portal home crash, which looks like a routing failure and is not one.
    if (!(config.url ?? '').includes('/auth/login')) {
      return Promise.resolve({
        data: {
          data: [],
          pagination: {
            page: 1,
            pageSize: 20,
            total: 0,
            totalPages: 1,
            hasNext: false,
            hasPrevious: false,
          },
        },
        status: 200,
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse);
    }

    if (status >= 400) {
      const response = {
        // The full envelope: `ApiErrorSchema` is parsed, and a partial one is
        // discarded — which is how the code goes missing and every failure reads
        // as "something went wrong".
        data: {
          error: {
            statusCode: status,
            code: options.code,
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
      data: { data: options.session ?? CUSTOMER },
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

/** The real routes, so the test exercises the wiring rather than a copy. */
function renderAt(path: string, state?: { from: string }): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <AppProviders>
        <Where />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Kept as a redirect: the path has been handed out. */}
          <Route path="/portal/login" element={<Navigate to="/login" replace />} />

          <Route element={<RequireAuth />}>
            <Route path="/portal" element={<PortalHomePage />} />
            <Route path="/portal/requests/:id" element={<div>one request</div>} />
            <Route path="/dashboard" element={<div>staff dashboard</div>} />
            <Route path="/tickets/:id" element={<div>staff ticket</div>} />
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
  respondWith({});
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
// One door
// ---------------------------------------------------------------------------

describe('one form for everybody', () => {
  test('a customer signs in at /login and lands on the portal', async () => {
    renderAt('/login');

    await signIn();

    await waitFor(() => {
      // One endpoint. There is no second one to prefer, and no audience field to
      // send: the answer decides where this person goes.
      expect(posts()).toEqual(['/auth/login']);
    });

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/portal');
    });

    // US-21's AC1 — "never on the staff dashboard".
    expect(screen.queryByText('staff dashboard')).not.toBeInTheDocument();
    expect(await screen.findByText(/Hello, Nadia/)).toBeInTheDocument();
  });

  test('a staff account signs in at the same form and lands on the dashboard', async () => {
    respondWith({ session: STAFF });

    renderAt('/login');

    await signIn();

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/dashboard');
    });

    expect(await screen.findByText('staff dashboard')).toBeInTheDocument();
  });

  test('there is no second sign-in to send anybody to', async () => {
    renderAt('/login');

    await screen.findByRole('button', { name: 'Sign in' });

    // The cross-link between two forms went with the second form. A link
    // offering "the other sign-in" would now be a link to this same page.
    expect(screen.queryByRole('link', { name: /sign-in/i })).not.toBeInTheDocument();
  });

  test('the old portal path still resolves, rather than 404ing a bookmark', async () => {
    renderAt('/portal/login');

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/login');
    });

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The remembered destination
// ---------------------------------------------------------------------------

describe('the destination somebody was heading for', () => {
  test('a customer is carried on to the portal page they wanted', async () => {
    renderAt('/login', { from: '/portal/requests/abc' });

    await signIn();

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/portal/requests/abc');
    });

    expect(await screen.findByText('one request')).toBeInTheDocument();
  });

  test('a customer is NOT carried on to a staff route', async () => {
    // Somebody followed a staff link, was bounced to the form, and signed in as
    // a customer. Sending them on would land them on a page whose every request
    // the server refuses — which reads as broken rather than as forbidden.
    renderAt('/login', { from: '/tickets/abc' });

    await signIn();

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/portal');
    });

    expect(screen.queryByText('staff ticket')).not.toBeInTheDocument();
  });

  test('a staff member is carried on to the staff route they wanted', async () => {
    respondWith({ session: STAFF });

    renderAt('/login', { from: '/tickets/abc' });

    await signIn();

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/tickets/abc');
    });
  });
});

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

describe('states', () => {
  test('invalid credentials show the generic message and leave the form usable', async () => {
    respondWith({ status: 401, code: 'UNAUTHENTICATED' });

    renderAt('/login');

    await signIn();

    const alert = await screen.findByRole('alert');

    // Which of the two was wrong must stay indistinguishable.
    expect(alert).toHaveTextContent(/Email or password/i);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  test('a deactivated account is told that, and not that its password is wrong', async () => {
    respondWith({ status: 403, code: 'FORBIDDEN' });

    renderAt('/login');

    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent(/deactivated/i);
  });

  test('the submit button reports that it is working, and is disabled while it does', async () => {
    let release: (() => void) | undefined;

    http.defaults.adapter = (config) => {
      sent.push(config);

      return new Promise((resolve) => {
        release = () =>
          resolve({
            data: { data: CUSTOMER },
            status: 200,
            statusText: '',
            headers: {},
            config,
          } as AxiosResponse);
      });
    };

    renderAt('/login');

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

    renderAt('/login');

    await signIn();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/Email or password/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Protected routing
// ---------------------------------------------------------------------------

describe('protected routes', () => {
  test('an unauthenticated visit to a portal page goes to the one sign-in', async () => {
    renderAt('/portal');

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/login');
    });
  });

  test('an authenticated customer reaches the portal home', async () => {
    publishSession(CUSTOMER);

    renderAt('/portal');

    expect(await screen.findByText(/Hello, Nadia/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Arabic
// ---------------------------------------------------------------------------

describe('Arabic', () => {
  test('the sign-in renders in Arabic with no physical-direction classes', async () => {
    await i18n.changeLanguage('ar');

    const { container } = render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProviders>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'تسجيل الدخول' })).toBeInTheDocument();

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
