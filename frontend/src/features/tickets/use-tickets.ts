import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { PaginationMeta, Ticket, TicketCounts } from '@crm/shared';

import { apiGet } from '@/lib/api-client';
import { http } from '@/lib/api-client';

/** The root every ticket query hangs off, so one invalidation refreshes them all. */
export const TICKETS_KEY = ['tickets'] as const;

export const TICKET_COUNTS_KEY = ['tickets', 'counts'] as const;

export interface TicketPage {
  tickets: Ticket[];
  pagination: PaginationMeta;
}

/**
 * A page of the queue — US-42.
 *
 * The query string is passed through verbatim rather than reassembled from
 * parsed pieces. `useTableQueryState` already holds the URL as the single copy
 * of the view (US-30, AC1), so re-deriving it here would create a second copy
 * that can disagree with the address bar.
 *
 * `keepPreviousData` is what stops the table blanking on every keystroke and
 * page change. A list that flashes empty between two populated states reads as
 * a failure, and an agent scanning a queue loses their place.
 */
export function useTicketList(search: string): UseQueryResult<TicketPage> {
  return useQuery({
    queryKey: [...TICKETS_KEY, 'list', search],
    queryFn: async (): Promise<TicketPage> => {
      const response = await http.get<{ data: Ticket[]; pagination: PaginationMeta }>(
        `/tickets${search}`,
      );

      return { tickets: response.data.data, pagination: response.data.pagination };
    },
    placeholderData: keepPreviousData,
    // A queue is read to decide what to do next, so a minute-old count is
    // actively misleading. Short enough to feel live, long enough that
    // switching tabs is not six requests.
    staleTime: 10_000,
  });
}

/**
 * AC4 — the live count on each view tab.
 *
 * One request for all six. Six list requests with `pageSize=1` would give the
 * same numbers and cost six round trips to render a tab row.
 */
export function useTicketCounts(): UseQueryResult<TicketCounts> {
  return useQuery({
    queryKey: TICKET_COUNTS_KEY,
    queryFn: async () => apiGet<TicketCounts>('/tickets/counts'),
    staleTime: 10_000,
  });
}
