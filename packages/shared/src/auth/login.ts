/**
 * The login request and response, shared by both sides (US-14).
 *
 * The frontend validates the form against the same schema the server validates
 * the body against, so a rule can never be enforced in one place and forgotten
 * in the other. Normalisation lives here for the same reason — see below.
 */
import { z } from 'zod';

import { EffectivePermissionsSchema } from './permissions.js';
import { TokenAudienceSchema } from './tokens.js';

/** Matches `Locale` in the Prisma schema. */
export const LocaleSchema = z.enum(['EN', 'AR']);

export type Locale = z.infer<typeof LocaleSchema>;

/**
 * A password field is capped, not shaped.
 *
 * **No policy is stated on the login form.** Telling someone signing in that
 * their password needs a digit is useless — the password already exists — and
 * it hands an attacker the rule set for free. The policy belongs to the form
 * that *sets* a password, which is US-18.
 *
 * The cap is a denial-of-service guard: argon2 has no bcrypt-style truncation,
 * so without it a megabyte of input would be hashed at full cost.
 */
const MAX_PASSWORD_LENGTH = 512;

export const LoginRequestSchema = z.object({
  /**
   * Lowercased and trimmed **before** validation, not after.
   *
   * Both sides normalise identically because both import this schema, which
   * matters more than it looks: the brute-force counter in US-14's throttle is
   * keyed on this value, so if the client sent `Agent@Example.com` and the
   * server keyed on the raw string, varying the capitalisation would reset the
   * attempt count on every try.
   */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Email is required')
    .email('Enter a valid email address'),

  password: z.string().min(1, 'Password is required').max(MAX_PASSWORD_LENGTH),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * The authenticated user, as the API reports them.
 *
 * Deliberately narrow. `passwordHash` is not on it and must never be — see the
 * `select` in `AuthService`, and the test that asserts no response body ever
 * contains it.
 */
export const AuthenticatedUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  locale: LocaleSchema,
  /** Role keys, the same plural the token carries. */
  roles: z.array(z.string().min(1)),
});

export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;

/**
 * What a successful login returns (AC1).
 *
 * **The refresh token is not in here.** It is only ever a `Set-Cookie` —
 * httpOnly and SameSite=Strict, per the story's technical note — so that script
 * on the page cannot read it. Putting it in the body would defeat the cookie.
 */
export const LoginResponseSchema = z.object({
  accessToken: z.string().min(1),

  /**
   * Seconds until the access token expires. Lets the client schedule US-15's
   * silent refresh without having to decode the token to find out.
   */
  expiresIn: z.number().int().positive(),

  /**
   * Which application this token is for — **decided by the account, not asked
   * for by the client.**
   *
   * There is one login form. A person types their email and password, and the
   * server answers with the audience their account belongs to: `crm-portal` for
   * an account with a linked customer record, `crm-staff` otherwise. The client
   * uses it to decide where to land, and cannot influence it — there is no
   * request field for it and no second endpoint to prefer.
   *
   * It is reported rather than inferred from `roles` because roles are
   * configuration an administrator can reassign, and which application somebody
   * belongs in must not be.
   */
  audience: TokenAudienceSchema,

  user: AuthenticatedUserSchema,

  /**
   * Shipped with the session so the UI can gate itself without a second round
   * trip — US-23 reads exactly this. A convenience, never enforcement: US-22
   * checks the same permissions again on every request.
   */
  permissions: EffectivePermissionsSchema,
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
