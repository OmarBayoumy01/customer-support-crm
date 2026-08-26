import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/index.js';
import type { AuditAction, Prisma } from '../generated/prisma/client.js';

/** What to write. `before` is omitted on a create, `after` on a delete. */
export interface AuditRecord {
  actorUserId: string | null;
  action: AuditAction;
  /** The model name, as it appears in the Prisma schema. */
  entityType: string;
  entityId: string | null;
  before?: Record<string, unknown> | undefined;
  after?: Record<string, unknown> | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * The platform-wide compliance trail — first written by US-67, AC5.
 *
 * Not to be confused with `TicketHistory`, which is the story of one ticket
 * rendered in the workspace. This one is read by an administrator asking who
 * changed a configuration and when, and US-6 made them separate models because
 * they have different readers and different retention needs.
 *
 * **Only the fields that changed** are recorded. US-6's comment on the model
 * says so, and it is also what makes "before and after values" a diff rather
 * than two copies of a row that the reader has to compare by eye.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditRecord): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          ...(entry.before === undefined ? {} : { before: entry.before as Prisma.InputJsonValue }),
          ...(entry.after === undefined ? {} : { after: entry.after as Prisma.InputJsonValue }),
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (error: unknown) {
      // Logged, never swallowed silently, and never allowed to fail the change
      // it was describing. Refusing to save a corrected SLA target because the
      // audit row would not write is worse than a gap in the trail — and the
      // gap is visible here, in the application log.
      this.logger.error(
        `Failed to audit ${entry.action} on ${entry.entityType} ${entry.entityId ?? '(none)'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Records an update, writing only the fields that actually moved.
   *
   * Values are compared with `JSON.stringify`, which is enough for the scalars
   * and small arrays a configuration row holds, and returns without writing
   * anything when nothing changed — a save that changed nothing is not an audit
   * event.
   */
  async recordUpdate(
    entry: Omit<AuditRecord, 'action' | 'before' | 'after'> & {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    },
  ): Promise<void> {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    for (const [field, next] of Object.entries(entry.after)) {
      const previous = entry.before[field];

      if (JSON.stringify(previous) === JSON.stringify(next)) {
        continue;
      }

      before[field] = previous ?? null;
      after[field] = next;
    }

    if (Object.keys(after).length === 0) {
      return;
    }

    await this.record({
      actorUserId: entry.actorUserId,
      action: 'UPDATE',
      entityType: entry.entityType,
      entityId: entry.entityId,
      before,
      after,
      ...(entry.ipAddress === undefined ? {} : { ipAddress: entry.ipAddress }),
      ...(entry.userAgent === undefined ? {} : { userAgent: entry.userAgent }),
    });
  }
}
