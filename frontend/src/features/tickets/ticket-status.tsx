import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import type { Ticket } from '@crm/shared';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { StatusBadge } from '@/components/domain/indicators';
import { Button } from '@/components/ui/button';
import { STATUS_PRESENTATION } from '@/lib/design-tokens';
import { http } from '@/lib/api-client';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { ASSIGNED_TICKET_COUNT_KEY } from './use-assigned-ticket-count';
import { ticketDetailKey } from './use-ticket-detail';

/**
 * What this control actually reads.
 */
export interface TicketStatusControlProps {
  ticket: Pick<Ticket, 'id' | 'status'> & { sla: Pick<Ticket['sla'], 'firstRespondedAt'> };
  className?: string | undefined;
}

/**
 * Displays status badge and a direct Resolve action button.
 */
export function TicketStatusControl({
  ticket,
  className,
}: TicketStatusControlProps): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const save = useMutation({
    mutationFn: async (status: Ticket['status']) => {
      const response = await http.patch<{ data: Ticket }>(`/tickets/${ticket.id}/status`, {
        status,
      });

      return response.data.data;
    },
    onSuccess: (updated) => {
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
    <div className={cn('flex items-center gap-2', className)}>
      <StatusBadge status={ticket.status} />

      <Button
        variant="outline"
        size="sm"
        onClick={() => choose('RESOLVED')}
        disabled={ticket.status === 'RESOLVED' || save.isPending}
        className={cn(
          'gap-1.5 shadow-2xs text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
          ticket.status === 'RESOLVED'
            ? 'opacity-60 cursor-not-allowed bg-muted/40 text-muted-foreground border-border'
            : 'hover:bg-emerald-500/10 hover:text-emerald-800 dark:hover:text-emerald-200',
        )}
      >
        <CheckCircle2 aria-hidden="true" className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        <span>{t('ticket.statusControl.resolve')}</span>
      </Button>

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
    </div>
  );
}

/** The i18n key for a status label, so the toast and the option agree. */
function labelKeyOf(status: Ticket['status']): string {
  return STATUS_PRESENTATION[status].labelKey;
}
