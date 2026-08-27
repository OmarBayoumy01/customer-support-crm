import { Injectable, Logger } from '@nestjs/common';
import {
  PORTAL_STATUS,
  URGENCY_PRIORITY,
  internalStatusesFor,
  toPortalStatus,
  type PortalMessage,
  type PortalTicket,
  type PortalTicketDetail,
  type PortalCategory,
  type PortalEvent,
  type PortalEventKind,
  type PortalReply,
  type PortalTicketListQuery,
  type SubmitPortalTicket,
} from '@crm/shared';

import { ApiException } from '../common/index.js';
import { PrismaService } from '../prisma/index.js';
import { CategoriesService } from '../categories/index.js';
import { TicketsService } from '../tickets/index.js';
import type { Prisma, TicketStatus } from '../generated/prisma/client.js';

/**
 * Everything the portal may read about a ticket — US-82, AC2.
 *
 * **An allowlist, and the absences are the point.** No `slaPolicyId`, no due
 * dates, no `assigneeId`, no `departmentId`, no `branchId`, no `escalatedAt`, no
 * `reopenCount`, no `tags`. The assignee is joined for a **first name only**,
 * which is the most AC2 allows.
 */
const PORTAL_TICKET_SELECT = {
  id: true,
  number: true,
  subject: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { nameEn: true, nameAr: true } },
} as const;

type PortalTicketRow = Prisma.TicketGetPayload<{ select: typeof PORTAL_TICKET_SELECT }>;

/**
 * One message a customer may see, and its attachments — US-82, AC2.
 *
 * **The attachment filter is the vector that filtering messages does not
 * cover.** `Attachment` has no `isInternal` column of its own: a file is
 * internal because the message carrying it is. Selecting attachments through the
 * message — rather than off the ticket, as the staff detail does — is what keeps
 * `escalation-to-legal.pdf` out of a portal response. A filename discloses
 * intent with no body text at all.
 */
const PORTAL_MESSAGE_SELECT = {
  id: true,
  senderType: true,
  body: true,
  createdAt: true,
  authorUser: { select: { firstName: true } },
  authorCustomer: { select: { firstName: true, lastName: true } },
  attachments: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, fileName: true, contentType: true, sizeBytes: true },
  },
} satisfies Prisma.MessageSelect;

type PortalMessageRow = Prisma.MessageGetPayload<{ select: typeof PORTAL_MESSAGE_SELECT }>;

/** How many messages a portal detail opens with. Older ones page separately. */
const RECENT_MESSAGE_COUNT = 30;

/**
 * Which history entries a customer is told about — US-85, AC6.
 *
 * **An allowlist returning a kind, never the entry itself.** AC6 asks for
 * status changes in plain language; US-82 requires that internal history never
 * reaches a customer. Both hold because this returns one of seven kinds or
 * `null`, and carries no actor, no field name, no from/to values and no
 * internal status string.
 *
 * A `STATUS_CHANGED` entry is mapped **through `PORTAL_STATUS`** and emitted only
 * when the customer-facing status actually moved. So `OPEN -> PENDING_INTERNAL`
 * produces nothing — both read as "In Progress" — and an escalation produces
 * nothing at all, which is what keeps AC6 from undoing US-82 AC2.
 *
 * Everything not named here is dropped: priority changes, category changes,
 * department moves, escalations, SLA breaches and unassignments are the
 * support desk talking to itself.
 */
export function portalEventKindFor(entry: {
  eventType: string;
  fromValue: string | null;
  toValue: string | null;
}): PortalEventKind | null {
  switch (entry.eventType) {
    case 'CREATED':
      return 'received';

    case 'ASSIGNED':
      return 'assigned';

    case 'REOPENED':
      return 'reopened';

    case 'CLOSED':
      return 'closed';

    case 'STATUS_CHANGED': {
      const to = PORTAL_STATUS[entry.toValue as TicketStatus] ?? null;
      const from =
        entry.fromValue === null ? null : (PORTAL_STATUS[entry.fromValue as TicketStatus] ?? null);

      // A move the customer cannot see is not an event they should be told
      // about — and an unrecognised status is dropped rather than guessed at.
      if (to === null || to === from) {
        return null;
      }

      if (to === 'IN_PROGRESS') return 'in_progress';
      if (to === 'WAITING_ON_YOU') return 'waiting_on_you';
      if (to === 'RESOLVED') return 'resolved';
      if (to === 'CLOSED') return 'closed';

      // `OPEN` is only ever the starting state, which `CREATED` already covers.
      return null;
    }

    default:
      return null;
  }
}

/**
 * The customer-scoped API — US-82.
 *
 * **This service is the boundary the project's first non-negotiable rule is
 * enforced at.** Two rules hold in every method, without exception:
 *
 * 1. **`isInternal: false` is in the `where` of every message query**, and of
 *    every count taken over messages. Not applied to fetched rows — the rule
 *    forbids that, and a filtered list beside an unfiltered count leaks the
 *    existence of what was filtered.
 * 2. **`customerId` is in the `where` of every query**, resolved from the
 *    authenticated token and from nothing else (AC1).
 *
 * On (2): the `OWN` permission scope from US-13 produces exactly the right
 * clause and is **deliberately not used here.** A permission scope is
 * configuration, so an administrator who ever granted a customer-facing role
 * `ticket:view` at `ALL` would silently widen the portal to every ticket in the
 * platform. The portal's scope must not be something anybody can misconfigure:
 * it is derived from the authenticated identity, in the query, every time.
 */
@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categoryList: CategoriesService,
    /**
     * Reused for the business rules a ticket must have and nothing else — US-86.
     *
     * `TicketsService.create` owns the sequential number from Postgres's own
     * sequence, the `CREATED` history entry and the SLA clock start. Those are
     * rules about what a ticket *is*, not about who may make one, and
     * reimplementing them here would be two clocks and two numbering schemes.
     *
     * **It imports no authorisation.** `create` has never done permission work —
     * its caller's guard does — and the `customerId` it receives here is the one
     * this service resolved from the portal token.
     */
    private readonly ticketRules: TicketsService,
  ) {}

  /**
   * The `Customer` behind a portal token — AC1, and it fails closed.
   *
   * A portal `User` with no linked `Customer` gets 403 rather than an unscoped
   * query. There is no version of this that returns "no filter": the only two
   * outcomes are a customer id or a refusal.
   */
  async customerIdFor(userId: string): Promise<string> {
    const customer = await this.prisma.notDeleted.customer.findFirst({
      where: { userId },
      select: { id: true },
    });

    if (customer === null) {
      this.logger.warn(`Portal request from user ${userId} with no linked customer record`);

      throw ApiException.forbidden('This account has no customer record.');
    }

    return customer.id;
  }

  private toTicket(row: PortalTicketRow, locale: 'EN' | 'AR'): PortalTicket {
    return {
      id: row.id,
      number: row.number,
      subject: row.subject,
      // AC3 — the internal status never reaches the payload.
      status: toPortalStatus(row.status),
      categoryName:
        row.category === null ? null : locale === 'AR' ? row.category.nameAr : row.category.nameEn,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * A message as the customer reads it.
   *
   * `SYSTEM` is folded into `support` rather than exposed as a third author kind:
   * a customer does not need to know which of the support side's messages came
   * from a person and which from the platform.
   */
  private static toMessage(row: PortalMessageRow): PortalMessage {
    const fromCustomer = row.senderType === 'CUSTOMER';

    return {
      id: row.id,
      author: fromCustomer ? 'you' : 'support',
      authorName: fromCustomer
        ? row.authorCustomer === null
          ? null
          : `${row.authorCustomer.firstName} ${row.authorCustomer.lastName}`
        : // A first name and no more — AC2. "Layla replied" is sayable; the staff
          // directory is not handed out.
          (row.authorUser?.firstName ?? null),
      body: row.body,
      attachments: row.attachments,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * The customer's own requests — AC1.
   *
   * The status filter is translated to the internal statuses it covers and
   * applied **in the query**, so filtering by "In Progress" is an `IN` clause
   * rather than a pass over fetched rows.
   */
  async tickets(
    customerId: string,
    query: PortalTicketListQuery,
    locale: 'EN' | 'AR' = 'EN',
  ): Promise<{ tickets: PortalTicket[]; total: number }> {
    const where: Prisma.TicketWhereInput = {
      customerId,
      ...(query.status === undefined ? {} : { status: { in: internalStatusesFor(query.status) } }),
    };

    /**
     * AC2's search — subject and number, in the query — US-84.
     *
     * **Not the description and not the message bodies.** A customer recognises
     * a request by its subject line or by the number they were given, and
     * searching message text would have a portal query reading rows that the
     * internal-note filter exists to keep out of reach.
     *
     * The number is matched when the term is one, because "1042" is how a
     * customer refers to a request out loud.
     */
    if (query.q !== undefined && query.q !== '') {
      const asNumber = Number.parseInt(query.q, 10);

      where.OR = [
        { subject: { contains: query.q, mode: 'insensitive' } },
        ...(Number.isNaN(asNumber) ? [] : [{ number: asNumber }]),
      ];
    }

    /**
     * AC2's date filter, on the day the request was opened.
     *
     * Both ends are optional, so "since March" and "before April" are each a
     * sentence a customer might mean on their own.
     */
    if (query.createdFrom !== undefined || query.createdTo !== undefined) {
      where.createdAt = {
        ...(query.createdFrom === undefined ? {} : { gte: new Date(query.createdFrom) }),
        ...(query.createdTo === undefined ? {} : { lte: new Date(query.createdTo) }),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.notDeleted.ticket.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: PORTAL_TICKET_SELECT,
      }),
      this.prisma.notDeleted.ticket.count({ where }),
    ]);

    return { tickets: rows.map((row) => this.toTicket(row, locale)), total };
  }

  /**
   * One of the customer's requests, with the conversation they may see.
   *
   * A ticket belonging to somebody else answers **404, not 403** — the same
   * choice the staff API made, for the same reason: telling somebody a ticket
   * exists but is not theirs still tells them it exists.
   */
  async ticket(
    customerId: string,
    ticketId: string,
    locale: 'EN' | 'AR' = 'EN',
  ): Promise<PortalTicketDetail> {
    const row = await this.prisma.notDeleted.ticket.findFirst({
      // Ownership in the `where`, never checked after the fact.
      where: { id: ticketId, customerId },
      select: {
        ...PORTAL_TICKET_SELECT,
        description: true,
        resolvedAt: true,
        assignee: { select: { firstName: true } },
      },
    });

    if (row === null) {
      throw ApiException.notFound('That request');
    }

    const { messages, total } = await this.messages(customerId, ticketId, {
      skip: 0,
      take: RECENT_MESSAGE_COUNT,
    });

    return {
      ...this.toTicket(row, locale),
      events: await this.events(ticketId),
      description: row.description,
      // AC2 — a first name, or nothing.
      assigneeFirstName: row.assignee?.firstName ?? null,
      // Oldest first: a conversation reads downwards.
      messages: [...messages].reverse(),
      messageCount: total,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }

  /**
   * A page of the conversation, newest first.
   *
   * **This is where the project's first non-negotiable rule is enforced.**
   *
   * `isInternal: false` is part of the `where`, so an internal note is never
   * fetched — not fetched and dropped, which the rule explicitly forbids. The
   * count uses the **same** `where`, because a portal reporting a total that
   * includes notes it will not show has disclosed that they exist.
   *
   * The ticket's ownership is in the same query rather than checked beforehand,
   * so there is no window in which a message is read for a ticket that turns out
   * not to belong to the caller.
   */
  async messages(
    customerId: string,
    ticketId: string,
    options: { skip: number; take: number },
  ): Promise<{ messages: PortalMessage[]; total: number }> {
    const where: Prisma.MessageWhereInput = {
      isInternal: false,
      ticket: { id: ticketId, customerId },
    };

    const [rows, total] = await Promise.all([
      this.prisma.notDeleted.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: options.skip,
        take: options.take,
        select: PORTAL_MESSAGE_SELECT,
      }),
      this.prisma.notDeleted.message.count({ where }),
    ]);

    return { messages: rows.map((row) => PortalService.toMessage(row)), total };
  }

  /**
   * The categories a customer may file under — US-86, AC1.
   *
   * Reuses `CategoriesService.list` for the rows and then **narrows them**: the
   * staff `Category` carries `departmentId`, `departmentName` and
   * `defaultPriority`, which is the internal routing detail US-82's allowlist
   * exists to keep out. A customer who can see which team a category routes to is
   * a customer who can shop for one.
   */
  async categories(locale: 'EN' | 'AR' = 'EN'): Promise<PortalCategory[]> {
    const rows = await this.categoryList.list();

    return rows.map((row) => ({
      id: row.id,
      name: locale === 'AR' ? row.nameAr : row.nameEn,
    }));
  }

  /**
   * A customer raises a request — US-86.
   *
   * **`customerId` is a parameter, resolved by the controller from the portal
   * token, and there is nowhere in `SubmitPortalTicket` to put one.** That is the
   * whole ownership guarantee: not a check that the body matches the token, but a
   * contract with no field to disagree about.
   *
   * Four things the server decides and the customer cannot ask for:
   *
   * - `channel: 'WEB'` — it *arrived* through the portal. An observed fact, not a
   *   preference, and not the same thing as the contact method they prefer.
   * - `departmentId` / `branchId` — internal routing. A customer choosing a
   *   department is a customer choosing whose SLA target they get.
   * - `tags` — an internal vocabulary.
   * - `status` — the schema's `NEW`. Triage is staff work.
   *
   * The priority comes from `URGENCY_PRIORITY`, which has no `URGENT` entry, so
   * no accepted input produces the tightest SLA target.
   */
  async submit(
    /**
     * Both halves come from the token: the customer the request belongs to, and
     * the user who raised it. Neither is ever read from the body.
     */
    actor: { customerId: string; userId: string },
    input: SubmitPortalTicket,
    locale: 'EN' | 'AR' = 'EN',
  ): Promise<PortalTicketDetail> {
    const { customerId } = actor;
    if (input.categoryId !== undefined) {
      // Existing **and active**: a stale id should be refused rather than filed
      // under a category nobody is watching any more.
      const category = await this.prisma.notDeleted.category.findFirst({
        where: { id: input.categoryId, isActive: true },
        select: { id: true },
      });

      if (category === null) {
        throw ApiException.unprocessable('That category is not available.');
      }
    }

    /**
     * AC1's preferred contact method, recorded where the domain already models
     * it — `Customer.preferredChannel`.
     *
     * **Nothing is sent to it.** Recording a preference is not integrating with a
     * channel; the channels themselves are P13.
     */
    if (input.preferredContact !== undefined) {
      await this.prisma.customer.update({
        where: { id: customerId },
        data: { preferredChannel: input.preferredContact },
      });
    }

    const created = await this.ticketRules.create(
      {
        customerId,
        subject: input.subject,
        description: input.description,
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        priority: URGENCY_PRIORITY[input.urgency],
        channel: 'WEB',
      },
      // Used only to attribute the `CREATED` history entry, which is correct:
      // the customer really did create it.
      { userId: actor.userId, departmentId: null },
    );

    this.logger.log(`Portal request #${String(created.number)} raised by customer ${customerId}`);

    /**
     * Read back through the portal's own path rather than mapping `create`'s
     * return value.
     *
     * `TicketsService.create` returns the **staff** `Ticket` — the SLA block, the
     * assignee, the department, the internal status. Going back through
     * `ticket()` means the submit response and the read response are the same
     * allowlisted shape by construction, rather than by two functions agreeing
     * with each other for as long as somebody keeps them in step.
     */
    return this.ticket(customerId, created.id, locale);
  }

  /**
   * What has happened to the request, as the customer is told it — US-85, AC6.
   *
   * The **allowlist** is `portalEventKindFor`; anything it does not name is
   * dropped. The rows are read oldest first because a customer reads a thread
   * downwards, and the entry's id is reused so the client has a stable key
   * without this inventing one.
   *
   * Ownership is not re-checked here: every caller has already been through
   * `ticket()`, which refuses a request that is not the caller's. A second check
   * would be a second place that has to agree about who may see what.
   */
  async events(ticketId: string): Promise<PortalEvent[]> {
    const rows = await this.prisma.ticketHistory.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, eventType: true, fromValue: true, toValue: true, createdAt: true },
    });

    const events: PortalEvent[] = [];

    for (const row of rows) {
      const kind = portalEventKindFor(row);

      if (kind !== null) {
        events.push({ id: row.id, kind, createdAt: row.createdAt.toISOString() });
      }
    }

    return events;
  }

  /**
   * The customer replies — US-85.
   *
   * **`isInternal` is hardcoded `false` and appears nowhere in `PortalReply`.**
   * Not defaulted, not read from the body: a customer-authored internal note is a
   * contradiction, and the flag the whole of the project's first non-negotiable
   * rule hangs on must not be reachable from a customer-facing request.
   *
   * Ownership is in the same query that finds the ticket, so there is no window
   * between checking and writing.
   */
  async reply(
    actor: { customerId: string; userId: string },
    ticketId: string,
    input: PortalReply,
    locale: 'EN' | 'AR' = 'EN',
  ): Promise<PortalTicketDetail> {
    const ticket = await this.prisma.notDeleted.ticket.findFirst({
      where: { id: ticketId, customerId: actor.customerId },
      select: { id: true, status: true },
    });

    if (ticket === null) {
      // 404, not 403 — a 403 would confirm the request exists.
      throw ApiException.notFound('That request');
    }

    /**
     * A closed request does not take replies — US-85, and an interpretation
     * worth stating.
     *
     * **This is not a new lifecycle rule:** nothing transitions and nothing is
     * added to the state machine. US-47 decided that a customer reply reopens a
     * `RESOLVED` request and deliberately not a `CLOSED` one, so a reply here
     * would sit in a ticket that is in no open queue — a message nobody is
     * coming for, acknowledged with a success message. Refusing says so instead.
     * US-90 is the story that gives a customer a way back into a closed request.
     */
    if (ticket.status === 'CLOSED') {
      throw ApiException.unprocessable(
        'This request is closed. Please raise a new one and we will pick it up.',
      );
    }

    const message = await this.prisma.message.create({
      data: {
        ticketId,
        senderType: 'CUSTOMER',
        // Attribution from the token, never from the body.
        authorCustomerId: actor.customerId,
        body: input.body,
        // Hardcoded. See the method comment.
        isInternal: false,
        channel: 'WEB',
      },
      select: { id: true, createdAt: true },
    });

    // Denormalisation US-6 added and nothing has written: "waiting on us" versus
    // "waiting on them" is a column comparison rather than a subquery over
    // messages. Not a lifecycle rule.
    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { lastCustomerReplyAt: message.createdAt },
    });

    /**
     * US-47's reopen rule, called for the first time.
     *
     * `onCustomerReply` reopens a `RESOLVED` request to `OPEN`, clears
     * `resolvedAt`, increments `reopenCount`, writes a `REOPENED` entry with no
     * actor and restarts the clock. Anything else it leaves alone. **That
     * transition is used exactly as US-47 defined it** — this story adds no state
     * and no rule of its own.
     */
    await this.ticketRules.onCustomerReply(ticketId);

    this.logger.log(`Customer ${actor.customerId} replied to request ${ticketId}`);

    return this.ticket(actor.customerId, ticketId, locale);
  }
}
