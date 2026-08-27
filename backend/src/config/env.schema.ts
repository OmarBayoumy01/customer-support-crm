import { z } from 'zod';

import { LOG_LEVELS } from '../common/logging/log-level.js';

/**
 * Environment variables are strings, and `z.coerce.boolean()` is the wrong tool
 * for them: it follows JavaScript truthiness, so the string `"false"` coerces to
 * `true`. Listing the accepted spellings is unglamorous and correct.
 */
const BooleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/**
 * The single source of truth for this service's environment contract.
 *
 * Every variable the backend reads is declared here. Nothing else in the
 * codebase may touch `process.env` — the `no-process-env` ESLint rule enforces
 * that everywhere except `backend/src/config/`.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),

  /**
   * Deliberately has no default. A service that cannot reach its database must
   * not boot into a half-working state — same fail-fast stance as every other
   * variable here.
   */
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'must be a postgresql:// connection string',
    ),

  /** Maximum connections held open by the pg pool. See PrismaService. */
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().max(100).default(10),

  /** How long to wait for a free pooled connection before failing. */
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  /**
   * Redis connection string. Required, but unlike `DATABASE_URL` an unreachable
   * Redis does not stop the service booting — the cache degrades and `/health`
   * reports it down. See RedisService.
   */
  REDIS_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
      'must be a redis:// or rediss:// connection string',
    ),

  /**
   * Namespaces every cache key. Two environments sharing one Redis — which
   * happens more often than anyone plans for — must not read each other's
   * entries.
   */
  REDIS_KEY_PREFIX: z.string().default('crm:'),

  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  /** Default cache lifetime when a caller does not specify one. */
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  /** How many times a background job is tried before it is dead-lettered. */
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().max(20).default(3),

  /** Base delay for exponential backoff between job attempts. */
  QUEUE_BACKOFF_MS: z.coerce.number().int().positive().default(1_000),

  /**
   * Verbosity, changeable without a code change (US-9, AC4). Left optional so
   * the default can depend on `NODE_ENV` — quiet in production, `debug`
   * everywhere else.
   */
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),

  /** Where the Swagger UI is served from. No leading slash — Nest adds it. */
  SWAGGER_PATH: z.string().min(1).default('api/docs'),

  /**
   * Off in production unless this is deliberately set, and even then only with
   * credentials — see `SWAGGER_USER`. Outside production the docs are always on,
   * because a developer having to enable them defeats the point.
   */
  SWAGGER_ENABLED_IN_PRODUCTION: BooleanFromString.default('false'),

  /**
   * Basic-auth credentials guarding the docs in production. Both must be set for
   * production docs to serve at all; a public schema of every endpoint is a gift
   * to anyone probing the service.
   */
  SWAGGER_USER: z.string().min(1).optional(),
  SWAGGER_PASSWORD: z.string().min(1).optional(),

  // --- Authentication (US-14) ----------------------------------------------

  /**
   * Signs access tokens. **Deliberately has no default** — the same fail-fast
   * stance as `DATABASE_URL`, and for a sharper reason: a signing key with a
   * default is a signing key every attacker already has. 32 characters is the
   * floor for HS256 to be worth anything.
   */
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),

  /**
   * Signs nothing today — refresh tokens are random bytes checked against a
   * stored hash, not JWTs. Declared now because US-15 rotates them and the
   * deployment contract should not change under it. Same no-default rule.
   */
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),

  /** The `iss` claim, and what the strategy verifies incoming tokens against. */
  JWT_ISSUER: z.string().min(1).default('crm'),

  /**
   * US-14 AC6 says fifteen minutes, so that is the default. Configurable
   * because staging sometimes wants it shorter to shake out refresh bugs — but
   * the criterion is asserted against `ACCESS_TOKEN_TTL_SECONDS` in
   * `@crm/shared`, not against this.
   */
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  /** How long a refresh token — and its `Session` row — stays valid. 30 days. */
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  /**
   * argon2id parameters. Defaults are the OWASP minimum: 19 MiB of memory, two
   * passes, one lane. Raising `ARGON2_MEMORY_COST` is the one that actually
   * costs an attacker; raising it also costs every login, so it is a knob and
   * not a constant.
   */
  ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19_456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

  /**
   * Brute-force thresholds (AC5). Two independent counters, because one office
   * behind one NAT is one IP: a single counter either locks out a whole floor
   * of agents or fails to stop an attack on one account.
   */
  LOGIN_MAX_ATTEMPTS_PER_EMAIL: z.coerce.number().int().positive().default(5),
  LOGIN_MAX_ATTEMPTS_PER_IP: z.coerce.number().int().positive().default(20),

  /** Both the counting window and the lockout, in seconds. */
  LOGIN_THROTTLE_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),

  /**
   * Portal rate limits — US-82, AC5.
   *
   * Requests, not failures: a customer doing nothing wrong is still capable of
   * doing too much of it. Two independent counters for the same reason the
   * login throttle has two — per account stops one signed-in customer, per IP
   * stops a spray across many accounts from one place.
   *
   * Generous by default. The portal is the surface a real customer uses while
   * a page loads several requests at once, and a limit that trips during
   * ordinary use is a limit that gets raised until it means nothing.
   */
  PORTAL_RATE_LIMIT_PER_ACCOUNT: z.coerce.number().int().positive().default(120),
  PORTAL_RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(240),

  /** The counting window for both portal limits, in seconds. */
  PORTAL_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  /**
   * `Secure` on the refresh cookie. Off by default only because a developer on
   * plain `http://localhost` would otherwise never receive the cookie at all
   * and login would appear to work while silently issuing no session.
   * **Set this to true in every deployed environment.**
   */
  COOKIE_SECURE: BooleanFromString.default('false'),

  /**
   * Password given to the seeded development users. Optional: when it is unset
   * the seed creates no users at all rather than inventing a password, and it
   * refuses to create them in production regardless. See `src/seed/seed.ts`.
   */
  SEED_PASSWORD: z.string().min(8).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Formats Zod issues as one readable line per offending variable.
 *
 * AC2 requires a clear message that names the variable, so this deliberately
 * avoids dumping the raw ZodError — a stack trace is not a clear message.
 */
export function formatEnvIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  ${name} — ${issue.message}`;
  });

  return ['Config validation failed:', ...lines].join('\n');
}

/**
 * Validation hook for `ConfigModule.forRoot({ validate })`.
 *
 * Exits the process rather than throwing. Throwing here surfaces as an
 * unhandled rejection inside Nest's bootstrap and prints a stack trace, which
 * is exactly what AC2 says must not happen.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);

  if (!result.success) {
    console.error(formatEnvIssues(result.error));
    process.exit(1);
  }

  return result.data;
}
