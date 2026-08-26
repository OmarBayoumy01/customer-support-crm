import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { Customer, PaginationMeta, Ticket, TicketDetail, TicketMessage } from '@crm/shared';

import { apiGet, http } from '@/lib/api-client';

/** The key a mutation invalidates to refresh one ticket. */
export const ticketDetailKey = (id: string): readonly unknown[] => ['tickets', 'detail', id];

/**
 * One ticket, with everything the workspace needs — US-40's AC3 paying off.
 *
 * Ticket, customer, messages, attachments, history and SLA in a single
 * response, so the screen renders in one round trip instead of five spinners on
 * the same page.
 */
export function useTicketDetail(id: string): UseQueryResult<TicketDetail> {
  return useQuery({
    queryKey: ticketDetailKey(id),
    queryFn: async () => apiGet<TicketDetail>(`/tickets/${id}`),
    // Short: an agent works a ticket while a colleague may be changing it, and
    // a stale header is how two people overwrite each other.
    staleTime: 5_000,
  });
}

/**
 * Older messages, a page at a time — US-46, AC5.
 *
 * `useInfiniteQuery` rather than a growing list in component state, because the
 * pages have to survive a refetch of the ticket: an agent who has scrolled back
 * through three weeks of a thread should not lose their place because the
 * detail query revalidated.
 *
 * Page 1 is the slice the detail already showed, so paging starts at 2.
 */
export function useEarlierMessages(
  ticketId: string,
  pageSize: number,
): UseInfiniteQueryResult<InfiniteData<TicketMessage[]>> {
  return useInfiniteQuery({
    queryKey: ['tickets', 'messages', ticketId],
    initialPageParam: 2,
    queryFn: async ({ pageParam }): Promise<TicketMessage[]> => {
      const response = await http.get<{ data: TicketMessage[]; pagination: PaginationMeta }>(
        `/tickets/${ticketId}/messages?page=${String(pageParam)}&pageSize=${String(pageSize)}`,
      );

      return response.data.data;
    },
    getNextPageParam: (last, all) => (last.length < pageSize ? undefined : all.length + 2),
    // Only fetched when somebody asks for it.
    enabled: false,
  });
}

/**
 * The customer behind the ticket — US-45, AC4.
 *
 * A second request, deliberately. The ticket payload carries only enough of a
 * customer to render a row (name, email, company); the context panel wants
 * contact details, VIP standing, notes and lifetime stats, and putting all of
 * that on every row of the queue would be a payload nobody reads.
 */
export function useCustomer(id: string | undefined): UseQueryResult<Customer> {
  return useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: async () => apiGet<Customer>(`/customers/${id ?? ''}`),
    enabled: id !== undefined,
    staleTime: 60_000,
  });
}

/**
 * What else this customer has raised — AC4's "recent tickets".
 *
 * Excludes the ticket being read: it is already on the screen, and a "recent
 * tickets" list whose first entry is the one you are looking at wastes the
 * three rows the panel has.
 */
export function useCustomerTickets(
  customerId: string | undefined,
  excludeTicketId: string,
): UseQueryResult<Ticket[]> {
  return useQuery({
    queryKey: ['tickets', 'byCustomer', customerId],
    queryFn: async () => {
      const response = await http.get<{ data: Ticket[]; pagination: PaginationMeta }>(
        `/tickets?customerId=${customerId ?? ''}&pageSize=6&sort=updatedAt&dir=desc`,
      );

      return response.data.data.filter((ticket) => ticket.id !== excludeTicketId).slice(0, 5);
    },
    enabled: customerId !== undefined,
    staleTime: 30_000,
  });
}
