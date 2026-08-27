import { useTranslation } from 'react-i18next';
import type { TicketDetail } from '@crm/shared';

import { SlaTimer } from '@/components/domain/sla-timer';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { TicketAssignee } from './ticket-assignee';
import { TicketStatusControl } from './ticket-status';
import { TicketClassification } from './ticket-classification';

export interface TicketHeaderProps {
  ticket: TicketDetail;
  className?: string | undefined;
}

/**
 * The ticket header — US-45, AC1, AC2 and AC6.
 *
 * Everything an agent needs to *decide* is here and none of it is behind a
 * dialog: the number and subject, status, priority and assignee, both SLA
 * clocks, and the metadata strip. AC6 is the reason it is this dense — a
 * workspace that hides the assignee behind two clicks is a workspace where
 * tickets sit unassigned.
 *
 * **Every pill in the header is now a control.** Priority and category became
 * real with US-49, the assignee with US-48, and status with US-47 — which lists
 * all seven and disables the moves the state machine does not allow from here.
 */
export function TicketHeader({ ticket, className }: TicketHeaderProps): React.JSX.Element {
  const { t, i18n } = useTranslation();

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
    <Card className={cn('gap-0 py-0', className)}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="tabular text-meta text-ink-muted">#{ticket.number}</p>
            <h1 className="text-title text-ink">{ticket.subject}</h1>
          </div>

          {/*
            AC1's inline controls, and AC6's "never behind a dialog".
            Priority and category became real controls with US-49, the assignee
            with US-48, status with US-47.
          */}
          <div className="flex flex-wrap items-center gap-2">
            <TicketStatusControl ticket={ticket} />
            <TicketClassification ticket={ticket} />
            <TicketAssignee ticket={ticket} />
          </div>
        </div>

        <Separator />

        {/* AC2 — both clocks, above the fold, no scrolling. */}
        <div className="flex flex-wrap gap-6">
          <SlaTimer
            kind="response"
            dueAt={ticket.sla.firstResponseDueAt}
            breached={ticket.sla.firstResponseBreached}
            // AC3's completed state: a response that has been sent is finished
            // with, however its deadline compares to now.
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
            met={ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'}
            startedAt={ticket.createdAt}
            policyName={ticket.slaPolicyName}
            targetMinutes={ticket.sla.resolutionTargetMinutes}
            // Only the resolution clock pauses — a ticket waiting on the
            // customer has by definition already had its response.
            pausedAt={ticket.sla.pausedAt}
            pausedMs={ticket.sla.pausedMs}
          />
        </div>

        <Separator />

        <dl className="text-meta flex flex-wrap gap-x-6 gap-y-1">
          {metadata.map((item) => (
            <div key={item.label} className="flex gap-1">
              <dt className="text-ink-muted">{item.label}</dt>
              <dd className="text-ink">{item.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
