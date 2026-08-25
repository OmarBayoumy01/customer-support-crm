/**
 * Health DTO — the first shared contract in the system.
 *
 * `@crm/shared` carries DTOs and Zod schemas ONLY. No auth logic, no permission
 * checks, no enforcement of any kind. The server is the security boundary
 * (see CLAUDE.md, "Two rules that are non-negotiable"), and everything in this
 * package is, by definition, code the browser can read. A schema here describes
 * the shape of a payload; it never decides who is allowed to see it.
 */
import { z } from 'zod';

/**
 * The state of one thing the service depends on.
 *
 * `error` carries the failure message so an operator can see *why* a dependency
 * is down without opening logs. It is a connection-level message — never a
 * query, a credential, or anything derived from user data.
 */
export const DependencyStatusSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
});

export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;

export const HealthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  service: z.string().min(1),
  timestamp: z.string().datetime(),

  /**
   * Keyed by dependency name — `database` from US-5, `redis` from US-10.
   *
   * A new dependency is a new entry, not a new field: this is the extension
   * point, so the DTO does not have to change again every time the service
   * grows something else to talk to.
   *
   * Overall `status` is derived from these. A *critical* dependency being down
   * makes the service `down`; a non-critical one makes it `degraded`. Which
   * dependencies are critical is a server-side decision and is not expressed
   * here — the client is told the outcome, not the policy.
   */
  dependencies: z.record(z.string(), DependencyStatusSchema),
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;
