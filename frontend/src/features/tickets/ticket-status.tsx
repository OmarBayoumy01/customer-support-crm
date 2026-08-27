import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canTransition, STATUS_PERMISSION, type Ticket } from '@crm/shared';
import type { PermissionKey } from '@crm/shared';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { STATUS_PRESENTATION, TICKET_STATUSES } from '@/lib/design-tokens';
import { http } from '@/lib/api-client';
import { toastError, toastSuccess } from '@/lib/toast';
import { useAuth } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';
import { ASSIGNED_TICKET_COUNT_KEY } from './use-assigned-ticket-count';
import { ticketDetailKey } from './use-ticket-detail';

/**
 * What this control actually reads — US-55.
 *
 * Widened from `TicketDetail` so the dashboard can hand it a queue row. It only
 * ever needed the id, the status and whether a reply has gone out, and saying so
 * is more honest than requiring the whole detail payload.
 */
export interface TicketStatusControlProps {
  ticket: Pick<Ticket, 'id' | 'status'> & { sla: Pick<Ticket['sla'], 'firstRespondedAt'> };
  className?: string | undefined;
}

/**
 * Where a ticket stands, changed in place — US-47.
 *
 * **All seven statuses are listed and the invalid ones are disabled**, rather
 * than the list being filtered down to what is legal. An agent who cannot see
 * `RESOLVED` from `NEW` learns nothing; one who sees it greyed out learns the
 * shape of the lifecycle. It is the choice US-48 made for unavailable agents,
 * for the same reason.
 *
 * Legality comes from `TICKET_TRANSITIONS` in `@crm/shared` — the same map the
 * server enforces. AC2 asks for both halves, and two lists would drift into the
 * worst failure there is: the screen offering a move the server refuses.
 */
export function TicketStatusControl({
  ticket,
  className,
}: TicketStatusControlProps): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const [confirming, setConfirming] = useState(false);

  const save = useMutation({
    mutationFn: async (status: Ticket['status']) => {
      const response = await http.patch<{ data: Ticket }>(`/tickets/${ticket.id}/status`, {
        status,
      });

      return response.data.data;
    },
    onSuccess: (updated) => {
      /**
       * The SLA clock has just moved and this screen cannot predict where to.
       *
       * `PENDING_CUSTOMER` pauses the resolution clock and `RESOLVED` stops it,
       * both server-side (US-68). Invalidating rather than patching keeps one
       * implementation of that arithmetic.
       */
      void queryClient.invalidateQueries({ queryKey: ticketDetailKey(ticket.id) });
      void queryClient.invalidateQueries({ queryKey: ['tickets', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['tickets', 'counts'] });
      void queryClient.invalidateQueries({ queryKey: ASSIGNED_TICKET_COUNT_KEY });

      toastSuccess(t('ticket.statusControl.saved', { status: t(labelKeyOf(updated.status)) }));
    },
    onError: (error: unknown) => {
      toastError(error);
    },
  });

  /**
   * Whether the signed-in user holds what a destination needs.
   *
   * A convenience, not a boundary: the service checks the same thing, and this
   * exists so nobody is offered a move that will answer 403. Read through
   * `useAuth` rather than `usePermission` because the key is decided per option
   * and a hook cannot be called in a loop.
   */
  const holds = (key: string | undefined): boolean =>
    key === undefined || (permissions?.permissions[key as PermissionKey]?.length ?? 0) > 0;

  /** Why an option cannot be chosen, in words — never a silent grey row. */
  const reasonFor = (status: Ticket['status']): string | null => {
    if (status === ticket.status) {
      return t('ticket.statusControl.current');
    }

    if (!canTransition(ticket.status, status)) {
      return t('ticket.statusControl.notAllowed');
    }

    if (!holds(STATUS_PERMISSION[status])) {
      return t('ticket.statusControl.noPermission');
    }

    return null;
  };

  /**
   * AC3 — resolving a ticket nobody has replied to asks first.
   *
   * `firstRespondedAt` is null until a customer-facing agent reply goes out;
   * US-68 maintains it and excludes internal notes, so it is exactly "no agent
   * reply exists on the ticket".
   *
   * **A warning, not a refusal.** Resolving without a reply is sometimes right —
   * fixed on a phone call, or a duplicate — and a server that refused would push
   * agents into writing a hollow "as discussed" line to get past it, which is
   * the silent closure the criterion exists to prevent with a sentence stapled
   * on.
   */
  const needsConfirmation = (status: Ticket['status']): boolean =>
    status === 'RESOLVED' && ticket.sla.firstRespondedAt === null;

  const choose = (status: Ticket['status']): void => {
    if (needsConfirmation(status)) {
      setConfirming(true);

      return;
    }

    save.mutate(status);
  };

  return (
    <>
      <Select
        value={ticket.status}
        disabled={save.isPending}
        onValueChange={(value) => {
          choose(value as Ticket['status']);
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={t('ticket.queue.column.status')}
          className={cn('w-44', className)}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TICKET_STATUSES.map((status) => {
            const presentation = STATUS_PRESENTATION[status];
            const Icon = presentation.icon;
            const reason = reasonFor(status);

            return (
              <SelectItem
                key={status}
                value={status}
                // The current status stays selectable-looking so the trigger can
                // render it; every other blocked option is disabled.
                disabled={reason !== null && status !== ticket.status}
              >
                {/* Icon and text — status is never carried by colour alone. */}
                <Icon aria-hidden="true" className="size-3.5" />
                {t(presentation.labelKey)}
                {reason === null ? null : (
                  <span className="text-meta text-ink-muted ms-auto ps-2">{reason}</span>
                )}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('ticket.statusControl.confirmResolve.title')}
        description={t('ticket.statusControl.confirmResolve.description')}
        confirmLabel={t('ticket.statusControl.confirmResolve.confirm')}
        onConfirm={() => {
          save.mutate('RESOLVED');
        }}
      />
    </>
  );
}

/** The i18n key for a status label, so the toast and the option agree — AC6. */
function labelKeyOf(status: Ticket['status']): string {
  return STATUS_PRESENTATION[status].labelKey;
}
