/**
 * The ticket contract, shared by both sides — US-40.
 *
 * The spine: nineteen of the twenty-eight stories in the MVP slice touch this.
 */
import { z } from 'zod';

import { ChannelSchema } from './customer.js';
import { TicketViewSchema } from './ticket-counts.js';
import { PaginationQuerySchema } from '../api/pagination.js';

/** Matches `TicketStatus` in the Prisma schema. */
export const TicketStatusSchema = z.enum([
  'NEW',
  'OPEN',
  'PENDING_CUSTOMER',
  'PENDING_INTERNAL',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

/**
 * Which statuses a ticket may move to from each status — US-47, AC2.
 *
 * **One map, shared.** AC2 asks for two things that must not disagree: the
 * control offers only valid moves, and the server rejects invalid ones. Two
 * lists would drift, and the failure is the worst kind — the screen invites a
 * move and the server answers with an error for doing what was offered.
 *
 * Three decisions worth stating:
 *
 * - **`NEW` is never a target.** It means "nobody has looked at this yet", which
 *   stops being true the moment somebody does. A ticket cannot become
 *   un-triaged.
 * - **`NEW` may go straight to `CLOSED`.** Spam and duplicates are closed, not
 *   resolved; routing them through `RESOLVED` would count them as work done.
 * - **`CLOSED` may reopen to `OPEN`.** A ticket closed by mistake has to be
 *   undoable, or an agent raises a duplicate to correct the record. This is
 *   staff only — what a *customer* may do to a closed ticket is US-90.
 */
export const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  NEW: ['OPEN', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  OPEN: ['PENDING_CUSTOMER', 'PENDING_INTERNAL', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  PENDING_CUSTOMER: ['OPEN', 'PENDING_INTERNAL', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  PENDING_INTERNAL: ['OPEN', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  ESCALATED: ['OPEN', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'CLOSED'],
  CLOSED: ['OPEN'],
};

/** Whether one status may become another. */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

/**
 * The permission a destination needs **on top of** `ticket:update` — US-47.
 *
 * Every status change requires `ticket:update`, which is a floor the route's
 * guard states declaratively. Two destinations require more than that, and the
 * catalogue already names them. Because it is a property of the *destination*
 * rather than of the action, it is checked with the rest of the transition rules
 * rather than by a second guard — splitting `/resolve` and `/escalate` into
 * endpoints of their own would scatter one state machine across three doors.
 *
 * Typed as a plain record of strings rather than importing `PermissionKey`, to
 * keep the ticket contract from depending on the authorisation one. The backend
 * narrows it where it reads it.
 */
export const STATUS_PERMISSION: Partial<Record<TicketStatus, string>> = {
  RESOLVED: 'ticket:close',
  CLOSED: 'ticket:close',
  ESCALATED: 'ticket:escalate',
};

/** Moving a ticket through its lifecycle — US-47. */
export const ChangeTicketStatusSchema = z.object({
  status: TicketStatusSchema,
});

export type ChangeTicketStatus = z.infer<typeof ChangeTicketStatusSchema>;

/** Matches `TicketPriority` in the Prisma schema. */
export const TicketPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;

/**
 * How a ticket stands against its SLA.
 *
 * Derived from the due dates denormalised onto the ticket, not stored — so it
 * cannot go stale between the clock passing and something noticing. `none`
 * means no policy applies, which is different from "on track".
 */
export const SlaStateSchema = z.enum(['none', 'ok', 'warn', 'breach']);
export type SlaState = z.infer<typeof SlaStateSchema>;

export const CreateTicketSchema = z.object({
  customerId: z.string().uuid(),
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().max(20_000).optional(),
  categoryId: z.string().uuid().optional(),
  priority: TicketPrioritySchema.optional(),
  departmentId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  channel: ChannelSchema.default('WEB'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export type CreateTicket = z.infer<typeof CreateTicketSchema>;

/**
 * Everything a ticket's own fields can become.
 *
 * `status` is deliberately **absent**: moving a ticket through its lifecycle is
 * US-47's transition endpoint, which validates that the move is legal. Allowing
 * it here would be a second, unguarded door onto the same state machine.
 *
 * `assigneeId` left for the same reason in US-48, and it was not theoretical:
 * this schema meant `PATCH /tickets/:id` reassigned a ticket under
 * `ticket:update`, which every agent holds and which is **not** `ticket:assign`.
 * Assignment is `PATCH /tickets/:id/assignee`, guarded by the permission that
 * names it.
 */
export const UpdateTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(20_000).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  priority: TicketPrioritySchema.optional(),
  departmentId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export type UpdateTicket = z.infer<typeof UpdateTicketSchema>;

/**
 * Who owns the ticket — US-48.
 *
 * `assigneeId` is **required and nullable** rather than optional. Null is a
 * deliberate unassignment (AC3), and an omitted field would be indistinguishable
 * from it — which is how a client that forgets to send the value quietly empties
 * a queue.
 */
export const AssignTicketSchema = z.object({
  assigneeId: z.string().uuid().nullable(),
});

export type AssignTicket = z.infer<typeof AssignTicketSchema>;

/**
 * Somebody a ticket can be given to — US-48, AC2 and AC5.
 *
 * Candidacy is derived from permissions, not from a role name: whoever holds
 * `ticket:update` can work a ticket, so whoever holds it can be handed one. A
 * hardcoded list of role keys would be a second definition to keep in step with
 * the catalogue.
 */
export const AssignableAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  departmentName: z.string().nullable(),
  /**
   * AC2 — "so I can avoid overloading one person".
   *
   * Open means not resolved and not closed, the same definition the queue's
   * `open` view uses. Rendered as a number and never as a colour: the point is
   * the comparison between two agents, which a hue cannot carry.
   */
  openTicketCount: z.number().int().nonnegative(),
  /**
   * AC5 — false when the user is inactive.
   *
   * Only inactive. "Out of office" has no representation in the domain schema,
   * so the half of AC5 that depends on it is flagged unmet rather than faked
   * from something adjacent.
   */
  isAvailable: z.boolean(),
});

export type AssignableAgent = z.infer<typeof AssignableAgentSchema>;

/** AC2 — every one of these reaches the database. */
export const TicketListQuerySchema = PaginationQuerySchema.extend({
  /**
   * One of the queue's view tabs — US-42, AC4.
   *
   * A named view rather than the caller assembling the same filters by hand, so
   * the tab, its count and the list it produces all come from one definition.
   */
  view: TicketViewSchema.optional(),
  q: z.string().trim().max(200).optional(),
  status: TicketStatusSchema.optional(),
  priority: TicketPrioritySchema.optional(),
  categoryId: z.string().uuid().optional(),
  /** Everything one customer has raised — the ticket workspace's context panel. */
  customerId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  /** `unassigned` is a real filter, and the one an agent picking up work uses. */
  unassigned: z.enum(['true']).optional(),
  departmentId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  channel: ChannelSchema.optional(),
  slaState: SlaStateSchema.optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'priority', 'sla', 'number']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
});

export type TicketListQuery = z.infer<typeof TicketListQuerySchema>;

/** Just enough of a customer to render a ticket row or header. */
export const TicketCustomerSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  companyName: z.string().nullable(),
});

export const TicketSlaSchema = z.object({
  state: SlaStateSchema,
  /**
   * When the first customer-facing agent reply went out — US-47, AC3.
   *
   * Null means nothing has been said to the customer yet, which is exactly the
   * fact the resolve confirmation needs: "no agent reply exists on the ticket".
   * US-68 already maintains this column and deliberately excludes internal
   * notes, so the screen does not have to count messages or reason about which
   * ones are customer-facing.
   */
  firstRespondedAt: z.string().datetime().nullable(),
  firstResponseDueAt: z.string().datetime().nullable(),
  resolutionDueAt: z.string().datetime().nullable(),
  firstResponseBreached: z.boolean(),
  resolutionBreached: z.boolean(),
  /** Negative once the target has passed. Null when no policy applies. */
  secondsRemaining: z.number().int().nullable(),
  /**
   * Since when the resolution clock has been stopped — US-69, AC4.
   *
   * Non-null while the ticket sits in `PENDING_CUSTOMER`. US-68 has maintained
   * this column since it was written and nothing has ever read it: a countdown
   * that keeps running while its clock is paused is a lie, in the queue as much
   * as on the ticket.
   */
  pausedAt: z.string().datetime().nullable(),
  /** How long the clock has been stopped in total, in milliseconds — AC4. */
  pausedMs: z.number().int().nonnegative(),
  /**
   * What the governing policy actually promises — US-69, AC4.
   *
   * Sent rather than inferred from `createdAt` to the deadline, because that
   * difference is wrong by exactly the banked pause. Null when no policy
   * applies.
   */
  responseTargetMinutes: z.number().int().positive().nullable(),
  resolutionTargetMinutes: z.number().int().positive().nullable(),
});

export const TicketSchema = z.object({
  id: z.string().uuid(),
  /** The human-facing reference. Sequential, generated by PostgreSQL. */
  number: z.number().int().positive(),
  subject: z.string(),
  status: TicketStatusSchema,
  priority: TicketPrioritySchema,
  channel: ChannelSchema,
  customer: TicketCustomerSchema,
  assigneeId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  categoryId: z.string().nullable(),
  /**
   * The category as a person reads it — US-42, AC1.
   *
   * Bilingual, resolved server-side from the caller's locale rather than sent
   * as a pair, because the queue renders one of them and shipping both to
   * render one is a column of dead weight on every row.
   */
  categoryName: z.string().nullable(),
  departmentId: z.string().nullable(),
  branchId: z.string().nullable(),
  tags: z.array(z.string()),
  sla: TicketSlaSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Ticket = z.infer<typeof TicketSchema>;

/**
 * A file on a message — US-46, AC4.
 *
 * `messageId` because attachments render **on the message that carried them**,
 * not in a separate list. A file detached from the sentence explaining it is a
 * file nobody opens.
 *
 * There is no download URL here on purpose: object storage arrives with US-51,
 * and a link to a key with nothing behind it is worse than no link.
 */
export const TicketAttachmentSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

export type TicketAttachment = z.infer<typeof TicketAttachmentSchema>;

export const TicketMessageSchema = z.object({
  id: z.string().uuid(),
  senderType: z.enum(['AGENT', 'CUSTOMER', 'SYSTEM']),
  authorName: z.string().nullable(),
  body: z.string(),
  /**
   * **The project's first non-negotiable rule lives on this field.**
   *
   * An internal note must never reach a customer. The portal API (US-82)
   * filters on it in the query, not in the UI — this flag is a contract for the
   * staff client, never a permission.
   */
  isInternal: z.boolean(),
  /**
   * How this message travelled — US-46, AC3.
   *
   * Per message rather than per ticket: a conversation that opened as an email
   * and continued on WhatsApp is an ordinary support conversation, and an agent
   * about to reply needs to know which one they are replying on.
   *
   * Null on a system event, which arrived by no channel at all.
   */
  channel: ChannelSchema.nullable(),
  attachments: z.array(TicketAttachmentSchema),
  createdAt: z.string().datetime(),
});

/**
 * Writing into the conversation — US-1.
 *
 * `isInternal` is the whole story. It is **required**, not defaulted: the
 * project's first non-negotiable rule is that an internal note must never reach
 * a customer, and a field with a default is a field a caller can forget. An
 * omitted flag would silently mean "customer-facing", which is the wrong way
 * round for a mistake to fall.
 */
export const CreateTicketMessageSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  isInternal: z.boolean(),
  /**
   * How the reply is being sent. Defaults to the ticket's own channel, which is
   * almost always what an agent means — you answer an email with an email.
   */
  channel: ChannelSchema.optional(),
});

export type CreateTicketMessage = z.infer<typeof CreateTicketMessageSchema>;

export const TicketHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  field: z.string().nullable(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  /**
   * The same two values as a person reads them — US-48, AC6.
   *
   * `fromValue` and `toValue` hold ids for the fields that reference something
   * (assignee, category, department), which is what a report wants and what a
   * timeline must never show: *"Assignee moved from 0192c… to 0192d…"* does not
   * tell the new owner who had it before.
   *
   * Captured when the entry is written, not joined when it is read. History is
   * append-only and describes what was true at the time — a join would rename a
   * historical entry when somebody's name changed, and would render blank once
   * their row was deleted. Null for the fields whose value is already legible.
   */
  fromLabel: z.string().nullable(),
  toLabel: z.string().nullable(),
  actorName: z.string().nullable(),
  /**
   * The automation that caused this, when nothing human did — US-50, AC3.
   *
   * Exactly one of `actorName` and `automationRule` is set. Attributing an SLA
   * escalation to whoever happened to touch the ticket last would be a lie in
   * the one record kept for settling disputes.
   */
  automationRule: z.string().nullable(),
  createdAt: z.string().datetime(),
});

/**
 * AC3 — the whole workspace in one response.
 *
 * The ticket screen would otherwise cost five round trips, and each of them
 * would be a separate spinner on the same page.
 */
export const TicketDetailSchema = TicketSchema.extend({
  description: z.string().nullable(),
  /**
   * Which service commitment governs this ticket — US-45, AC2.
   *
   * On the detail only. The queue shows a countdown; the workspace has to be
   * able to answer *why that number*, which means naming the policy.
   */
  slaPolicyName: z.string().nullable(),
  /**
   * The most recent slice of the conversation, oldest first — US-46, AC5.
   *
   * Not the whole thread. A ticket that has run three weeks has a hundred
   * messages and an agent opens it to read the last three; sending all hundred
   * to render three makes the workspace slowest for exactly the tickets that
   * matter most.
   *
   * `messageCount` is the total, so the timeline knows whether to offer "load
   * earlier" without a second request to find out.
   */
  messages: z.array(TicketMessageSchema),
  messageCount: z.number().int().nonnegative(),
  attachments: z.array(TicketAttachmentSchema),
  history: z.array(TicketHistoryEntrySchema),
  resolvedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  reopenCount: z.number().int().nonnegative(),
});

export type TicketDetail = z.infer<typeof TicketDetailSchema>;
export type TicketMessage = z.infer<typeof TicketMessageSchema>;
export type TicketHistoryEntry = z.infer<typeof TicketHistoryEntrySchema>;
