import { Injectable, Logger } from '@nestjs/common';
import {
  buildPaginationMeta,
  toSkipTake,
  TICKET_VIEWS,
  type ApiPaginated,
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
} from '@crm/shared';

import { ApiException } from '../common/index.js';
import { PermissionsService, ticketScopeWhere } from '../permissions/index.js';
import { PrismaService } from '../prisma/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SlaClockService } from '../sla/sla-clock.service.js';
import { automationRuleOf, TicketHistoryService } from './ticket-history.service.js';

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
  firstResponseDueAt: true,
  firstResponseBreached: true,
  resolutionDueAt: true,
  resolutionBreached: true,
  createdAt: true,
  updatedAt: true,
  customer: {
    select: { id: true, firstName: true, lastName: true, email: true, companyName: true },
  },
  assignee: { select: { firstName: true, lastName: true } },
  category: { select: { nameEn: true, nameAr: true } },
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
        firstResponseDueAt: row.firstResponseDueAt?.toISOString() ?? null,
        resolutionDueAt: null,
        firstResponseBreached: row.firstResponseBreached,
        resolutionBreached: row.resolutionBreached,
        secondsRemaining: null,
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
      firstResponseDueAt: row.firstResponseDueAt?.toISOString() ?? null,
      resolutionDueAt: due.toISOString(),
      firstResponseBreached: row.firstResponseBreached,
      resolutionBreached: row.resolutionBreached,
      secondsRemaining: Math.round(remainingMs / 1000),
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
    const open: Prisma.TicketWhereInput = { status: { notIn: ['RESOLVED', 'CLOSED'] } };

    switch (view) {
      case 'unassigned':
        return { ...open, assigneeId: null };

      case 'mine':
        return { ...open, assigneeId: actor.userId };

      case 'escalated':
        return { status: 'ESCALATED' };

      case 'breached':
        // Both clocks. A response target missed is a broken promise even if the
        // ticket is later resolved on time, and an agent triaging needs to see
        // it in the same place.
        return {
          ...open,
          OR: [{ resolutionBreached: true }, { firstResponseBreached: true }],
        };

      case 'closed':
        return { status: { in: ['RESOLVED', 'CLOSED'] } };

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
      status: { notIn: ['RESOLVED', 'CLOSED'] },
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
        slaPolicy: { select: { nameEn: true } },
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
}
