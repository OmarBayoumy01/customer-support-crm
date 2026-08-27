import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CalendarDays, Inbox, MessageSquareReply, Plus, Search, Tag } from 'lucide-react';
import type { PortalTicket, PortalTicketListQuery, PortalTicketStatus } from '@crm/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
 * The five customer-facing statuses — US-82's set, in the order a request moves
 * through them. `PortalTicketStatusSchema.options` would do, but the enum's order
 * is alphabetical-by-accident and this is a menu somebody reads.
 */
const STATUS_ORDER: PortalTicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_YOU',
  'RESOLVED',
  'CLOSED',
];

/** How many cards a page holds. Generous rows, so fewer of them. */
const PAGE_SIZE = 10;

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

  /** AC3 — awaiting my reply. `WAITING_ON_YOU` already means exactly that. */
  const needsReply = ticket.status === 'WAITING_ON_YOU';

  const date = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <Card
      // AC3's edge marker is `border-s`, so in Arabic it is on the right — the
      // same edge the reading starts from. Never `border-l`.
      className={cn('gap-0 py-0', needsReply && 'border-s-4 border-s-sla-warn')}
    >
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="tabular text-meta text-ink-muted">
              {t('portal.requests.number', { number: ticket.number })}
            </p>
            {/*
              A link now that US-85 gives it somewhere to go. The whole heading
              is the target rather than a "view" affordance elsewhere on the card.
            */}
            <h2 className="text-section mt-0.5 font-semibold">
              <Link
                to={`/portal/requests/${ticket.id}`}
                className="text-ink hover:underline focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                {ticket.subject}
              </Link>
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/*
              AC3 in words as well as by colour. The edge stripe alone would be
              colour-only signalling, which the definition of done forbids.
            */}
            {needsReply ? (
              <Badge className="border-sla-warn/25 bg-sla-warn-soft text-sla-warn gap-1">
                <MessageSquareReply aria-hidden="true" className="size-3" />
                {t('portal.requests.needsReply')}
              </Badge>
            ) : null}

            <Badge variant="outline" className="font-normal">
              {t(`portal.requests.status.${ticket.status}`)}
            </Badge>
          </div>
        </div>

        <dl className="text-meta text-ink-muted flex flex-wrap gap-x-5 gap-y-1">
          <div className="flex items-center gap-1.5">
            <Tag aria-hidden="true" className="size-3.5" />
            <dt className="sr-only">{t('portal.requests.category')}</dt>
            <dd>{ticket.categoryName ?? t('portal.requests.noCategory')}</dd>
          </div>

          <div className="flex items-center gap-1.5">
            <CalendarDays aria-hidden="true" className="size-3.5" />
            <dt className="sr-only">{t('portal.requests.opened')}</dt>
            <dd>{t('portal.requests.openedOn', { date: date(ticket.createdAt) })}</dd>
          </div>

          <div className="flex items-center gap-1.5">
            <dt className="sr-only">{t('portal.requests.lastUpdate')}</dt>
            <dd>{t('portal.requests.updatedOn', { date: date(ticket.updatedAt) })}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * The customer's own requests — US-84.
 *
 * **AC4 is unmet and deliberately absent.** A star rating on a resolved request
 * needs somewhere to send the stars, and rating is US-88 — deferred, with no
 * column and no endpoint. Five stars that discard the click would invite feedback
 * and silently throw it away, which is worse than not asking.
 */
export function PortalRequests(): React.JSX.Element {
  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>(ANY_STATUS);
  const [from, setFrom] = useState('');
  const [page, setPage] = useState(1);

  /**
   * Every filter goes to the server — AC2.
   *
   * Not a pass over the current page: the scope and the filter are one `where`
   * clause, and searching in the browser would search only whatever page
   * happened to be loaded.
   */
  const query: PortalTicketListQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(search === '' ? {} : { q: search }),
    ...(status === ANY_STATUS ? {} : { status: status as PortalTicketStatus }),
    ...(from === '' ? {} : { createdFrom: new Date(from).toISOString() }),
  };

  const requests = usePortalTickets(query);

  const filtered = search !== '' || status !== ANY_STATUS || from !== '';
  const tickets = requests.data?.data ?? [];
  const total = requests.data?.pagination.total ?? 0;

  const clear = (): void => {
    setSearch('');
    setStatus(ANY_STATUS);
    setFrom('');
    setPage(1);
  };

  return (
    <section aria-label={t('portal.requests.title')}>
      {/*
        AC2 — search, status and date. **Nothing else.** There is no assignee,
        department, branch or channel control here, and there is no field for one
        in the query contract either.
      */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Label htmlFor="portal-search" className="mb-1.5">
            {t('portal.requests.search')}
          </Label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="text-ink-faint absolute inset-y-0 start-0 my-auto ms-3 size-4"
            />
            <Input
              id="portal-search"
              type="search"
              className="text-start ps-9"
              placeholder={t('portal.requests.searchPlaceholder')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        <div className="w-44">
          <Label htmlFor="portal-status" className="mb-1.5">
            {t('portal.requests.statusLabel')}
          </Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger id="portal-status" aria-label={t('portal.requests.statusLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_STATUS}>{t('portal.requests.anyStatus')}</SelectItem>
              {STATUS_ORDER.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`portal.requests.status.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-44">
          <Label htmlFor="portal-from" className="mb-1.5">
            {t('portal.requests.openedSince')}
          </Label>
          <Input
            id="portal-from"
            type="date"
            className="text-start"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

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

          {total > PAGE_SIZE ? (
            <div className="mt-6 flex items-center justify-between gap-3">
              <p className="text-meta text-ink-muted">
                {t('portal.requests.showing', { count: tickets.length, total })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => {
                    setPage((value) => Math.max(1, value - 1));
                  }}
                >
                  {t('portal.requests.previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * PAGE_SIZE >= total}
                  onClick={() => {
                    setPage((value) => value + 1);
                  }}
                >
                  {t('portal.requests.next')}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
