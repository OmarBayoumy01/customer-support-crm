import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AssignableAgent, Ticket } from '@crm/shared';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Combobox, type ComboboxOption } from '@/components/common/combobox';
import { http } from '@/lib/api-client';
import { toastError, toastSuccess } from '@/lib/toast';
import { usePermission } from '@/features/auth/use-permission';
import { cn } from '@/lib/utils';
import { ASSIGNED_TICKET_COUNT_KEY } from './use-assigned-ticket-count';
import { assigneesKey, useAssignees } from './use-assignees';
import { ticketDetailKey } from './use-ticket-detail';

/** Two letters, from whatever the name gives us. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/**
 * What this control actually reads — US-55.
 *
 * Widened from `TicketDetail` so the dashboard can hand it a queue row: the id
 * and who holds it is all it ever used.
 */
export interface TicketAssigneeProps {
  ticket: Pick<Ticket, 'id' | 'assigneeId' | 'assigneeName'>;
  className?: string | undefined;
}

/**
 * Who owns the ticket — US-48.
 *
 * Two branches, chosen by `ticket:assign`:
 *
 * - **With the permission**, a combobox listing the team, each row carrying the
 *   open ticket count that answers AC2's "so I can avoid overloading one
 *   person".
 * - **Without it**, the read-only badge that has been in the header since US-45.
 *   Not a disabled combobox: a disabled control invites a click and teaches
 *   nothing, while the badge already reads correctly.
 *
 * The gate is a convenience either way. `PATCH /tickets/:id/assignee` is guarded
 * by the same permission on the server, and the service checks the candidate
 * against the same scoped query that produced this list — because the frontend
 * is never the boundary.
 */
export function TicketAssignee({ ticket, className }: TicketAssigneeProps): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canAssign = usePermission('ticket:assign');
  const candidates = useAssignees(canAssign);

  const save = useMutation({
    mutationFn: async (assigneeId: string | null) => {
      const response = await http.patch<{ data: Ticket }>(`/tickets/${ticket.id}/assignee`, {
        assigneeId,
      });

      return response.data.data;
    },
    onSuccess: (updated) => {
      /**
       * Four keys, and each one is stale for a different reason.
       *
       * The ticket has a new owner; the queue's rows and its Unassigned tab
       * count have changed; the signed-in agent's sidebar badge changes when the
       * ticket was theirs or has become theirs; and every candidate's workload
       * count in this very picker has just moved by one.
       */
      void queryClient.invalidateQueries({ queryKey: ticketDetailKey(ticket.id) });
      void queryClient.invalidateQueries({ queryKey: ['tickets', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ASSIGNED_TICKET_COUNT_KEY });
      void queryClient.invalidateQueries({ queryKey: assigneesKey });

      toastSuccess(
        updated.assigneeName === null
          ? t('ticket.assignee.unassigned')
          : t('ticket.assignee.assigned', { name: updated.assigneeName }),
      );
    },
    onError: (error: unknown) => {
      toastError(error);
    },
  });

  // AC4 — read-only for anybody without the permission.
  if (!canAssign) {
    return (
      <Badge variant="outline" className={cn('font-normal', className)}>
        <span className="text-ink-muted">{t('ticket.queue.column.assignee')}</span>
        <span className="text-ink">{ticket.assigneeName ?? t('ticket.queue.unassigned')}</span>
      </Badge>
    );
  }

  const optionFor = (agent: AssignableAgent): ComboboxOption => ({
    value: agent.id,
    label: agent.name,
    adornment: (
      <Avatar className="me-2 size-5">
        <AvatarFallback className="text-meta">{initialsOf(agent.name)}</AvatarFallback>
      </Avatar>
    ),
    /**
     * AC2 and AC5, both as words.
     *
     * A workload is a number an agent compares against another number, which no
     * colour can carry — and the definition of done bans signalling by colour
     * alone regardless.
     */
    meta: agent.isAvailable
      ? t('ticket.assignee.openCount', { count: agent.openTicketCount })
      : t('ticket.assignee.unavailable'),
    disabled: !agent.isAvailable,
  });

  const options = (candidates.data ?? []).map(optionFor);

  /**
   * The current assignee always has a row, even when they are not a candidate.
   *
   * They may have left the caller's scope, or been deactivated and filtered out
   * of nothing — the API returns inactive users precisely so this stays true.
   * Without this, a ticket assigned to somebody unlisted would render as though
   * it were unassigned.
   */
  if (ticket.assigneeId !== null && !options.some((option) => option.value === ticket.assigneeId)) {
    options.unshift({
      value: ticket.assigneeId,
      label: ticket.assigneeName ?? t('ticket.assignee.unknown'),
      meta: t('ticket.assignee.unavailable'),
      disabled: true,
    });
  }

  return (
    <Combobox
      id={`assignee-${ticket.id}`}
      label={t('ticket.queue.column.assignee')}
      // `Combobox` clears on re-selecting the current value, which is exactly
      // AC3's unassign — one control for both directions.
      value={ticket.assigneeId}
      onChange={(assigneeId) => {
        save.mutate(assigneeId);
      }}
      options={options}
      placeholder={t('ticket.queue.unassigned')}
      disabled={save.isPending || candidates.isPending}
      className={cn('w-56', className)}
    />
  );
}
