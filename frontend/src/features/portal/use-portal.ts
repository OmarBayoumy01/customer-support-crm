import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { PortalCategory, PortalTicketDetail, SubmitPortalTicket } from '@crm/shared';

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
