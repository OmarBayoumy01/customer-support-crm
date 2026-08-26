import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { TokenAudience } from '@crm/shared';

import { PrismaService } from '../prisma/index.js';

export interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  audience: TokenAudience;
  ttlSeconds: number;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  /** Omitted at login — the new session starts its own family. */
  familyId?: string | undefined;
}

/** A session row as the refresh flow needs to see it. */
export interface SessionRecord {
  id: string;
  userId: string;
  familyId: string;
  audience: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

/**
 * The revocable half of a session — US-14, rotation added in US-15.
 *
 * A signed JWT cannot be un-issued, so anything that has to be *ended* lives
 * here as a row.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSessionInput): Promise<{ id: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1_000);

    return this.prisma.session.create({
      data: {
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        audience: input.audience,
        expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        // A login starts a new family; a refresh passes the existing one down.
        // Generated here rather than reusing the row's own id, which does not
        // exist until the insert returns — that would cost a second write on
        // the hot path to say something an opaque key says just as well.
        familyId: input.familyId ?? randomUUID(),
      },
      select: { id: true, expiresAt: true },
    });
  }

  /** Looks a session up by the hash of the token presented. */
  async findByRefreshTokenHash(hash: string): Promise<SessionRecord | null> {
    return this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        audience: true,
        expiresAt: true,
        revokedAt: true,
        replacedById: true,
      },
    });
  }

  /**
   * Retires a session in favour of its successor — US-15, AC2.
   *
   * The old token is invalidated the moment a new pair is issued, so a stolen
   * refresh token is useful exactly once, and using it announces itself.
   */
  async rotate(previousId: string, successorId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: previousId },
      data: { revokedAt: new Date(), replacedById: successorId, lastUsedAt: new Date() },
    });
  }

  /**
   * Revokes every session in a family — US-15, AC3.
   *
   * Called when an already-used refresh token comes back. The benign
   * explanation is a client that retried; the one worth designing for is that
   * the token was copied. Killing the family costs the real user one sign-in
   * and costs the thief everything.
   */
  async revokeFamily(familyId: string, reason: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    this.logger.warn(`Revoked ${String(result.count)} session(s) in family ${familyId}: ${reason}`);

    return result.count;
  }

  /** Revokes one session — US-16, AC1. */
  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every live session a user has — US-16, AC3. */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return result.count;
  }

  /**
   * Deletes rows that expired before now.
   *
   * **Nothing calls this yet, and that is deliberate.** Scheduling it means
   * deciding where recurring jobs live, which is a platform concern P15 owns.
   * Expired rows are harmless meanwhile: every lookup filters on `expiresAt`,
   * so a stale row authenticates nobody.
   */
  async deleteExpired(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    return result.count;
  }
}
