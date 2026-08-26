import { Injectable } from '@nestjs/common';
import type { TokenAudience } from '@crm/shared';

import { PrismaService } from '../prisma/index.js';

export interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  audience: TokenAudience;
  ttlSeconds: number;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * The revocable half of a session — US-14.
 *
 * A signed JWT cannot be un-issued, so anything that has to be *ended* lives
 * here as a row. US-16 sets `revokedAt`; US-15 rotates the hash on refresh.
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSessionInput): Promise<{ id: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1_000);

    const session = await this.prisma.session.create({
      data: {
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        audience: input.audience,
        expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
      select: { id: true, expiresAt: true },
    });

    return session;
  }

  /**
   * Deletes rows that expired before now.
   *
   * **Nothing calls this yet, and that is deliberate.** Scheduling it means
   * deciding where recurring jobs live, which is a platform concern P15 owns —
   * inventing a scheduler here to service one table would be the wrong place to
   * make that decision. Expired rows are harmless in the meantime: every lookup
   * filters on `expiresAt`, so a stale row authenticates nobody.
   */
  async deleteExpired(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    return result.count;
  }
}
