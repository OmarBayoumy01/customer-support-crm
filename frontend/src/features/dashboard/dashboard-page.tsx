import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clock,
  Inbox,
  Minus,
  SquareArrowOutUpRight,
} from 'lucide-react';
import type { DashboardMetric, Ticket } from '@crm/shared';

import { PriorityBadge, SlaMeter, StatusBadge } from '@/components/domain/indicators';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
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
 * Enhanced with shadcn card styling, icon accent, and distinct visual tones.
 */
function Kpi({
  labelKey,
  metric,
  tone,
  icon: Icon,
  iconClass,
}: {
  labelKey: string;
  metric: DashboardMetric;
  tone?: 'warn' | 'breach';
  icon: typeof Inbox;
  iconClass?: string;
}): React.JSX.Element {
  const { t } = useTranslation();

  const delta = metric.previous === null ? null : metric.value - metric.previous;

  const Arrow = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUp : ArrowDown;

  return (
    <Card className="relative overflow-hidden rounded-xl border bg-card/80 p-0 shadow-xs transition-all duration-200 hover:border-primary/40 hover:shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{t(labelKey)}</p>
          <div
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg border',
              iconClass ?? 'border-primary/20 bg-primary/10 text-primary',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
          </div>
        </div>

        <div className="mt-3">
          <p
            className={cn(
              'tabular font-mono text-3xl font-bold tracking-tight text-foreground',
              tone === 'warn' && 'text-amber-600 dark:text-amber-400',
              tone === 'breach' && 'text-rose-600 dark:text-rose-400',
            )}
          >
            {metric.value}
          </p>

          {delta === null ? (
            <p className="mt-1.5 text-xs text-muted-foreground">{t('dashboard.kpi.noComparison')}</p>
          ) : (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 font-medium',
                  delta > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : delta < 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-muted-foreground',
                )}
              >
                <Arrow aria-hidden="true" className="size-3" />
                {t('dashboard.kpi.sinceLastWeek', { delta: Math.abs(delta) })}
              </span>
            </div>
          )}
        </div>
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
      cell: (ticket) => (
        <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
          #{ticket.number}
        </span>
      ),
    },
    {
      key: 'subject',
      header: t('dashboard.table.subject'),
      cell: (ticket) => (
        <Link
          to={`/tickets/${ticket.id}`}
          className="font-medium text-foreground hover:text-primary hover:underline transition-colors focus-visible:ring-1 focus-visible:outline-none"
        >
          {ticket.subject}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: t('dashboard.table.customer'),
      cell: (ticket) => (
        <span className="text-muted-foreground">
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
      cell: (ticket) => <StatusBadge status={ticket.status} />,
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
          <SlaMeter {...figures} met={ticket.status === 'RESOLVED'} />
        );
      },
    },
    {
      key: 'updatedAt',
      header: t('dashboard.table.updated'),
      sortable: true,
      align: 'end',
      cell: (ticket) => (
        <span className="tabular text-xs text-muted-foreground">
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
        <div className="flex items-center justify-end">
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
      {/* Header Banner */}
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('dashboard.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
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
              <Skeleton key={index} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : summary.isError || summary.data === undefined ? (
          <Card className="rounded-xl border bg-card/60 p-0 shadow-xs">
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">{t('dashboard.kpi.failed')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              labelKey="dashboard.kpi.open"
              metric={summary.data.open}
              icon={Inbox}
              iconClass="border-primary/20 bg-primary/10 text-primary"
            />
            <Kpi
              labelKey="dashboard.kpi.pending"
              metric={summary.data.pending}
              icon={Clock}
              iconClass="border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400"
            />
            <Kpi
              labelKey="dashboard.kpi.dueSoon"
              metric={summary.data.dueSoon}
              tone="warn"
              icon={AlertCircle}
              iconClass="border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400"
            />
            <Kpi
              labelKey="dashboard.kpi.breached"
              metric={summary.data.breached}
              tone="breach"
              icon={AlertTriangle}
              iconClass="border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400"
            />
          </div>
        )}
      </section>

      {/* AC2 — my tickets. AC5 — renders as soon as it has rows. */}
      <section aria-label={t('dashboard.table.label')}>
        <Card className="overflow-hidden rounded-xl border bg-card/80 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between border-b px-6 py-4">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">
                  {t('dashboard.table.label')}
                </CardTitle>
                {tickets.data?.data !== undefined && (
                  <Badge variant="secondary" className="font-mono text-xs font-semibold px-2 py-0.5">
                    {tickets.data.data.length}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs mt-1">
                {t('ticket.queue.subtitle')}
              </CardDescription>
            </div>

            <Button asChild variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <Link to="/tickets?view=mine">
                <span>{t('dashboard.table.seeAll')}</span>
                <ArrowRight aria-hidden="true" className="size-3.5 rtl:rotate-180" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              rows={tickets.data?.data ?? []}
              rowKey={(ticket) => ticket.id}
              isLoading={tickets.isPending}
              error={tickets.error ?? undefined}
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
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
