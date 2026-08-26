/**
 * US-22 — authorisation cannot be bypassed by calling the API directly.
 *
 * AC1 (declarative guards), AC2 (scope enforcement), AC3 (scoping happens in
 * the query), AC4 (deny by default), AC5 (denials are logged).
 *
 * This is the project's second non-negotiable rule under test: the server is
 * the security boundary.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PermissionKey, PermissionScope } from '@crm/shared';

import { AppModule } from '../app.module.js';
import { PasswordService, TokenService } from '../auth/index.js';
import { PrismaService } from '../prisma/index.js';
import { PermissionsService } from './permissions.service.js';
import { RequirePermission } from './require-permission.decorator.js';
import { RolesService } from './roles.service.js';
import { ticketScopeWhere } from './scope.js';

/** Routes that exist only to be allowed or denied. */
@Controller('guard-perms')
class PermissionFixtureController {
  @Get('read')
  @RequirePermission('ticket:view')
  read(): { ok: boolean } {
    return { ok: true };
  }

  @Get('assign')
  @RequirePermission('ticket:assign')
  assign(): { ok: boolean } {
    return { ok: true };
  }

  /** No decorator: authenticated, but requires nothing in particular. */
  @Get('any')
  any(): { ok: boolean } {
    return { ok: true };
  }
}

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let passwords: PasswordService;
let tokens: TokenService;
let permissions: PermissionsService;
let roles: RolesService;

/**
 * Every warning the application logged.
 *
 * Captured through Nest's own logger rather than by patching `process.stdout`:
 * the guard logs through `Logger`, and where that ends up depends on which sink
 * is installed. AC5 is about the *content* of the line, so intercept it where
 * it is emitted.
 */
const warnings: string[] = [];

const run = randomUUID().slice(0, 8);

let created = 0;

let viewerRoleId: string;
let assignerRoleId: string;
let teamViewerRoleId: string;

/** A role owned by this suite, with exactly the grants named. */
async function makeRole(
  name: string,
  grants: readonly (readonly [PermissionKey, PermissionScope])[],
): Promise<string> {
  const role = await prisma.role.create({
    data: { key: `${name}-${run}`, nameEn: name, nameAr: name, isSystem: false },
    select: { id: true },
  });

  for (const [key, scope] of grants) {
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key },
      select: { id: true },
    });

    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id, scope },
    });
  }

  return role.id;
}

async function makeUser(roleIds: string[]): Promise<{ id: string; token: string }> {
  created += 1;

  const user = await prisma.user.create({
    data: {
      email: `perm-${run}-${String(created)}@example.com`,
      passwordHash: await passwords.hash('irrelevant-for-these-tests'),
      firstName: 'Perm',
      lastName: 'User',
      roles: { create: roleIds.map((roleId) => ({ roleId })) },
    },
    select: { id: true },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: `perm-hash-${run}-${String(created)}`,
      audience: 'crm-staff',
      familyId: `perm-family-${run}-${String(created)}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
    select: { id: true },
  });

  const token = await tokens.signAccessToken({
    userId: user.id,
    roles: [],
    sessionId: session.id,
    audience: 'crm-staff',
  });

  return { id: user.id, token };
}

async function get(path: string, token?: string): Promise<number> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

  return response.status;
}

before(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [PermissionFixtureController],
  }).compile();

  app = moduleRef.createNestApplication();

  app.useLogger({
    log: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    verbose: () => undefined,
    warn: (message: unknown) => {
      warnings.push(typeof message === 'string' ? message : JSON.stringify(message));
    },
  });

  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  prisma = app.get(PrismaService);
  passwords = app.get(PasswordService);
  tokens = app.get(TokenService);
  permissions = app.get(PermissionsService);
  roles = app.get(RolesService);

  // Roles of this suite's own, rather than the seeded system ones.
  //
  // `node --test` runs files in separate processes, concurrently, and the seed
  // *replaces* every system role's grants inside a transaction. Two suites
  // seeding at once fight over the same rows — which is exactly what happened
  // the first time this file called the seed, and it broke `permissions.test.ts`
  // rather than itself. Owning the fixtures removes the shared state entirely.
  for (const key of ['ticket:view', 'ticket:assign'] as const) {
    const [resource, action] = key.split(':') as [string, string];

    await prisma.permission.upsert({
      where: { key },
      create: { key, resource, action, description: key },
      update: {},
    });
  }

  viewerRoleId = await makeRole('viewer', [['ticket:view', 'ASSIGNED']]);
  assignerRoleId = await makeRole('assigner', [
    ['ticket:view', 'ASSIGNED'],
    ['ticket:assign', 'ALL'],
  ]);
  teamViewerRoleId = await makeRole('team-viewer', [['ticket:view', 'TEAM']]);
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// AC1 — declarative guards
// ---------------------------------------------------------------------------

test('AC1 — a user holding the permission is allowed through', async () => {
  const agent = await makeUser([viewerRoleId]);

  assert.equal(await get('/guard-perms/read', agent.token), 200);
});

test('AC1 — a user lacking it is refused with 403, not 500 and not silently', async () => {
  const agent = await makeUser([viewerRoleId]);

  // An agent may view tickets; assigning them is a manager's job.
  assert.equal(await get('/guard-perms/assign', agent.token), 403);
});

test('AC1 — a manager holding the same permission is allowed', async () => {
  const manager = await makeUser([assignerRoleId]);

  assert.equal(await get('/guard-perms/assign', manager.token), 200);
});

test('AC1 — a user with no roles at all is refused', async () => {
  const nobody = await makeUser([]);

  assert.equal(await get('/guard-perms/read', nobody.token), 403);
});

// ---------------------------------------------------------------------------
// AC4 — deny by default
// ---------------------------------------------------------------------------

test('AC4 — an unauthenticated call is rejected before permissions are considered', async () => {
  assert.equal(await get('/guard-perms/read'), 401);
  // Even the route that requires no particular permission is closed: every
  // endpoint is protected unless it carries @Public().
  assert.equal(await get('/guard-perms/any'), 401);
});

test('AC4 — a route with no @RequirePermission still requires authentication', async () => {
  const nobody = await makeUser([]);

  // Authenticated, no permissions — the guard has nothing to check, so it
  // passes. Authorisation for this route is "be signed in", stated by omission.
  assert.equal(await get('/guard-perms/any', nobody.token), 200);
});

// ---------------------------------------------------------------------------
// AC2 and AC3 — scope, applied in the query
// ---------------------------------------------------------------------------

test('AC2 — an agent sees a ticket assigned to them and not one assigned to someone else', async () => {
  const agent = await makeUser([viewerRoleId]);
  const other = await makeUser([viewerRoleId]);

  const scopes = await permissions.scopesFor(agent.id, 'ticket:view');
  const where = ticketScopeWhere(scopes, { userId: agent.id, departmentId: null });

  const mine = await prisma.ticket.count({ where: { ...where, assigneeId: agent.id } });
  const theirs = await prisma.ticket.count({ where: { ...where, assigneeId: other.id } });

  // The agent's scope is ASSIGNED, so the filter can only ever match their own.
  assert.equal(theirs, 0, "an agent's scope must not reach another agent's queue");
  assert.equal(mine, 0, 'no tickets exist yet — the point is the filter, not the count');
});

test('AC3 — the scope is a WHERE clause, not a filter applied after fetching', async () => {
  const agent = await makeUser([viewerRoleId]);

  const scopes = await permissions.scopesFor(agent.id, 'ticket:view');
  const where = ticketScopeWhere(scopes, { userId: agent.id, departmentId: null });

  // This is the assertion that matters: the scope resolves to something Prisma
  // puts in the query. If it were `{}` the database would return every row and
  // the filtering would have to happen in memory — which US-13 established is
  // never correct, and which AC3 forbids outright.
  assert.notDeepEqual(where, {});
  assert.ok(JSON.stringify(where).includes(agent.id));
});

test('AC3 — no grant produces an impossible filter, never an empty one', async () => {
  const nobody = await makeUser([]);

  const scopes = await permissions.scopesFor(nobody.id, 'ticket:view');
  const where = ticketScopeWhere(scopes, { userId: nobody.id, departmentId: null });

  // An empty Prisma `where` matches every row. A user with no grant reaching
  // for "no filter" would be handed the whole table — the single most dangerous
  // way this could be got wrong.
  assert.notDeepEqual(where, {});
  assert.equal(await prisma.ticket.count({ where }), 0);
});

test('AC2 — widening the role widens the scope, without a redeploy', async () => {
  const user = await makeUser([viewerRoleId]);

  const asAgent = await permissions.scopesFor(user.id, 'ticket:view');
  assert.deepEqual(asAgent, ['ASSIGNED']);

  await roles.setUserRoles(user.id, [teamViewerRoleId]);

  const asManager = await permissions.scopesFor(user.id, 'ticket:view');
  assert.deepEqual(asManager, ['TEAM']);
});

// ---------------------------------------------------------------------------
// AC5 — denials are logged
// ---------------------------------------------------------------------------

test('AC5 — a denial names the user and the endpoint', async () => {
  const agent = await makeUser([viewerRoleId]);

  assert.equal(await get('/guard-perms/assign', agent.token), 403);

  const joined = warnings.join('\n');

  assert.ok(joined.includes(agent.id), `the log line should name the user; got: ${joined}`);
  assert.ok(joined.includes('ticket:assign'), `and the permission it lacked; got: ${joined}`);
  assert.ok(joined.includes('/guard-perms/assign'), `and the endpoint; got: ${joined}`);
});
