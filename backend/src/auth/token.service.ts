import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { TokenAudience } from '@crm/shared';

import { TypedConfigService } from '../config/index.js';

/** What goes into an access token, before the JWT library adds `iat` and `exp`. */
export interface AccessTokenInput {
  userId: string;
  roles: string[];
  sessionId: string;
  audience: TokenAudience;
}

/** A freshly minted refresh token. The plain value is returned exactly once. */
export interface MintedRefreshToken {
  /** Sent to the browser as an httpOnly cookie and never stored. */
  plain: string;
  /** Stored on the `Session` row. */
  hash: string;
}

/**
 * Bytes of entropy in a refresh token. 256 bits — enough that the unique
 * constraint on `Session.refreshTokenHash` will never actually fire, which is
 * how it should be.
 */
const REFRESH_TOKEN_BYTES = 32;

/**
 * Minting the two tokens a session is made of — US-14.
 *
 * They are deliberately different kinds of thing. The access token is a signed
 * JWT the server can check without touching the database. The refresh token is
 * an opaque random string whose only meaning is that a matching `Session` row
 * exists — which is what lets US-16 revoke it.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: TypedConfigService,
  ) {}

  /** Seconds until an access token expires. AC6 requires 900. */
  get accessTokenTtlSeconds(): number {
    return this.config.get('JWT_ACCESS_TTL_SECONDS');
  }

  get refreshTokenTtlSeconds(): number {
    return this.config.get('JWT_REFRESH_TTL_SECONDS');
  }

  /**
   * Signs an access token carrying the claims AC6 asks for: user id (`sub`),
   * roles, and audience — plus `sid`, so US-16 knows which session to revoke.
   */
  async signAccessToken(input: AccessTokenInput): Promise<string> {
    return this.jwt.signAsync(
      { roles: input.roles, sid: input.sessionId },
      {
        subject: input.userId,
        audience: input.audience,
        issuer: this.config.get('JWT_ISSUER'),
        expiresIn: this.accessTokenTtlSeconds,
      },
    );
  }

  /**
   * A refresh token and the hash to store for it.
   *
   * SHA-256 rather than argon2: this is 256 bits of `randomBytes`, so there is
   * no dictionary to attack and nothing a slow hash would buy — it would only
   * tax every refresh. Passwords are the opposite problem and get argon2id.
   */
  mintRefreshToken(): MintedRefreshToken {
    const plain = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');

    return { plain, hash: TokenService.hashRefreshToken(plain) };
  }

  /**
   * The same hash, for looking a token up. Static because US-15 and US-16 need
   * it without needing the rest of this service.
   */
  static hashRefreshToken(plain: string): string {
    return createHash('sha256').update(plain).digest('hex');
  }
}
