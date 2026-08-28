import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Calendar as CalendarIcon,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Inbox,
  MessageSquareReply,
  Plus,
  Search,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import type { PortalTicket, PortalTicketListQuery, TicketStatus } from '@crm/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { usePortalTickets } from './use-portal';

/** `null` cannot travel in a `<Select>` value, so "any" gets a name. */
const ANY_STATUS = '__any__';

/**
 * The customer-facing statuses in the order a request moves
 * through them.
 */
const STATUS_ORDER: TicketStatus[] = [
  'NEW',
  'WAITING_FOR_AGENT',
  'WAITING_FOR_CUSTOMER',
  'RESOLVED',
];

/** How many cards a page holds. Set to 5 so page breaks occur sooner. */
const PAGE_SIZE = 5;

/**
 * One request, as a card — US-84, AC1.
 *
 * **A card, not a table row.** AC1 rules out a dense data table explicitly, and
 * the reason is that a customer has a handful of requests and reads them like
 * letters. The staff queue's `DataTable` is an instrument for a hundred rows and
 * bulk selection; neither applies here.
 */
function RequestCard({ ticket }: { ticket: PortalTicket }): React.JSX.Element {
  const { t, i18n } = useTranslation();

  const needsReply = ticket.status === 'WAITING_FOR_CUSTOMER';

  const date = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));

  const statusConfig = {
    WAITING_FOR_CUSTOMER: {
      badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      icon: MessageSquareReply,
    },
    WAITING_FOR_AGENT: {
      badgeClass: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
      icon: Clock,
    },
    RESOLVED: {
      badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      icon: CheckCircle2,
    },
    NEW: {
      badgeClass: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
      icon: Sparkles,
    },
  }[ticket.status] ?? {
    badgeClass: 'border-muted bg-muted text-muted-foreground',
    icon: Inbox,
  };

  const StatusIcon = statusConfig.icon;

  return (
    <Link to={`/portal/requests/${ticket.id}`} className="group block outline-none">
      <Card
        className={cn(
          'relative overflow-hidden rounded-xl border bg-card p-0 shadow-xs transition-all duration-200',
          'group-hover:border-primary/40 group-hover:shadow-md group-hover:bg-muted/15',
          needsReply && 'border-s-4 border-s-amber-500',
        )}
      >
        <CardContent className="p-5 sm:p-6">
          {/* Top Row: Number, Category & Status Badge */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                {t('portal.requests.number', { number: ticket.number })}
              </span>

              <Badge variant="outline" className="gap-1 font-normal text-xs text-muted-foreground">
                <Tag aria-hidden="true" className="size-3" />
                {ticket.categoryName ?? t('portal.requests.noCategory')}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn('gap-1.5 py-0.5 text-xs font-medium', statusConfig.badgeClass)}>
                <StatusIcon aria-hidden="true" className="size-3" />
                {t(`portal.requests.status.${ticket.status}`)}
              </Badge>
            </div>
          </div>

          {/* Middle Row: Subject & Action Prompt */}
          <div className="mt-3 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors sm:text-lg">
                {ticket.subject}
              </h2>
              {needsReply ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
                  </span>
                  <span>{t('portal.requests.needsReply')}</span>
                </div>
              ) : null}
            </div>

            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-transform duration-200 group-hover:bg-primary group-hover:text-primary-foreground group-hover:translate-x-1 rtl:group-hover:-translate-x-1">
              <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
            </div>
          </div>

          {/* Bottom Row: Metadata Dates */}
          <div className="mt-4 flex flex-wrap items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarDays aria-hidden="true" className="size-3.5" />
              {t('portal.requests.openedOn', { date: date(ticket.createdAt) })}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1.5">
              <Clock aria-hidden="true" className="size-3.5" />
              {t('portal.requests.updatedOn', { date: date(ticket.updatedAt) })}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * The requests list — US-84.
 *
 * AC4 (inline star rating) is unmet and untested: rating is US-88, deferred.
 * There are no stars here because a five-star widget that accepted the click
 * and silently throw it away, which is worse than not asking.
 */
export function PortalRequests(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith('ar') ? ar : enUS;

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>(ANY_STATUS);
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date } | undefined>(undefined);
  const [page, setPage] = useState(1);

  const from = dateRange?.from;
  const to = dateRange?.to;

  const query: PortalTicketListQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(search === '' ? {} : { q: search }),
    ...(status === ANY_STATUS ? {} : { status: status as TicketStatus }),
    ...(from === undefined
      ? {}
      : {
          createdFrom: new Date(
            from.getFullYear(),
            from.getMonth(),
            from.getDate(),
            0,
            0,
            0,
          ).toISOString(),
        }),
    ...(to === undefined
      ? {}
      : {
          createdTo: new Date(
            to.getFullYear(),
            to.getMonth(),
            to.getDate(),
            23,
            59,
            59,
            999,
          ).toISOString(),
        }),
  };

  const requests = usePortalTickets(query);

  const filtered =
    search !== '' || status !== ANY_STATUS || from !== undefined || to !== undefined;
  const tickets = requests.data?.data ?? [];
  const total = requests.data?.pagination.total ?? 0;

  const clear = (): void => {
    setSearch('');
    setStatus(ANY_STATUS);
    setDateRange(undefined);
    setPage(1);
  };

  const setPreset = (preset: 'today' | '7days' | '30days' | 'thisMonth') => {
    const now = new Date();
    setPage(1);
    if (preset === 'today') {
      setDateRange({ from: now, to: now });
    } else if (preset === '7days') {
      const past = new Date();
      past.setDate(now.getDate() - 7);
      setDateRange({ from: past, to: now });
    } else if (preset === '30days') {
      const past = new Date();
      past.setDate(now.getDate() - 30);
      setDateRange({ from: past, to: now });
    } else if (preset === 'thisMonth') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateRange({ from: startOfMonth, to: now });
    }
  };

  const formattedDateRange = (): string => {
    if (!from) return t('portal.requests.pickDateRange');
    if (!to) return format(from, 'd MMM yyyy', { locale: dateLocale });
    return `${format(from, 'd MMM', { locale: dateLocale })} - ${format(to, 'd MMM yyyy', { locale: dateLocale })}`;
  };

  return (
    <section aria-label={t('portal.requests.title')}>
      {/* Filters Toolbar Card */}
      <Card className="mb-6 border bg-card/60 shadow-xs backdrop-blur-xs">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            {/* Search Input */}
            <div className="min-w-0 flex-1">
              <Label htmlFor="portal-search" className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t('portal.requests.search')}
              </Label>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="text-muted-foreground absolute inset-y-0 start-0 my-auto ms-3 size-4"
                />
                <Input
                  id="portal-search"
                  type="search"
                  className="h-9 text-start ps-9 text-xs"
                  placeholder={t('portal.requests.searchPlaceholder')}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setPage(1);
                    }}
                    className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-0 my-auto me-2.5 flex size-5 items-center justify-center rounded-full"
                    aria-label="Clear search"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Status Select */}
            <div className="w-full md:w-48">
              <Label htmlFor="portal-status" className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t('portal.requests.statusLabel')}
              </Label>
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
              >
                <SelectTrigger id="portal-status" aria-label={t('portal.requests.statusLabel')} className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_STATUS} className="text-xs">{t('portal.requests.anyStatus')}</SelectItem>
                  {STATUS_ORDER.map((value) => (
                    <SelectItem key={value} value={value} className="text-xs">
                      {t(`portal.requests.status.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Unified Date Range Picker */}
            <div className="w-full md:w-56">
              <Label htmlFor="portal-date" className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t('portal.requests.dateRange')}
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="portal-date"
                    variant="outline"
                    className={cn(
                      'h-9 w-full justify-start px-3 text-start text-xs font-normal',
                      from === undefined && 'text-muted-foreground',
                    )}
                  >
                    <CalendarIcon className="me-2 size-3.5" />
                    <span className="truncate">{formattedDateRange()}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 shadow-lg rounded-xl border" align="end">
                  <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x rtl:sm:divide-x-reverse">
                    {/* Presets Sidebar */}
                    <div className="flex flex-row sm:flex-col gap-1 p-3 min-w-32 bg-muted/20">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 justify-start text-xs font-normal"
                        onClick={() => setPreset('today')}
                      >
                        {t('portal.requests.presets.today')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 justify-start text-xs font-normal"
                        onClick={() => setPreset('7days')}
                      >
                        {t('portal.requests.presets.last7Days')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 justify-start text-xs font-normal"
                        onClick={() => setPreset('30days')}
                      >
                        {t('portal.requests.presets.last30Days')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 justify-start text-xs font-normal"
                        onClick={() => setPreset('thisMonth')}
                      >
                        {t('portal.requests.presets.thisMonth')}
                      </Button>
                    </div>

                    {/* Calendar Grid */}
                    <div className="p-3">
                      <Calendar
                        mode="range"
                        selected={dateRange as any}
                        onSelect={(range) => {
                          setDateRange(range as any);
                          setPage(1);
                        }}
                        numberOfMonths={1}
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Clear Filters Button */}
            {filtered ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clear}
                className="h-9 shrink-0 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <X aria-hidden="true" className="size-3.5" />
                {t('portal.requests.clearFilters')}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {requests.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : requests.isError ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-body text-ink">{t('portal.requests.error')}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                void requests.refetch();
              }}
            >
              {t('portal.requests.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : tickets.length === 0 ? (
        /*
          Two different empty states, because they are two different situations
          with two different answers. Telling somebody with twelve requests that
          they have never contacted support is the failure worth avoiding.
        */
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Inbox aria-hidden="true" className="text-ink-faint size-8" />
            {filtered ? (
              <>
                <p className="text-body text-ink">{t('portal.requests.noMatches')}</p>
                <Button variant="outline" size="sm" onClick={clear}>
                  {t('portal.requests.clearFilters')}
                </Button>
              </>
            ) : (
              <>
                {/* AC5 — a friendly message and a way to submit. */}
                <p className="text-body text-ink">{t('portal.requests.empty')}</p>
                <p className="text-meta text-ink-muted">{t('portal.requests.emptyHint')}</p>
                <Button asChild className="mt-1 gap-2">
                  <Link to="/portal/new">
                    <Plus aria-hidden="true" className="size-4" />
                    {t('portal.home.newRequest')}
                  </Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="space-y-3">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <RequestCard ticket={ticket} />
              </li>
            ))}
          </ul>

          {total > 0 ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t('portal.requests.showing', { count: tickets.length, total })}</span>
                <span>•</span>
                <span className="font-mono">
                  {t('common.pageOf', { page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => {
                    setPage((value) => Math.max(1, value - 1));
                  }}
                  className="gap-1 shadow-2xs h-8 text-xs"
                >
                  <ChevronLeft aria-hidden="true" className="size-3.5 rtl:rotate-180" />
                  {t('portal.requests.previous')}
                </Button>
                <div className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-semibold font-mono">
                  {page}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= Math.max(1, Math.ceil(total / PAGE_SIZE))}
                  onClick={() => {
                    setPage((value) => value + 1);
                  }}
                  className="gap-1 shadow-2xs h-8 text-xs"
                >
                  {t('portal.requests.next')}
                  <ChevronRight aria-hidden="true" className="size-3.5 rtl:rotate-180" />
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
