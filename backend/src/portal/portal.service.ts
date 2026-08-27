import { Injectable, Logger } from '@nestjs/common';
import {
  internalStatusesFor,
  toPortalStatus,
  type PortalMessage,
  type PortalTicket,
  type PortalTicketDetail,
  type PortalTicketListQuery,
} from '@crm/shared';

import { ApiException } from '../common/index.js';
import { PrismaService } from '../prisma/index.js';
import type { Prisma } from '../generated/prisma/client.js';

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

  constructor(private readonly prisma: PrismaService) {}

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
}
