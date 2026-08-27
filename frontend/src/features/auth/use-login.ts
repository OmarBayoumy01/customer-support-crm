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
 * Which sign-in this is — US-21.
 *
 * The audience a token gets is decided by **which endpoint is called**, never by
 * a field in the body, so the variant picks the path rather than a parameter.
 */
export type LoginVariant = 'staff' | 'portal';

const ENDPOINTS: Record<LoginVariant, string> = {
  staff: '/auth/login',
  portal: '/auth/portal/login',
};

const LANDING: Record<LoginVariant, string> = {
  staff: AFTER_LOGIN_PATH,
  portal: AFTER_PORTAL_LOGIN_PATH,
};

async function postLogin(credentials: LoginRequest, variant: LoginVariant): Promise<LoginResponse> {
  const payload = await apiPost<unknown>(ENDPOINTS[variant], credentials);

  // Parsed, not cast. The server is the authority on this shape, and a silent
  // mismatch here would surface later as an undefined somewhere unrelated.
  return LoginResponseSchema.parse(payload);
}

export function useLogin(
  variant: LoginVariant = 'staff',
): UseMutationResult<LoginResponse, ApiRequestError, LoginRequest> {
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
    mutationFn: async (credentials) => postLogin(credentials, variant),
    onSuccess: (response) => {
      signIn(response);
      // `replace`, so the back button does not return to a login form the user
      // has already used.
      // AC4 needs no code of its own: the preserved destination already wins
      // over the landing page, for the portal exactly as for staff.
      void navigate(intended ?? LANDING[variant], { replace: true });
    },
    // No retry. A 401 is an answer, not a failure to get one, and retrying
    // wrong credentials walks the account straight into AC5's lockout.
    retry: false,
  });
}
