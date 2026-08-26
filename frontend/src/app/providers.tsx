import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import type { ReactNode } from 'react';

import i18n from '../i18n';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '../features/auth/auth-context';

/**
 * Built once per app, or per test.
 *
 * Retries are off. A 401 is an answer, not a failed attempt to get one, and
 * retrying it three times both delays the error the user is waiting for and
 * pushes the account towards AC5's lockout.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * Thirty seconds — US-25, AC3.
         *
         * Long enough that moving between two screens does not refetch the
         * same list twice, short enough that an agent who assigns a ticket and
         * goes back to the queue sees it moved. A helpdesk is collaborative:
         * the data genuinely does change under you, so caching for minutes
         * would show colleagues' work late.
         */
        staleTime: 30_000,

        /**
         * Retry only what a retry could fix.
         *
         * A 401, 403, 404 or 422 is an answer, not a failed attempt to get
         * one, and repeating it delays the error the user is waiting for.
         * Blanket `retry: 3` is also how a wrong password walks an account
         * into US-14's lockout.
         */
        retry: (failureCount, error: unknown) => {
          const status = (error as { status?: number } | null)?.status ?? 0;

          if (status >= 400 && status < 500) {
            return false;
          }

          return failureCount < 2;
        },

        // An agent alt-tabs constantly. Refetching on every return is noise.
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

/**
 * Everything the tree needs, in one place, so a test can mount the same stack
 * the application does. `AuthProvider` is innermost because the router and the
 * query client do not depend on it, and it does not depend on them.
 */
export function AppProviders({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}): React.JSX.Element {
  const client = queryClient ?? createQueryClient();

  return (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <AuthProvider>
          {children}
          {/* One host for the whole app — US-32. */}
          <Toaster />
        </AuthProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
