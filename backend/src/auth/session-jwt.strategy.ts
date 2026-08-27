import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { AuthGuard } from '@nestjs/passport';
import { ExtractJwt, Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';
import { TOKEN_AUDIENCES } from '@crm/shared';

import { ApiException, RequestContextService } from '../common/index.js';
import { TypedConfigService } from '../config/index.js';
import type { CurrentUserPayload } from './decorators/current-user.decorator.js';
import { TokenRevocationService } from './token-revocation.service.js';

/** The claims as they come off the wire, before we trust anything about them. */
interface RawClaims {
  sub: string;
  roles?: unknown;
  sid?: unknown;
  jti?: unknown;
  iat?: unknown;
  iatMs?: unknown;
}

/**
 * Verifies a bearer token of **either** audience — for signing out, and only
 * for that.
 *
 * The two applications are kept apart by their audiences: `JwtStrategy` accepts
 * only `crm-staff` and `PortalJwtStrategy` only `crm-portal`, and neither
 * decision is left to application code. Ending your own session is the one
 * operation that belongs to neither side, and it lives at `/auth/logout`
 * because a session is not a portal or a staff thing — it is a session.
 *
 * **The bug this fixes was not theoretical.** `/auth/logout` sat behind the
 * staff strategy, so a customer's token was refused with a 401. The client
 * clears its own state either way, so the sign-out *looked* like it worked —
 * while the server session stayed alive and the refresh cookie stayed on the
 * browser. The next page load then exchanged that cookie for a new token and
 * signed the customer straight back in, which reads exactly like a stale cache.
 *
 * This grants nothing else. It authenticates, and the routes that use it revoke
 * the caller's own session and nothing else.
 */
@Injectable()
export class SessionJwtStrategy extends PassportStrategy(Strategy, 'jwt-session') {
  constructor(
    config: TypedConfigService,
    private readonly requestContext: RequestContextService,
    private readonly revocations: TokenRevocationService,
  ) {
    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_ACCESS_SECRET'),
      issuer: config.get('JWT_ISSUER'),
      /**
       * Both, and no more than both.
       *
       * `jsonwebtoken` treats an array as "any of these", so this is the union
       * of the two audiences rather than the absence of a check — a token with
       * some other audience is still refused by the library before `validate`
       * is reached.
       */
      audience: [...TOKEN_AUDIENCES],
      ignoreExpiration: false,
    };

    super(options);
  }

  /**
   * The same revocation check both other strategies make.
   *
   * Signing out with an already-revoked token is refused rather than treated as
   * a no-op: the token is not this caller's to spend any more, and pretending
   * otherwise would let a stolen one keep producing 204s.
   */
  async validate(payload: RawClaims): Promise<CurrentUserPayload> {
    const jti = typeof payload.jti === 'string' ? payload.jti : '';
    const iat = typeof payload.iat === 'number' ? payload.iat : 0;
    const issuedAtMs = typeof payload.iatMs === 'number' ? payload.iatMs : iat * 1_000;

    // A token that cannot be revoked is refused rather than trusted.
    if (jti === '') {
      throw new ApiException('UNAUTHENTICATED', 'This session is no longer valid.');
    }

    if (await this.revocations.isRevoked({ jti, sub: payload.sub, issuedAtMs })) {
      throw new ApiException('UNAUTHENTICATED', 'This session is no longer valid.');
    }

    this.requestContext.setUserId(payload.sub);

    return {
      userId: payload.sub,
      roles: Array.isArray(payload.roles)
        ? payload.roles.filter((role): role is string => typeof role === 'string')
        : [],
      sessionId: typeof payload.sid === 'string' ? payload.sid : '',
      jti,
      issuedAt: iat,
      issuedAtMs,
    };
  }
}

/**
 * The guard for the sign-out routes.
 *
 * **Must be applied together with `@Public()`**, the same pairing
 * `PortalAuthGuard` documents: the global `JwtAuthGuard` is pinned to
 * `crm-staff`, so without `@Public()` a portal token never reaches this
 * strategy. `@Public()` alone would leave the route open, so the two go on
 * together — and `logout.test.ts` asserts that an unauthenticated sign-out is
 * 401, which is the test standing between a refactor and an open endpoint.
 */
@Injectable()
export class SessionAuthGuard extends AuthGuard('jwt-session') {
  /** The project's error envelope rather than Passport's bare 401. */
  override handleRequest<TUser>(error: unknown, user: TUser): TUser {
    if (error !== null && error !== undefined) {
      throw error instanceof ApiException
        ? error
        : new ApiException('UNAUTHENTICATED', 'Authentication is required.');
    }

    if (user === false || user === null || user === undefined) {
      throw new ApiException('UNAUTHENTICATED', 'Authentication is required.');
    }

    return user;
  }
}
