import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import type { ReactNode } from 'react';

import i18n from '../i18n';
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
      queries: { retry: false, refetchOnWindowFocus: false },
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
        <AuthProvider>{children}</AuthProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
