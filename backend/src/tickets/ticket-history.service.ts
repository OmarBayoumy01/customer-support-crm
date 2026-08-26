import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/index.js';
import type { TicketHistoryEntry } from '@crm/shared';
import type { Prisma, TicketEventType } from '../generated/prisma/client.js';

/** One recorded change. */
export interface HistoryEntry {
  ticketId: string;
  actorUserId: string | null;
  eventType: TicketEventType;
  field?: string | undefined;
  fromValue?: string | undefined;
  toValue?: string | undefined;
  /**
   * The automation responsible, when nothing human was — US-50, AC3.
   *
   * Set this **instead of** `actorUserId`. An SLA escalation attributed to
   * whoever last touched the ticket is a lie in the one record kept for
   * settling disputes, and the person it names is the one who gets asked about
   * it.
   */
  automationRule?: string | undefined;
  metadata?: Prisma.InputJsonValue | undefined;
}

/** Where the rule name lives inside `metadata`. One place, so readers agree. */
export const AUTOMATION_METADATA_KEY = 'automationRule';

/** Pulls the rule name back out of a stored entry. */
export function automationRuleOf(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[AUTOMATION_METADATA_KEY];

  return typeof value === 'string' ? value : null;
}

/**
 * A history value, as text.
 *
 * Every field this records is a scalar — a status, a priority, an id, a
 * subject. Anything else is a caller passing something it should not, and
 * `[object Object]` in an audit trail is worse than a gap, so it is refused
 * rather than coerced. `tags` is an array and is deliberately not one of the
 * mapped fields.
 */
function asText(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

/**
 * Which field change is which kind of event.
 *
 * A reassignment and a priority change are both "a column moved", but they read
 * completely differently in a timeline, and P11's reports count them
 * separately. Mapping here means the caller states the field and gets the right
 * event type without every call site remembering.
 */
const EVENT_FOR_FIELD: Record<string, TicketEventType> = {
  status: 'STATUS_CHANGED',
  priority: 'PRIORITY_CHANGED',
  assigneeId: 'ASSIGNED',
  categoryId: 'CATEGORY_CHANGED',
  departmentId: 'DEPARTMENT_CHANGED',
};

/**
 * The per-ticket timeline — US-40 AC5, extended by US-50.
 *
 * Append-only. `TicketHistory` has no `updatedAt` and no `deletedAt`, which US-6
 * made deliberate: **an audit trail you can edit is not an audit trail.**
 *
 * Separate from `AuditLog`, which is the platform-wide compliance record read by
 * administrators. This one is the story of a single ticket, rendered in the
 * workspace, and an agent reads it constantly.
 */
@Injectable()
export class TicketHistoryService {
  private readonly logger = new Logger(TicketHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: HistoryEntry): Promise<void> {
    // Exactly one attribution. An automated change with an actor attached would
    // read as a person having done it, which is the thing AC3 forbids.
    const metadata =
      entry.automationRule === undefined
        ? entry.metadata
        : {
            ...(entry.metadata as object | undefined),
            [AUTOMATION_METADATA_KEY]: entry.automationRule,
          };

    try {
      await this.prisma.ticketHistory.create({
        data: {
          ticketId: entry.ticketId,
          actorUserId: entry.automationRule === undefined ? entry.actorUserId : null,
          eventType: entry.eventType,
          field: entry.field ?? null,
          fromValue: entry.fromValue ?? null,
          toValue: entry.toValue ?? null,
          ...(metadata === undefined ? {} : { metadata }),
        },
      });
    } catch (error: unknown) {
      // Logged, never swallowed silently, and never allowed to fail the change
      // it was describing. A missing history line is bad; refusing to resolve a
      // ticket because its history line would not write is worse.
      this.logger.error(
        `Failed to record ${entry.eventType} on ticket ${entry.ticketId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * A ticket's timeline, newest first — US-50, AC1 and AC2.
   *
   * Paginated because a long-running ticket accumulates hundreds of entries and
   * the panel is collapsed by default (AC5) — loading all of them to render
   * three is work nobody asked for.
   *
   * Scope is **not** applied here: the caller has already been through
   * `TicketsService.detail`, which refuses a ticket outside their scope. Adding
   * a second check would mean two places that have to agree about who may see
   * what.
   */
  async forTicket(
    ticketId: string,
    options: { skip: number; take: number },
  ): Promise<{ entries: TicketHistoryEntry[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.ticketHistory.findMany({
        where: { ticketId },
        orderBy: { createdAt: 'desc' },
        skip: options.skip,
        take: options.take,
        select: {
          id: true,
          eventType: true,
          field: true,
          fromValue: true,
          toValue: true,
          metadata: true,
          createdAt: true,
          actor: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.ticketHistory.count({ where: { ticketId } }),
    ]);

    return {
      entries: rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        field: row.field,
        fromValue: row.fromValue,
        toValue: row.toValue,
        actorName: row.actor === null ? null : `${row.actor.firstName} ${row.actor.lastName}`,
        automationRule: automationRuleOf(row.metadata),
        createdAt: row.createdAt.toISOString(),
      })),
      total,
    };
  }

  /**
   * AC5 — one entry per field that actually moved.
   *
   * Compares before and after and writes nothing for fields that did not
   * change. A PATCH that sends the whole object back unmodified should leave no
   * trace, or a timeline becomes unreadable within a week.
   */
  async recordChanges(
    ticketId: string,
    actorUserId: string | null,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void> {
    for (const [field, next] of Object.entries(after)) {
      const previous = before[field];

      if (previous === next) {
        continue;
      }

      // Both are rendered to text: the same three columns describe a status
      // change, a priority change and a reassignment, which is why US-6 typed
      // them as strings rather than adding a column per field.
      await this.record({
        ticketId,
        actorUserId,
        eventType: EVENT_FOR_FIELD[field] ?? 'STATUS_CHANGED',
        field,
        fromValue: asText(previous),
        toValue: asText(next),
      });
    }
  }
}
