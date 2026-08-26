import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Category, Ticket, TicketDetail, UpdateTicket } from '@crm/shared';

import { PRIORITY_PRESENTATION, TICKET_PRIORITIES } from '@/lib/design-tokens';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiGet, http } from '@/lib/api-client';
import { toastError, toastSuccess } from '@/lib/toast';
import { isRtl } from '@/i18n';
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

/** `null` cannot travel in a `<Select>` value, so absence gets a name. */
const NONE = '__none__';

export interface TicketClassificationProps {
  ticket: TicketDetail;
  className?: string | undefined;
}

/**
 * Category and priority, changed in place — US-49.
 *
 * Both live in the ticket header rather than behind an edit dialog, which is
 * US-45's AC6: what an agent needs in order to *decide* is never more than one
 * click away. Categorising a ticket is the first thing that happens to it and
 * the thing most often got wrong on the way in, so it has to be cheap to fix.
 *
 * Each control saves on change. There is no Save button because there is
 * nothing to batch — one field, one decision — and a form that needs saving is
 * a form somebody leaves half-changed.
 */
export function TicketClassification({
  ticket,
  className,
}: TicketClassificationProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const categories = useCategories();

  const nameOf = (category: Category): string =>
    isRtl(i18n.language) ? category.nameAr : category.nameEn;

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
      <Select
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
                {/* Icon and text — AC1's "consistent colours and labels", and
                    the definition of done's ban on colour alone. */}
                <Icon aria-hidden="true" className="size-3.5" />
                {t(presentation.labelKey)}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <Select
        value={ticket.categoryId ?? NONE}
        disabled={save.isPending || categories.isPending}
        onValueChange={(value) => {
          save.mutate({ categoryId: value === NONE ? null : value });
        }}
      >
        <SelectTrigger size="sm" aria-label={t('ticket.queue.column.category')} className="w-44">
          <SelectValue placeholder={t('ticket.classification.uncategorised')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('ticket.classification.uncategorised')}</SelectItem>
          {(categories.data ?? []).map((category) => (
            <SelectItem key={category.id} value={category.id}>
              {nameOf(category)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
