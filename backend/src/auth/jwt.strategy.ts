import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
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
 * Verifies the bearer token on every protected request — US-14.
 *
 * `passport-jwt` checks the signature, `exp`, `iss` and `aud` before
 * `validate()` is reached; anything that gets here has already passed those.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: TypedConfigService,
    private readonly requestContext: RequestContextService,
    private readonly revocations: TokenRevocationService,
  ) {
    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_ACCESS_SECRET'),
      issuer: config.get('JWT_ISSUER'),
      // Staff only. A `crm-portal` token from US-21 is rejected here rather
      // than being quietly accepted with the wrong privileges.
      audience: TOKEN_AUDIENCES[0],
      // No `clockTolerance`, deliberately: AC6 says fifteen minutes, and a
      // token is valid for fifteen minutes and not a second longer.
      ignoreExpiration: false,
    };

    super(options);
  }

  /**
   * Runs after the signature, issuer, audience and expiry checks pass.
   *
   * **One Redis lookup, no database read** — US-16. US-14 left this decision
   * open; the answer is that revocation is checked (a signed-out token must
   * stop working *now*, AC2) but the user row is not re-read, because the
   * claims already carry everything a guard needs and a query per request would
   * be paid on every endpoint forever.
   *
   * A role change does not have to re-read the user either: US-16 revokes that
   * user's tokens at the moment the role changes, so the stale token is caught
   * by the same lookup (AC4).
   */
  async validate(payload: RawClaims): Promise<CurrentUserPayload> {
    const jti = typeof payload.jti === 'string' ? payload.jti : '';
    const iat = typeof payload.iat === 'number' ? payload.iat : 0;
    // Falls back to the standard second-resolution claim if `iatMs` is somehow
    // absent — coarse, but never treats an old token as newer than it is.
    const issuedAtMs = typeof payload.iatMs === 'number' ? payload.iatMs : iat * 1_000;

    // A token with no `jti` cannot be revoked, so it is refused rather than
    // trusted. In practice that means a token minted before US-16 shipped.
    if (jti === '') {
      throw new ApiException('UNAUTHENTICATED', 'This session is no longer valid.');
    }

    if (await this.revocations.isRevoked({ jti, sub: payload.sub, issuedAtMs })) {
      throw new ApiException('UNAUTHENTICATED', 'This session is no longer valid.');
    }

    // This is what `RequestContextService.setUserId`'s doc comment has been
    // waiting for since US-9: from here on every log line for this request
    // carries the user who made it.
    this.requestContext.setUserId(payload.sub);

    return {
      userId: payload.sub,
      roles: Array.isArray(payload.roles) ? payload.roles.filter((r) => typeof r === 'string') : [],
      sessionId: typeof payload.sid === 'string' ? payload.sid : '',
      jti,
      issuedAt: iat,
      issuedAtMs,
    };
  }
}
