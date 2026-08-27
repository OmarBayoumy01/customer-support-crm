import { Injectable, Logger } from '@nestjs/common';
import { canTransition } from '@crm/shared';

import { PrismaService } from '../prisma/index.js';
import { TicketHistoryService } from '../tickets/ticket-history.service.js';
import type { EscalationTarget, TicketStatus } from '../generated/prisma/client.js';

/**
 * The rule every automated escalation is attributed to — US-71, AC6.
 *
 * A ladder rung is not somebody's decision. `TicketHistoryService` takes this
 * *instead of* an actor, so an escalation cannot end up named after whoever last
 * touched the ticket — which is the person who would then be asked about it.
 */
export const SLA_ESCALATION_RULE = 'sla.escalation-threshold';

/**
 * Where a rung's idempotency key is written — US-71, AC5.
 *
 * The field name on the history entry. Recording which rung fired, and checking
 * for that record before firing it, is what stops a ticket at 80% of its target
 * announcing itself every minute for the rest of the afternoon.
 */
export const ESCALATION_STEP_FIELD = 'escalationStep';

/** A ticket in one of these is finished; its clocks have stopped. */
const FINISHED_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED'];

/** How many tickets one pass will look at. The sweep uses the same bound. */
const SWEEP_LIMIT = 500;

/**
 * How far through its target a clock is, as a percentage.
 *
 * Pure, and `now` arrives as an argument rather than being read inside — the
 * whole ladder is decided by this number, and a threshold you cannot test
 * against a fixed clock is a threshold nobody can reason about.
 *
 * **Pause needs no special case here.** US-68 pushes `resolutionDueAt` out by
 * exactly what the clock was stopped for, so a paused ticket's percentage stops
 * climbing without this function knowing that pause exists.
 */
export function elapsedPercent(input: { startedAt: Date; dueAt: Date; now: Date }): number {
  const total = input.dueAt.getTime() - input.startedAt.getTime();

  if (total <= 0) {
    return 100;
  }

  return ((input.now.getTime() - input.startedAt.getTime()) / total) * 100;
}

/** One rung of a policy's ladder, as this service needs it. */
interface Rung {
  sequence: number;
  atPercent: number;
  notify: EscalationTarget;
  notifyUserId: string | null;
  changeStatusToEscalated: boolean;
}

/**
 * Automatic escalation on SLA thresholds — US-71.
 *
 * Reads the ladder US-6 modelled and US-67 seeds, and is driven by the sweep
 * `SlaSweepWorker` already schedules — there is no second scheduler, and no
 * dependency added.
 *
 * A service of its own rather than more of `SlaClockService`: that file is clock
 * arithmetic, and climbing a configured ladder is a different job with different
 * failure modes. The worker now does two named things in order, which is easier
 * to read than one that does both.
 *
 * **Every pass is safe to repeat.** BullMQ retries a failed job with backoff and
 * dead-letters it on the final attempt (US-10), so a pass that dies half way
 * through will run again — and each rung checks for its own history entry before
 * acting. That is AC5 and the retry contract in one mechanism rather than two.
 */
@Injectable()
export class SlaEscalationService {
  private readonly logger = new Logger(SlaEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly history: TicketHistoryService,
  ) {}

  /**
   * One pass over the open tickets that have a resolution target.
   *
   * Only the resolution clock is laddered, which is US-67's decision and worth
   * repeating here: a first-response target is often fifteen minutes, and a rung
   * at 75% of that fires while the agent is still reading the ticket.
   */
  async run(
    now = new Date(),
  ): Promise<{ examined: number; rungsFired: number; escalated: number }> {
    const tickets = await this.prisma.notDeleted.ticket.findMany({
      where: {
        status: { notIn: FINISHED_STATUSES },
        resolutionDueAt: { not: null },
        slaPolicyId: { not: null },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        resolutionDueAt: true,
        assigneeId: true,
        escalatedAt: true,
        departmentId: true,
        slaPolicy: {
          select: {
            escalationSteps: {
              where: { clock: 'RESOLUTION' },
              orderBy: { sequence: 'asc' },
              select: {
                sequence: true,
                atPercent: true,
                notify: true,
                notifyUserId: true,
                changeStatusToEscalated: true,
              },
            },
          },
        },
      },
      /**
       * **The ordering is load-bearing, not cosmetic.**
       *
       * A rung is due on the tickets closest to their deadline or already past
       * it, so the soonest deadline first means the bound below always covers
       * the tickets that matter. An unordered `take` is an arbitrary slice of
       * every open ticket in the platform, and on a busy instance the late ones
       * are exactly what it would miss.
       */
      orderBy: { resolutionDueAt: 'asc' },
      take: SWEEP_LIMIT,
    });

    let rungsFired = 0;
    let escalated = 0;

    for (const ticket of tickets) {
      if (ticket.resolutionDueAt === null) {
        continue;
      }

      const percent = elapsedPercent({
        startedAt: ticket.createdAt,
        dueAt: ticket.resolutionDueAt,
        now,
      });

      const due = (ticket.slaPolicy?.escalationSteps ?? []).filter(
        (step) => percent >= step.atPercent,
      );

      for (const rung of due) {
        const fired = await this.fire(ticket, rung, percent);

        if (fired) {
          rungsFired += 1;

          if (rung.changeStatusToEscalated) {
            escalated += 1;
          }
        }
      }
    }

    if (rungsFired > 0) {
      this.logger.log(
        `SLA escalation: ${String(rungsFired)} threshold(s) crossed, ` +
          `${String(escalated)} ticket(s) escalated`,
      );
    }

    return { examined: tickets.length, rungsFired, escalated };
  }

  /**
   * Acts on one rung, once.
   *
   * Returns whether it did anything, so a pass can report honestly rather than
   * counting rungs it skipped.
   */
  private async fire(
    ticket: {
      id: string;
      status: TicketStatus;
      assigneeId: string | null;
      escalatedAt: Date | null;
      departmentId: string | null;
    },
    rung: Rung,
    percent: number,
  ): Promise<boolean> {
    /**
     * AC5 — the rung's own history entry is its idempotency key.
     *
     * `escalatedAt` cannot carry this alone: it marks only the rung that changes
     * status, so the 75% and 90% warnings would re-fire on every sweep for as
     * long as the ticket stayed late. An indexed lookup on
     * `(ticketId, field, toValue)` rather than a JSON path filter, and no new
     * column — the entry has to be written anyway.
     */
    const already = await this.prisma.ticketHistory.findFirst({
      where: {
        ticketId: ticket.id,
        field: ESCALATION_STEP_FIELD,
        toValue: String(rung.sequence),
      },
      select: { id: true },
    });

    if (already !== null) {
      return false;
    }

    const recipientId = await this.recipientFor(ticket, rung);

    if (rung.changeStatusToEscalated) {
      // AC5 again, from the other direction: a ticket already escalated is not
      // escalated a second time even if its history were somehow missing.
      const alreadyEscalated = ticket.status === 'ESCALATED' || ticket.escalatedAt !== null;

      /**
       * The state machine is the same one a person is held to — US-47's map.
       *
       * An automation that can make a move an agent cannot is a second, quieter
       * state machine. A ticket that cannot legally reach `ESCALATED` is skipped
       * and logged rather than forced.
       */
      if (!alreadyEscalated && canTransition(ticket.status, 'ESCALATED')) {
        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            status: 'ESCALATED',
            escalatedAt: new Date(),
            // Data, not a notification: who the ticket was escalated *to*, which
            // is what the manager dashboard and US-62 will both read.
            ...(recipientId === null ? {} : { escalatedToId: recipientId }),
          },
        });

        await this.history.record({
          ticketId: ticket.id,
          actorUserId: null,
          eventType: 'ESCALATED',
          field: 'status',
          fromValue: ticket.status,
          toValue: 'ESCALATED',
          automationRule: SLA_ESCALATION_RULE,
        });
      } else if (!alreadyEscalated) {
        this.logger.warn(
          `Ticket ${ticket.id} is past its target but cannot move from ${ticket.status} ` +
            'to ESCALATED; leaving the status alone',
        );
      }
    }

    /**
     * The rung itself, recorded — AC3's "a history entry records the automated
     * action", AC6's attribution, and AC5's key, in one row.
     */
    await this.history.record({
      ticketId: ticket.id,
      actorUserId: null,
      eventType: 'ESCALATED',
      field: ESCALATION_STEP_FIELD,
      toValue: String(rung.sequence),
      automationRule: SLA_ESCALATION_RULE,
      metadata: { atPercent: rung.atPercent, reachedPercent: Math.round(percent) },
    });

    /**
     * AC1 and AC2 — as far as they can go today.
     *
     * **US-62 is deferred and there is no notification channel, so nothing is
     * sent and none is invented here.** The intended recipient and the reason
     * they were chosen are logged, and the crossing is in the ticket's history
     * where an agent and a manager both read it. US-62 consumes exactly these
     * events when it arrives.
     */
    this.logger.log(
      `Ticket ${ticket.id} crossed ${String(rung.atPercent)}% of its resolution target ` +
        `(rung ${String(rung.sequence)}, notify ${rung.notify}` +
        `${recipientId === null ? ', nobody resolved' : ` -> ${recipientId}`}). ` +
        'No notification sent: US-62 is deferred.',
    );

    return true;
  }

  /**
   * Who the rung is aimed at.
   *
   * Null when nobody can be resolved — an unassigned ticket whose rung notifies
   * the assignee, or a department with no manager. That is a real state and not
   * an error: the escalation still happens and still gets recorded, because a
   * missing recipient is a reason to keep going, not to leave a late ticket
   * un-escalated.
   */
  private async recipientFor(
    ticket: { assigneeId: string | null; departmentId: string | null },
    rung: Rung,
  ): Promise<string | null> {
    if (rung.notify === 'ASSIGNEE') {
      return ticket.assigneeId;
    }

    if (rung.notify === 'SPECIFIC_USER') {
      return rung.notifyUserId;
    }

    if (ticket.departmentId === null) {
      return null;
    }

    const department = await this.prisma.department.findUnique({
      where: { id: ticket.departmentId },
      select: { managerId: true },
    });

    return department?.managerId ?? null;
  }
}
