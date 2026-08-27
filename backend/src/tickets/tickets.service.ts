import { Injectable, Logger } from '@nestjs/common';
import {
  buildPaginationMeta,
  toSkipTake,
  TICKET_VIEWS,
  type ApiPaginated,
  canTransition,
  STATUS_PERMISSION,
  type AssignableAgent,
  type AssignedSummary,
  type DistributionSlice,
  type TeamOverview,
  type AssignedTicketCount,
  type TicketCounts,
  type TicketView,
  type CreateTicket,
  type SlaState,
  type Ticket,
  type TicketDetail,
  type CreateTicketMessage,
  type TicketListQuery,
  type TicketMessage,
  type UpdateTicket,
  type PermissionKey,
  type TicketStatus,
} from '@crm/shared';

import { ApiException } from '../common/index.js';
import { PermissionsService, ticketScopeWhere } from '../permissions/index.js';
import { PrismaService } from '../prisma/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SlaClockService } from '../sla/sla-clock.service.js';
import {
  automationRuleOf,
  eventFor,
  statusEventFor,
  labelOf,
  FROM_LABEL_METADATA_KEY,
  TO_LABEL_METADATA_KEY,
  TicketHistoryService,
} from './ticket-history.service.js';

/** Who is asking, and what they may see. */
export interface TicketActor {
  userId: string;
  departmentId: string | null;
}

/**
 * How close a due date is before it counts as "due soon".
 *
 * The same threshold the frontend's `slaStateFor` uses, expressed the other way
 * round: a quarter of the target remaining. Kept here rather than imported so
 * the API's answer does not depend on a browser constant.
 */
const WARN_FRACTION = 0.25;

const TICKET_SELECT = {
  id: true,
  number: true,
  subject: true,
  status: true,
  priority: true,
  channel: true,
  assigneeId: true,
  categoryId: true,
  departmentId: true,
  branchId: true,
  tags: true,
  firstRespondedAt: true,
  firstResponseDueAt: true,
  firstResponseBreached: true,
  resolutionDueAt: true,
  resolutionBreached: true,
  // US-69, AC4. The pause columns have been maintained by US-68 since it was
  // written and read by nothing until now.
  slaPausedAt: true,
  slaPausedMs: true,
  createdAt: true,
  updatedAt: true,
  customer: {
    select: { id: true, firstName: true, lastName: true, email: true, companyName: true },
  },
  assignee: { select: { firstName: true, lastName: true } },
  category: { select: { nameEn: true, nameAr: true } },
  // One indexed join for what the policy promises — AC4 asks for the target, and
  // deriving it from createdAt to the deadline is wrong by the banked pause.
  slaPolicy: { select: { firstResponseMinutes: true, resolutionMinutes: true } },
} as const;

type TicketRow = Prisma.TicketGetPayload<{ select: typeof TICKET_SELECT }>;

/**
 * How many messages the workspace opens with — US-46, AC5.
 *
 * Enough that most tickets arrive whole and "load earlier" never appears, few
 * enough that a three-week thread does not ship a hundred bodies to render the
 * last three.
 */
const RECENT_MESSAGE_COUNT = 30;

/** One message, everything the timeline renders. */
const MESSAGE_SELECT = {
  id: true,
  senderType: true,
  body: true,
  isInternal: true,
  channel: true,
  createdAt: true,
  authorUser: { select: { firstName: true, lastName: true } },
  authorCustomer: { select: { firstName: true, lastName: true } },
  attachments: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, messageId: true, fileName: true, contentType: true, sizeBytes: true },
  },
} satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

/**
 * A message row as the API sends it.
 *
 * A free function rather than a method: the detail and the paged endpoint both
 * map messages, and two copies of this would drift the moment one of them
 * gained a field.
 */
function toMessage(row: MessageRow): TicketMessage {
  return {
    id: row.id,
    senderType: row.senderType,
    authorName:
      row.authorUser !== null
        ? `${row.authorUser.firstName} ${row.authorUser.lastName}`
        : row.authorCustomer !== null
          ? `${row.authorCustomer.firstName} ${row.authorCustomer.lastName}`
          : null,
    body: row.body,
    isInternal: row.isInternal,
    channel: row.channel,
    attachments: row.attachments,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The lifecycle timestamps a status change owes — US-47, AC4.
 *
 * `resolvedAt`, `closedAt` and `reopenCount` have been read by the detail
 * payload since US-40 and written by nothing. P11’s reports are why they
 * exist, so they are maintained here rather than left for a reporting story to
 * backfill out of history.
 *
 * A free function so the reopen path and the ordinary path cannot disagree
 * about what reopening means.
 */
function statusTimestamps(from: TicketStatus, to: TicketStatus): Prisma.TicketUpdateInput {
  if (to === 'RESOLVED') {
    return { resolvedAt: new Date() };
  }

  // Coming back from a finished state is a reopen, and the timestamps of the
  // ending that has just been undone must not survive it.
  if (to === 'WAITING_FOR_AGENT' && from === 'RESOLVED') {
    return { resolvedAt: null, closedAt: null, reopenCount: { increment: 1 } };
  }

  return {};
}

/**
 * How far back US-58's averages and daily buckets look.
 *
 * A window rather than all history, because "average response time" over two
 * years is a number that cannot move and therefore tells a manager nothing about
 * this month. Thirty days is what a monthly review looks at.
 */
const OVERVIEW_WINDOW_DAYS = 30;

/** The bound on any row-level fetch behind a dashboard figure. */
const OVERVIEW_ROW_CAP = 2_000;

/**
 * The mean gap between two timestamps, in whole seconds — US-58, AC1.
 *
 * Pairs whose second value is null are **skipped, not counted as zero**: a ticket
 * nobody has replied to yet is missing from the average rather than dragging it
 * to nothing. Returns null when there is nothing to average, because "no data"
 * and "instant" are different answers.
 */
function meanSecondsBetween(pairs: [Date, Date | null][]): number | null {
  let total = 0;
  let counted = 0;

  for (const [from, to] of pairs) {
    if (to === null) {
      continue;
    }

    total += Math.max(0, to.getTime() - from.getTime());
    counted += 1;
  }

  return counted === 0 ? null : Math.round(total / counted / 1000);
}

/**
 * Tickets per day across the window — AC2's "tickets over time".
 *
 * Every day in the window appears, including the empty ones: a line that skips
 * quiet days reads as though the quiet days were busy.
 */
function dailyBuckets(dates: Date[], from: Date, to: Date): DistributionSlice[] {
  const counts = new Map<string, number>();

  const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

  for (
    const cursor = new Date(dayKey(from));
    cursor.getTime() <= to.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    counts.set(dayKey(cursor), 0);
  }

  for (const date of dates) {
    const key = dayKey(date);

    if (counts.has(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return [...counts.entries()].map(([key, count]) => ({ key, label: key, count }));
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly history: TicketHistoryService,
    private readonly clock: SlaClockService,
  ) {}

  /**
   * AC4 — the caller's scope, as a `where` fragment.
   *
   * **Applied in the query, never after fetching.** This is the project's second
   * non-negotiable rule, and `ticketScopeWhere` fails closed: no grant resolves
   * to a filter that matches nothing, never to `{}`, which Prisma would read as
   * every row.
   */
  private async scopeFor(actor: TicketActor): Promise<Prisma.TicketWhereInput> {
    const scopes = await this.permissions.scopesFor(actor.userId, 'ticket:view');

    return ticketScopeWhere(scopes, {
      userId: actor.userId,
      departmentId: actor.departmentId,
    });
  }

  /**
   * Derived from the due dates, never stored.
   *
   * A stored state goes stale the moment a clock passes without anything
   * running, and then the queue lies about what is on fire. Computing it on
   * read costs nothing — the columns are already on the row.
   */
  private slaFor(row: TicketRow): Ticket['sla'] {
    const due = row.resolutionDueAt;

    if (due === null) {
      return {
        state: 'none',
        firstRespondedAt: row.firstRespondedAt?.toISOString() ?? null,
        firstResponseDueAt: row.firstResponseDueAt?.toISOString() ?? null,
        resolutionDueAt: null,
        firstResponseBreached: row.firstResponseBreached,
        resolutionBreached: row.resolutionBreached,
        secondsRemaining: null,
        pausedAt: row.slaPausedAt?.toISOString() ?? null,
        pausedMs: row.slaPausedMs,
        responseTargetMinutes: row.slaPolicy?.firstResponseMinutes ?? null,
        resolutionTargetMinutes: row.slaPolicy?.resolutionMinutes ?? null,
      };
    }

    const remainingMs = due.getTime() - Date.now();
    const totalMs = due.getTime() - row.createdAt.getTime();

    let state: SlaState = 'ok';

    if (row.resolutionBreached || remainingMs <= 0) {
      state = 'breach';
    } else if (totalMs > 0 && remainingMs / totalMs <= WARN_FRACTION) {
      state = 'warn';
    }

    return {
      state,
      firstRespondedAt: row.firstRespondedAt?.toISOString() ?? null,
      firstResponseDueAt: row.firstResponseDueAt?.toISOString() ?? null,
      resolutionDueAt: due.toISOString(),
      firstResponseBreached: row.firstResponseBreached,
      resolutionBreached: row.resolutionBreached,
      secondsRemaining: Math.round(remainingMs / 1000),
      pausedAt: row.slaPausedAt?.toISOString() ?? null,
      pausedMs: row.slaPausedMs,
      responseTargetMinutes: row.slaPolicy?.firstResponseMinutes ?? null,
      resolutionTargetMinutes: row.slaPolicy?.resolutionMinutes ?? null,
    };
  }

  private toTicket(row: TicketRow): Ticket {
    return {
      id: row.id,
      number: row.number,
      subject: row.subject,
      status: row.status,
      priority: row.priority,
      channel: row.channel,
      customer: row.customer,
      assigneeId: row.assigneeId,
      assigneeName:
        row.assignee === null ? null : `${row.assignee.firstName} ${row.assignee.lastName}`,
      categoryId: row.categoryId,
      categoryName: row.category === null ? null : row.category.nameEn,
      departmentId: row.departmentId,
      branchId: row.branchId,
      tags: row.tags,
      sla: this.slaFor(row),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * AC2 — every filter, in the database.
   *
   * The SLA filter is a **column comparison**, not a post-fetch pass: US-6
   * denormalised the due dates onto the ticket precisely so this could hit an
   * index rather than join out on every read.
   */
  private whereFrom(query: TicketListQuery): Prisma.TicketWhereInput {
    const where: Prisma.TicketWhereInput = {};
    const now = new Date();

    /**
     * Each independent `OR` group gets its own entry here.
     *
     * Merging them into a single `where.OR` — which an earlier version did —
     * turns an intersection into a union: "matches the search **or** is
     * breached" rather than "matches the search **and** is breached". A test
     * caught it, and it is exactly the kind of filter bug that looks like the
     * data being wrong rather than the query.
     */
    const groups: Prisma.TicketWhereInput[] = [];

    if (query.q !== undefined && query.q !== '') {
      const asNumber = Number.parseInt(query.q, 10);

      groups.push({
        OR: [
          { subject: { contains: query.q, mode: 'insensitive' } },
          { description: { contains: query.q, mode: 'insensitive' } },
          // An agent given "1043" over the phone types exactly that.
          ...(Number.isFinite(asNumber) ? [{ number: asNumber }] : []),
        ],
      });
    }

    for (const [key, value] of [
      ['status', query.status],
      ['priority', query.priority],
      ['categoryId', query.categoryId],
      ['customerId', query.customerId],
      ['departmentId', query.departmentId],
      ['branchId', query.branchId],
      ['channel', query.channel],
    ] as const) {
      if (value !== undefined) {
        (where as Record<string, unknown>)[key] = value;
      }
    }

    // Explicit `unassigned` rather than overloading `assigneeId=null`: a query
    // string cannot carry null, and "" would be indistinguishable from absent.
    if (query.unassigned === 'true') {
      where.assigneeId = null;
    } else if (query.assigneeId !== undefined) {
      where.assigneeId = query.assigneeId;
    }

    /**
     * AC3's "tickets requiring attention" — US-58.
     *
     * Open and **already past a target, or escalated**: the tickets a manager has
     * to act on now. One SQL group, so the scope, the sort, the paging and the
     * total are the queue's own and already correct.
     *
     * `resolutionDueAt < now` covers the minute between a deadline passing and
     * the sweep flagging it — without it the table would miss exactly the ticket
     * that just went late.
     *
     * The at-risk *fraction* is not here: it is a proportion of each ticket's own
     * target, so it cannot be a SQL comparison, and filtering fetched rows would
     * report a total that disagreed with the rows returned. That figure is the
     * dashboard's "SLA at risk" KPI instead.
     */
    if (query.attention === 'true') {
      groups.push({
        AND: [
          { status: { not: 'RESOLVED' } },
          {
            OR: [
              { firstResponseBreached: true },
              { resolutionBreached: true },
              { escalatedAt: { not: null } },
              { resolutionDueAt: { lt: now } },
            ],
          },
        ],
      });
    }

    if (query.createdFrom !== undefined || query.createdTo !== undefined) {
      where.createdAt = {
        ...(query.createdFrom === undefined ? {} : { gte: new Date(query.createdFrom) }),
        ...(query.createdTo === undefined ? {} : { lte: new Date(query.createdTo) }),
      };
    }

    switch (query.slaState) {
      case 'breach':
        // Its own group, so it intersects the search rather than widening it.
        groups.push({ OR: [{ resolutionBreached: true }, { resolutionDueAt: { lt: now } }] });
        break;

      case 'ok':
        groups.push({ resolutionDueAt: { gt: now }, resolutionBreached: false });
        break;

      case 'none':
        groups.push({ resolutionDueAt: null });
        break;

      case 'warn':
        // "Due soon" is a fraction of a per-ticket target, so it cannot be one
        // comparison against a fixed window. Narrowed to unbreached tickets
        // with a due date here, and finished in `list` — see the note there.
        groups.push({ resolutionDueAt: { gt: now }, resolutionBreached: false });
        break;

      default:
        break;
    }

    return groups.length === 0 ? where : { AND: [where, ...groups] };
  }

  /**
   * The `where` behind one of the queue's view tabs — US-42, AC4.
   *
   * Exported through `counts` and applied by `list` so the tab and its count
   * can never disagree about what the tab means. Two definitions of "Breached
   * SLA" is the failure mode a live count invites.
   */
  private viewWhere(view: TicketView, actor: TicketActor): Prisma.TicketWhereInput {
    const open: Prisma.TicketWhereInput = { status: { not: 'RESOLVED' } };

    switch (view) {
      case 'unassigned':
        return { ...open, assigneeId: null };

      case 'mine':
        return { ...open, assigneeId: actor.userId };

      case 'escalated':
        return { escalatedAt: { not: null }, status: { not: 'RESOLVED' } };

      case 'breached':
        // Both clocks. A response target missed is a broken promise even if the
        // ticket is later resolved on time, and an agent triaging needs to see
        // it in the same place.
        return {
          ...open,
          OR: [{ resolutionBreached: true }, { firstResponseBreached: true }],
        };

      case 'resolved':
        return { status: 'RESOLVED' };

      case 'all':
      default:
        return open;
    }
  }

  /**
   * AC4 — a live count per tab, in one round trip.
   *
   * Six counts rather than six list requests: the queue would otherwise ask the
   * API seven times to render one screen. Each count carries the caller's scope,
   * so an agent's "All" is their own queue and not the department's.
   */
  async counts(actor: TicketActor): Promise<TicketCounts> {
    const scope = await this.scopeFor(actor);

    const entries = await Promise.all(
      TICKET_VIEWS.map(async (view) => {
        const total = await this.prisma.notDeleted.ticket.count({
          where: { AND: [this.viewWhere(view, actor), scope] },
        });

        return [view, total] as const;
      }),
    );

    return Object.fromEntries(entries) as unknown as TicketCounts;
  }

  /**
   * What the sidebar badge shows — US-28, AC5, which has been waiting for this.
   *
   * `atRisk` counts the ticket the agent should look at next: already breached,
   * or inside the warning window. The warning window is a fraction of each
   * ticket's own target, so it is finished in application code for the same
   * reason `list` finishes the `warn` filter there — and over one agent's open
   * queue, which is tens of rows, not thousands.
   */
  async assignedCount(actor: TicketActor): Promise<AssignedTicketCount> {
    const where: Prisma.TicketWhereInput = {
      assigneeId: actor.userId,
      status: { not: 'RESOLVED' },
    };

    const rows = await this.prisma.notDeleted.ticket.findMany({
      where,
      select: TICKET_SELECT,
      take: 500,
    });

    const atRisk = rows
      .map((row) => this.slaFor(row).state)
      .filter((state) => state === 'warn' || state === 'breach').length;

    return { total: rows.length, atRisk };
  }

  /**
   * What an agent holds, for the dashboard's KPI row — US-55, AC1.
   *
   * **One query, four numbers.** The open assigned tickets are fetched once and
   * every figure is derived from them through `slaFor` — the same function the
   * queue and the ticket header use. The warning window is a fraction of each
   * ticket’s *own* target, so it cannot be one SQL comparison; `assignedCount`
   * made the same call over the same bounded set, for the same reason.
   *
   * **`assigneeId` and the caller’s scope are both in the `where`.** A ticket
   * assigned to me is inside any scope I could hold, so the scope clause can
   * never widen this — but rule #2 says scoped permissions are applied in the
   * query, and a redundant clause that cannot widen is cheaper than an argument
   * about whether it was needed.
   */
  async assignedSummary(actor: TicketActor, now = new Date()): Promise<AssignedSummary> {
    const scope = await this.scopeFor(actor);
    const mine: Prisma.TicketWhereInput = { AND: [{ assigneeId: actor.userId }, scope] };

    const rows = await this.prisma.notDeleted.ticket.findMany({
      where: { AND: [mine, { status: { not: 'RESOLVED' } }] },
      select: TICKET_SELECT,
      take: 500,
    });

    let pending = 0;
    let dueSoon = 0;
    let breached = 0;

    for (const row of rows) {
      if (row.status === 'WAITING_FOR_CUSTOMER') {
        pending += 1;
      }

      const { state } = this.slaFor(row);

      if (state === 'warn') {
        dueSoon += 1;
      }

      // The sweep’s flags as well as the arithmetic: a response target missed is
      // a broken promise even when the resolution clock is still comfortable.
      if (state === 'breach' || row.firstResponseBreached || row.resolutionBreached) {
        breached += 1;
      }
    }

    /**
     * The one figure with an honest past value — US-55, AC1.
     *
     * A ticket was open a week ago if it existed then and had not been finished
     * then, which `createdAt`, `resolvedAt` and `closedAt` can answer. The other
     * three cannot: the status then is not stored, the breach flags are
     * current-only, and "due soon" is a window relative to now. Those return
     * `null` rather than a number nobody can defend.
     *
     * **Assignment is taken as current**, because `assigneeId` is a column and
     * not a history. A ticket reassigned to me yesterday counts in both figures;
     * the alternative is scanning `TicketHistory` per ticket on a dashboard load.
     */
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const openThen = await this.prisma.notDeleted.ticket.count({
      where: {
        AND: [
          mine,
          { createdAt: { lte: weekAgo } },
          { OR: [{ resolvedAt: null }, { resolvedAt: { gt: weekAgo } }] },
          { OR: [{ closedAt: null }, { closedAt: { gt: weekAgo } }] },
        ],
      },
    });

    return {
      open: { value: rows.length, previous: openThen },
      pending: { value: pending, previous: null },
      dueSoon: { value: dueSoon, previous: null },
      breached: { value: breached, previous: null },
    };
  }

  /**
   * The team, as a manager sees it — US-58, AC1 and AC2.
   *
   * **Scope comes from the caller's token and nothing else.** `scopeFor` reads
   * their `ticket:view` grants and returns the `where` fragment; every query
   * below carries it.
   *
   * **`departmentId` and `branchId` are filters, not scope selectors.** They are
   * `AND`ed with the scope clause and can therefore only narrow it: an
   * administrator filtering by a department sees that department, and a manager
   * filtering by somebody else’s sees zero — scope ∩ filter, which is the
   * correct answer rather than an error. Nothing the request sends can widen
   * what the token allows, because the scope clause is not built from it.
   *
   * **No dashboard definitions.** "Open" is the same `notIn` the queue uses and
   * the SLA figures come from `slaFor`, exactly as in US-55.
   */
  async teamOverview(
    actor: TicketActor,
    filters: { departmentId?: string | undefined; branchId?: string | undefined } = {},
    now = new Date(),
  ): Promise<TeamOverview> {
    const scope = await this.scopeFor(actor);

    const inScope: Prisma.TicketWhereInput = {
      AND: [
        scope,
        ...(filters.departmentId === undefined ? [] : [{ departmentId: filters.departmentId }]),
        ...(filters.branchId === undefined ? [] : [{ branchId: filters.branchId }]),
      ],
    };

    const openWhere: Prisma.TicketWhereInput = {
      AND: [inScope, { status: { not: 'RESOLVED' } }],
    };

    /** The averages and the daily buckets read one bounded window. */
    const windowStart = new Date(now.getTime() - OVERVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [
      open,
      unassigned,
      openRows,
      statusGroups,
      priorityGroups,
      departmentGroups,
      agentGroups,
      windowRows,
    ] = await Promise.all([
      this.prisma.notDeleted.ticket.count({ where: openWhere }),
      this.prisma.notDeleted.ticket.count({
        where: { AND: [openWhere, { assigneeId: null }] },
      }),
      // The SLA figures need `slaFor`, which is per-row arithmetic against
      // each ticket’s own target. Bounded, like `assignedCount` and US-55.
      this.prisma.notDeleted.ticket.findMany({
        where: openWhere,
        select: TICKET_SELECT,
        take: OVERVIEW_ROW_CAP,
      }),
      this.prisma.notDeleted.ticket.groupBy({
        by: ['status'],
        where: inScope,
        _count: { _all: true },
      }),
      this.prisma.notDeleted.ticket.groupBy({
        by: ['priority'],
        where: inScope,
        _count: { _all: true },
      }),
      this.prisma.notDeleted.ticket.groupBy({
        by: ['departmentId'],
        where: inScope,
        _count: { _all: true },
      }),
      this.prisma.notDeleted.ticket.groupBy({
        by: ['assigneeId'],
        where: openWhere,
        _count: { _all: true },
      }),
      // Two purposes, one fetch: the averages and AC2’s daily buckets.
      this.prisma.notDeleted.ticket.findMany({
        where: { AND: [inScope, { createdAt: { gte: windowStart } }] },
        select: { createdAt: true, firstRespondedAt: true, resolvedAt: true },
        take: OVERVIEW_ROW_CAP,
      }),
    ]);

    let atRisk = 0;
    let breached = 0;

    for (const row of openRows) {
      const { state } = this.slaFor(row);

      if (state === 'warn') {
        atRisk += 1;
      }

      if (state === 'breach' || row.firstResponseBreached || row.resolutionBreached) {
        breached += 1;
      }
    }

    return {
      open,
      unassigned,
      atRisk,
      breached,
      averageResponseSeconds: meanSecondsBetween(
        windowRows.map((row) => [row.createdAt, row.firstRespondedAt]),
      ),
      averageResolutionSeconds: meanSecondsBetween(
        windowRows.map((row) => [row.createdAt, row.resolvedAt]),
      ),
      byStatus: statusGroups.map((group) => ({
        key: group.status,
        label: group.status,
        count: group._count._all,
      })),
      byPriority: priorityGroups.map((group) => ({
        key: group.priority,
        label: group.priority,
        count: group._count._all,
      })),
      byDepartment: await this.labelledSlices(
        departmentGroups.map((group) => ({ id: group.departmentId, count: group._count._all })),
        'department',
      ),
      byAgent: await this.labelledSlices(
        agentGroups.map((group) => ({ id: group.assigneeId, count: group._count._all })),
        'user',
      ),
      overTime: dailyBuckets(
        windowRows.map((row) => row.createdAt),
        windowStart,
        now,
      ),
    };
  }

  /**
   * Turns grouped ids into named slices — AC2.
   *
   * One indexed read per kind rather than a join on the group-by, and a null id
   * becomes an explicit "unassigned" / "no department" slice rather than being
   * dropped: a manager needs to see that ten tickets belong to nobody.
   */
  private async labelledSlices(
    groups: { id: string | null; count: number }[],
    kind: 'department' | 'user',
  ): Promise<DistributionSlice[]> {
    const ids = groups.map((group) => group.id).filter((id): id is string => id !== null);

    const names = new Map<string, string>();

    if (ids.length > 0) {
      if (kind === 'department') {
        const rows = await this.prisma.notDeleted.department.findMany({
          where: { id: { in: ids } },
          select: { id: true, nameEn: true },
        });

        for (const row of rows) names.set(row.id, row.nameEn);
      } else {
        const rows = await this.prisma.notDeleted.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true },
        });

        for (const row of rows) names.set(row.id, `${row.firstName} ${row.lastName}`);
      }
    }

    return groups.map((group) => ({
      key: group.id ?? 'none',
      label: group.id === null ? 'none' : (names.get(group.id) ?? 'none'),
      count: group.count,
    }));
  }

  async list(query: TicketListQuery, actor: TicketActor): Promise<ApiPaginated<Ticket>> {
    const where: Prisma.TicketWhereInput = {
      AND: [
        this.whereFrom(query),
        ...(query.view === undefined ? [] : [this.viewWhere(query.view, actor)]),
        await this.scopeFor(actor),
      ],
    };

    const dir = query.dir ?? 'desc';

    const orderBy: Prisma.TicketOrderByWithRelationInput =
      query.sort === 'priority'
        ? { priority: dir }
        : query.sort === 'number'
          ? { number: dir }
          : query.sort === 'sla'
            ? // Nulls last so tickets with no policy do not crowd the top of a
              // queue sorted by urgency.
              { resolutionDueAt: { sort: dir, nulls: 'last' } }
            : query.sort === 'createdAt'
              ? { createdAt: dir }
              : { updatedAt: dir };

    const { skip, take } = toSkipTake(query);

    const [rows, total] = await Promise.all([
      this.prisma.notDeleted.ticket.findMany({
        where,
        select: TICKET_SELECT,
        orderBy,
        skip,
        take,
      }),
      this.prisma.notDeleted.ticket.count({ where }),
    ]);

    const tickets = rows.map((row) => this.toTicket(row));

    /**
     * The one filter finished outside the database, and the reason is stated
     * rather than hidden: "due soon" is a *fraction* of each ticket's own
     * target, so it cannot be expressed as one comparison against a fixed
     * window. The query above has already narrowed to unbreached tickets with a
     * due date, so this refines a page, never a table.
     *
     * A generated column holding the fraction would move it fully into SQL.
     * That is worth doing when a screen sorts by it; nothing does yet.
     */
    if (query.slaState === 'warn') {
      const warned = tickets.filter((ticket) => ticket.sla.state === 'warn');

      return {
        data: warned,
        pagination: buildPaginationMeta({
          page: query.page,
          pageSize: query.pageSize,
          total: warned.length,
        }),
      };
    }

    return {
      data: tickets,
      pagination: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
    };
  }

  /**
   * AC3 — the whole workspace in one response.
   *
   * Five round trips would otherwise mean five spinners on one screen.
   *
   * **Every message is returned, internal notes included.** This is the staff
   * API; the portal (US-82) is a different controller with `isInternal: false`
   * in its query. Filtering here would break the agent's own timeline, which is
   * the thing internal notes exist for.
   */
  async detail(id: string, actor: TicketActor): Promise<TicketDetail> {
    const scope = await this.scopeFor(actor);

    const row = await this.prisma.notDeleted.ticket.findFirst({
      where: { AND: [{ id }, scope] },
      select: {
        ...TICKET_SELECT,
        description: true,
        resolvedAt: true,
        closedAt: true,
        reopenCount: true,
        // The name for the header, the minutes for AC4’s target — US-69.
        slaPolicy: {
          select: { nameEn: true, firstResponseMinutes: true, resolutionMinutes: true },
        },
        // Newest first here, reversed below: "the most recent thirty" is a
        // descending query, and the timeline reads oldest-to-newest.
        messages: {
          orderBy: { createdAt: 'desc' },
          take: RECENT_MESSAGE_COUNT,
          select: MESSAGE_SELECT,
        },
        _count: { select: { messages: true } },
        attachments: {
          select: { id: true, messageId: true, fileName: true, contentType: true, sizeBytes: true },
        },
        history: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            eventType: true,
            field: true,
            fromValue: true,
            toValue: true,
            createdAt: true,
            metadata: true,
            actor: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    // Out of scope and not found are the same answer on purpose: telling
    // somebody a ticket exists but is not theirs is still telling them it
    // exists.
    if (row === null) {
      throw ApiException.notFound('That ticket');
    }

    return {
      ...this.toTicket(row),
      description: row.description,
      slaPolicyName: row.slaPolicy?.nameEn ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      reopenCount: row.reopenCount,
      messages: [...row.messages].reverse().map(toMessage),
      messageCount: row._count.messages,
      attachments: row.attachments,
      history: row.history.map((entry) => ({
        id: entry.id,
        eventType: entry.eventType,
        field: entry.field,
        fromValue: entry.fromValue,
        toValue: entry.toValue,
        fromLabel: labelOf(entry.metadata, FROM_LABEL_METADATA_KEY),
        toLabel: labelOf(entry.metadata, TO_LABEL_METADATA_KEY),
        actorName: entry.actor === null ? null : `${entry.actor.firstName} ${entry.actor.lastName}`,
        automationRule: automationRuleOf(entry.metadata),
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  /**
   * AC1 — a ticket, with a sequential number.
   *
   * The number comes from PostgreSQL's own sequence (`@default(autoincrement())`),
   * so two agents submitting at the same instant cannot collide. Generating it
   * in application code would need a lock, and would still be wrong under two
   * replicas.
   */
  async create(input: CreateTicket, actor: TicketActor): Promise<Ticket> {
    const customer = await this.prisma.notDeleted.customer.findFirst({
      where: { id: input.customerId },
      select: { id: true },
    });

    if (customer === null) {
      throw ApiException.unprocessable('That customer does not exist.');
    }

    const row = await this.prisma.ticket.create({
      data: {
        customerId: input.customerId,
        subject: input.subject,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
        priority: input.priority ?? 'MEDIUM',
        departmentId: input.departmentId ?? null,
        branchId: input.branchId ?? null,
        channel: input.channel,
        tags: input.tags ?? [],
      },
      select: TICKET_SELECT,
    });

    await this.history.record({
      ticketId: row.id,
      actorUserId: actor.userId,
      eventType: 'CREATED',
    });

    // US-68, AC1. After the insert rather than inside it, because the deadline
    // is measured from the ticket's own `createdAt` and the policy is chosen
    // from the values the database actually stored.
    await this.clock.applyOnCreate(row.id);

    this.logger.log(`Created ticket #${String(row.number)}`);

    // Re-read so the caller sees the deadlines rather than the nulls the insert
    // returned. One extra indexed read on a create is worth an API response
    // that agrees with the database.
    const withSla = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: row.id },
      select: TICKET_SELECT,
    });

    return this.toTicket(withSla);
  }

  /**
   * Older messages, on demand — US-46, AC5.
   *
   * Newest first, because paging backwards through a conversation is how you
   * read one: page 1 is the most recent slice the detail already showed, page 2
   * is what came before it.
   *
   * Scope is enforced by loading the ticket through `detail` first, the same
   * way the history endpoint does. One place decides who may see what.
   *
   * **Internal notes are included.** This is the staff API and an internal note
   * is the thing they exist for; the portal (US-82) is a separate controller
   * that queries `isInternal: false`.
   */
  async messages(
    id: string,
    actor: TicketActor,
    options: { skip: number; take: number; includeInternal?: boolean },
  ): Promise<{ messages: TicketMessage[]; total: number }> {
    await this.detail(id, actor);

    /**
     * **The project's first non-negotiable rule, as a query.**
     *
     * `includeInternal` defaults to true because this is the staff API and a
     * note is the thing notes exist for. US-82's portal passes `false`, and
     * when it does the filter is applied **in the database** — not by dropping
     * rows after fetching them, which the rule explicitly forbids and which
     * would also leave the count wrong.
     *
     * The count uses the same `where` for that reason: a portal that says
     * "12 messages" and shows 9 has leaked the existence of three notes even
     * though it never rendered them.
     */
    const where: Prisma.MessageWhereInput =
      options.includeInternal === false ? { ticketId: id, isInternal: false } : { ticketId: id };

    const [rows, total] = await Promise.all([
      this.prisma.notDeleted.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: options.skip,
        take: options.take,
        select: MESSAGE_SELECT,
      }),
      this.prisma.notDeleted.message.count({ where }),
    ]);

    return { messages: rows.map(toMessage), total };
  }

  /**
   * An agent writes into the conversation — US-1.
   *
   * `isInternal` decides everything downstream, and it comes from the caller
   * rather than from anything inferred. The project's first non-negotiable rule
   * lives here: what this flag says is what the portal (US-82) filters on, so
   * getting it from the request body and storing it verbatim is the whole
   * mechanism.
   *
   * Scope is enforced by loading the ticket through `detail` first, the same
   * way the read endpoints do.
   *
   * The SLA clock is told **only** about a customer-facing reply — an internal
   * note is not a response to the customer, and letting one stop the response
   * clock would mean an agent could satisfy a service commitment by writing a
   * note to themselves. `SlaClockService.onAgentReply` refuses an internal one
   * anyway; passing the flag through keeps the two agreeing rather than relying
   * on that.
   */
  async addMessage(
    id: string,
    input: CreateTicketMessage,
    actor: TicketActor,
  ): Promise<TicketMessage> {
    const ticket = await this.detail(id, actor);

    const row = await this.prisma.message.create({
      data: {
        ticketId: id,
        senderType: 'AGENT',
        authorUserId: actor.userId,
        body: input.body,
        isInternal: input.isInternal,
        channel: input.channel ?? ticket.channel,
      },
      select: MESSAGE_SELECT,
    });

    if (!input.isInternal) {
      // "Waiting on us" versus "waiting on them" is a column comparison rather
      // than a correlated subquery over messages — US-6 denormalised it for
      // exactly this write.
      await this.prisma.ticket.update({
        where: { id },
        data: { lastAgentReplyAt: row.createdAt },
      });

      if (ticket.status === 'NEW' || ticket.status === 'WAITING_FOR_AGENT') {
        await this.prisma.ticket.update({
          where: { id },
          data: {
            status: 'WAITING_FOR_CUSTOMER',
            ...statusTimestamps(ticket.status, 'WAITING_FOR_CUSTOMER'),
          },
        });
        await this.clock.onStatusChange(id, ticket.status, 'WAITING_FOR_CUSTOMER');
        await this.history.record({
          ticketId: id,
          actorUserId: actor.userId,
          eventType: 'STATUS_CHANGED',
          field: 'status',
          fromValue: ticket.status,
          toValue: 'WAITING_FOR_CUSTOMER',
        });
      }
    }

    await this.clock.onAgentReply(id, { isInternal: input.isInternal, at: row.createdAt });

    return toMessage(row);
  }

  /**
   * AC5 — every field change is recorded.
   *
   * The before image is read inside the same call so the history entry can say
   * what the value *was*, which is the half of an audit trail that makes it
   * worth keeping.
   */
  async update(id: string, input: UpdateTicket, actor: TicketActor): Promise<Ticket> {
    const scope = await this.scopeFor(actor);

    const before = await this.prisma.notDeleted.ticket.findFirst({
      where: { AND: [{ id }, scope] },
      select: {
        subject: true,
        description: true,
        categoryId: true,
        priority: true,
        departmentId: true,
        branchId: true,
        assigneeId: true,
      },
    });

    if (before === null) {
      throw ApiException.notFound('That ticket');
    }

    const data: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        data[key] = value;
      }
    }

    /**
     * AC4 — a category carries a department with it.
     *
     * `Category.departmentId` has been a documented routing hint since US-6.
     * Applying it here rather than in the client means it holds for every
     * caller: the workspace, US-41's create screen, and whatever files a ticket
     * from an inbound email in P13.
     *
     * **A hint, not a rule.** It is skipped when the same request also sets a
     * department explicitly, because an agent moving a ticket to a specific
     * team meant that, and having the category quietly overrule them is the
     * kind of behaviour that makes people stop trusting a form.
     */
    if (
      input.categoryId !== undefined &&
      input.categoryId !== null &&
      input.categoryId !== before.categoryId &&
      input.departmentId === undefined
    ) {
      const category = await this.prisma.notDeleted.category.findFirst({
        where: { id: input.categoryId },
        select: { departmentId: true },
      });

      if (category?.departmentId != null) {
        data['departmentId'] = category.departmentId;
      }
    }

    const row = await this.prisma.ticket.update({
      where: { id },
      data,
      select: TICKET_SELECT,
    });

    await this.history.recordChanges(id, actor.userId, before, data);

    // US-68, AC6. Priority decides which policy applies, so changing it changes
    // the targets — recomputed from the original start, never from now.
    if (data['priority'] !== undefined && data['priority'] !== before.priority) {
      await this.clock.onPriorityChange(id);

      const recomputed = await this.prisma.ticket.findUniqueOrThrow({
        where: { id },
        select: TICKET_SELECT,
      });

      return this.toTicket(recomputed);
    }

    return this.toTicket(row);
  }

  /**
   * Who this caller may hand a ticket to — US-48, AC2 and AC5.
   *
   * **Candidacy is derived from permissions, not from role names.** A candidate
   * is somebody who holds `ticket:update` through one of their roles, because
   * that is precisely the permission needed to work the ticket once they have
   * it. Matching on `role.key IN ('agent', 'manager')` would be a second
   * definition of "an agent" to keep in step with the catalogue, and it would
   * silently exclude every custom role an administrator ever creates.
   *
   * `customerProfile` must be absent as well. The `customer` role deliberately
   * holds `ticket:view` and `ticket:create` and **not** `ticket:update`, so the
   * permission clause already excludes portal users — this second clause is what
   * keeps that true if somebody ever grants a customer role more than they meant
   * to.
   *
   * Scope is applied here, in the query. `ALL` sees every candidate, `TEAM` sees
   * their own department. Anything else sees only themselves: no seeded role
   * grants `ticket:assign` at `OWN` or `ASSIGNED`, but a guard that lets someone
   * through still has to answer with something defensible rather than everybody.
   */
  private async assignableWhere(actor: TicketActor): Promise<Prisma.UserWhereInput> {
    const scopes = await this.permissions.scopesFor(actor.userId, 'ticket:assign');

    const candidate: Prisma.UserWhereInput = {
      customerProfile: { is: null },
      roles: {
        some: { role: { permissions: { some: { permission: { key: 'ticket:update' } } } } },
      },
    };

    if (scopes.includes('ALL')) {
      return candidate;
    }

    if (scopes.includes('TEAM')) {
      // A manager with no department of their own would otherwise match every
      // user whose department is also null. Fail closed: themselves.
      return actor.departmentId === null
        ? { ...candidate, id: actor.userId }
        : { ...candidate, departmentId: actor.departmentId };
    }

    return { ...candidate, id: actor.userId };
  }

  /**
   * The assignee picker's options — US-48, AC2 and AC5.
   *
   * Inactive candidates are **returned, marked unavailable**, rather than
   * filtered out. AC5 asks for two things at once, and dropping them satisfies
   * neither: a ticket whose assignee has since been deactivated still has to
   * render that person's name, or the control claims "Unassigned" for a ticket
   * that is assigned. The picker disables the row, so they are visible and not
   * offered.
   *
   * The open counts are **one** query. A count per candidate is how a picker
   * becomes the slowest thing on the screen, and it is four rows today and four
   * hundred in any real deployment.
   */
  async assignees(actor: TicketActor): Promise<AssignableAgent[]> {
    const rows = await this.prisma.notDeleted.user.findMany({
      where: await this.assignableWhere(actor),
      orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        isActive: true,
        department: { select: { nameEn: true } },
      },
    });

    if (rows.length === 0) {
      return [];
    }

    const workload = await this.prisma.notDeleted.ticket.groupBy({
      by: ['assigneeId'],
      where: {
        assigneeId: { in: rows.map((row) => row.id) },
        // The same definition of "open" the queue's views use.
        status: { not: 'RESOLVED' },
      },
      _count: { _all: true },
    });

    const openFor = new Map(
      workload.map((group) => [group.assigneeId, group._count._all] as const),
    );

    return rows.map((row) => ({
      id: row.id,
      name: `${row.firstName} ${row.lastName}`,
      email: row.email,
      departmentName: row.department?.nameEn ?? null,
      openTicketCount: openFor.get(row.id) ?? 0,
      isAvailable: row.isActive,
    }));
  }

  /**
   * Assign, reassign, or unassign — US-48, AC1 and AC3.
   *
   * Its own operation rather than a field on `update`, and the reason is not
   * tidiness: `assigneeId` used to be in `UpdateTicketSchema`, which meant
   * `PATCH /tickets/:id` reassigned tickets under `ticket:update` — a permission
   * every agent holds, and not the one that names this action. The controller's
   * guard is now the boundary, and this method is the second half of it.
   *
   * **The candidate is validated, not trusted.** Holding `ticket:assign` says
   * nothing about *whom* you may assign to, so the target has to come back from
   * the same `assignableWhere` that builds the picker. One query defines the set;
   * a separate rule here would be a second definition that has to agree.
   */
  async assign(id: string, assigneeId: string | null, actor: TicketActor): Promise<Ticket> {
    const scope = await this.scopeFor(actor);

    const before = await this.prisma.notDeleted.ticket.findFirst({
      where: { AND: [{ id }, scope] },
      select: {
        status: true,
        assigneeId: true,
        assignee: { select: { firstName: true, lastName: true } },
      },
    });

    if (before === null) {
      throw ApiException.notFound('That ticket');
    }

    let assigneeName: string | null = null;

    if (assigneeId !== null) {
      const candidate = await this.prisma.notDeleted.user.findFirst({
        where: { AND: [{ id: assigneeId }, await this.assignableWhere(actor)] },
        select: { firstName: true, lastName: true, isActive: true },
      });

      if (candidate === null) {
        throw ApiException.unprocessable('That person cannot be assigned this ticket.');
      }

      // AC5, enforced on the server as well as rendered in the picker. The
      // frontend disables the row; this is what makes it true for every caller.
      if (!candidate.isActive) {
        throw ApiException.unprocessable('That person is not available.');
      }

      assigneeName = `${candidate.firstName} ${candidate.lastName}`;
    }

    // Nothing to record when nothing moved. A PATCH that re-sends the current
    // assignee should leave no trace, the same way `recordChanges` treats an
    // unchanged field.
    if (before.assigneeId === assigneeId) {
      const unchanged = await this.prisma.ticket.findUniqueOrThrow({
        where: { id },
        select: TICKET_SELECT,
      });

      return this.toTicket(unchanged);
    }

    let newStatus: 'WAITING_FOR_AGENT' | undefined = undefined;
    if (before.status === 'NEW' && assigneeId !== null) {
      newStatus = 'WAITING_FOR_AGENT';
    }

    const data: Prisma.TicketUncheckedUpdateInput = { assigneeId };
    if (newStatus) {
      data.status = newStatus;
      Object.assign(data, statusTimestamps(before.status, newStatus));
    }

    const row = await this.prisma.ticket.update({
      where: { id },
      data,
      select: TICKET_SELECT,
    });

    /**
     * AC6 — the names, so the timeline can say who had it before.
     *
     * `fromValue` and `toValue` keep the ids; the labels are what the workspace
     * renders. Both are captured now rather than joined on read, because history
     * describes what was true when it happened.
     */
    await this.history.record({
      ticketId: id,
      actorUserId: actor.userId,
      eventType: eventFor('assigneeId', assigneeId),
      field: 'assigneeId',
      fromValue: before.assigneeId ?? undefined,
      toValue: assigneeId ?? undefined,
      fromLabel:
        before.assignee === null
          ? null
          : `${before.assignee.firstName} ${before.assignee.lastName}`,
      toLabel: assigneeName,
    });

    if (newStatus) {
      await this.clock.onStatusChange(id, before.status, newStatus);
      await this.history.record({
        ticketId: id,
        actorUserId: actor.userId,
        eventType: 'STATUS_CHANGED',
        field: 'status',
        fromValue: before.status,
        toValue: newStatus,
      });
    }

    /**
     * AC1's "the agent is notified" — as far as it can go today.
     *
     * P07 is deferred by the MVP scope, so there is no notification channel to
     * send to. What the new assignee actually gets is the ticket appearing in
     * their queue and in their sidebar badge; this line is the traceable record
     * in the meantime, and the event US-62 consumes when it arrives.
     */
    this.logger.log(
      assigneeId === null
        ? `Ticket ${id} unassigned by ${actor.userId}`
        : `Ticket ${id} assigned to ${assigneeId} by ${actor.userId}`,
    );

    return this.toTicket(row);
  }
  /**
   * Move a ticket through its lifecycle — US-47.
   *
   * The endpoint US-40 promised when it refused `status` on the general PATCH:
   * "a second, unguarded door onto the same state machine". This is the guarded
   * one, and it does four things in order — check the move is legal, check the
   * caller may make *this* move, write the status with its timestamps, then tell
   * the clock and the timeline.
   *
   * **The extra permission is checked here rather than by a guard.** Every status
   * change needs `ticket:update`, which the route states declaratively; resolving
   * and closing additionally need `ticket:close`, and escalating needs
   * `ticket:escalate`. That is a property of the *destination*, so it belongs
   * with the rest of the transition rules — splitting `/resolve` and `/escalate`
   * into routes of their own would scatter one state machine across three doors.
   */
  async changeStatus(id: string, to: TicketStatus, actor: TicketActor): Promise<Ticket> {
    const scope = await this.scopeFor(actor);

    const before = await this.prisma.notDeleted.ticket.findFirst({
      where: { AND: [{ id }, scope] },
      select: { status: true },
    });

    if (before === null) {
      throw ApiException.notFound('That ticket');
    }

    const from = before.status;

    // Nothing moved. Same rule the rest of the service follows: a request that
    // re-sends the current value leaves no trace.
    if (from === to) {
      return this.toTicket(
        await this.prisma.ticket.findUniqueOrThrow({ where: { id }, select: TICKET_SELECT }),
      );
    }

    if (!canTransition(from, to)) {
      throw ApiException.unprocessable(`A ticket cannot move from ${from} to ${to}.`);
    }

    const required = STATUS_PERMISSION[to];

    if (required !== undefined) {
      const scopes = await this.permissions.scopesFor(actor.userId, required as PermissionKey);

      if (scopes.length === 0) {
        throw ApiException.forbidden(`You do not have permission to set a ticket to ${to}.`);
      }
    }

    const row = await this.prisma.ticket.update({
      where: { id },
      data: { status: to, ...statusTimestamps(from, to) },
      select: TICKET_SELECT,
    });

    /**
     * AC4 — the clock reacts.
     *
     * `SlaClockService.onStatusChange` was written by US-68 and has had no
     * caller until now: it pauses the resolution clock on `WAITING_FOR_CUSTOMER`,
     * stops it on `RESOLVED`, and adds the banked pause back to the
     * deadline on the way out. Nothing about that arithmetic is repeated here.
     */
    await this.clock.onStatusChange(id, from, to);

    await this.history.record({
      ticketId: id,
      actorUserId: actor.userId,
      eventType: statusEventFor(from, to),
      field: 'status',
      fromValue: from,
      toValue: to,
    });

    return this.toTicket(row);
  }

  /**
   * A customer replied to a resolved ticket, so it is open again — US-47, AC5.
   *
   * **Nothing calls this yet.** No code path writes a customer message: the staff
   * composer hardcodes `senderType: 'AGENT'`, and the portal reply endpoint is
   * US-85 in wave 4. The rule is built and tested here because it is a lifecycle
   * rule, and the portal story is the wrong owner for one — the same split US-1
   * used for the internal-note filter it could not yet demonstrate.
   *
   * Attributed to **no actor**: no member of staff reopened it. The customer is
   * not a `User` in the sense `actorUserId` means, and naming whoever last
   * touched the ticket would be the lie US-50's AC3 exists to prevent.
   */
  async onCustomerReply(ticketId: string): Promise<void> {
    const ticket = await this.prisma.notDeleted.ticket.findFirst({
      where: { id: ticketId },
      select: { id: true, status: true, assigneeId: true },
    });

    if (ticket === null) {
      return;
    }

    if (ticket.status === 'RESOLVED') {
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: 'WAITING_FOR_AGENT', ...statusTimestamps('RESOLVED', 'WAITING_FOR_AGENT') },
      });

      // Restarts the resolution clock the same way an agent's move would.
      await this.clock.onStatusChange(ticketId, 'RESOLVED', 'WAITING_FOR_AGENT');

      await this.history.record({
        ticketId,
        actorUserId: null,
        eventType: 'REOPENED',
        field: 'status',
        fromValue: 'RESOLVED',
        toValue: 'WAITING_FOR_AGENT',
      });

      /**
       * AC5's "the assigned agent is notified" — as far as it goes today.
       *
       * P07 is deferred, so there is no channel. The reopen shows up in the
       * agent's queue and sidebar badge, and this line is the traceable record
       * until US-62 has something to send.
       */
      this.logger.log(
        `Ticket ${ticketId} reopened by a customer reply (assignee ${ticket.assigneeId ?? 'none'})`,
      );
    } else if (ticket.status === 'WAITING_FOR_CUSTOMER') {
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: 'WAITING_FOR_AGENT' },
      });
      await this.clock.onStatusChange(ticketId, 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_AGENT');
      await this.history.record({
        ticketId,
        actorUserId: null,
        eventType: 'STATUS_CHANGED',
        field: 'status',
        fromValue: 'WAITING_FOR_CUSTOMER',
        toValue: 'WAITING_FOR_AGENT',
      });
    } else {
      return;
    }
  }
}
