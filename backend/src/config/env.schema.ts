import { z } from 'zod';

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
