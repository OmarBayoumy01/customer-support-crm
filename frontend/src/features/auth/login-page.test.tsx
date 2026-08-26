/**
 * US-14 from the browser side.
 *
 * AC1 (lands on the dashboard), AC2 (one generic message), AC3 (deactivated
 * account), AC5 (throttled), plus the loading/empty/error states and the Arabic
 * mirror that the definition of done requires of anything with a UI.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import i18n from '../../i18n';
import { AppProviders } from '../../app/providers';
import { http } from '../../lib/api-client';
import { LoginPage } from './login-page';

const VALID_EMAIL = 'agent@crm.local';
const VALID_PASSWORD = 'DevPassw0rd!';

const realAdapter = http.defaults.adapter;

/** Every request the component made, so a test can assert what was sent. */
let sent: InternalAxiosRequestConfig[] = [];

/**
 * Login requests only.
 *
 * The screen also asks `/health` for the platform-status strip, through the
 * same client — so 'nothing was sent' would be false even when no sign-in was
 * attempted. These assertions are about the sign-in.
 */
const loginCalls = (): InternalAxiosRequestConfig[] => sent.filter((r) => r.url === '/auth/login');

function respondWith(status: number, data: unknown): void {
  const adapter: AxiosAdapter = (config) => {
    sent.push(config);

    const response: AxiosResponse = {
      data,
      status,
      statusText: '',
      headers: {},
      config,
    };

    if (status >= 200 && status < 300) {
      return Promise.resolve(response);
    }

    // What axios itself does for a non-2xx, so the interceptor under test sees
    // exactly the shape it sees in the browser.
    return Promise.reject(
      new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, {}, response),
    );
  };

  http.defaults.adapter = adapter;
}

/** No response at all — offline, DNS failure, dropped connection. */
function respondWithNetworkFailure(): void {
  http.defaults.adapter = (config) => {
    sent.push(config);

    return Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {}));
  };
}

/** The API's `{ error }` envelope. */
function errorEnvelope(status: number, code: string, message: string): unknown {
  return {
    error: {
      statusCode: status,
      code,
      message,
      requestId: 'test-request-id',
      timestamp: new Date().toISOString(),
    },
  };
}

const USER_ID = '01923456-89ab-7cde-8f01-234567890abc';

/** The API's `{ data }` envelope for a successful login. */
const SUCCESS_ENVELOPE = {
  data: {
    accessToken: 'a.test.token',
    expiresIn: 900,
    user: {
      id: USER_ID,
      email: VALID_EMAIL,
      firstName: 'Aisha',
      lastName: 'Haddad',
      locale: 'EN',
      roles: ['agent'],
    },
    permissions: {
      userId: USER_ID,
      roles: ['agent'],
      permissions: { 'ticket:view': ['ASSIGNED'] },
    },
  },
};

function renderLogin(): void {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AppProviders>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<div>dashboard reached</div>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

async function submit(email = VALID_EMAIL, password = VALID_PASSWORD): Promise<void> {
  const user = userEvent.setup();

  await user.type(screen.getByLabelText(/email|البريد/i, { selector: 'input' }), email);
  await user.type(screen.getByLabelText(/password|كلمة المرور/i, { selector: 'input' }), password);
  await user.click(screen.getByRole('button', { name: /sign in|تسجيل الدخول/i }));
}

beforeEach(async () => {
  sent = [];
  await i18n.changeLanguage('en');
});

afterEach(() => {
  // `exactOptionalPropertyTypes` is on, so assigning a possibly-undefined value
  // back is an error — delete the override instead and let axios fall back to
  // its own default, which is what an unset adapter means anyway.
  if (realAdapter === undefined) {
    delete http.defaults.adapter;
  } else {
    http.defaults.adapter = realAdapter;
  }

  vi.restoreAllMocks();
});

describe('the form itself', () => {
  test('renders labelled email and password fields', () => {
    renderLogin();

    // Found by label, which is also the assertion that they *have* labels —
    // keyboard and screen-reader access is in the definition of done.
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  test('an empty submit shows validation and never calls the API', async () => {
    respondWith(200, SUCCESS_ENVELOPE);
    renderLogin();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(loginCalls()).toHaveLength(0);
  });

  test('a malformed email is caught before the request', async () => {
    respondWith(200, SUCCESS_ENVELOPE);
    renderLogin();

    await submit('not-an-email', VALID_PASSWORD);

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(loginCalls()).toHaveLength(0);
  });
});

describe('AC1 — successful login', () => {
  test('lands on the dashboard', async () => {
    respondWith(200, SUCCESS_ENVELOPE);
    renderLogin();

    await submit();

    expect(await screen.findByText('dashboard reached')).toBeInTheDocument();
  });

  test('posts the credentials to /auth/login with the cookie included', async () => {
    respondWith(200, SUCCESS_ENVELOPE);
    renderLogin();

    await submit();

    await waitFor(() => {
      expect(loginCalls()).toHaveLength(1);
    });

    const request = loginCalls()[0];
    expect(request?.url).toBe('/auth/login');
    expect(request?.method).toBe('post');
    // Without this the httpOnly refresh cookie is never stored.
    expect(request?.withCredentials).toBe(true);
  });

  test('the email is normalised before it leaves the browser', async () => {
    respondWith(200, SUCCESS_ENVELOPE);
    renderLogin();

    await submit('  AGENT@CRM.LOCAL  ', VALID_PASSWORD);

    await waitFor(() => {
      expect(loginCalls()).toHaveLength(1);
    });

    // The same shared schema normalises on the server, and the brute-force
    // counter is keyed on the normalised value — so both sides must agree.
    expect(JSON.parse(String(loginCalls()[0]?.data))).toMatchObject({ email: VALID_EMAIL });
  });
});

describe('error states', () => {
  test('AC2 — a 401 shows one generic message that names neither the email nor which half was wrong', async () => {
    respondWith(401, errorEnvelope(401, 'UNAUTHENTICATED', 'Email or password is incorrect.'));
    renderLogin();

    await submit();

    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent('Email or password is incorrect.');
    // The UI must not leak what the API was careful not to.
    expect(alert).not.toHaveTextContent(VALID_EMAIL);
    expect(alert.textContent ?? '').not.toMatch(/no such|unknown|not found/i);
  });

  test('AC3 — a 403 tells the user to contact an administrator', async () => {
    respondWith(403, errorEnvelope(403, 'FORBIDDEN', 'This account has been deactivated.'));
    renderLogin();

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/contact an administrator/i);
  });

  test('AC5 — a 429 says to wait rather than repeating the credentials error', async () => {
    respondWith(429, errorEnvelope(429, 'RATE_LIMITED', 'Too many sign-in attempts.'));
    renderLogin();

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many sign-in attempts/i);
  });

  test('a network failure is reported as such, not as bad credentials', async () => {
    respondWithNetworkFailure();
    renderLogin();

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
  });

  test('the message is chosen by code, not by the text the server sent', async () => {
    // Same code, different wording — the UI must render its own copy, so that
    // rewording a server message never breaks or changes the client.
    respondWith(
      401,
      errorEnvelope(401, 'UNAUTHENTICATED', 'some completely different server wording'),
    );
    renderLogin();

    await submit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Email or password is incorrect.');
    expect(alert).not.toHaveTextContent('completely different');
  });

  test('a non-2xx that is not in our envelope does not crash the form', async () => {
    // A proxy error page, say. Reported as something went wrong rather than
    // guessed at.
    respondWith(502, '<html>Bad Gateway</html>');
    renderLogin();

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });
});

describe('loading state', () => {
  test('the submit control is disabled and aria-busy while the request is in flight', async () => {
    // Never settles, so the pending state stays observable.
    http.defaults.adapter = () => new Promise<AxiosResponse>(() => undefined);

    renderLogin();
    await submit();

    const button = screen.getByRole('button', { name: /signing in/i });

    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Arabic RTL', () => {
  test('switching language mirrors the document and renders the Arabic strings', async () => {
    renderLogin();

    expect(document.documentElement.dir).toBe('ltr');

    await userEvent.setup().click(screen.getByRole('button', { name: 'العربية' }));

    await waitFor(() => {
      expect(document.documentElement.dir).toBe('rtl');
    });
    expect(document.documentElement.lang).toBe('ar');
    expect(screen.getByLabelText('البريد الإلكتروني')).toBeInTheDocument();
    expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument();
  });

  test('validation messages are translated too', async () => {
    await i18n.changeLanguage('ar');
    renderLogin();

    await userEvent.setup().click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    // The rules come from the shared schema; only the wording is localised.
    expect(await screen.findByText('البريد الإلكتروني مطلوب')).toBeInTheDocument();
  });

  test('no component positions anything with a physical direction', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProviders>
          <LoginPage />
        </AppProviders>
      </MemoryRouter>,
    );

    const classNames = [...container.querySelectorAll('*')]
      .map((element) => element.getAttribute('class') ?? '')
      .join(' ');

    // `ml-`, `mr-`, `pl-`, `pr-`, `text-left`, `text-right` all break the
    // Arabic mirror. The logical equivalents (`ms-`, `me-`, `ps-`, `pe-`,
    // `text-start`, `text-end`) do not.
    expect(classNames).not.toMatch(/\b(ml|mr|pl|pr)-/);
    expect(classNames).not.toMatch(/\btext-(left|right)\b/);
    expect(classNames).not.toMatch(/\b(left|right)-\d/);
  });
});

describe('the password field', () => {
  test('the reveal toggles the field between hidden and visible', async () => {
    respondWith(200, SUCCESS_ENVELOPE);
    renderLogin();

    const field = screen.getByLabelText('Password', { selector: 'input' });
    expect(field).toHaveAttribute('type', 'password');

    const reveal = screen.getByRole('button', { name: 'Show password' });
    expect(reveal).toHaveAttribute('aria-pressed', 'false');

    await userEvent.setup().click(reveal);

    // On a shared support floor, being able to check what you typed without it
    // staying on screen is the point.
    expect(field).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('the reveal is a button, so it never submits the form', () => {
    respondWith(200, SUCCESS_ENVELOPE);
    renderLogin();

    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('type', 'button');
  });

  test('Caps Lock is warned about, since it is the usual cause of a password that should work', async () => {
    respondWith(200, SUCCESS_ENVELOPE);
    renderLogin();

    const field = screen.getByLabelText('Password', { selector: 'input' });

    expect(screen.queryByText('Caps Lock is on')).not.toBeInTheDocument();

    await userEvent.setup({ document }).type(field, '{CapsLock}a');

    expect(await screen.findByText('Caps Lock is on')).toBeInTheDocument();
    // Described by it, so a screen reader hears the warning with the field.
    expect(field.getAttribute('aria-describedby')).toContain('caps-warning');
  });
});

describe('the platform status strip', () => {
  test('renders nothing when the API cannot be reached', async () => {
    // Absence is not a claim. A red "unreachable" badge here would tell someone
    // their password was the problem when it was not.
    respondWithNetworkFailure();
    renderLogin();

    await waitFor(() => {
      expect(screen.queryByText('Platform status')).not.toBeInTheDocument();
    });
  });
});
