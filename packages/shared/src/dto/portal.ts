/**
 * The customer-facing contract — US-82.
 *
 * **These schemas are built from nothing, deliberately. They are not derived
 * from `TicketSchema` with an `omit`, and nothing here should ever become one.**
 *
 * That is the whole safety property of this file. An `omit` list is a denylist:
 * the day somebody adds `escalationReason` or `internalNotes` to the staff DTO,
 * every portal response inherits it and the omit list does not know. Listing the
 * customer-facing fields explicitly makes it an allowlist — a new staff field
 * simply does not appear, and putting it in front of a customer takes a
 * deliberate edit to this file.
 *
 * **The project's first non-negotiable rule lives here and in the portal
 * service's queries: an internal note must never reach a customer.** What is
 * absent from these types is as load-bearing as what is present — no `sla`, no
 * `assigneeId`, no `departmentId`, no `escalatedAt`, no internal `status`, and no
 * `history`. See `backend/src/portal/portal.service.ts` for the query side.
 */
import { z } from 'zod';

import { TicketStatusSchema, type TicketStatus } from './ticket.js';

/**
 * What a customer is told about where their request stands — US-82, AC3.
 *
 * Five values, and deliberately fewer than the internal seven. `PENDING_INTERNAL`
 * and `ESCALATED` describe what the support team is doing among themselves; AC2
 * requires their absence, and this set is where that happens.
 */
export const PortalTicketStatusSchema = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_YOU',
  'RESOLVED',
  'CLOSED',
]);

export type PortalTicketStatus = z.infer<typeof PortalTicketStatusSchema>;

/**
 * Internal status to customer-facing status.
 *
 * Exhaustive over `TicketStatus` by construction — a `Record`, not a lookup with
 * a fallback — so a status added to the enum later is a **compile error** rather
 * than a value that leaks through a default branch.
 *
 * `ESCALATED` reads as "In Progress": true from the customer's point of view, and
 * it tells them nothing about an internal escalation.
 */
export const PORTAL_STATUS: Record<TicketStatus, PortalTicketStatus> = {
  NEW: 'OPEN',
  OPEN: 'IN_PROGRESS',
  PENDING_INTERNAL: 'IN_PROGRESS',
  ESCALATED: 'IN_PROGRESS',
  PENDING_CUSTOMER: 'WAITING_ON_YOU',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
};

/** The mapping as a function, for callers that have a value rather than a key. */
export function toPortalStatus(status: TicketStatus): PortalTicketStatus {
  return PORTAL_STATUS[status];
}

/** Only what a customer needs to recognise their own file on a request. */
export const PortalAttachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

export type PortalAttachment = z.infer<typeof PortalAttachmentSchema>;

/**
 * One message in a conversation a customer can see.
 *
 * **There is no `isInternal` field**, and that is not an oversight: an internal
 * note never reaches this type at all, so a flag saying "this one is internal"
 * would only ever be false. A boolean whose true case cannot occur is an
 * invitation to start sending the true case.
 *
 * `authorName` is a **first name** for staff — AC2 allows the assignee's first
 * name and no more, so "Layla replied" is sayable and the staff directory is not
 * handed out. A customer's own messages carry their own name.
 */
export const PortalMessageSchema = z.object({
  id: z.string().uuid(),
  /** Who wrote it, from the customer's point of view. */
  author: z.enum(['you', 'support']),
  authorName: z.string().nullable(),
  body: z.string(),
  attachments: z.array(PortalAttachmentSchema),
  createdAt: z.string().datetime(),
});

export type PortalMessage = z.infer<typeof PortalMessageSchema>;

/** A request as it appears in the customer's own list. */
export const PortalTicketSchema = z.object({
  id: z.string().uuid(),
  /** The reference a customer quotes on the phone. */
  number: z.number().int().positive(),
  subject: z.string(),
  status: PortalTicketStatusSchema,
  /** What the customer chose when they raised it, if anything. */
  categoryName: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PortalTicket = z.infer<typeof PortalTicketSchema>;

/**
 * One request, with its conversation.
 *
 * Extends the list shape with the description, the messages and the attachments
 * a customer may see — and nothing else. Compare with `TicketDetailSchema`,
 * which additionally carries the SLA block, the policy name, the assignee, the
 * department, the branch, tags, the reopen count and a hundred history entries.
 * None of that is here, and none of it should arrive by inheritance.
 */
export const PortalTicketDetailSchema = PortalTicketSchema.extend({
  description: z.string().nullable(),
  /** A first name, or null when nobody is working it yet — AC2. */
  assigneeFirstName: z.string().nullable(),
  messages: z.array(PortalMessageSchema),
  /**
   * The number of messages **the customer can see**.
   *
   * Counted from the same filtered query the messages come from. A portal that
   * says "12 messages" and renders 9 has disclosed the existence of three
   * internal notes without ever showing one.
   */
  messageCount: z.number().int().nonnegative(),
  resolvedAt: z.string().datetime().nullable(),
});

export type PortalTicketDetail = z.infer<typeof PortalTicketDetailSchema>;

/** Paging for the customer's own list. Kept minimal on purpose. */
export const PortalTicketListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
  status: PortalTicketStatusSchema.optional(),
});

export type PortalTicketListQuery = z.infer<typeof PortalTicketListQuerySchema>;

/**
 * Which internal statuses a customer-facing filter value covers.
 *
 * The inverse of `PORTAL_STATUS`, so filtering by "In Progress" in the portal
 * becomes an `IN` clause over the internal statuses **in the query** rather than
 * a pass over fetched rows.
 */
export function internalStatusesFor(status: PortalTicketStatus): TicketStatus[] {
  return TicketStatusSchema.options.filter((internal) => PORTAL_STATUS[internal] === status);
}
