import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { LoginResponseSchema, type LoginRequest, type LoginResponse } from '@crm/shared';

import { apiPost, type ApiRequestError } from '../../lib/api-client';
import { useAuth } from './auth-context';

/** Where a signed-in staff member lands. AC1's "and land on the dashboard". */
export const AFTER_LOGIN_PATH = '/dashboard';

async function postLogin(credentials: LoginRequest): Promise<LoginResponse> {
  const payload = await apiPost<unknown>('/auth/login', credentials);

  // Parsed, not cast. The server is the authority on this shape, and a silent
  // mismatch here would surface later as an undefined somewhere unrelated.
  return LoginResponseSchema.parse(payload);
}

export function useLogin(): UseMutationResult<LoginResponse, ApiRequestError, LoginRequest> {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  return useMutation<LoginResponse, ApiRequestError, LoginRequest>({
    mutationFn: postLogin,
    onSuccess: (response) => {
      signIn(response);
      // `replace`, so the back button does not return to a login form the user
      // has already used.
      void navigate(AFTER_LOGIN_PATH, { replace: true });
    },
    // No retry. A 401 is an answer, not a failure to get one, and retrying
    // wrong credentials walks the account straight into AC5's lockout.
    retry: false,
  });
}
