import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { PERMISSION_KEYS, SYSTEM_ROLE_KEYS, type PermissionKey } from '@crm/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/index.js';
import { PERMISSION_CATALOGUE, SYSTEM_ROLES, systemRole } from './permission-catalogue.js';
import { PermissionsService } from './permissions.service.js';
import { RolesService } from './roles.service.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let app: INestApplication;
let prisma: PrismaService;
let permissions: PermissionsService;
let roles: RolesService;

/** Namespaces this run's rows, since the test database persists between runs. */
const run = `${String(process.pid)}-${String(Math.floor(performance.now()))}`;

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  await app.init();

  prisma = app.get(PrismaService);
  permissions = app.get(PermissionsService);
  roles = app.get(RolesService);

  // AC1 says "when seeding runs" — so the suite runs it, against the test
  // database, rather than assuming someone did. It is idempotent, so this is
  // also the proof that running it twice is safe.
  const databaseUrl = process.env['DATABASE_URL'] ?? '';

  execFileSync(process.execPath, ['dist/seed/seed.js'], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 60_000,
  });
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// AC1 — four seeded roles with sensible defaults
// ---------------------------------------------------------------------------

test('AC1 — Administrator, Manager, Agent, and Customer all exist after seeding', async () => {
  const seeded = await prisma.role.findMany({
    where: { key: { in: [...SYSTEM_ROLE_KEYS] } },
    select: { key: true, isSystem: true, nameEn: true, nameAr: true },
  });

  assert.deepEqual(seeded.map((role) => role.key).sort(), [
    'administrator',
    'agent',
    'customer',
    'manager',
  ]);

  for (const role of seeded) {
    assert.equal(role.isSystem, true, `${role.key} must be a system role`);
    assert.ok(role.nameEn.length > 0, `${role.key} needs an English name`);
    assert.ok(
      role.nameAr.length > 0,
      `${role.key} needs an Arabic name — the platform is bilingual`,
    );
  }
});

test('AC1 — each seeded role has the grants its definition declares', async () => {
  for (const definition of SYSTEM_ROLES) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { key: definition.key },
      include: { permissions: true },
    });

    assert.equal(
      role.permissions.length,
      definition.grants.length,
      `${definition.key} should have ${String(definition.grants.length)} grants`,
    );
  }
});

test('AC1 — the administrator holds every permission', async () => {
  const role = await prisma.role.findUniqueOrThrow({
    where: { key: 'administrator' },
    include: { permissions: { include: { permission: true } } },
  });

  assert.deepEqual(
    role.permissions.map((grant) => grant.permission.key).sort(),
    [...PERMISSION_KEYS].sort(),
  );

  for (const grant of role.permissions) {
    assert.equal(grant.scope, 'ALL', 'an administrator is not scoped');
  }
});

test('AC1 — seeding twice changes nothing', async () => {
  const before = await prisma.rolePermission.count();

  const databaseUrl = process.env['DATABASE_URL'] ?? '';
  execFileSync(process.execPath, ['dist/seed/seed.js'], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 60_000,
  });

  assert.equal(await prisma.rolePermission.count(), before, 'the seed must be idempotent');
});

/**
 * The permission-level form of the project's first non-negotiable rule.
 *
 * If someone ever adds `message:view_internal` to the customer role, this fails
 * — before any endpoint exists to leak through.
 */
test('AC1 — the Customer role can NEVER read internal notes', async () => {
  const definition = systemRole('customer');
  const granted = definition.grants.map(([key]) => key);

  assert.ok(
    !granted.includes('message:view_internal'),
    'internal notes must never reach a customer — not even by permission',
  );
  assert.ok(!granted.includes('message:create_internal'));

  // And the same, read back from the database rather than the definition.
  const role = await prisma.role.findUniqueOrThrow({
    where: { key: 'customer' },
    include: { permissions: { include: { permission: true } } },
  });

  assert.ok(
    !role.permissions.some((grant) => grant.permission.key.includes('internal')),
    'the seeded customer role must hold no internal-note permission',
  );
});

// ---------------------------------------------------------------------------
// AC2 — resource plus action
// ---------------------------------------------------------------------------

test('AC2 — every permission is stored as resource plus action', async () => {
  const stored = await prisma.permission.findMany({
    select: { key: true, resource: true, action: true, description: true },
  });

  assert.ok(stored.length >= PERMISSION_KEYS.length);

  for (const permission of stored) {
    assert.equal(
      permission.key,
      `${permission.resource}:${permission.action}`,
      'the key must be exactly resource:action, or the three columns disagree',
    );
    assert.ok(permission.description !== null && permission.description.length > 0);
  }
});

test('AC2 — the story’s own examples exist', async () => {
  for (const key of ['ticket:assign', 'user:manage', 'report:view']) {
    const found = await prisma.permission.findUnique({ where: { key } });
    assert.ok(found !== null, `${key} should exist — the story names it`);
  }
});

test('AC2 — the catalogue and the shared key list cannot drift', () => {
  assert.deepEqual(
    PERMISSION_CATALOGUE.map((permission) => permission.key).sort(),
    [...PERMISSION_KEYS].sort(),
  );
});

// ---------------------------------------------------------------------------
// AC3 — scoped permissions resolve in the query
// ---------------------------------------------------------------------------

interface Fixture {
  agentId: string;
  otherAgentId: string;
  assignedTicketId: string;
  otherAgentTicketId: string;
  unassignedSameTeamTicketId: string;
}

/** Bumped per call: the fixture is built more than once in a run, and branch
 * codes and emails are unique. */
let fixtureCount = 0;

async function buildTicketFixture(): Promise<Fixture> {
  const id = `${run}-${String((fixtureCount += 1))}`;

  const branch = await prisma.branch.create({
    data: { code: `SC-${id}`, nameEn: 'Scope', nameAr: 'النطاق' },
  });
  const department = await prisma.department.create({
    data: { code: `SD-${id}`, nameEn: 'Scope', nameAr: 'النطاق', branchId: branch.id },
  });

  const agent = await prisma.user.create({
    data: {
      email: `scope-agent-${id}@example.com`,
      passwordHash: 'x',
      firstName: 'Scoped',
      lastName: 'Agent',
      departmentId: department.id,
    },
  });

  const otherAgent = await prisma.user.create({
    data: {
      email: `scope-other-${id}@example.com`,
      passwordHash: 'x',
      firstName: 'Other',
      lastName: 'Agent',
      departmentId: department.id,
    },
  });

  const customer = await prisma.customer.create({
    data: { firstName: 'Scope', lastName: 'Customer', email: `scope-cust-${id}@example.com` },
  });

  const assigned = await prisma.ticket.create({
    data: {
      subject: `assigned-${id}`,
      customerId: customer.id,
      assigneeId: agent.id,
      departmentId: department.id,
    },
  });

  const otherAgentTicket = await prisma.ticket.create({
    data: {
      subject: `other-${id}`,
      customerId: customer.id,
      assigneeId: otherAgent.id,
      departmentId: department.id,
    },
  });

  const unassigned = await prisma.ticket.create({
    data: { subject: `unassigned-${id}`, customerId: customer.id, departmentId: department.id },
  });

  const agentRole = await prisma.role.findUniqueOrThrow({ where: { key: 'agent' } });
  await roles.assignRole(agent.id, agentRole.id);

  return {
    agentId: agent.id,
    otherAgentId: otherAgent.id,
    assignedTicketId: assigned.id,
    otherAgentTicketId: otherAgentTicket.id,
    unassignedSameTeamTicketId: unassigned.id,
  };
}

test('AC3 — an agent with ticket:view at ASSIGNED sees only their own queue', async () => {
  const fixture = await buildTicketFixture();

  const scopes = await permissions.scopesFor(fixture.agentId, 'ticket:view');
  assert.deepEqual(scopes, ['ASSIGNED'], 'the seeded agent role scopes ticket:view to ASSIGNED');

  const where = await permissions.ticketScopeFor(fixture.agentId, 'ticket:view');

  // The whole point: the narrowing happens in the query, not afterwards.
  const visible = await prisma.ticket.findMany({ where, select: { id: true } });
  const visibleIds = new Set(visible.map((ticket) => ticket.id));

  assert.ok(visibleIds.has(fixture.assignedTicketId), 'their own ticket should be visible');
  assert.ok(
    !visibleIds.has(fixture.otherAgentTicketId),
    "another agent's ticket must not be visible",
  );
  assert.ok(
    !visibleIds.has(fixture.unassignedSameTeamTicketId),
    'an unassigned ticket in the same department is not "assigned" to them',
  );
});

test('AC3 — the same permission at TEAM widens to the whole department', async () => {
  const fixture = await buildTicketFixture();

  const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
  await roles.setUserRoles(fixture.agentId, [managerRole.id]);

  const where = await permissions.ticketScopeFor(fixture.agentId, 'ticket:view');
  const visibleIds = new Set(
    (await prisma.ticket.findMany({ where, select: { id: true } })).map((ticket) => ticket.id),
  );

  assert.ok(visibleIds.has(fixture.assignedTicketId));
  assert.ok(
    visibleIds.has(fixture.otherAgentTicketId),
    "a manager sees their department's tickets, including other agents'",
  );
  assert.ok(visibleIds.has(fixture.unassignedSameTeamTicketId));
});

test('AC3 — a permission that is not granted resolves to nothing, not everything', async () => {
  const stranger = await prisma.user.create({
    data: {
      email: `no-roles-${run}@example.com`,
      passwordHash: 'x',
      firstName: 'No',
      lastName: 'Roles',
    },
  });

  const where = await permissions.ticketScopeFor(stranger.id, 'ticket:view');
  const visible = await prisma.ticket.findMany({ where, select: { id: true } });

  // The failure mode this guards against is a "no filter" that means "no
  // access" being expressed as {} — which matches every row in the table.
  assert.equal(visible.length, 0, 'no grant must mean no rows, never all rows');
});

// ---------------------------------------------------------------------------
// AC4 — a role change takes effect on the next request
// ---------------------------------------------------------------------------

test('AC4 — changing a user’s role changes their permissions immediately', async () => {
  const user = await prisma.user.create({
    data: {
      email: `role-change-${run}@example.com`,
      passwordHash: 'x',
      firstName: 'Role',
      lastName: 'Change',
    },
  });

  const agentRole = await prisma.role.findUniqueOrThrow({ where: { key: 'agent' } });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'administrator' } });

  await roles.assignRole(user.id, agentRole.id);

  const asAgent = await permissions.effectivePermissionsFor(user.id);
  assert.deepEqual(asAgent.roles, ['agent']);
  assert.equal(
    await permissions.can(user.id, 'user:manage'),
    false,
    'an agent cannot manage users',
  );

  // Read again so the result is definitely cached, then change the role.
  await permissions.effectivePermissionsFor(user.id);
  await roles.setUserRoles(user.id, [adminRole.id]);

  const asAdmin = await permissions.effectivePermissionsFor(user.id);

  assert.deepEqual(asAdmin.roles, ['administrator']);
  assert.equal(
    await permissions.can(user.id, 'user:manage'),
    true,
    'the change must be visible on the next resolution, with no redeploy and no TTL wait',
  );
});

test('AC4 — editing a role invalidates every holder', async () => {
  const user = await prisma.user.create({
    data: {
      email: `role-edit-${run}@example.com`,
      passwordHash: 'x',
      firstName: 'Role',
      lastName: 'Edit',
    },
  });

  const custom = await roles.createRole({
    key: `narrow-${run}`,
    nameEn: 'Narrow',
    nameAr: 'ضيق',
    grants: [{ key: 'ticket:view', scope: 'OWN' }],
  });

  await roles.assignRole(user.id, custom.id);
  assert.deepEqual(await permissions.scopesFor(user.id, 'ticket:view'), ['OWN']);

  await roles.setRolePermissions(custom.id, [
    { key: 'ticket:view', scope: 'ALL' },
    { key: 'report:view', scope: 'ALL' },
  ]);

  assert.deepEqual(await permissions.scopesFor(user.id, 'ticket:view'), ['ALL']);
  assert.equal(await permissions.can(user.id, 'report:view'), true);
});

test('AC4 — two roles granting the same permission keep both scopes', async () => {
  const user = await prisma.user.create({
    data: {
      email: `two-roles-${run}@example.com`,
      passwordHash: 'x',
      firstName: 'Two',
      lastName: 'Roles',
    },
  });

  const first = await roles.createRole({
    key: `assigned-only-${run}`,
    nameEn: 'Assigned only',
    nameAr: 'المسند فقط',
    grants: [{ key: 'ticket:view', scope: 'ASSIGNED' }],
  });

  const second = await roles.createRole({
    key: `own-only-${run}`,
    nameEn: 'Own only',
    nameAr: 'الخاصة فقط',
    grants: [{ key: 'ticket:view', scope: 'OWN' }],
  });

  await roles.setUserRoles(user.id, [first.id, second.id]);

  const scopes = await permissions.scopesFor(user.id, 'ticket:view');

  // Neither ASSIGNED nor OWN contains the other, so picking a "broadest" would
  // silently drop access. Both are kept and the query ORs them.
  assert.deepEqual([...scopes].sort(), ['ASSIGNED', 'OWN']);
});

// ---------------------------------------------------------------------------
// AC5 — custom roles
// ---------------------------------------------------------------------------

test('AC5 — an administrator can create a role with any combination of permissions', async () => {
  const chosen: Array<{ key: PermissionKey; scope: 'ALL' | 'TEAM' }> = [
    { key: 'report:view', scope: 'ALL' },
    { key: 'report:export', scope: 'TEAM' },
    { key: 'audit:view', scope: 'ALL' },
  ];

  const created = await roles.createRole({
    key: `analyst-${run}`,
    nameEn: 'Analyst',
    nameAr: 'محلل',
    description: 'Reads reports, changes nothing',
    grants: chosen,
  });

  const readBack = await roles.roleWithGrants(created.id);

  assert.equal(readBack.isSystem, false, 'a custom role must be deletable');
  assert.deepEqual(readBack.grants.map((grant) => grant.key).sort(), [
    'audit:view',
    'report:export',
    'report:view',
  ]);
  assert.equal(readBack.grants.find((grant) => grant.key === 'report:export')?.scope, 'TEAM');
});

test('AC5 — users can be assigned to a custom role, and removed again', async () => {
  const user = await prisma.user.create({
    data: {
      email: `custom-member-${run}@example.com`,
      passwordHash: 'x',
      firstName: 'Custom',
      lastName: 'Member',
    },
  });

  const custom = await roles.createRole({
    key: `viewer-${run}`,
    nameEn: 'Viewer',
    nameAr: 'مشاهد',
    grants: [{ key: 'report:view', scope: 'ALL' }],
  });

  await roles.assignRole(user.id, custom.id);
  assert.equal(await permissions.can(user.id, 'report:view'), true);

  await roles.removeRole(user.id, custom.id);
  assert.equal(await permissions.can(user.id, 'report:view'), false);
});

test('AC5 — a role naming an unknown permission is rejected, not quietly narrowed', async () => {
  await assert.rejects(
    () =>
      roles.createRole({
        key: `typo-${run}`,
        nameEn: 'Typo',
        nameAr: 'خطأ',
        // `ticket:asign` — the kind of mistake that would otherwise produce a
        // role that silently cannot assign anything.
        grants: [{ key: 'ticket:asign' as PermissionKey, scope: 'ALL' }],
      }),
    /Unknown permission/,
  );
});

test('AC5 — a duplicate role key is rejected', async () => {
  const key = `dup-${run}`;

  await roles.createRole({ key, nameEn: 'Dup', nameAr: 'مكرر', grants: [] });

  await assert.rejects(
    () => roles.createRole({ key, nameEn: 'Dup again', nameAr: 'مكرر', grants: [] }),
    /already exists/,
  );
});
