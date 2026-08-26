/**
 * The access-token contract, shared by both sides.
 *
 * **This file describes; it does not enforce.** Everything in `@crm/shared` is
 * code the browser can read, so nothing secret goes in here — no signing key,
 * no verification logic. The frontend uses these types to read a token it was
 * handed; the server re-verifies every claim on every request. Same split as
 * `permissions.ts`.
 */
import { z } from 'zod';

/**
 * Which front door a token was issued for.
 *
 * The `aud` claim (US-14, AC6) only means anything because there is more than
 * one value: a portal refresh token from US-21 must never be able to mint a
 * staff access token, and the audience check is what stops it. Declaring both
 * now costs nothing and makes the check in `jwt.strategy.ts` honest rather than
 * decorative.
 */
export const TOKEN_AUDIENCES = ['crm-staff', 'crm-portal'] as const;

export type TokenAudience = (typeof TOKEN_AUDIENCES)[number];

export const TokenAudienceSchema = z.enum(TOKEN_AUDIENCES);

/**
 * The claims an access token carries (US-14, AC6).
 *
 * `roles` is plural where AC6 says "role". US-13 gave users **many** roles via
 * the `UserRole` join — that was a deliberate decision, taken over the single
 * `roleId` US-13's own technical note suggested — and a singular claim cannot
 * represent it. The plural is the same idea the criterion is reaching for: the
 * token says what the holder is.
 */
export const AccessTokenClaimsSchema = z.object({
  /** The user id. AC6's "user ID". */
  sub: z.string().uuid(),

  /** Role keys — `"agent"`, `"manager"`. AC6's "role". */
  roles: z.array(z.string().min(1)),

  /** AC6's "audience". */
  aud: TokenAudienceSchema,

  iss: z.string().min(1),

  /**
   * The session this token belongs to.
   *
   * Present so US-16 can revoke it. Deliberately unused for now: checking it
   * would mean a database read on every authenticated request, and which reads
   * are worth that is US-16's decision to make, not this story's.
   */
  sid: z.string().uuid(),

  /**
   * This token's own id — US-16.
   *
   * A signed JWT cannot be recalled, so signing out puts the `jti` on a Redis
   * denylist for the remainder of its fifteen minutes. Without it the only
   * options are keeping a database row per access token or accepting that
   * "sign out" means "sign out in a quarter of an hour".
   */
  jti: z.string().uuid(),

  /** Issued at, seconds since the epoch. */
  iat: z.number().int(),

  /**
   * Issued at again, in milliseconds — US-16.
   *
   * `iat` is standard and has one-second resolution, which is too coarse for
   * the per-user revocation cutoff: revoking a user's tokens and then signing
   * them back in happens well inside one second, and the fresh token would be
   * caught by the cutoff meant for the old one. Comparing milliseconds makes
   * "issued before the revocation" an answerable question.
   */
  iatMs: z.number().int(),

  /** Expires at, seconds since the epoch. AC6 requires `exp - iat === 900`. */
  exp: z.number().int(),
});

export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;

/**
 * AC6, as a number.
 *
 * Both sides import this rather than writing `900` twice: the server signs with
 * it, and the test that proves the criterion asserts against it.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 900;
