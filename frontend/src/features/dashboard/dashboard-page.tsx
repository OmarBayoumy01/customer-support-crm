import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ArrowDown, ArrowUp, Minus, MessageSquare, SquareArrowOutUpRight } from 'lucide-react';
import type { DashboardMetric, Ticket } from '@crm/shared';

import { PriorityBadge, SlaMeter } from '@/components/domain/indicators';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { TicketAssignee } from '@/features/tickets/ticket-assignee';
import { TicketStatusControl } from '@/features/tickets/ticket-status';
import { useAuth } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';
import { useAssignedSummary, useMyTickets } from './use-dashboard';

/**
 * How far through its target a ticket is, as `SlaMeter` wants it.
 *
 * The same derivation the queue uses: the API sends a deadline and the seconds
 * remaining, and the meter wants a target and an elapsed figure. Kept identical
 * so the dashboard and the queue show the same chip — US-69's AC6.
 */
function slaFigures(ticket: Ticket): { targetSeconds: number; elapsedSeconds: number } | null {
  const { resolutionDueAt, secondsRemaining } = ticket.sla;

  if (resolutionDueAt === null || secondsRemaining === null) {
    return null;
  }

  const targetSeconds = Math.max(
    1,
    Math.round((Date.parse(resolutionDueAt) - Date.parse(ticket.createdAt)) / 1000),
  );

  return { targetSeconds, elapsedSeconds: targetSeconds - secondsRemaining };
}

/**
 * One KPI — US-55, AC1.
 *
 * The comparison renders **only when there is one**. `previous` is null for
 * three of the four figures because the schema cannot answer what they were a
 * week ago — see `DashboardMetricSchema` — and a "0%" where the truth is "we do
 * not know" is worse than a blank.
 *
 * The direction is an arrow **and** a word, never a colour alone.
 */
function Kpi({
  labelKey,
  metric,
  tone,
}: {
  labelKey: string;
  metric: DashboardMetric;
  tone?: 'warn' | 'breach';
}): React.JSX.Element {
  const { t } = useTranslation();

  const delta = metric.previous === null ? null : metric.value - metric.previous;

  const Arrow = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUp : ArrowDown;

  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-4">
        <p className="text-meta text-ink-muted">{t(labelKey)}</p>

        <p
          className={cn(
            'tabular text-page mt-1 font-semibold',
            tone === 'warn' && 'text-sla-warn',
            tone === 'breach' && 'text-sla-breach',
          )}
        >
          {metric.value}
        </p>

        {delta === null ? (
          // Nothing to compare against, and saying nothing is the honest answer.
          <p className="text-meta text-ink-faint mt-1">{t('dashboard.kpi.noComparison')}</p>
        ) : (
          <p className="text-meta text-ink-muted mt-1 flex items-center gap-1">
            <Arrow aria-hidden="true" className="size-3" />
            {t('dashboard.kpi.sinceLastWeek', { delta: Math.abs(delta) })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The agent's own dashboard — US-55.
 *
 * Two queries with two loading states, which is AC5: the table renders as soon as
 * it has rows whether or not the KPI query has answered, and neither blocks on
 * the other.
 *
 * **AC4's snooze is not here.** There is no column to store a snooze-until, no
 * endpoint to set one, and no story that owns it — a button that appeared to
 * snooze and did not would be worse than its absence. Flagged in the plan.
 */
export function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();

  /** AC3 — SLA urgency ascending is the default, not a preference to discover. */
  const [sort, setSort] = useState('sla');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');

  const summary = useAssignedSummary();
  const tickets = useMyTickets(sort, dir);

  const columns: ColumnDef<Ticket>[] = [
    {
      key: 'number',
      header: t('dashboard.table.id'),
      sortable: true,
      cell: (ticket) => <span className="tabular text-ink-muted">#{ticket.number}</span>,
    },
    {
      key: 'subject',
      header: t('dashboard.table.subject'),
      cell: (ticket) => (
        // AC4's "open", as the most obvious target on the row.
        <Link
          to={`/tickets/${ticket.id}`}
          className="text-ink focus-visible:ring-ring rounded font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          {ticket.subject}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: t('dashboard.table.customer'),
      cell: (ticket) => (
        <span className="text-ink-muted">
          {ticket.customer.firstName} {ticket.customer.lastName}
        </span>
      ),
    },
    {
      key: 'priority',
      header: t('dashboard.table.priority'),
      sortable: true,
      cell: (ticket) => <PriorityBadge priority={ticket.priority} />,
    },
    {
      key: 'status',
      header: t('dashboard.table.status'),
      // AC4 — changed in place, through US-47's control and its rules.
      cell: (ticket) => <TicketStatusControl ticket={ticket} className="w-40" />,
    },
    {
      key: 'sla',
      header: t('dashboard.table.sla'),
      sortable: true,
      cell: (ticket) => {
        const figures = slaFigures(ticket);

        return figures === null ? (
          <span className="text-meta text-ink-faint">{t('ticket.queue.noSla')}</span>
        ) : (
          <SlaMeter {...figures} met={ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'} />
        );
      },
    },
    {
      key: 'updatedAt',
      header: t('dashboard.table.updated'),
      sortable: true,
      align: 'end',
      cell: (ticket) => (
        <span className="tabular text-ink-muted">
          {new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(
            new Date(ticket.updatedAt),
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('dashboard.table.actions'),
      align: 'end',
      cell: (ticket) => (
        <div className="flex items-center justify-end gap-1.5">
          {/* AC4 — reassign, through US-48's control and its permission gate. */}
          <TicketAssignee ticket={ticket} className="w-40" />

          {/* AC4 — reply, which lands on the composer US-1 built. */}
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link to={`/tickets/${ticket.id}#reply`}>
              <MessageSquare aria-hidden="true" className="size-4" />
              <span className="sr-only sm:not-sr-only">{t('dashboard.table.reply')}</span>
            </Link>
          </Button>

          <Button asChild variant="ghost" size="sm" aria-label={t('dashboard.table.open')}>
            <Link to={`/tickets/${ticket.id}`}>
              <SquareArrowOutUpRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-page font-semibold">{t('dashboard.title')}</h1>
        <p className="text-ink-muted mt-1">
          {user === null
            ? t('dashboard.subtitleAnonymous')
            : t('dashboard.subtitle', { name: user.firstName })}
        </p>
      </div>

      {/* AC1 — four figures. AC5 — its own skeleton, not the table's. */}
      <section aria-label={t('dashboard.kpi.label')}>
        {summary.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
        ) : summary.isError || summary.data === undefined ? (
          <Card>
            <CardContent className="p-4">
              <p className="text-body text-ink-muted">{t('dashboard.kpi.failed')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi labelKey="dashboard.kpi.open" metric={summary.data.open} />
            <Kpi labelKey="dashboard.kpi.pending" metric={summary.data.pending} />
            <Kpi labelKey="dashboard.kpi.dueSoon" metric={summary.data.dueSoon} tone="warn" />
            <Kpi labelKey="dashboard.kpi.breached" metric={summary.data.breached} tone="breach" />
          </div>
        )}
      </section>

      {/* AC2 — my tickets. AC5 — renders as soon as it has rows. */}
      <section aria-label={t('dashboard.table.label')}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-section font-semibold">{t('dashboard.table.label')}</h2>
          <Button asChild variant="outline" size="sm">
            <Link to="/tickets?view=mine">{t('dashboard.table.seeAll')}</Link>
          </Button>
        </div>

        <DataTable
          columns={columns}
          rows={tickets.data?.data ?? []}
          rowKey={(ticket) => ticket.id}
          isLoading={tickets.isPending}
          error={tickets.isError ? tickets.error : undefined}
          onRetry={() => {
            void tickets.refetch();
          }}
          sort={sort}
          dir={dir}
          onSortChange={(column) => {
            if (column === sort) {
              setDir((value) => (value === 'asc' ? 'desc' : 'asc'));

              return;
            }

            setSort(column);
            setDir('asc');
          }}
          emptyTitle={t('dashboard.table.emptyTitle')}
          emptyDescription={t('dashboard.table.emptyBody')}
        />
      </section>
    </div>
  );
}
