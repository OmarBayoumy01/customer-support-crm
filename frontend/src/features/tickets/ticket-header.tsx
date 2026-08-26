import { ChevronDown, Clock, Timer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketDetail } from '@crm/shared';

import { PriorityBadge, StatusBadge, formatRemaining } from '@/components/domain/indicators';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

/**
 * One SLA clock — US-45, AC2.
 *
 * Two of these sit in the header: response and resolution. Each is a state, a
 * countdown, and — when opened — the exact deadline a dispute would be settled
 * on. Closed by default because the number an agent glances at is "how long
 * have I got"; the timestamp is only ever wanted deliberately.
 *
 * Radix's `Collapsible` handles the disclosure, so `aria-expanded` and the
 * content's mounting are not this component's business.
 */
function SlaClock({
  labelKey,
  dueAt,
  breached,
  policyName,
}: {
  labelKey: string;
  dueAt: string | null;
  breached: boolean;
  policyName: string | null;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  const Icon = labelKey.endsWith('response') ? Timer : Clock;

  if (dueAt === null) {
    return (
      <div className="min-w-40 space-y-0.5">
        <p className="text-meta text-ink-muted flex items-center gap-1.5">
          <Icon aria-hidden="true" className="text-ink-faint size-3.5" />
          {t(labelKey)}
        </p>
        <p className="text-meta text-ink-faint">{t('ticket.queue.noSla')}</p>
      </div>
    );
  }

  const remainingSeconds = Math.round((Date.parse(dueAt) - Date.now()) / 1000);
  const passed = breached || remainingSeconds <= 0;

  const value =
    remainingSeconds >= 0
      ? t('ticket.sla.remaining', { time: formatRemaining(remainingSeconds) })
      : t('ticket.sla.overBy', { time: formatRemaining(remainingSeconds) });

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-40">
      <CollapsibleTrigger className="focus-visible:ring-ring -mx-1 flex items-center gap-1.5 rounded px-1 focus-visible:ring-2 focus-visible:outline-none">
        <Icon aria-hidden="true" className="text-ink-faint size-3.5" />
        <span className="text-meta text-ink-muted">{t(labelKey)}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn('text-ink-faint size-3 transition-transform', open && 'rotate-180')}
        />
      </CollapsibleTrigger>

      {/* State in words as well as colour — never colour alone. */}
      <p
        className={cn('tabular text-body font-medium', passed ? 'text-sla-breach' : 'text-sla-ok')}
      >
        {value}
      </p>

      <CollapsibleContent>
        <dl className="text-meta text-ink-muted mt-1 space-y-0.5">
          <div className="flex gap-1">
            <dt>{t('ticket.detail.sla.dueAt')}</dt>
            <dd className="tabular text-ink">
              {new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(dueAt))}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>{t('ticket.detail.sla.policy')}</dt>
            <dd className="text-ink">{policyName ?? t('ticket.detail.sla.noPolicy')}</dd>
          </div>
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

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
 * **The status, priority and assignee controls are read-only here.** Changing
 * each of them is a story with its own rules: US-47 validates that a status
 * move is legal, US-48 owns assignment, US-49 owns category and priority. This
 * story places them; those three make them act. Rendering a control that
 * silently does nothing would be worse than rendering the value.
 */
export function TicketHeader({ ticket, className }: TicketHeaderProps): React.JSX.Element {
  const { t, i18n } = useTranslation();

  const metadata: { label: string; value: string }[] = [
    { label: t('ticket.queue.column.category'), value: ticket.categoryName ?? '—' },
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

          {/* AC1's inline controls, and AC6's "never behind a dialog". */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            <Badge variant="outline" className="font-normal">
              <span className="text-ink-muted">{t('ticket.queue.column.assignee')}</span>
              <span className="text-ink">
                {ticket.assigneeName ?? t('ticket.queue.unassigned')}
              </span>
            </Badge>
          </div>
        </div>

        <Separator />

        {/* AC2 — both clocks, above the fold, no scrolling. */}
        <div className="flex flex-wrap gap-6">
          <SlaClock
            labelKey="ticket.detail.sla.response"
            dueAt={ticket.sla.firstResponseDueAt}
            breached={ticket.sla.firstResponseBreached}
            policyName={ticket.slaPolicyName}
          />
          <SlaClock
            labelKey="ticket.detail.sla.resolution"
            dueAt={ticket.sla.resolutionDueAt}
            breached={ticket.sla.resolutionBreached}
            policyName={ticket.slaPolicyName}
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
