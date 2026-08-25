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
