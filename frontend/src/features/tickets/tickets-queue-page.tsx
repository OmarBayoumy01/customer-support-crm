import { Mail, MessageCircle, MessagesSquare, Globe, Smartphone } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { TICKET_VIEWS, type Channel, type Ticket, type TicketView } from '@crm/shared';

import { FilterBar, type FilterDefinition } from '@/components/common/filter-bar';
import { ListPagination } from '@/components/common/list-pagination';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { useTableQueryState } from '@/components/data-table/use-table-query-state';
import { PriorityBadge, SlaMeter, StatusBadge, slaEdgeClass } from '@/components/domain/indicators';
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/design-tokens';
import { cn } from '@/lib/utils';
import { FilterChips, type FilterChip } from './filter-chips';
import { QueueTabs } from './queue-tabs';
import { useTicketCounts, useTicketList } from './use-tickets';

/** Which filters this screen puts in the URL. Everything else is reserved. */
const FILTER_KEYS = ['status', 'priority', 'channel', 'slaState', 'view'] as const;

/** The channel a ticket arrived on — AC1 renders it beside the subject. */
const CHANNEL_ICON: Record<Channel, typeof Mail> = {
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  CHAT: MessagesSquare,
  SMS: Smartphone,
  WEB: Globe,
};

/**
 * How far through its target a ticket is, as a fraction.
 *
 * `SlaMeter` wants a target and an elapsed figure; the API sends a deadline and
 * the seconds remaining. Deriving the target from `createdAt` rather than asking
 * the API for it keeps the payload the same shape it has been since US-40.
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
 * The ticket queue — US-42.
 *
 * The screen an agent lives in. Its whole job is to answer *what do I do next*,
 * which is why AC2 puts priority and SLA above everything else and why the row
 * carries a coloured rule on its inline start rather than a tinted background:
 * a queue where every row is coloured is a queue where nothing stands out.
 *
 * Every piece of view state — tab, filters, sort, page, search — lives in the
 * URL. A manager can paste a link to "breached, urgent, unassigned" into chat
 * and their colleague sees that list, not a default and a conversation about
 * which tickets they meant.
 */
export function TicketsQueuePage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const table = useTableQueryState(FILTER_KEYS);
  const [selected, setSelected] = useState(new Set<string>());

  const rawView = table.filters['view'];
  const view: TicketView = TICKET_VIEWS.includes(rawView as TicketView)
    ? (rawView as TicketView)
    : 'all';

  // Sent to the API verbatim. `view` travels with the rest because the server
  // owns what each tab means — see `TicketsService.viewWhere`.
  const search = useMemo(() => {
    const next = new URLSearchParams(params);
    next.set('pageSize', '25');

    return `?${next.toString()}`;
  }, [params]);

  const list = useTicketList(search);
  const counts = useTicketCounts();

  const filters: FilterDefinition[] = [
    {
      key: 'status',
      label: t('ticket.queue.filter.status'),
      options: TICKET_STATUSES.map((status: TicketStatus) => ({
        value: status,
        label: t(`ticket.status.${camel(status)}`),
      })),
    },
    {
      key: 'priority',
      label: t('ticket.queue.filter.priority'),
      options: TICKET_PRIORITIES.map((priority: TicketPriority) => ({
        value: priority,
        label: t(`ticket.priority.${priority.toLowerCase()}`),
      })),
    },
    {
      key: 'channel',
      label: t('ticket.queue.filter.channel'),
      options: (['EMAIL', 'WHATSAPP', 'CHAT', 'SMS', 'WEB'] as const).map((channel) => ({
        value: channel,
        label: t(`ticket.channel.${channel.toLowerCase()}`),
      })),
    },
    {
      key: 'slaState',
      label: t('ticket.queue.filter.sla'),
      options: [
        { value: 'ok', label: t('ticket.sla.onTrack') },
        { value: 'warn', label: t('ticket.sla.dueSoon') },
        { value: 'breach', label: t('ticket.sla.breached') },
      ],
    },
  ];

  /** AC3 — what is currently narrowing the list, in words. */
  const chips: FilterChip[] = filters.flatMap((filter) => {
    const value = table.filters[filter.key];
    const option = filter.options.find((candidate) => candidate.value === value);

    return option === undefined
      ? []
      : [{ key: filter.key, label: filter.label, value: option.label }];
  });

  const columns: ColumnDef<Ticket>[] = [
    {
      key: 'number',
      header: t('ticket.queue.column.id'),
      sortable: true,
      className: 'w-20',
      cell: (ticket) => <span className="tabular text-ink-muted">#{ticket.number}</span>,
    },
    {
      key: 'subject',
      header: t('ticket.queue.column.subject'),
      cell: (ticket) => {
        const Icon = CHANNEL_ICON[ticket.channel];

        return (
          <span className="flex items-center gap-2">
            <Icon
              aria-hidden="true"
              className="text-ink-faint size-3.5 shrink-0"
              // The icon is decoration; the channel is on the row for a reader
              // who cannot see it, via the title below.
            />
            <span className="sr-only">{t(`ticket.channel.${ticket.channel.toLowerCase()}`)}</span>
            <span className="text-ink line-clamp-1">{ticket.subject}</span>
          </span>
        );
      },
    },
    {
      key: 'customer',
      header: t('ticket.queue.column.customer'),
      cell: (ticket) => (
        <span className="text-ink-muted line-clamp-1">
          {ticket.customer.companyName ??
            `${ticket.customer.firstName} ${ticket.customer.lastName}`}
        </span>
      ),
    },
    {
      key: 'category',
      header: t('ticket.queue.column.category'),
      cell: (ticket) => (
        <span className="text-ink-muted line-clamp-1">{ticket.categoryName ?? '—'}</span>
      ),
    },
    {
      key: 'priority',
      header: t('ticket.queue.column.priority'),
      sortable: true,
      cell: (ticket) => <PriorityBadge priority={ticket.priority} />,
    },
    {
      key: 'status',
      header: t('ticket.queue.column.status'),
      cell: (ticket) => <StatusBadge status={ticket.status} />,
    },
    {
      key: 'assignee',
      header: t('ticket.queue.column.assignee'),
      cell: (ticket) =>
        ticket.assigneeName === null ? (
          <span className="text-ink-faint">{t('ticket.queue.unassigned')}</span>
        ) : (
          <span className="text-ink-muted line-clamp-1">{ticket.assigneeName}</span>
        ),
    },
    {
      key: 'sla',
      header: t('ticket.queue.column.sla'),
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
      header: t('ticket.queue.column.updated'),
      sortable: true,
      align: 'end',
      cell: (ticket) => (
        <time className="tabular text-meta text-ink-muted" dateTime={ticket.updatedAt}>
          {relative(ticket.updatedAt)}
        </time>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-title text-ink">{t('ticket.queue.title')}</h1>
        <p className="text-meta text-ink-muted">{t('ticket.queue.subtitle')}</p>
      </header>

      <QueueTabs
        view={view}
        counts={counts.data}
        onChange={(next) => {
          // "All" is the absence of a view rather than a value, so the default
          // queue has a clean URL worth sharing.
          table.setFilter('view', next === 'all' ? null : next);
        }}
      />

      <div className="space-y-2">
        <FilterBar
          filters={filters}
          values={table.filters}
          onChange={table.setFilter}
          onClear={table.clearFilters}
          search={{
            value: table.search,
            onChange: table.setSearch,
            label: t('ticket.queue.searchLabel'),
          }}
        />

        {chips.length > 0 && (
          <FilterChips
            chips={chips}
            onRemove={(key) => {
              table.setFilter(key, null);
            }}
          />
        )}
      </div>

      <DataTable
        columns={columns}
        rows={list.data?.tickets ?? []}
        rowKey={(ticket) => ticket.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        sort={table.sort}
        dir={table.dir}
        onSortChange={table.toggleSort}
        selected={selected}
        onSelectedChange={setSelected}
        onRowClick={(ticket) => {
          void navigate(`/tickets/${ticket.id}`);
        }}
        // AC2's signature. A rule on the inline start, which mirrors in Arabic
        // on its own, rather than a tint that would make the whole queue shout.
        rowClassName={(ticket) => {
          const figures = slaFigures(ticket);

          return figures === null
            ? undefined
            : cn(slaEdgeClass(figures.elapsedSeconds / figures.targetSeconds));
        }}
        isFiltered={chips.length > 0 || table.search !== '' || view !== 'all'}
        onClearFilters={table.clearFilters}
        emptyTitle={t('ticket.queue.emptyTitle')}
        emptyDescription={t('ticket.queue.emptyDescription')}
      />

      {list.data?.pagination !== undefined && list.data.pagination.total > 0 && (
        <ListPagination
          page={list.data.pagination.page}
          totalPages={list.data.pagination.totalPages}
          total={list.data.pagination.total}
          onPageChange={table.setPage}
        />
      )}
    </div>
  );
}

/** `PENDING_CUSTOMER` → `pendingCustomer`, matching the i18n keys. */
function camel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/**
 * "4h ago", not a timestamp.
 *
 * The updated column answers *has anything happened lately*, which is a
 * question about recency. The exact time is on the ticket itself, where a
 * dispute would need it.
 */
function relative(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);

  if (minutes < 1) {
    return 'now';
  }

  if (minutes < 60) {
    return `${String(minutes)}m`;
  }

  const hours = Math.round(minutes / 60);

  return hours < 48 ? `${String(hours)}h` : `${String(Math.round(hours / 24))}d`;
}
