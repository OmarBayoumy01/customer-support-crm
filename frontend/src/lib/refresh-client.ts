import axios from 'axios';
import { LoginResponseSchema, type LoginResponse } from '@crm/shared';

/**
 * The refresh call, and the promise that makes it happen only once — US-15.
 *
 * **AC4 is the whole reason this is a module and not three lines in an
 * interceptor.** When an access token expires, every request in flight fails
 * with 401 at roughly the same moment. Refreshing per failure would fire five
 * refreshes for five requests — and because US-15 rotates the token, the second
 * one through would be presenting a token the first had already retired, which
 * the server correctly reads as a replay and answers by revoking the entire
 * session family. Naive per-request refresh does not just waste calls; it logs
 * the user out.
 *
 * So: one in-flight refresh, shared. Everyone else awaits the same promise.
 */
let inFlight: Promise<LoginResponse> | null = null;

/**
 * A bare axios instance, deliberately not the one with the interceptor on it.
 *
 * If the refresh call went through the interceptor and itself answered 401, it
 * would try to refresh in order to refresh, forever.
 */
export const refreshHttp = axios.create({ baseURL: '/', withCredentials: true });

export function refreshSession(): Promise<LoginResponse> {
  inFlight ??= refreshHttp
    .post<{ data: unknown }>('/auth/refresh')
    .then((response) => LoginResponseSchema.parse(response.data.data))
    .finally(() => {
      // Cleared whether it resolved or rejected, so the *next* 401 starts a
      // fresh attempt rather than replaying a settled failure forever.
      inFlight = null;
    });

  return inFlight;
}

/** Test seam. Nothing in the application should need this. */
export function resetRefreshState(): void {
  inFlight = null;
}
