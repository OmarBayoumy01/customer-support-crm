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

export const HealthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  service: z.string().min(1),
  timestamp: z.string().datetime(),
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;
