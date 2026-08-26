import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { ApiErrorSchema, type ApiErrorCode } from '@crm/shared';

import { refreshSession } from './refresh-client';
import { getAccessToken, publishSession } from './session-store';

/**
 * A failed request, carrying the machine-readable code from the error envelope.
 *
 * Callers switch on `code`, never on `message`. The split is the whole point of
 * US-7's envelope: the message is for people and may be reworded freely, so a
 * UI that branches on its text breaks the first time someone improves the copy.
 */
export class ApiRequestError extends Error {
  readonly code: ApiErrorCode | 'NETWORK_ERROR';
  readonly status: number;
  readonly requestId: string | undefined;

  constructor(
    code: ApiErrorCode | 'NETWORK_ERROR',
    message: string,
    status: number,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

/**
 * The shared axios instance.
 *
 * `withCredentials` so the httpOnly refresh cookie travels with every request.
 * In development Vite proxies `/auth` to the API for the same reason — a
 * `SameSite=Strict` cookie would simply not be sent cross-origin from :5173 to
 * :3000, and login would appear to work while issuing no usable session.
 */
export const http: AxiosInstance = axios.create({
  baseURL: '/',
  withCredentials: true,
  headers: { 'content-type': 'application/json' },
  // Envelopes are small; a request that has not answered by now has failed.
  timeout: 15_000,
});

/** Attaches the bearer token, if there is one. */
http.interceptors.request.use((config) => {
  const token = getAccessToken();

  if (token !== null) {
    config.headers.set('authorization', `Bearer ${token}`);
  }

  return config;
});

/** Marks a request as already retried, so a refresh loop cannot form. */
interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

/**
 * Silent refresh — US-15, AC1 and AC4.
 *
 * On a 401, exchange the refresh cookie for a new access token and replay the
 * original request. The user sees a slightly slower request and nothing else.
 *
 * Three things keep this from misbehaving:
 *
 *   - **`_retried`** — a request is replayed at most once. Without it, a 401
 *     that refresh cannot fix becomes an infinite loop.
 *   - **`refreshSession()` is single-flight** — see `refresh-client.ts`. This
 *     matters more than it looks: refresh *rotates* the token, so a second
 *     concurrent refresh would present one the first had already retired, and
 *     the server would correctly treat that as a replay and revoke the whole
 *     session family.
 *   - **`/auth/*` is exempt** — a failed login answers 401 legitimately, and
 *     refreshing on it would be nonsense.
 */
async function attemptSilentRefresh(error: AxiosError): Promise<AxiosResponse> {
  const original = error.config as RetriableConfig | undefined;

  if (
    original === undefined ||
    original._retried === true ||
    (original.url ?? '').startsWith('/auth/')
  ) {
    throw error;
  }

  original._retried = true;

  try {
    const session = await refreshSession();

    publishSession(session);
  } catch {
    // AC5 — the refresh token is expired, revoked, or was replayed. Publishing
    // null is what returns the user to the login screen; the original 401 is
    // then reported so the caller still sees a failure rather than a hang.
    publishSession(null);
    throw error;
  }

  original.headers.set('authorization', `Bearer ${getAccessToken() ?? ''}`);

  return http.request(original);
}

/**
 * Turns anything axios rejects with into an `ApiRequestError`.
 *
 * Registered as an interceptor rather than repeated at every call site, so a
 * new feature cannot forget it and end up rendering a raw axios message at a
 * user.
 */
http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (error instanceof AxiosError && error.response?.status === 401) {
      try {
        return await attemptSilentRefresh(error);
      } catch (afterRefresh: unknown) {
        // Every way out of the refresh path lands here — the `/auth/*`
        // exemption, an already-retried request, and a refresh that failed.
        // Mapping here rather than at each `throw` is what stops a caller
        // receiving a raw AxiosError from one branch and an ApiRequestError
        // from the others.
        return rejectAsApiError(afterRefresh);
      }
    }

    return rejectAsApiError(error);
  },
);

function rejectAsApiError(error: unknown): never {
  {
    if (!(error instanceof AxiosError)) {
      throw new ApiRequestError(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Request failed',
        0,
      );
    }

    // No response at all: offline, DNS failure, timeout, connection dropped.
    // Distinct from any answer the server gave, because the UI says something
    // different about it.
    if (error.response === undefined) {
      throw new ApiRequestError('NETWORK_ERROR', error.message, 0);
    }

    const parsed = ApiErrorSchema.safeParse(error.response.data);

    if (parsed.success) {
      throw new ApiRequestError(
        parsed.data.error.code,
        parsed.data.error.message,
        error.response.status,
        parsed.data.error.requestId,
      );
    }

    // A non-2xx that is not in our envelope at all — a proxy error page, say.
    // Reported as INTERNAL_ERROR rather than guessed at.
    throw new ApiRequestError('INTERNAL_ERROR', error.message, error.response.status);
  }
}

/** Unwraps US-7's `{ data }` success envelope. */
export async function apiGet<T>(path: string): Promise<T> {
  const response = await http.get<{ data: T }>(path);

  return response.data.data;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await http.post<{ data: T }>(path, body);

  return response.data.data;
}
