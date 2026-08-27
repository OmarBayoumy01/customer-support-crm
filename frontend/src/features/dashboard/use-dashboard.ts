import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AssignedSummary, PaginationMeta, TeamOverview, Ticket } from '@crm/shared';

import { apiGet, http } from '@/lib/api-client';

/** The key the KPI row subscribes to, so a row action can refresh it. */
export const ASSIGNED_SUMMARY_KEY = ['tickets', 'assigned', 'summary'] as const;

/** The key the dashboard's table subscribes to. */
export const MY_TICKETS_KEY = ['tickets', 'list', 'dashboard'] as const;

/**
 * The four figures the KPI row shows — US-55, AC1.
 *
 * Its own query, separate from the table's, which is what makes AC5's
 * progressive rendering fall out rather than needing arranging: neither waits for
 * the other.
 */
export function useAssignedSummary(): UseQueryResult<AssignedSummary> {
  return useQuery({
    queryKey: ASSIGNED_SUMMARY_KEY,
    queryFn: async () => apiGet<AssignedSummary>('/tickets/assigned/summary'),
    // The number an agent decides their morning by. A minute stale misleads.
    staleTime: 15_000,
  });
}

/** How many rows the dashboard's table holds before the queue is the better tool. */
export const DASHBOARD_PAGE_SIZE = 10;

/**
 * My assigned tickets, closest to breaching first — US-55, AC2 and AC3.
 *
 * **The queue's own endpoint**, with `view=mine` and `sort=sla`. AC3's default
 * sort is a query parameter rather than a second definition of urgency: the queue
 * decided what "closest to breaching" means and the dashboard inherits it.
 */
export function useMyTickets(
  sort: string,
  dir: 'asc' | 'desc',
): UseQueryResult<{ data: Ticket[]; pagination: PaginationMeta }> {
  return useQuery({
    queryKey: [...MY_TICKETS_KEY, sort, dir],
    queryFn: async () => {
      const response = await http.get<{ data: Ticket[]; pagination: PaginationMeta }>(
        `/tickets?view=mine&sort=${sort}&dir=${dir}&pageSize=${String(DASHBOARD_PAGE_SIZE)}`,
      );

      return response.data;
    },
    staleTime: 15_000,
  });
}

/** The key the manager dashboard's figures subscribe to. */
export const TEAM_OVERVIEW_KEY = ['tickets', 'team', 'overview'] as const;

/** The key its attention table subscribes to. */
export const ATTENTION_KEY = ['tickets', 'list', 'attention'] as const;

/**
 * Team workload and SLA health — US-58, AC1 and AC2.
 *
 * The department and branch are **filters** the server ANDs with the caller's own
 * scope. Passing one cannot widen what the token allows: a manager asking for
 * another department gets zeros, which is the correct answer.
 */
export function useTeamOverview(
  filters: { departmentId?: string; branchId?: string } = {},
): UseQueryResult<TeamOverview> {
  return useQuery({
    queryKey: [...TEAM_OVERVIEW_KEY, filters],
    queryFn: async () => {
      const params = new URLSearchParams();

      if (filters.departmentId !== undefined) params.set('departmentId', filters.departmentId);
      if (filters.branchId !== undefined) params.set('branchId', filters.branchId);

      const query = params.toString();

      return apiGet<TeamOverview>(`/tickets/team/overview${query === '' ? '' : `?${query}`}`);
    },
    staleTime: 30_000,
  });
}

/**
 * Tickets requiring attention — US-58, AC3.
 *
 * The queue's own list with `attention=true`, so the scope, the sort, the paging
 * and the total are the ones already tested. AC5's filters go to the same
 * endpoint, which is how one filter row governs the table as well as the figures.
 */
export function useAttentionTickets(
  filters: { departmentId?: string; branchId?: string } = {},
): UseQueryResult<{ data: Ticket[]; pagination: PaginationMeta }> {
  return useQuery({
    queryKey: [...ATTENTION_KEY, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        attention: 'true',
        sort: 'sla',
        dir: 'asc',
        pageSize: '10',
      });

      if (filters.departmentId !== undefined) params.set('departmentId', filters.departmentId);
      if (filters.branchId !== undefined) params.set('branchId', filters.branchId);

      const response = await http.get<{ data: Ticket[]; pagination: PaginationMeta }>(
        `/tickets?${params.toString()}`,
      );

      return response.data;
    },
    staleTime: 15_000,
  });
}
