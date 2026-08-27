import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';
import { TOKEN_AUDIENCES } from '@crm/shared';

import { ApiException, RequestContextService } from '../common/index.js';
import { TypedConfigService } from '../config/index.js';
import { TokenRevocationService } from '../auth/token-revocation.service.js';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator.js';

/** The claims as they arrive, before anything about them is trusted. */
interface RawClaims {
  sub: string;
  roles?: unknown;
  sid?: unknown;
  jti?: unknown;
  iat?: unknown;
  iatMs?: unknown;
}

/** `crm-portal`. Named rather than indexed so the intent survives a reorder. */
const PORTAL_AUDIENCE = TOKEN_AUDIENCES[1];

/**
 * Verifies a **portal** bearer token — US-82, AC4.
 *
 * A second strategy rather than a shared one that accepts either audience, and
 * that is the point of the story: `passport-jwt` checks `aud` before `validate`
 * is reached, so a `crm-staff` token is refused here by the library and a
 * `crm-portal` token is refused by `JwtStrategy` on the staff side. Neither
 * decision is left to application code that could forget.
 *
 * Everything else — signature, issuer, expiry, and the Redis revocation check —
 * is identical to the staff strategy, because a portal session must stop working
 * the moment it is signed out just as a staff one does.
 */
@Injectable()
export class PortalJwtStrategy extends PassportStrategy(Strategy, 'jwt-portal') {
  constructor(
    config: TypedConfigService,
    private readonly requestContext: RequestContextService,
    private readonly revocations: TokenRevocationService,
  ) {
    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_ACCESS_SECRET'),
      issuer: config.get('JWT_ISSUER'),
      // The whole of AC4's first half, in one line.
      audience: PORTAL_AUDIENCE,
      ignoreExpiration: false,
    };

    super(options);
  }

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
      roles: Array.isArray(payload.roles) ? payload.roles.filter((r) => typeof r === 'string') : [],
      sessionId: typeof payload.sid === 'string' ? payload.sid : '',
      jti,
      issuedAt: iat,
      issuedAtMs,
    };
  }
}
