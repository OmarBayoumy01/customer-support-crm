import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';
import { TOKEN_AUDIENCES } from '@crm/shared';

import { RequestContextService } from '../common/index.js';
import { TypedConfigService } from '../config/index.js';
import type { CurrentUserPayload } from './decorators/current-user.decorator.js';

/** The claims as they come off the wire, before we trust anything about them. */
interface RawClaims {
  sub: string;
  roles?: unknown;
  sid?: unknown;
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
   * Runs after the signature checks pass.
   *
   * **No database read, and no session-revocation check.** Both would be a
   * query on every authenticated request, and whether that cost is worth paying
   * is US-16's decision to make — the `sid` claim is carried precisely so it
   * can. Until then an access token stays valid for its fifteen minutes even if
   * its session is revoked, which is the normal trade-off for stateless
   * access tokens and is worth stating out loud.
   */
  validate(payload: RawClaims): CurrentUserPayload {
    // This is what `RequestContextService.setUserId`'s doc comment has been
    // waiting for since US-9: from here on every log line for this request
    // carries the user who made it.
    this.requestContext.setUserId(payload.sub);

    return {
      userId: payload.sub,
      roles: Array.isArray(payload.roles) ? payload.roles.filter((r) => typeof r === 'string') : [],
      sessionId: typeof payload.sid === 'string' ? payload.sid : '',
    };
  }
}
