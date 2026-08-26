import { Injectable, Logger } from '@nestjs/common';
import type { SlaPolicy, TicketPriority, TicketStatus } from '@crm/shared';

import { PrismaService } from '../prisma/index.js';
import { TicketHistoryService } from '../tickets/ticket-history.service.js';
import { SlaPolicyService } from './sla-policy.service.js';

/**
 * The rule name every automated SLA change is attributed to — US-50, AC3.
 *
 * A breach is nobody's doing. Attributing it to whoever last touched the ticket
 * is a lie in the record kept for settling disputes.
 */
export const SLA_BREACH_RULE = 'sla.target-passed';

/** How much of a target has to be gone before a ticket is "at risk". */
export const AT_RISK_FRACTION = 0.75;

/** The status while a ticket is waiting on the customer — the only paused one. */
const PAUSED_STATUS: TicketStatus = 'PENDING_CUSTOMER';

/** A ticket in one of these has stopped counting for good. */
const FINISHED_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED'];

/**
 * When a target is due.
 *
 * **This is the whole of US-75.** Today it adds wall-clock minutes and ignores
 * `businessHoursOnly`, because the MVP agreed a 24/7 clock and the calendar that
 * flag would read is deferred. US-75 replaces the body of this function and
 * flips the seeded policies to `true`; nothing else in this file changes.
 */
export function deadlineFrom(start: Date, minutes: number, _policy: SlaPolicy): Date {
  return new Date(start.getTime() + minutes * 60_000);
}

/** What the clock needs to know about a ticket to place its deadlines. */
const CLOCK_SELECT = {
  id: true,
  createdAt: true,
  status: true,
  priority: true,
  categoryId: true,
  departmentId: true,
  branchId: true,
  slaPolicyId: true,
  firstResponseDueAt: true,
  firstRespondedAt: true,
  resolutionDueAt: true,
  slaPausedAt: true,
  slaPausedMs: true,
  customer: { select: { type: true, isVip: true } },
} as const;

/**
 * The SLA engine — US-68.
 *
 * Deadlines are absolute timestamps on the ticket, plus the total the clock has
 * been paused for. Everything below is arithmetic on those three columns, which
 * is deliberate: `TicketsService.slaFor()` has derived ok / warn / breach from
 * them since US-40, so the read path needs no change and cannot go stale
 * between the clock passing and something noticing.
 */
@Injectable()
export class SlaClockService {
  private readonly logger = new Logger(SlaClockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: SlaPolicyService,
    private readonly history: TicketHistoryService,
  ) {}

  /**
   * AC1 — the clock starts when the ticket does.
   *
   * A ticket matching no policy keeps null deadlines, which `slaFor()` reports
   * as `none`. That is a real state, not a failure: not every ticket is under a
   * service commitment.
   */
  async applyOnCreate(ticketId: string): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: CLOCK_SELECT,
    });

    if (ticket === null) {
      return;
    }

    const policy = await this.policyFor(ticket);

    if (policy === null) {
      return;
    }

    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        slaPolicyId: policy.id,
        firstResponseDueAt: deadlineFrom(ticket.createdAt, policy.firstResponseMinutes, policy),
        resolutionDueAt: deadlineFrom(ticket.createdAt, policy.resolutionMinutes, policy),
      },
    });
  }

  /**
   * AC3 — the resolution clock pauses while the ticket waits on the customer.
   *
   * Only the resolution clock. A ticket in `PENDING_CUSTOMER` has by definition
   * already had an agent reply, so its response clock stopped for good when
   * that reply was sent.
   */
  async onStatusChange(ticketId: string, from: TicketStatus, to: TicketStatus): Promise<void> {
    if (from === to) {
      return;
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: CLOCK_SELECT,
    });

    if (ticket === null) {
      return;
    }

    if (to === PAUSED_STATUS) {
      // Already paused is not an error — a second write here would restart the
      // pause and quietly grant the ticket the time it had already banked.
      if (ticket.slaPausedAt !== null) {
        return;
      }

      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { slaPausedAt: new Date() },
      });

      return;
    }

    if (ticket.slaPausedAt === null) {
      return;
    }

    const pausedMs = Math.max(0, Date.now() - ticket.slaPausedAt.getTime());

    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        slaPausedAt: null,
        slaPausedMs: ticket.slaPausedMs + pausedMs,
        // The deadline moves by exactly what the clock was stopped for. Nothing
        // is recomputed, so a policy edited in the meantime cannot leak into a
        // ticket that was already governed by the old one — US-67, AC4.
        ...(ticket.resolutionDueAt === null
          ? {}
          : { resolutionDueAt: new Date(ticket.resolutionDueAt.getTime() + pausedMs) }),
      },
    });
  }

  /**
   * AC4 — the first customer-facing agent reply satisfies the response target.
   *
   * `isInternal` decides it. An internal note is not a reply to the customer,
   * and letting one count would mean an agent could satisfy a service
   * commitment by writing a note to themselves.
   *
   * Only the first reply counts — a later one must not move a timestamp that
   * has already been recorded.
   */
  async onAgentReply(ticketId: string, options: { isInternal: boolean; at?: Date }): Promise<void> {
    if (options.isInternal) {
      return;
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { firstRespondedAt: true, firstResponseDueAt: true },
    });

    if (ticket === null || ticket.firstRespondedAt !== null) {
      return;
    }

    const at = options.at ?? new Date();

    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        firstRespondedAt: at,
        // Recorded here rather than left to the sweep, because after this the
        // sweep stops looking: `firstRespondedAt` is what takes the ticket out
        // of its query.
        firstResponseBreached: ticket.firstResponseDueAt !== null && at > ticket.firstResponseDueAt,
      },
    });
  }

  /**
   * AC6 — a priority change recomputes from the original start.
   *
   * From `createdAt`, never from now. Recomputing from now would hand a ticket
   * that has been open three days a fresh four-hour target every time somebody
   * nudged its priority, which is a way to never breach anything.
   *
   * Accumulated pause is added back, so a ticket that legitimately spent two
   * days waiting on the customer does not lose them.
   */
  async onPriorityChange(ticketId: string): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: CLOCK_SELECT,
    });

    if (ticket === null) {
      return;
    }

    const policy = await this.policyFor(ticket);

    if (policy === null) {
      return;
    }

    // Time already banked, plus the current pause if one is running.
    const pausedMs =
      ticket.slaPausedMs +
      (ticket.slaPausedAt === null ? 0 : Math.max(0, Date.now() - ticket.slaPausedAt.getTime()));

    const resolutionDueAt = new Date(
      deadlineFrom(ticket.createdAt, policy.resolutionMinutes, policy).getTime() + pausedMs,
    );

    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        slaPolicyId: policy.id,
        resolutionDueAt,
        // Left alone once the response has happened. That clock is finished,
        // and moving a target after the fact is rewriting history.
        ...(ticket.firstRespondedAt !== null
          ? {}
          : {
              firstResponseDueAt: new Date(
                deadlineFrom(ticket.createdAt, policy.firstResponseMinutes, policy).getTime() +
                  pausedMs,
              ),
            }),
        // A recomputed deadline may now be in the future. The sweep would never
        // clear a flag it had set, so clearing it here is what keeps the flag
        // and the clock agreeing.
        resolutionBreached: resolutionDueAt < new Date(),
      },
    });
  }

  /**
   * AC5 — the scheduled check.
   *
   * Finds tickets whose target has passed and whose flag is not yet set, sets
   * it, and records the crossing in the ticket's history attributed to the rule
   * rather than to a person.
   *
   * The flag is what makes this idempotent: a second run within the same minute
   * finds nothing, which matters because a repeatable job will occasionally run
   * twice.
   *
   * It deliberately does **not** change status. One thing moves a ticket to
   * `ESCALATED` and that is US-71, reading the ladder US-67 stored.
   */
  async sweep(now = new Date()): Promise<{ firstResponse: number; resolution: number }> {
    const responseOverdue = await this.prisma.notDeleted.ticket.findMany({
      where: {
        status: { notIn: FINISHED_STATUSES },
        firstRespondedAt: null,
        firstResponseBreached: false,
        firstResponseDueAt: { lt: now },
      },
      select: { id: true, firstResponseDueAt: true },
      take: 500,
    });

    for (const ticket of responseOverdue) {
      await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { firstResponseBreached: true },
      });

      await this.history.record({
        ticketId: ticket.id,
        actorUserId: null,
        eventType: 'SLA_BREACHED',
        field: 'firstResponseDueAt',
        toValue: ticket.firstResponseDueAt?.toISOString() ?? undefined,
        automationRule: SLA_BREACH_RULE,
      });
    }

    const resolutionOverdue = await this.prisma.notDeleted.ticket.findMany({
      where: {
        status: { notIn: FINISHED_STATUSES },
        resolutionBreached: false,
        resolutionDueAt: { lt: now },
      },
      select: { id: true, resolutionDueAt: true },
      take: 500,
    });

    for (const ticket of resolutionOverdue) {
      await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { resolutionBreached: true },
      });

      await this.history.record({
        ticketId: ticket.id,
        actorUserId: null,
        eventType: 'SLA_BREACHED',
        field: 'resolutionDueAt',
        toValue: ticket.resolutionDueAt?.toISOString() ?? undefined,
        automationRule: SLA_BREACH_RULE,
      });
    }

    if (responseOverdue.length > 0 || resolutionOverdue.length > 0) {
      this.logger.log(
        `SLA sweep: ${String(responseOverdue.length)} response, ` +
          `${String(resolutionOverdue.length)} resolution target(s) passed`,
      );
    }

    return { firstResponse: responseOverdue.length, resolution: resolutionOverdue.length };
  }

  /** The facts a ticket states about itself, handed to US-67's resolver. */
  private async policyFor(ticket: {
    priority: TicketPriority;
    categoryId: string | null;
    departmentId: string | null;
    branchId: string | null;
    customer: { type: 'INDIVIDUAL' | 'COMPANY'; isVip: boolean };
  }): Promise<SlaPolicy | null> {
    return this.policies.resolveFor({
      priority: ticket.priority,
      categoryId: ticket.categoryId,
      departmentId: ticket.departmentId,
      branchId: ticket.branchId,
      customerType: ticket.customer.type,
      customerIsVip: ticket.customer.isVip,
    });
  }
}
