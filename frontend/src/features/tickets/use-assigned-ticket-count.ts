import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';

export interface AssignedTicketCount {
  /** Tickets currently assigned to the signed-in agent. */
  total: number;
  /** How many of those are inside their SLA warning window or already breached. */
  atRisk: number;
}

/**
 * The key the sidebar badge subscribes to — US-28, AC5.
 *
 * Exported so that whatever changes an assignment can invalidate it:
 *
 *   queryClient.invalidateQueries({ queryKey: ASSIGNED_TICKET_COUNT_KEY })
 *
 * That is the whole mechanism behind "updates without a full page reload", and
 * naming the key here rather than inlining it is what stops the invalidating
 * code and the subscribing component drifting apart.
 */
export const ASSIGNED_TICKET_COUNT_KEY = ['tickets', 'assigned', 'count'] as const;

/**
 * How many tickets are on the signed-in agent's plate.
 *
 * `GET /tickets/assigned/count` landed with US-42, so this is now real. The
 * failure path is unchanged and still deliberate: a failure resolves to
 * `undefined` and the badge does not render, because a sidebar showing `0`
 * because nothing answered is worse than one showing nothing at all.
 */
export function useAssignedTicketCount(): UseQueryResult<AssignedTicketCount | undefined> {
  return useQuery({
    queryKey: ASSIGNED_TICKET_COUNT_KEY,
    queryFn: async (): Promise<AssignedTicketCount | undefined> => {
      try {
        return await apiGet<AssignedTicketCount>('/tickets/assigned/count');
      } catch {
        return undefined;
      }
    },
    // A queue count that is a minute stale misleads in a way a list does not:
    // it is the number an agent decides what to do next by.
    staleTime: 15_000,
  });
}
