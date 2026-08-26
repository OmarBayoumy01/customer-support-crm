import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { HealthStatusSchema, type HealthStatus } from '@crm/shared';

import { http } from '@/lib/api-client';

/**
 * The desk's own health, shown on the sign-in screen.
 *
 * Not decoration. When somebody cannot sign in, the first question is always
 * whether it is them or the platform, and without this the answer is a support
 * ticket. `/health` is `@Public()` precisely so it can be asked before anyone
 * has a token, and it reports the database and the cache separately — so this
 * distinguishes "the API is down" from "the database is down" without anyone
 * opening a terminal.
 *
 * **Fail-silent.** Every failure resolves to `undefined` and the strip renders
 * nothing. A sign-in screen that showed a red error because its own status
 * widget could not load would be worse than one that showed no widget: it would
 * tell the user their credentials were the problem when they are not.
 */
export function useServiceHealth(): UseQueryResult<HealthStatus | undefined> {
  return useQuery({
    queryKey: ['service-health'],
    queryFn: async (): Promise<HealthStatus | undefined> => {
      try {
        const response = await http.get<{ data: unknown }>('/health');

        // Parsed, not cast. Anything unexpected — a proxy error page, a stub in
        // a test — becomes `undefined` rather than a half-rendered strip.
        return HealthStatusSchema.parse(response.data.data);
      } catch {
        return undefined;
      }
    },
    // Someone staring at a sign-in screen because the platform is down wants to
    // see it come back without reloading.
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: false,
  });
}
