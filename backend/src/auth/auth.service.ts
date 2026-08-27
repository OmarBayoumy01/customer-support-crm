import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser, LoginRequest, LoginResponse, TokenAudience } from '@crm/shared';

import { ApiException } from '../common/index.js';
import { PermissionsService } from '../permissions/index.js';
import { PrismaService } from '../prisma/index.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

/** Where the request came from, for the throttle and the audit trail. */
export interface RequestOrigin {
  ip: string | undefined;
  userAgent: string | undefined;
}

/**
 * The one message every failed credential check returns — AC2.
 *
 * A single constant, referenced from both failure paths, because the criterion
 * is that they are indistinguishable and two string literals drift.
 */
const GENERIC_FAILURE = 'Email or password is incorrect.';

/** AC3's message. Deliberately different — see the note in `login`. */
const INACTIVE_ACCOUNT = 'This account has been deactivated. Please contact an administrator.';

/**
 * Signing in — US-14.
 *
 * The order of the steps below is load-bearing and each one is tied to a
 * criterion. Read the comments before rearranging anything.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottleService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Returns the login payload plus the plain refresh token, which the
   * controller turns into a cookie and this service never lets anywhere else.
   */
  async login(
    credentials: LoginRequest,
    origin: RequestOrigin,
  ): Promise<{ response: LoginResponse; refreshToken: string }> {
    const { email, password } = credentials;

    // 1 — AC5, before any database work. A locked-out attacker must not be able
    // to keep using this endpoint to probe which emails exist while they wait.
    await this.throttle.check(email, origin.ip);

    // 2 — `notDeleted` filters soft-deleted rows, so a deleted user falls into
    // the same branch as a user who never existed. That is AC2's requirement,
    // and getting it for free from the extension beats remembering it here.
    const user = await this.prisma.notDeleted.user.findFirst({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        firstName: true,
        lastName: true,
        locale: true,
        isActive: true,
        roles: { select: { role: { select: { key: true } } } },
      },
    });

    if (user === null) {
      // 3 — Burn the same work a real verification costs. Without this the
      // response for an unknown email comes back in about a millisecond and one
      // for a known email in fifty, and the clock enumerates accounts just as
      // well as a different message would.
      await this.passwords.verifyDummy();
      throw await this.failedLogin(email, origin, null);
    }

    // 4 — Password before `isActive`. See the comment on step 5; this ordering
    // is the whole reason AC3's specific message is safe to send.
    const passwordMatches = await this.passwords.verify(user.passwordHash, password);

    if (!passwordMatches) {
      throw await this.failedLogin(email, origin, user.id);
    }

    // 5 — AC3, and the one place this endpoint says something specific.
    //
    // It does reveal that the account exists, which AC2 otherwise forbids. That
    // is the story's explicit instruction and it is implemented as written
    // rather than quietly made generic — but it is only reachable by someone
    // who has already proved they know the password, because step 4 ran first.
    // Check `isActive` before the password and this message becomes a free
    // account-enumeration oracle for anyone guessing email addresses.
    if (!user.isActive) {
      await this.audit('LOGIN_FAILED', user.id, origin, 'account inactive');
      this.logger.warn(`Login refused for deactivated account ${user.id}`);
      throw new ApiException('FORBIDDEN', INACTIVE_ACCOUNT);
    }

    /**
     * 5.5 — which application this account belongs to.
     *
     * **One login form, and the server decides.** Nobody should have to know
     * which of two URLs their account was filed under: they type their email
     * and password and arrive where they belong. So the audience is derived
     * here, from the account — there is no request field for it and no second
     * endpoint that could ask for the other one.
     *
     * **What makes an account a portal account is a linked `Customer` row** — the
     * same fact US-82 scopes every portal query on. Not a role name: roles are
     * configuration, and which application somebody belongs in must not be
     * something an administrator changes by reassigning one.
     *
     * **The boundary is unchanged, and it was never the form.** It is the
     * token: a `crm-portal` token is refused by every staff route and a
     * `crm-staff` token by every portal route, both at the strategy. What has
     * gone is the second door, and with it the possibility of walking through
     * the wrong one — which used to end in a screenful of permission errors.
     *
     * Read **after** the password, so the lookup tells an attacker nothing,
     * and **before** the session, so the audience stamped on the session and
     * the one in the token cannot disagree.
     */
    const isPortalAccount =
      (await this.prisma.notDeleted.customer.findFirst({
        where: { userId: user.id },
        select: { id: true },
      })) !== null;

    const audience: TokenAudience = isPortalAccount ? 'crm-portal' : 'crm-staff';

    // 6 — Success.
    await this.throttle.clear(email, origin.ip);

    const roles = user.roles.map((assignment) => assignment.role.key);
    const refresh = this.tokens.mintRefreshToken();

    const session = await this.sessions.create({
      userId: user.id,
      refreshTokenHash: refresh.hash,
      audience,
      ttlSeconds: this.tokens.refreshTokenTtlSeconds,
      ipAddress: origin.ip,
      userAgent: origin.userAgent,
    });

    const accessToken = await this.tokens.signAccessToken({
      userId: user.id,
      roles,
      sessionId: session.id,
      audience,
    });

    // Already cached by US-13, so this is cheap, and shipping it with the
    // session saves US-23 a second round trip. A convenience only — US-22
    // checks the same permissions again on every request.
    const permissions = await this.permissions.effectivePermissionsFor(user.id);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit('LOGIN', user.id, origin);

    const authenticated: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
      roles,
    };

    return {
      response: {
        accessToken,
        expiresIn: this.tokens.accessTokenTtlSeconds,
        // Where this account belongs. The client routes on it and cannot ask
        // for a different one.
        audience,
        user: authenticated,
        permissions,
      },
      refreshToken: refresh.plain,
    };
  }

  /**
   * Records a failed attempt and *returns* the generic error for the caller to
   * throw.
   *
   * Returning rather than throwing so that the call sites read `throw await
   * this.failedLogin(...)`. TypeScript narrows across an explicit `throw`; it
   * does not narrow across an awaited call that merely happens to return
   * `never`, which would leave `user` nullable for the rest of the method.
   */
  private async failedLogin(
    email: string,
    origin: RequestOrigin,
    userId: string | null,
  ): Promise<ApiException> {
    await this.throttle.recordFailure(email, origin.ip);
    await this.audit('LOGIN_FAILED', userId, origin);

    // The log line may name the account; the *response* may not. Operators
    // investigating a lockout need to know which account, and they are already
    // trusted with the audit trail.
    this.logger.warn(
      `Failed login attempt for ${userId ?? 'unknown account'} from ${origin.ip ?? 'unknown ip'}`,
    );

    return new ApiException('UNAUTHENTICATED', GENERIC_FAILURE);
  }

  /**
   * One audit row per attempt, successful or not — AC5's "the lockout is
   * logged", and the compliance trail P14 reads.
   *
   * **Never** pass the submitted password, the stored hash, or the refresh
   * token into `before`/`after`. The schema comment on `AuditLog` says the same
   * thing; there is a test asserting it.
   */
  private async audit(
    action: 'LOGIN' | 'LOGIN_FAILED',
    userId: string | null,
    origin: RequestOrigin,
    reason?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action,
          entityType: 'User',
          entityId: userId,
          // Spread rather than `after: undefined`: `exactOptionalPropertyTypes`
          // is on, so an explicit `undefined` is not the same as absent.
          ...(reason === undefined ? {} : { after: { reason } }),
          ipAddress: origin.ip ?? null,
          userAgent: origin.userAgent ?? null,
        },
      });
    } catch (error: unknown) {
      // Never let the audit write decide whether login succeeds. Logged, not
      // swallowed silently — a trail that has stopped recording is something an
      // operator needs to find out about.
      this.logger.error(
        `Failed to write ${action} audit row: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
