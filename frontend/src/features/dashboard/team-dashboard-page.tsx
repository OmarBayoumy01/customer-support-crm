import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Flame, SquareArrowOutUpRight, TriangleAlert } from 'lucide-react';
import type { DistributionSlice, Ticket } from '@crm/shared';

import { PriorityBadge, SlaMeter } from '@/components/domain/indicators';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { TicketAssignee } from '@/features/tickets/ticket-assignee';
import { usePermission } from '@/features/auth/use-permission';
import { http } from '@/lib/api-client';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useAttentionTickets, useTeamOverview } from './use-dashboard';

/** `null` cannot travel in a `<Select>` value, so "all" gets a name. */
const ALL = '__all__';

/** Seconds as a duration a manager reads at a glance. */
function duration(seconds: number | null, none: string): string {
  if (seconds === null) {
    return none;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  return hours > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(minutes)}m`;
}

/** One figure. Plain, because seven of them beside each other must stay scannable. */
function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'breach';
}): React.JSX.Element {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-4">
        <p className="text-meta text-ink-muted">{label}</p>
        <p
          className={cn(
            'tabular text-page mt-1 font-semibold',
            tone === 'warn' && 'text-sla-warn',
            tone === 'breach' && 'text-sla-breach',
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * A distribution as labelled bar rows — US-58, AC2.
 *
 * **Not a charting library.** `.squad/plans/00-mvp-scope.md` settled that for this
 * story ("no charts library"), and at this size a labelled row with its figure
 * beside it is more legible than a canvas — as well as readable by a screen
 * reader, printable, and translatable.
 *
 * The bar is proportional to the largest slice rather than to the total, so a
 * distribution with one dominant value still shows the small ones.
 */
function Distribution({
  title,
  slices,
  labelFor,
}: {
  title: string;
  slices: DistributionSlice[];
  labelFor?: (slice: DistributionSlice) => string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const largest = slices.reduce((max, slice) => Math.max(max, slice.count), 0);

  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-4">
        <h3 className="text-meta text-ink-muted mb-3">{title}</h3>

        {slices.length === 0 ? (
          <p className="text-meta text-ink-faint">{t('team.noData')}</p>
        ) : (
          <dl className="space-y-2">
            {slices.map((slice) => (
              <div key={slice.key} className="flex items-center gap-3">
                <dt className="text-meta text-ink w-28 shrink-0 truncate">
                  {labelFor === undefined ? slice.label : labelFor(slice)}
                </dt>
                <dd className="flex flex-1 items-center gap-2">
                  <div className="bg-secondary h-2 flex-1 overflow-hidden rounded-full">
                    <div
                      className="bg-ink/60 h-full rounded-full"
                      // The figure is beside it in text, so the bar is decoration.
                      style={{
                        inlineSize: `${String(largest === 0 ? 0 : (slice.count / largest) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="tabular text-meta text-ink-muted w-8 text-end">
                    {slice.count}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * How far through its target a ticket is, as `SlaMeter` wants it — the same
 * derivation the queue and the agent dashboard use, so all three show one chip.
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

/** Already past a target — AC4's emphasis, and the escalate button's reason. */
function isBreached(ticket: Ticket): boolean {
  return (
    ticket.sla.state === 'breach' ||
    ticket.sla.firstResponseBreached ||
    ticket.sla.resolutionBreached
  );
}

/**
 * The manager dashboard — US-58.
 *
 * **This is the "Report" step of the core workflow**, since all of P11 is V2.
 *
 * Every figure on it is computed inside the manager's own ticket scope, on the
 * server, in the query. The department and branch controls are **filters** the
 * server ANDs with that scope: asking for another department returns zeros rather
 * than that department's numbers.
 *
 * **Customer satisfaction is absent** — AC1 asks for it and there is no rating in
 * the domain. US-88 owns it, and a figure invented from resolution time would be
 * a number whose label lies.
 */
export function TeamDashboardPage(): React.JSX.Element {
  const { t } = useTranslation();

  // Convenience only: PATCH /tickets/:id/status is guarded by the same
  // permission, and a button that always 403s teaches nothing.
  const canEscalate = usePermission('ticket:escalate');

  const [department, setDepartment] = useState<string>(ALL);
  const filters = department === ALL ? {} : { departmentId: department };

  const overview = useTeamOverview(filters);
  const attention = useAttentionTickets(filters);

  /**
   * AC3's escalate, through US-47's validated transition.
   *
   * `PATCH /tickets/:id/status` already refuses an illegal move and already
   * requires `ticket:escalate`. No new endpoint and no new lifecycle rule.
   */
  const escalate = async (ticket: Ticket): Promise<void> => {
    try {
      await http.patch(`/tickets/${ticket.id}/status`, { status: 'ESCALATED' });
      toastSuccess(t('team.escalated', { number: ticket.number }));
      await Promise.all([attention.refetch(), overview.refetch()]);
    } catch (error: unknown) {
      toastError(error);
    }
  };

  /** The departments the manager can actually see, from their own figures. */
  const departmentOptions = overview.data?.byDepartment ?? [];

  const columns: ColumnDef<Ticket>[] = [
    {
      key: 'number',
      header: t('team.table.ticket'),
      cell: (ticket) => (
        <Link
          to={`/tickets/${ticket.id}`}
          className="text-ink focus-visible:ring-ring rounded font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          <span className="tabular text-ink-muted">#{ticket.number}</span> {ticket.subject}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: t('team.table.customer'),
      cell: (ticket) => (
        <span className="text-ink-muted">
          {ticket.customer.firstName} {ticket.customer.lastName}
        </span>
      ),
    },
    {
      key: 'agent',
      header: t('team.table.agent'),
      cell: (ticket) => (
        <span className="text-ink-muted">
          {ticket.assigneeName ?? t('ticket.queue.unassigned')}
        </span>
      ),
    },
    {
      key: 'priority',
      header: t('team.table.priority'),
      sortable: true,
      cell: (ticket) => <PriorityBadge priority={ticket.priority} />,
    },
    {
      key: 'sla',
      header: t('team.table.sla'),
      sortable: true,
      cell: (ticket) => {
        const figures = slaFigures(ticket);

        return (
          <div className="flex items-center gap-2">
            {/*
              AC4 — the words, not only the tint on the row. A manager scanning
              for what to escalate is exactly the reader a colour-only cue fails.

              It says "SLA breached" rather than repeating the meter's own
              "Breached": a first-response breach on a ticket whose resolution
              target is still healthy shows an amber meter, so the badge is
              carrying something the meter does not.
            */}
            {isBreached(ticket) ? (
              <Badge className="border-sla-breach/25 bg-sla-breach-soft text-sla-breach gap-1">
                <Flame aria-hidden="true" className="size-3" />
                {t('team.table.breached')}
              </Badge>
            ) : null}

            {figures === null ? (
              <span className="text-meta text-ink-faint">{t('ticket.queue.noSla')}</span>
            ) : (
              <SlaMeter {...figures} />
            )}
          </div>
        );
      },
    },
    {
      key: 'updatedAt',
      header: t('team.table.updated'),
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
      header: t('team.table.actions'),
      align: 'end',
      cell: (ticket) => (
        <div className="flex items-center justify-end gap-1.5">
          {/* AC3 — reassign, through US-48's control and its permission gate. */}
          <TicketAssignee ticket={ticket} className="w-40" />

          {canEscalate ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={ticket.status === 'ESCALATED'}
              onClick={() => {
                void escalate(ticket);
              }}
            >
              <TriangleAlert aria-hidden="true" className="size-4" />
              {t('team.table.escalate')}
            </Button>
          ) : null}

          <Button asChild variant="ghost" size="sm" aria-label={t('team.table.view')}>
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold">{t('team.title')}</h1>
          <p className="text-ink-muted mt-1">{t('team.subtitle')}</p>
        </div>

        {/*
          AC5 — one filter row, governing the figures, the distributions and the
          table, because all three read it. A department the manager cannot see
          returns zeros server-side rather than being hidden here.
        */}
        <div className="w-52">
          <Label htmlFor="team-department" className="mb-1.5">
            {t('team.department')}
          </Label>
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger id="team-department" aria-label={t('team.department')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('team.allDepartments')}</SelectItem>
              {departmentOptions
                .filter((slice) => slice.key !== 'none')
                .map((slice) => (
                  <SelectItem key={slice.key} value={slice.key}>
                    {slice.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <section aria-label={t('team.kpi.label')}>
        {overview.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
        ) : overview.isError || overview.data === undefined ? (
          <Card>
            <CardContent className="p-4">
              <p className="text-body text-ink-muted">{t('team.kpi.failed')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi label={t('team.kpi.open')} value={String(overview.data.open)} />
            <Kpi label={t('team.kpi.unassigned')} value={String(overview.data.unassigned)} />
            <Kpi label={t('team.kpi.atRisk')} value={String(overview.data.atRisk)} tone="warn" />
            <Kpi
              label={t('team.kpi.breached')}
              value={String(overview.data.breached)}
              tone="breach"
            />
            <Kpi
              label={t('team.kpi.avgResponse')}
              value={duration(overview.data.averageResponseSeconds, t('team.noData'))}
            />
            <Kpi
              label={t('team.kpi.avgResolution')}
              value={duration(overview.data.averageResolutionSeconds, t('team.noData'))}
            />
          </div>
        )}

        {/*
          AC1 names customer satisfaction and there is nothing to average: no
          rating column, no endpoint, US-88 deferred. Said plainly rather than
          shown as a zero somebody would read as "nobody is happy".
        */}
        <p className="text-meta text-ink-faint mt-3">{t('team.kpi.satisfactionPending')}</p>
      </section>

      <section aria-label={t('team.charts.label')}>
        <h2 className="text-section mb-3 font-semibold">{t('team.charts.label')}</h2>

        {overview.isPending || overview.data === undefined ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-40 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <Distribution
              title={t('team.charts.overTime')}
              slices={overview.data.overTime.slice(-14)}
            />
            <Distribution
              title={t('team.charts.byStatus')}
              slices={overview.data.byStatus}
              labelFor={(slice) => t(`ticket.status.${camel(slice.key)}`, slice.label)}
            />
            <Distribution
              title={t('team.charts.byPriority')}
              slices={overview.data.byPriority}
              labelFor={(slice) => t(`ticket.priority.${slice.key.toLowerCase()}`, slice.label)}
            />
            <Distribution
              title={t('team.charts.byDepartment')}
              slices={overview.data.byDepartment}
              labelFor={(slice) => (slice.key === 'none' ? t('team.noDepartment') : slice.label)}
            />
            <Distribution
              title={t('team.charts.byAgent')}
              slices={overview.data.byAgent}
              labelFor={(slice) =>
                slice.key === 'none' ? t('ticket.queue.unassigned') : slice.label
              }
            />
          </div>
        )}
      </section>

      <section aria-label={t('team.table.label')}>
        <h2 className="text-section mb-3 font-semibold">{t('team.table.label')}</h2>

        <DataTable
          columns={columns}
          rows={attention.data?.data ?? []}
          rowKey={(ticket) => ticket.id}
          isLoading={attention.isPending}
          error={attention.isError ? attention.error : undefined}
          onRetry={() => {
            void attention.refetch();
          }}
          // AC4 — the ground and an inline-start rule, mirroring in Arabic.
          rowClassName={(ticket) =>
            isBreached(ticket) ? 'bg-sla-breach-soft/40 border-s-2 border-s-sla-breach' : undefined
          }
          emptyTitle={t('team.table.emptyTitle')}
          emptyDescription={t('team.table.emptyBody')}
        />
      </section>
    </div>
  );
}

/** `PENDING_CUSTOMER` → `pendingCustomer`, matching the status i18n keys. */
function camel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}
