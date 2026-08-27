import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  PaginationMeta,
  PortalCategory,
  PortalTicket,
  PortalTicketDetail,
  PortalTicketListQuery,
  SubmitPortalTicket,
} from '@crm/shared';

import { apiGet, http, type ApiRequestError } from '@/lib/api-client';

/** The categories a request can be filed under — US-86, AC1. */
export function usePortalCategories(): UseQueryResult<PortalCategory[]> {
  return useQuery({
    queryKey: ['portal', 'categories'],
    queryFn: async () => apiGet<PortalCategory[]>('/portal/categories'),
    // They change rarely, and a customer filling in one form does not need them
    // refetched underneath.
    staleTime: 5 * 60_000,
  });
}

/**
 * Raise a request — US-86.
 *
 * No `customerId` anywhere in the payload, and not because it is stripped here:
 * `SubmitPortalTicket` has no such field, and the server takes the customer from
 * the token. There is nothing for a client to get wrong.
 */
export function usePortalSubmit(): UseMutationResult<
  PortalTicketDetail,
  ApiRequestError,
  SubmitPortalTicket
> {
  return useMutation<PortalTicketDetail, ApiRequestError, SubmitPortalTicket>({
    mutationFn: async (input) => {
      const response = await http.post<{ data: PortalTicketDetail }>('/portal/tickets', input);

      return response.data.data;
    },
    // No retry: a submission that may have succeeded must not be sent twice, and
    // a duplicate support request is worse for the customer than an error.
    retry: false,
  });
}

/** The key the list subscribes to, so a submission can invalidate it. */
export const PORTAL_TICKETS_KEY = ['portal', 'tickets'] as const;

/**
 * The customer's own requests — US-84.
 *
 * The filters go to the **server**, not to a browser-side pass over a page: the
 * scope and the filter are the same `where` clause, and filtering here would mean
 * searching only whatever the current page happened to contain.
 */
export function usePortalTickets(
  query: PortalTicketListQuery,
): UseQueryResult<{ data: PortalTicket[]; pagination: PaginationMeta }> {
  return useQuery({
    queryKey: [...PORTAL_TICKETS_KEY, query],
    queryFn: async () => {
      const params = new URLSearchParams();

      params.set('page', String(query.page));
      params.set('pageSize', String(query.pageSize));

      if (query.status !== undefined) params.set('status', query.status);
      if (query.q !== undefined && query.q !== '') params.set('q', query.q);
      if (query.createdFrom !== undefined) params.set('createdFrom', query.createdFrom);
      if (query.createdTo !== undefined) params.set('createdTo', query.createdTo);

      const response = await http.get<{ data: PortalTicket[]; pagination: PaginationMeta }>(
        `/portal/tickets?${params.toString()}`,
      );

      return response.data;
    },
    // A customer refreshing to see whether support has replied should not be
    // served a minute-old answer.
    staleTime: 10_000,
  });
}
