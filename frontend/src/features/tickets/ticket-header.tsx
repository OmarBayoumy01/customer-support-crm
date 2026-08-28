import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TicketDetail } from '@crm/shared';

import { PriorityBadge } from '@/components/domain/indicators';
import { SlaTimer } from '@/components/domain/sla-timer';
import { DeleteTicketDialog } from '@/components/domain/delete-ticket-dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-context';
import { usePermission } from '@/features/auth/use-permission';
import { cn } from '@/lib/utils';
import { TicketAssignee } from './ticket-assignee';
import { TicketStatusControl } from './ticket-status';
import { TicketClassification } from './ticket-classification';
import { useDeleteTicket } from './use-ticket-detail';

export interface TicketHeaderProps {
  ticket: TicketDetail;
  className?: string | undefined;
}

/**
 * The ticket header — US-45, AC1, AC2 and AC6.
 */
export function TicketHeader({ ticket, className }: TicketHeaderProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const canDelete = usePermission('ticket:delete');
  const deleteTicket = useDeleteTicket(ticket.id, ticket.number);

  const { permissions } = useAuth();
  const isAgentOnly =
    permissions?.roles.includes('agent') &&
    !permissions?.roles.includes('administrator') &&
    !permissions?.roles.includes('manager');
  const isReadOnly = isAgentOnly || ticket.status === 'RESOLVED';

  const metadata: { label: string; value: string }[] = [
    {
      label: t('ticket.detail.meta.channel'),
      value: t(`ticket.channel.${ticket.channel.toLowerCase()}`),
    },
    {
      label: t('ticket.detail.meta.created'),
      value: new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(ticket.createdAt)),
    },
  ];

  return (
    <Card className={cn('overflow-hidden rounded-xl border bg-card/80 p-0 shadow-xs', className)}>
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                #{ticket.number}
              </span>
              {ticket.slaPolicyName ? (
                <Badge variant="secondary" className="font-normal text-xs gap-1">
                  <ShieldCheck aria-hidden="true" className="size-3 text-muted-foreground" />
                  <span>{ticket.slaPolicyName}</span>
                </Badge>
              ) : null}
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {ticket.subject}
            </h1>
          </div>

          {/* Inline Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            <TicketStatusControl ticket={ticket} />
            {isReadOnly ? (
              <>
                <PriorityBadge priority={ticket.priority} />
                {ticket.categoryName ? (
                  <Badge variant="outline" className="font-normal text-xs text-muted-foreground">
                    {ticket.categoryName}
                  </Badge>
                ) : null}
                {!isAgentOnly && (
                  <Badge variant="outline" className="font-normal text-xs text-muted-foreground">
                    <span>{ticket.assigneeName ?? t('ticket.queue.unassigned')}</span>
                  </Badge>
                )}
              </>
            ) : (
              <>
                <TicketClassification ticket={ticket} />
                <TicketAssignee ticket={ticket} />
              </>
            )}
            {canDelete && ticket.status !== 'RESOLVED' ? (
              <DeleteTicketDialog
                ticketNumber={ticket.number}
                isDeleting={deleteTicket.isPending}
                onConfirm={async () => {
                  await deleteTicket.mutateAsync();
                }}
              />
            ) : null}
          </div>
        </div>

        {/* SLA Clocks Section */}
        <div className="rounded-lg border bg-muted/30 p-3.5">
          <div className="flex flex-wrap items-center gap-6">
            <SlaTimer
              kind="response"
              dueAt={ticket.sla.firstResponseDueAt}
              breached={ticket.sla.firstResponseBreached}
              met={ticket.sla.firstRespondedAt !== null}
              startedAt={ticket.createdAt}
              policyName={ticket.slaPolicyName}
              targetMinutes={ticket.sla.responseTargetMinutes}
              pausedAt={null}
              pausedMs={0}
            />
            <SlaTimer
              kind="resolution"
              dueAt={ticket.sla.resolutionDueAt}
              breached={ticket.sla.resolutionBreached}
              met={ticket.status === 'RESOLVED'}
              startedAt={ticket.createdAt}
              policyName={ticket.slaPolicyName}
              targetMinutes={ticket.sla.resolutionTargetMinutes}
              pausedAt={ticket.sla.pausedAt}
              pausedMs={ticket.sla.pausedMs}
            />
          </div>
        </div>

        {/* Metadata Strip */}
        <dl className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-muted-foreground pt-1 border-t">
          {metadata.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <dt className="text-muted-foreground">{item.label}:</dt>
              <dd className="font-medium text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
