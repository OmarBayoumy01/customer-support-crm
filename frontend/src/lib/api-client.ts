import axios, { AxiosError, type AxiosInstance } from 'axios';
import { ApiErrorSchema, type ApiErrorCode } from '@crm/shared';

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

/**
 * Turns anything axios rejects with into an `ApiRequestError`.
 *
 * Registered as an interceptor rather than repeated at every call site, so a
 * new feature cannot forget it and end up rendering a raw axios message at a
 * user.
 */
http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
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
  },
);

/** Unwraps US-7's `{ data }` success envelope. */
export async function apiGet<T>(path: string): Promise<T> {
  const response = await http.get<{ data: T }>(path);

  return response.data.data;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await http.post<{ data: T }>(path, body);

  return response.data.data;
}
