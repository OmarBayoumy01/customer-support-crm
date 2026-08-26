import { Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../config/index.js';
import { RedisService } from '../redis/index.js';

/** One key per revoked access token. */
const JTI_PREFIX = 'auth:denied-jti:';

/** One key per user, holding the second before which no token is accepted. */
const USER_CUTOFF_PREFIX = 'auth:revoked-before:';

/**
 * Making already-issued access tokens stop working — US-16.
 *
 * An access token is a signed statement; nothing can un-sign it. So there are
 * only three honest options: keep them short-lived and accept a window, store
 * one database row per token, or keep a denylist of the few that were revoked
 * early. This is the third, which is why the tokens are also only fifteen
 * minutes long — the list stays small because entries expire on their own.
 *
 * Two mechanisms, because AC2 and AC4 are different shapes:
 *
 *   - **By `jti`** — "this one token is finished", for signing out (AC2).
 *   - **By user, before a timestamp** — "everything issued to this person up to
 *     now is finished", for signing out everywhere and for a role change or
 *     deactivation (AC3, AC4). Revoking by session id would not do: the point
 *     of AC4 is that tokens carrying *stale permissions* must stop, and the
 *     server does not know which sessions those went to.
 *
 * **Redis being down fails closed here**, which is the opposite of the login
 * throttle and needs saying out loud, because it also contradicts the posture
 * P01 set — that Redis is a cache, degrades, and never takes the service down.
 *
 * The two failures are not symmetrical. A throttle that cannot be consulted
 * merely stops catching attacks, and the password is still required. A
 * revocation list that cannot be consulted starts *honouring credentials that
 * were explicitly withdrawn* — a signed-out session, or the session of someone
 * who was just deactivated, quietly works again.
 *
 * The cost is real and worth being clear about: while Redis is unreachable,
 * every authenticated request is refused, so the helpdesk is down rather than
 * degraded. The window is bounded by the fifteen-minute access token, but that
 * is no comfort during an outage. **If that trade is wrong for this business,
 * this is the single method to change** — and the choice belongs to whoever
 * owns the incident, not to this file.
 */
@Injectable()
export class TokenRevocationService {
  private readonly logger = new Logger(TokenRevocationService.name);
  private readonly accessTtlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: TypedConfigService,
  ) {
    this.accessTtlSeconds = config.get('JWT_ACCESS_TTL_SECONDS');
  }

  /**
   * Denies one access token for whatever is left of its life — AC1, AC2.
   *
   * `expiresAt` is the token's own `exp`, so the entry disappears at the moment
   * the token would have expired anyway. A fixed TTL would either drop entries
   * early — un-revoking a token — or hold them long after they meant anything.
   */
  async denyToken(jti: string, expiresAtSeconds: number): Promise<void> {
    const remaining = Math.max(1, expiresAtSeconds - Math.floor(Date.now() / 1_000));

    await this.redis.client.set(`${JTI_PREFIX}${jti}`, '1', 'EX', remaining);
  }

  /**
   * Denies every access token issued to a user up to now — AC3, AC4.
   *
   * The cutoff only has to outlive the longest access token that could still be
   * in circulation, which is `JWT_ACCESS_TTL_SECONDS`. After that every
   * surviving token was necessarily issued after the cutoff.
   */
  async revokeUserTokens(userId: string): Promise<void> {
    await this.redis.client.set(
      `${USER_CUTOFF_PREFIX}${userId}`,
      String(Date.now()),
      'EX',
      this.accessTtlSeconds + 1,
    );
  }

  /**
   * Whether a token should be refused.
   *
   * Compared in **milliseconds**, against the token's `iatMs` claim rather than
   * the standard `iat`. `iat` has one-second resolution, and revoking a user's
   * tokens then signing them straight back in happens comfortably inside one
   * second — with seconds the fresh token would be caught by the cutoff meant
   * for the old one, and the user would be locked out of their own account for
   * up to a second after every role change.
   *
   * `<=` rather than `<` so that a token minted in the same millisecond as the
   * revocation loses. Ties have to go to the revocation, or a sign-out racing a
   * refresh could leave a live token behind.
   */
  async isRevoked(claims: { jti: string; sub: string; issuedAtMs: number }): Promise<boolean> {
    try {
      const [denied, cutoff] = await this.redis.client.mget(
        `${JTI_PREFIX}${claims.jti}`,
        `${USER_CUTOFF_PREFIX}${claims.sub}`,
      );

      if (denied !== null && denied !== undefined) {
        return true;
      }

      if (cutoff === null || cutoff === undefined) {
        return false;
      }

      return claims.issuedAtMs <= Number.parseInt(cutoff, 10);
    } catch (error: unknown) {
      // Fail closed. See the note on the class.
      this.logger.error(
        `Could not check token revocation, refusing the request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return true;
    }
  }
}
