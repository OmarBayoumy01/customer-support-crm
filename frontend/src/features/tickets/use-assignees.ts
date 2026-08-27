import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AssignableAgent } from '@crm/shared';

import { apiGet } from '@/lib/api-client';

/** The key the assignment mutation invalidates — a workload count has just moved. */
export const assigneesKey = ['tickets', 'assignees'] as const;

/**
 * Who the signed-in user may hand a ticket to — US-48, AC2 and AC5.
 *
 * `enabled` is the caller's business: the request is guarded by `ticket:assign`
 * on the server, so firing it for somebody who lacks the permission is a
 * guaranteed 403 in the console of every agent who opens a ticket.
 *
 * Short `staleTime` rather than the five minutes categories get. The open ticket
 * counts are the point of this list, and they move every time anybody in the
 * team is assigned anything.
 */
export function useAssignees(enabled: boolean): UseQueryResult<AssignableAgent[]> {
  return useQuery({
    queryKey: assigneesKey,
    queryFn: async () => apiGet<AssignableAgent[]>('/tickets/assignees'),
    enabled,
    staleTime: 30_000,
  });
}
