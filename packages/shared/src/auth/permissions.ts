/**
 * The permission vocabulary, shared by both sides.
 *
 * The frontend needs these strings to decide which buttons to render (US-23);
 * the backend needs them to decide what is actually allowed (US-22). They are
 * the same strings, defined once, so a typo in a UI gate is a compile error
 * rather than a control that silently never appears.
 *
 * **This file describes; it does not enforce.** Everything in `@crm/shared` is
 * code the browser can read. Frontend gating is a convenience so users are not
 * offered actions that will fail — the server is the security boundary, and
 * every one of these is checked again in a backend guard.
 */
import { z } from 'zod';

/**
 * How far a granted permission reaches.
 *
 * The four come from US-13. `ASSIGNED` and `OWN` are genuinely different and
 * both are needed: a ticket assigned to an agent is not a ticket that agent
 * raised, and a portal customer's "own" tickets are the ones raised for them.
 */
export const PermissionScopeSchema = z.enum(['ALL', 'TEAM', 'ASSIGNED', 'OWN']);
export type PermissionScope = z.infer<typeof PermissionScopeSchema>;

/**
 * Every permission in the system, as `resource:action`.
 *
 * Adding one here is the first step of adding it anywhere: the backend
 * catalogue is checked against this list at build time, so a permission that
 * exists in the database but not here — or the reverse — fails a test rather
 * than surfacing as a role that mysteriously cannot do something.
 */
export const PERMISSION_KEYS = [
  // Tickets — the core of the platform.
  'ticket:view',
  'ticket:create',
  'ticket:update',
  'ticket:delete',
  'ticket:assign',
  'ticket:escalate',
  'ticket:close',

  // Conversation. `message:view_internal` is the permission that expresses the
  // project's first non-negotiable rule: an internal note must never reach a
  // customer, and the Customer role is never granted this.
  'message:view',
  'message:create',
  'message:view_internal',
  'message:create_internal',

  'customer:view',
  'customer:create',
  'customer:update',
  'customer:delete',

  'user:view',
  'user:manage',
  'role:view',
  'role:manage',

  'department:manage',
  'branch:manage',
  'category:manage',

  'sla:view',
  'sla:manage',

  'task:view',
  'task:create',
  'task:update',

  'article:view',
  'article:create',
  'article:update',
  'article:publish',

  'report:view',
  'report:export',

  'audit:view',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PermissionKeySchema = z.enum(PERMISSION_KEYS);

/** Splits `ticket:assign` into its halves. The key is always the source of truth. */
export function splitPermissionKey(key: PermissionKey): { resource: string; action: string } {
  const separator = key.indexOf(':');

  return { resource: key.slice(0, separator), action: key.slice(separator + 1) };
}

/**
 * What a user may do, as the API reports it.
 *
 * `permissions` maps a key to **every** scope granted for it, not one. A user
 * holding two roles can be granted `ticket:view` at `ASSIGNED` by one and `OWN`
 * by another, and the honest answer is that they see both sets — so the scopes
 * are collected and the query ORs them, rather than one of them being picked as
 * "broadest" by a ranking that does not really exist between `ASSIGNED` and
 * `OWN`.
 */
export const EffectivePermissionsSchema = z.object({
  userId: z.string().min(1),
  roles: z.array(z.string().min(1)),
  permissions: z.record(PermissionKeySchema, z.array(PermissionScopeSchema)),
});

export type EffectivePermissions = z.infer<typeof EffectivePermissionsSchema>;

/** The four roles every installation is seeded with (US-13, AC1). */
export const SYSTEM_ROLE_KEYS = ['administrator', 'manager', 'agent', 'customer'] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];
