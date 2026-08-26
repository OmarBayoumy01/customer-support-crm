/**
 * US-15, AC1 and AC4 — silent refresh, and the single-flight guarantee.
 *
 * AC4 is not an optimisation. Refresh *rotates* the token, so a second
 * concurrent refresh presents one the first has already retired — which the
 * server correctly reads as a replay and answers by revoking the whole session
 * family. Without single-flight, a burst of expired requests logs the user out.
 */
import { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { apiGet, http } from './api-client';
import { refreshHttp, resetRefreshState } from './refresh-client';
import { getAccessToken, publishSession, resetSessionStore } from './session-store';

const realAdapter = http.defaults.adapter;

const SESSION = {
  accessToken: 'refreshed.access.token',
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

/** Requests seen by the adapter, in order, as `METHOD url`. */
let seen: string[] = [];

function unauthorised(config: Parameters<AxiosAdapter>[0]): AxiosError {
  const response: AxiosResponse = {
    data: {
      error: {
        statusCode: 401,
        code: 'UNAUTHENTICATED',
        message: 'Authentication is required.',
        requestId: 'test',
        timestamp: new Date().toISOString(),
      },
    },
    status: 401,
    statusText: '',
    headers: {},
    config,
  };

  return new AxiosError('Unauthorized', AxiosError.ERR_BAD_REQUEST, config, {}, response);
}

function ok(config: Parameters<AxiosAdapter>[0], data: unknown): AxiosResponse {
  return { data, status: 200, statusText: '', headers: {}, config };
}

/**
 * Answers 401 for protected calls until a refresh has happened, then 200.
 * `refreshDelayMs` holds the refresh open so concurrent callers pile up behind
 * it, which is the situation AC4 is about.
 */
function installAdapter(options: { refreshSucceeds: boolean; refreshDelayMs?: number }): void {
  let refreshed = false;

  const adapter: AxiosAdapter = (config) => {
    const url = config.url ?? '';
    seen.push(`${String(config.method).toUpperCase()} ${url}`);

    if (url === '/auth/refresh') {
      if (!options.refreshSucceeds) {
        return Promise.reject(unauthorised(config));
      }

      return new Promise<AxiosResponse>((resolve) => {
        setTimeout(() => {
          refreshed = true;
          resolve(ok(config, { data: SESSION }));
        }, options.refreshDelayMs ?? 0);
      });
    }

    return refreshed
      ? Promise.resolve(ok(config, { data: { fine: true } }))
      : Promise.reject(unauthorised(config));
  };

  // Both instances. `refreshHttp` is deliberately separate from `http` — it
  // must not carry the interceptor, or refreshing would try to refresh — so a
  // test that only stubbed `http` would let the real refresh call escape to the
  // network and fail for the wrong reason.
  http.defaults.adapter = adapter;
  refreshHttp.defaults.adapter = adapter;
}

beforeEach(() => {
  seen = [];
  resetRefreshState();
  resetSessionStore();
  publishSession(null);
});

afterEach(() => {
  if (realAdapter === undefined) {
    delete http.defaults.adapter;
    delete refreshHttp.defaults.adapter;
  } else {
    http.defaults.adapter = realAdapter;
    refreshHttp.defaults.adapter = realAdapter;
  }

  resetRefreshState();
  resetSessionStore();
});

describe('AC1 — silent refresh', () => {
  test('a 401 triggers a refresh and the original request is retried', async () => {
    installAdapter({ refreshSucceeds: true });

    const result = await apiGet<{ fine: boolean }>('/tickets');

    expect(result).toEqual({ fine: true });
    expect(seen).toEqual(['GET /tickets', 'POST /auth/refresh', 'GET /tickets']);
  });

  test('the new token is adopted, so later requests carry it', async () => {
    installAdapter({ refreshSucceeds: true });

    await apiGet('/tickets');

    expect(getAccessToken()).toBe(SESSION.accessToken);
  });
});

describe('AC4 — concurrent 401s cause exactly one refresh', () => {
  test('five simultaneous failures share a single refresh call', async () => {
    // The refresh is held open so all five requests are waiting on it at once —
    // the exact race a per-request refresh would lose.
    installAdapter({ refreshSucceeds: true, refreshDelayMs: 20 });

    const results = await Promise.all([
      apiGet('/a'),
      apiGet('/b'),
      apiGet('/c'),
      apiGet('/d'),
      apiGet('/e'),
    ]);

    expect(results).toHaveLength(5);

    const refreshCalls = seen.filter((entry) => entry === 'POST /auth/refresh');

    // If this is ever more than 1, the second call presents an already-rotated
    // token, the server revokes the family, and the user is signed out.
    expect(refreshCalls).toHaveLength(1);
  });

  test('all five queued requests resume with the new token', async () => {
    installAdapter({ refreshSucceeds: true, refreshDelayMs: 20 });

    const results = await Promise.all([apiGet('/a'), apiGet('/b'), apiGet('/c')]);

    for (const result of results) {
      expect(result).toEqual({ fine: true });
    }
  });
});

describe('AC5 — refresh fails', () => {
  test('the session is cleared, so the app returns the user to login', async () => {
    installAdapter({ refreshSucceeds: false });

    await expect(apiGet('/tickets')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(getAccessToken()).toBeNull();
  });

  test('a request is retried at most once, so a bad token cannot loop', async () => {
    installAdapter({ refreshSucceeds: false });

    await expect(apiGet('/tickets')).rejects.toBeDefined();

    // One original, one refresh attempt, and no second try at either.
    expect(seen).toEqual(['GET /tickets', 'POST /auth/refresh']);
  });
});

describe('the login call itself', () => {
  test('a 401 from /auth/login does not trigger a refresh', async () => {
    installAdapter({ refreshSucceeds: true });

    // Wrong credentials answer 401 legitimately. Refreshing on that would be
    // nonsense, and would hide the real error from the login form.
    await expect(
      http.post('/auth/login', { email: 'a@b.c', password: 'wrong' }),
    ).rejects.toBeDefined();

    expect(seen.filter((entry) => entry === 'POST /auth/refresh')).toHaveLength(0);
  });
});
