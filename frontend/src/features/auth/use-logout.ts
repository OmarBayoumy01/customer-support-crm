import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { http } from '../../lib/api-client';
import { useAuth } from './auth-context';

/**
 * Signing out — US-16, AC1.
 *
 * The local state is cleared **whether or not the server call succeeds**. A
 * user who clicked Logout has decided; leaving them signed in because the
 * network was down would be both surprising and, on a shared machine, exactly
 * the situation they were trying to avoid. The server-side revocation is what
 * makes it real, and an unreachable server means the tokens expire on their own
 * within fifteen minutes.
 *
 * `everywhere` reaches for `/auth/logout-all` (AC3) — the one to use after
 * losing a device.
 */
export function useLogout(): UseMutationResult<void, Error, { everywhere?: boolean } | void> {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation<void, Error, { everywhere?: boolean } | void>({
    mutationFn: async (options) => {
      const path =
        options !== undefined && options.everywhere === true ? '/auth/logout-all' : '/auth/logout';

      await http.post(path);
    },
    retry: false,
    onSettled: () => {
      signOut();

      /**
       * Everything the last session fetched, thrown away.
       *
       * The cache is a module-level store that outlives a sign-out, so
       * without this the next person to sign in on this tab is shown the
       * previous one's tickets, numbers and names until each query happens to
       * refetch. On a shared machine that is a data leak, and it is the thing
       * that reads as "the app remembered the old user".
       *
       * `clear` rather than `invalidateQueries`: invalidating keeps the data
       * and marks it stale, which still renders it once while the refetch is
       * in flight.
       */
      queryClient.clear();

      void navigate('/login', { replace: true });
    },
  });
}
