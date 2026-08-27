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

import { ChannelSchema } from './customer.js';
import { TicketStatusSchema, type TicketPriority, type TicketStatus } from './ticket.js';

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
 * Something that happened to a request, as the customer is told it — US-85, AC6.
 *
 * **A closed set of kinds, not the ticket's history.** AC6 asks for status
 * changes in plain language; US-82 requires that internal history never reaches
 * a customer. Both hold because this carries a `kind` and a time and nothing
 * else: no actor name (AC3 limits identity, and the story's own example sentence
 * names nobody), no field, no from/to values, and no internal status string.
 *
 * The sentences live in the client's translations, so the API never sends prose
 * that would then need translating.
 */
export const PORTAL_EVENT_KINDS = [
  'received',
  'assigned',
  'in_progress',
  'waiting_on_you',
  'resolved',
  'closed',
  'reopened',
] as const;

export const PortalEventKindSchema = z.enum(PORTAL_EVENT_KINDS);

export type PortalEventKind = z.infer<typeof PortalEventKindSchema>;

export const PortalEventSchema = z.object({
  id: z.string().uuid(),
  kind: PortalEventKindSchema,
  createdAt: z.string().datetime(),
});

export type PortalEvent = z.infer<typeof PortalEventSchema>;

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
  /**
   * What has happened to the request, in customer-facing terms — US-85, AC6.
   *
   * Deliberately **not** the ticket's history: see the schema above. Only the
   * kinds a customer has a stake in, with no actor and no internal values.
   */
  events: z.array(PortalEventSchema),
});

export type PortalTicketDetail = z.infer<typeof PortalTicketDetailSchema>;

/**
 * How a customer narrows their own list — US-84, AC2.
 *
 * **AC2 says only search, status and date, and this schema is how that becomes
 * true.** There is nowhere to put a department, a branch, an assignee or a
 * channel, so a customer cannot filter by one — the same allowlist argument
 * US-82 made about the response, applied to the request.
 *
 * `q` searches the **subject and the number** and nothing else. A customer
 * recognises a request by its subject line or by the number they were given;
 * searching message bodies would have a portal query reading rows that the
 * internal-note filter exists to keep out of reach.
 */
export const PortalTicketListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
  status: PortalTicketStatusSchema.optional(),
  q: z.string().trim().max(200).optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
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

/**
 * How urgent the customer says it is — US-86, AC2.
 *
 * **Plain words on the wire, not priority names.** The customer never sees
 * `LOW`/`MEDIUM`/`HIGH` and never sends them; the mapping below is the only
 * place the two vocabularies meet.
 */
export const PORTAL_URGENCY = ['whenever', 'soon', 'blocked'] as const;

export const PortalUrgencySchema = z.enum(PORTAL_URGENCY);

export type PortalUrgency = z.infer<typeof PortalUrgencySchema>;

/**
 * Plain urgency to internal priority — AC2's "mapped to priority behind the
 * scenes".
 *
 * **`URGENT` is deliberately unreachable.** Every customer's problem is urgent
 * to them, and a self-service field that sets the tightest SLA target is a field
 * that is always set to the tightest SLA target. Raising a ticket to `URGENT` is
 * triage, which US-49 gives agents. Because this map has no `URGENT` value, the
 * API cannot be talked into one — there is no accepted input that produces it.
 */
export const URGENCY_PRIORITY: Record<PortalUrgency, TicketPriority> = {
  whenever: 'LOW',
  soon: 'MEDIUM',
  blocked: 'HIGH',
};

/**
 * A category as the portal offers it — US-86, AC1.
 *
 * `id` and a resolved `name`, and nothing else. The staff `Category` also
 * carries `departmentId`, `departmentName` and `defaultPriority`, which is
 * exactly the internal routing detail the allowlist exists to keep out: a
 * customer does not need to know which team a category routes to, and telling
 * them invites them to shop for one.
 */
export const PortalCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export type PortalCategory = z.infer<typeof PortalCategorySchema>;

/**
 * What a customer may submit — US-86.
 *
 * **Everything a customer must not choose is absent from this schema**, which is
 * stronger than validating it away: `customerId` (resolved from the token, and a
 * body field here would be one customer filing against another), `channel` (it
 * arrived through the portal — an observed fact, not a preference),
 * `departmentId`, `branchId`, `tags` and `status`. A request cannot ask for any
 * of them because the contract has nowhere to put them.
 */
export const SubmitPortalTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(20_000),
  /** Optional: a customer who does not know the category should not be stuck. */
  categoryId: z.string().uuid().optional(),
  urgency: PortalUrgencySchema,
  /**
   * How they would like to be reached — AC1's "preferred contact method".
   *
   * Recorded on the customer record. **Nothing is sent to it:** recording a
   * preference is not integrating with a channel, and the channels themselves
   * are P13.
   */
  preferredContact: ChannelSchema.optional(),
});

export type SubmitPortalTicket = z.infer<typeof SubmitPortalTicketSchema>;

/**
 * A customer's reply — US-85.
 *
 * **`isInternal` is absent, and that is the point.** It is not defaulted here
 * and not read from the body anywhere: the portal hardcodes `false` on the
 * insert. A customer-authored internal note is a contradiction, and the flag the
 * whole of the project's first non-negotiable rule hangs on must not be
 * reachable from a customer-facing request.
 *
 * No `ticketId` either — that is the path — and no `customerId`, which comes
 * from the token.
 */
export const PortalReplySchema = z.object({
  body: z.string().trim().min(1).max(20_000),
});

export type PortalReply = z.infer<typeof PortalReplySchema>;
