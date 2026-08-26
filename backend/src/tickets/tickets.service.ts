import { Injectable, Logger } from '@nestjs/common';
import {
  buildPaginationMeta,
  toSkipTake,
  type ApiPaginated,
  type CreateTicket,
  type SlaState,
  type Ticket,
  type TicketDetail,
  type TicketListQuery,
  type UpdateTicket,
} from '@crm/shared';

import { ApiException } from '../common/index.js';
import { PermissionsService, ticketScopeWhere } from '../permissions/index.js';
import { PrismaService } from '../prisma/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { TicketHistoryService } from './ticket-history.service.js';

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
} as const;

type TicketRow = Prisma.TicketGetPayload<{ select: typeof TICKET_SELECT }>;

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly history: TicketHistoryService,
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

  async list(query: TicketListQuery, actor: TicketActor): Promise<ApiPaginated<Ticket>> {
    const where: Prisma.TicketWhereInput = {
      AND: [this.whereFrom(query), await this.scopeFor(actor)],
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
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            senderType: true,
            body: true,
            isInternal: true,
            createdAt: true,
            authorUser: { select: { firstName: true, lastName: true } },
            authorCustomer: { select: { firstName: true, lastName: true } },
          },
        },
        attachments: {
          select: { id: true, fileName: true, contentType: true, sizeBytes: true },
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
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      reopenCount: row.reopenCount,
      messages: row.messages.map((message) => ({
        id: message.id,
        senderType: message.senderType,
        authorName:
          message.authorUser !== null
            ? `${message.authorUser.firstName} ${message.authorUser.lastName}`
            : message.authorCustomer !== null
              ? `${message.authorCustomer.firstName} ${message.authorCustomer.lastName}`
              : null,
        body: message.body,
        isInternal: message.isInternal,
        createdAt: message.createdAt.toISOString(),
      })),
      attachments: row.attachments,
      history: row.history.map((entry) => ({
        id: entry.id,
        eventType: entry.eventType,
        field: entry.field,
        fromValue: entry.fromValue,
        toValue: entry.toValue,
        actorName: entry.actor === null ? null : `${entry.actor.firstName} ${entry.actor.lastName}`,
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

    this.logger.log(`Created ticket #${String(row.number)}`);

    return this.toTicket(row);
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

    const row = await this.prisma.ticket.update({
      where: { id },
      data,
      select: TICKET_SELECT,
    });

    await this.history.recordChanges(id, actor.userId, before, data);

    return this.toTicket(row);
  }
}
