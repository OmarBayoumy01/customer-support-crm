import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Category, Ticket, TicketDetail, UpdateTicket } from '@crm/shared';

import { PRIORITY_PRESENTATION, TICKET_PRIORITIES } from '@/lib/design-tokens';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiGet, http } from '@/lib/api-client';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { ticketDetailKey } from './use-ticket-detail';

/** The picker's options — US-49, AC3. Cached hard: categories change rarely. */
export function useCategories(): UseQueryResult<Category[]> {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => apiGet<Category[]>('/categories'),
    staleTime: 5 * 60_000,
  });
}

export interface TicketClassificationProps {
  ticket: TicketDetail;
  className?: string | undefined;
}

/**
 * Priority, changed in place by managers.
 */
export function TicketClassification({
  ticket,
  className,
}: TicketClassificationProps): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const categories = useCategories();

  const save = useMutation({
    mutationFn: async (patch: UpdateTicket) => {
      const response = await http.patch<{ data: Ticket }>(`/tickets/${ticket.id}`, patch);

      return response.data.data;
    },
    onSuccess: (updated, patch) => {
      /**
       * AC2 — the deadlines the agent is looking at have just moved.
       *
       * A priority change re-resolves the SLA policy server-side (US-68), so
       * the header's countdown is stale the instant this returns. Invalidating
       * rather than patching the cache is the honest option: the server decided
       * what the new deadline is, and guessing it here would be a second
       * implementation of the clock.
       */
      void queryClient.invalidateQueries({ queryKey: ticketDetailKey(ticket.id) });
      void queryClient.invalidateQueries({ queryKey: ['tickets', 'list'] });

      /**
       * AC4 — "I am told the ticket will route accordingly".
       *
       * Only when the department actually moved. A category with no department
       * mapped changes nothing about routing, and saying it did would teach
       * people to ignore the message.
       */
      if (patch.categoryId !== undefined && updated.departmentId !== ticket.departmentId) {
        const department = categories.data?.find(
          (candidate) => candidate.id === patch.categoryId,
        )?.departmentName;

        toastSuccess(
          department == null
            ? t('ticket.classification.saved')
            : t('ticket.classification.routed', { department }),
        );

        return;
      }

      toastSuccess(t('ticket.classification.saved'));
    },
    onError: (error: unknown) => {
      toastError(error);
    },
  });

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {/* <Select
        value={ticket.priority}
        disabled={save.isPending}
        onValueChange={(value) => {
          save.mutate({ priority: value as Ticket['priority'] });
        }}
      >
        <SelectTrigger size="sm" aria-label={t('ticket.queue.column.priority')} className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TICKET_PRIORITIES.map((priority) => {
            const presentation = PRIORITY_PRESENTATION[priority];
            const Icon = presentation.icon;

            return (
              <SelectItem key={priority} value={priority}>
                <Icon aria-hidden="true" className="size-3.5" />
                {t(presentation.labelKey)}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select> */}

      {ticket.categoryName ? (
        <Badge variant="outline" className="font-normal text-xs text-muted-foreground">
          {ticket.categoryName}
        </Badge>
      ) : null}
    </div>
  );
}
