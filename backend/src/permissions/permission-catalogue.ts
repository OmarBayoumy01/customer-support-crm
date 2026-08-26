import {
  PERMISSION_KEYS,
  splitPermissionKey,
  type PermissionKey,
  type PermissionScope,
  type SystemRoleKey,
} from '@crm/shared';

/** One permission, as it will exist in the `Permission` table. */
export interface PermissionDefinition {
  readonly key: PermissionKey;
  readonly resource: string;
  readonly action: string;
  readonly description: string;
}

/**
 * What a role is granted, and how far it reaches.
 *
 * A tuple rather than an object because these are read as a table — the whole
 * point of the role definitions below is that someone can scan them and see
 * what an Agent can do without reading prose.
 */
export type Grant = readonly [PermissionKey, PermissionScope];

export interface RoleDefinition {
  readonly key: SystemRoleKey;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly description: string;
  readonly grants: readonly Grant[];
}

/**
 * Human-readable descriptions, one per key in `PERMISSION_KEYS`.
 *
 * Kept as a `Record` keyed by the shared type, so **adding a permission to
 * `@crm/shared` without describing it here is a compile error**, and removing
 * one leaves an unused key that is equally visible. The two lists cannot drift.
 */
const DESCRIPTIONS: Record<PermissionKey, string> = {
  'ticket:view': 'See tickets',
  'ticket:create': 'Raise a ticket',
  'ticket:update': 'Change a ticket’s details, status, or priority',
  'ticket:delete': 'Delete a ticket',
  'ticket:assign': 'Assign a ticket to an agent',
  'ticket:escalate': 'Escalate a ticket',
  'ticket:close': 'Resolve or close a ticket',

  'message:view': 'Read customer-facing messages on a ticket',
  'message:create': 'Reply to a customer',
  'message:view_internal': 'Read internal notes — never granted to customers',
  'message:create_internal': 'Write an internal note',

  'customer:view': 'See customer records',
  'customer:create': 'Create a customer',
  'customer:update': 'Edit a customer',
  'customer:delete': 'Delete a customer',

  'user:view': 'See staff accounts',
  'user:manage': 'Invite, edit, deactivate, and assign roles to staff',
  'role:view': 'See roles and their permissions',
  'role:manage': 'Create and edit roles',

  'department:manage': 'Create and edit departments',
  'branch:manage': 'Create and edit branches',
  'category:manage': 'Create and edit ticket categories',

  'sla:view': 'See SLA policies and timers',
  'sla:manage': 'Create and edit SLA policies',

  'task:view': 'See tasks',
  'task:create': 'Create a task',
  'task:update': 'Complete or edit a task',

  'article:view': 'Read knowledge base articles',
  'article:create': 'Draft a knowledge base article',
  'article:update': 'Edit a knowledge base article',
  'article:publish': 'Publish or unpublish an article',

  'report:view': 'See reports and dashboards',
  'report:export': 'Export report data',

  'audit:view': 'Read the audit log',
};

/**
 * Every permission, derived from the shared key list (AC2).
 *
 * `resource` and `action` are split from the key rather than typed twice, so
 * the three columns can never disagree with each other.
 */
export const PERMISSION_CATALOGUE: readonly PermissionDefinition[] = PERMISSION_KEYS.map((key) => {
  const { resource, action } = splitPermissionKey(key);

  return { key, resource, action, description: DESCRIPTIONS[key] };
});

/** Everything, at `ALL`. Used by the administrator role. */
const EVERYTHING: readonly Grant[] = PERMISSION_KEYS.map((key) => [key, 'ALL'] as const);

/**
 * The four roles a fresh installation is seeded with (AC1).
 *
 * Read them as a permissions matrix. The scopes are the interesting part —
 * the same `ticket:view` means something different to each role, and that is
 * the whole design:
 *
 *   Administrator  ALL       every ticket in the platform
 *   Manager        TEAM      every ticket in their department
 *   Agent          ASSIGNED  the tickets in their own queue
 *   Customer       OWN       the tickets raised for them
 */
export const SYSTEM_ROLES: readonly RoleDefinition[] = [
  {
    key: 'administrator',
    nameEn: 'Administrator',
    nameAr: 'مدير النظام',
    description: 'Configures and secures the platform. Holds every permission.',
    grants: EVERYTHING,
  },

  {
    key: 'manager',
    nameEn: 'Manager',
    nameAr: 'مشرف',
    description: 'Supervises workload, escalations, and SLA performance for their department.',
    grants: [
      ['ticket:view', 'TEAM'],
      ['ticket:create', 'TEAM'],
      ['ticket:update', 'TEAM'],
      ['ticket:assign', 'TEAM'],
      ['ticket:escalate', 'TEAM'],
      ['ticket:close', 'TEAM'],

      ['message:view', 'TEAM'],
      ['message:create', 'TEAM'],
      ['message:view_internal', 'TEAM'],
      ['message:create_internal', 'TEAM'],

      ['customer:view', 'ALL'],
      ['customer:create', 'ALL'],
      ['customer:update', 'ALL'],

      // Sees their own team's staff, but cannot invite or remove anyone —
      // that is `user:manage`, and it belongs to an administrator.
      ['user:view', 'TEAM'],

      ['sla:view', 'ALL'],

      ['task:view', 'TEAM'],
      ['task:create', 'TEAM'],
      ['task:update', 'TEAM'],

      ['article:view', 'ALL'],
      ['article:create', 'ALL'],
      ['article:update', 'ALL'],
      ['article:publish', 'ALL'],

      ['report:view', 'TEAM'],
      ['report:export', 'TEAM'],
    ],
  },

  {
    key: 'agent',
    nameEn: 'Support Agent',
    nameAr: 'موظف دعم',
    description: 'Resolves assigned tickets against SLA targets.',
    grants: [
      // AC3's worked example: ticket:view at ASSIGNED resolves to this agent's
      // queue, not to every ticket in the platform.
      ['ticket:view', 'ASSIGNED'],
      ['ticket:update', 'ASSIGNED'],
      ['ticket:escalate', 'ASSIGNED'],
      ['ticket:close', 'ASSIGNED'],

      // Agents raise tickets on behalf of customers who phone in, which is a
      // ticket nobody has assigned yet — hence TEAM rather than ASSIGNED.
      ['ticket:create', 'TEAM'],

      ['message:view', 'ASSIGNED'],
      ['message:create', 'ASSIGNED'],
      ['message:view_internal', 'ASSIGNED'],
      ['message:create_internal', 'ASSIGNED'],

      // Looking a customer up is the first thing an agent does on a call, and
      // that customer is not necessarily theirs.
      ['customer:view', 'ALL'],
      ['customer:create', 'ALL'],
      ['customer:update', 'ALL'],

      ['task:view', 'ASSIGNED'],
      ['task:create', 'OWN'],
      ['task:update', 'ASSIGNED'],

      ['article:view', 'ALL'],
      ['article:create', 'OWN'],
      ['article:update', 'OWN'],
    ],
  },

  {
    key: 'customer',
    nameEn: 'Customer',
    nameAr: 'عميل',
    description: 'Raises requests through the portal and tracks their progress.',
    grants: [
      ['ticket:view', 'OWN'],
      ['ticket:create', 'OWN'],

      // `message:view` only. `message:view_internal` is deliberately absent and
      // must stay absent: it is the permission-level expression of the rule
      // that an internal note never reaches a customer. There is a test that
      // fails if it is ever added here.
      ['message:view', 'OWN'],
      ['message:create', 'OWN'],

      ['article:view', 'ALL'],
    ],
  },
];

/** Lookup by key, for the seed and for tests. */
export function systemRole(key: SystemRoleKey): RoleDefinition {
  const found = SYSTEM_ROLES.find((role) => role.key === key);

  if (found === undefined) {
    throw new Error(`No system role definition for "${key}"`);
  }

  return found;
}
