import { Injectable, Logger } from '@nestjs/common';
import type { LoginResponse, TokenAudience } from '@crm/shared';

import { ApiException } from '../common/index.js';
import { PermissionsService } from '../permissions/index.js';
import { PrismaService } from '../prisma/index.js';
import type { RequestOrigin } from './auth.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

/**
 * One message for every reason a refresh can fail — US-15.
 *
 * Expired, revoked, replayed, or never existed: the client's move is the same
 * in all four cases, which is to send the user back to the login screen. Saying
 * which it was would only tell an attacker holding a stolen token whether the
 * theft has been noticed yet.
 */
const REFRESH_REJECTED = 'Your session has expired. Please sign in again.';

/**
 * Exchanging a refresh token for a new pair — US-15.
 *
 * Rotation, not reuse: every refresh retires the token it was given and issues
 * a fresh one. That is what makes AC3 possible — once a token can only be used
 * once, a second use is evidence rather than ambiguity.
 */
@Injectable()
export class RefreshService {
  private readonly logger = new Logger(RefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly permissions: PermissionsService,
  ) {}

  async refresh(
    presentedToken: string | undefined,
    origin: RequestOrigin,
  ): Promise<{ response: LoginResponse; refreshToken: string }> {
    if (presentedToken === undefined || presentedToken === '') {
      throw new ApiException('UNAUTHENTICATED', REFRESH_REJECTED);
    }

    const hash = TokenService.hashRefreshToken(presentedToken);
    const session = await this.sessions.findByRefreshTokenHash(hash);

    if (session === null) {
      throw new ApiException('UNAUTHENTICATED', REFRESH_REJECTED);
    }

    // AC3 — a token that was already retired is being presented again.
    //
    // The innocent explanation is a client that retried a request it had
    // already completed. The one worth designing against is that the token was
    // copied, and that whoever copied it is now racing the real user. There is
    // no way to tell them apart from here, so the whole family goes: the real
    // user signs in again, and the thief gets nothing.
    if (session.revokedAt !== null) {
      await this.sessions.revokeFamily(
        session.familyId,
        'a retired refresh token was presented again — possible token theft',
      );

      this.logger.warn(
        `Refresh token replay for user ${session.userId} from ${origin.ip ?? 'unknown ip'}; family ${session.familyId} revoked`,
      );

      await this.audit(session.userId, origin);

      throw new ApiException('UNAUTHENTICATED', REFRESH_REJECTED);
    }

    // AC5 — past its lifetime. Revoked so the row cannot be replayed later.
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessions.revoke(session.id);
      throw new ApiException('UNAUTHENTICATED', REFRESH_REJECTED);
    }

    const user = await this.prisma.notDeleted.user.findFirst({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        locale: true,
        isActive: true,
        roles: { select: { role: { select: { key: true } } } },
      },
    });

    // Deactivated or deleted since the session was opened. Refresh is the
    // cheapest place to notice, because it is the only moment the server is
    // already reading the user row.
    if (user === null || !user.isActive) {
      await this.sessions.revokeFamily(session.familyId, 'account is no longer active');
      throw new ApiException('UNAUTHENTICATED', REFRESH_REJECTED);
    }

    const roles = user.roles.map((assignment) => assignment.role.key);
    const audience = session.audience as TokenAudience;
    const minted = this.tokens.mintRefreshToken();

    const successor = await this.sessions.create({
      userId: user.id,
      refreshTokenHash: minted.hash,
      audience,
      ttlSeconds: this.tokens.refreshTokenTtlSeconds,
      ipAddress: origin.ip,
      userAgent: origin.userAgent,
      // AC2 — same family, so a replay of either one takes both down.
      familyId: session.familyId,
    });

    await this.sessions.rotate(session.id, successor.id);

    const accessToken = await this.tokens.signAccessToken({
      userId: user.id,
      roles,
      sessionId: successor.id,
      audience,
    });

    // Re-resolved rather than carried over: a role change between sign-in and
    // refresh should take effect here, not at the next sign-in.
    const permissions = await this.permissions.effectivePermissionsFor(user.id);

    return {
      response: {
        accessToken,
        expiresIn: this.tokens.accessTokenTtlSeconds,
        // The session's own audience, carried through the rotation. A refresh
        // must never move an account between applications.
        audience,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          locale: user.locale,
          roles,
        },
        permissions,
      },
      refreshToken: minted.plain,
    };
  }

  /** Records the replay. Never fails the request — see the note in AuthService. */
  private async audit(userId: string, origin: RequestOrigin): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'LOGIN_FAILED',
          entityType: 'Session',
          entityId: userId,
          after: { reason: 'refresh token replay; session family revoked' },
          ipAddress: origin.ip ?? null,
          userAgent: origin.userAgent ?? null,
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `Failed to write replay audit row: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
