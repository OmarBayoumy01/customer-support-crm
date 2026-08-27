import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { LoginResponseSchema, type LoginRequest, type LoginResponse } from '@crm/shared';

import { apiPost, type ApiRequestError } from '../../lib/api-client';
import { useAuth } from './auth-context';

/** Where a signed-in staff member lands. AC1's "and land on the dashboard". */
export const AFTER_LOGIN_PATH = '/dashboard';

/** Where a signed-in customer lands — US-21, AC1: "never on the staff dashboard". */
export const AFTER_PORTAL_LOGIN_PATH = '/portal';

/**
 * One login form, and the server says where you belong.
 *
 * There used to be two endpoints, because the audience a token gets is decided
 * by which one was called. That is still true of the *token*, but it is now
 * decided from the account rather than from the URL: a person types their email
 * and password once and the response's `audience` says which application they
 * have signed in to.
 *
 * So there is nothing for the client to choose here — no variant, no parameter,
 * and no way to ask for the other application. The landing path is read off the
 * answer.
 */
async function postLogin(credentials: LoginRequest): Promise<LoginResponse> {
  const payload = await apiPost<unknown>('/auth/login', credentials);

  // Parsed, not cast. The server is the authority on this shape, and a silent
  // mismatch here would surface later as an undefined somewhere unrelated.
  return LoginResponseSchema.parse(payload);
}

export function useLogin(): UseMutationResult<LoginResponse, ApiRequestError, LoginRequest> {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * Where the user was heading before they were sent to sign in — US-23, AC1.
   *
   * `RequireAuth` puts it in the route state. Someone who followed a link to a
   * ticket and got a login screen expects to arrive at that ticket, not at a
   * dashboard from which they have to find it again.
   */
  const intended = (location.state as { from?: string } | null)?.from;

  return useMutation<LoginResponse, ApiRequestError, LoginRequest>({
    mutationFn: postLogin,
    onSuccess: (response) => {
      signIn(response);

      const landing =
        response.audience === 'crm-portal' ? AFTER_PORTAL_LOGIN_PATH : AFTER_LOGIN_PATH;

      /**
       * The remembered destination still wins — but only if it belongs to the
       * application this account signed in to.
       *
       * A customer who followed a staff link, was bounced to the form, and
       * signed in must not be sent on to a staff route that will refuse them:
       * the server would answer 401 and the screen would read as broken. Staff
       * are not restricted the other way, because every staff account may open
       * the portal's own pages — it has none they can reach.
       */
      const honourIntended =
        intended !== undefined &&
        (response.audience !== 'crm-portal' || intended.startsWith('/portal'));

      // `replace`, so the back button does not return to a login form the user
      // has already used.
      void navigate(honourIntended ? intended : landing, { replace: true });
    },
    // No retry. A 401 is an answer, not a failure to get one, and retrying
    // wrong credentials walks the account straight into AC5's lockout.
    retry: false,
  });
}
