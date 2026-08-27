/**
 * US-58 — the manager dashboard, on the server.
 *
 * The scope is the point of this suite: a manager's figures are their
 * department's, taken from their token, and **AC5's department filter can only
 * narrow that** — never select it. Everything else is AC1's figures, AC2's
 * distributions and AC3's attention filter, each checked against rows the test
 * counts for itself.
 *
 * AC4 is presentation and AC6's screen is a route wrapper; both are asserted in
 * `frontend/src/features/dashboard/team-dashboard.test.tsx`.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PermissionKey, PermissionScope, TeamOverview, Ticket } from '@crm/shared';

import { AppModule } from '../app.module.js';
import { PasswordService, TokenService } from '../auth/index.js';
import { PrismaService } from '../prisma/index.js';
import { SlaClockService } from '../sla/index.js';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let tokens: TokenService;
let clock: SlaClockService;

const run = randomUUID().slice(0, 8);
const SUBJECT_PREFIX = `Team ${run}`;
const HOUR = 60 * 60 * 1000;

let customerId: string;
/** The manager's own department. */
let departmentId: string;
/** Somebody else's, which must never appear in their figures. */
let otherDepartmentId: string;

let managerToken: string;
let adminToken: string;
let agentToken: string;
let portalToken: string;
let agentId: string;
let secondAgentId: string;

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
  pagination?: { total: number };
}

async function get<T>(
  path: string,
  token?: string,
): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

  const raw = await response.text();

  return { status: response.status, body: raw === '' ? {} : (JSON.parse(raw) as Envelope<T>) };
}

async function makeRole(
  name: string,
  grants: readonly (readonly [PermissionKey, PermissionScope])[],
): Promise<string> {
  const role = await prisma.role.create({
    data: { key: `${name}-${run}`, nameEn: name, nameAr: name, isSystem: false },
    select: { id: true },
  });

  for (const [key, scope] of grants) {
    const [resource, action] = key.split(':') as [string, string];

    const permission = await prisma.permission.upsert({
      where: { key },
      create: { key, resource, action, description: key },
      update: {},
      select: { id: true },
    });

    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id, scope },
    });
  }

  return role.id;
}

let created = 0;

async function makeUser(
  roleId: string,
  options: { departmentId?: string | null; audience?: 'crm-staff' | 'crm-portal' } = {},
): Promise<{ id: string; token: string }> {
  created += 1;

  const user = await prisma.user.create({
    data: {
      email: `team-${run}-${String(created)}@example.com`,
      passwordHash: await app.get(PasswordService).hash('irrelevant'),
      firstName: 'Team',
      lastName: `Person${String(created)}`,
      departmentId: options.departmentId === undefined ? departmentId : options.departmentId,
      roles: { create: { roleId } },
    },
    select: { id: true },
  });

  const audience = options.audience ?? 'crm-staff';

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: `team-hash-${run}-${String(created)}`,
      audience,
      familyId: `team-family-${run}-${String(created)}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
    select: { id: true },
  });

  return {
    id: user.id,
    token: await tokens.signAccessToken({
      userId: user.id,
      roles: [],
      sessionId: session.id,
      audience,
    }),
  };
}

async function makeTicket(options: {
  departmentId?: string;
  assigneeId?: string | null;
  status?: 'NEW' | 'OPEN' | 'PENDING_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
  hoursAgo?: number;
  withSla?: boolean;
  respondedHoursAfter?: number;
  resolvedHoursAfter?: number;
}): Promise<string> {
  const createdAt = new Date(Date.now() - (options.hoursAgo ?? 1) * HOUR);

  const row = await prisma.ticket.create({
    data: {
      subject: `${SUBJECT_PREFIX} ${randomUUID().slice(0, 6)}`,
      customerId,
      departmentId: options.departmentId ?? departmentId,
      priority: 'MEDIUM',
      status: options.status ?? 'OPEN',
      createdAt,
      updatedAt: createdAt,
      ...(options.assigneeId == null ? {} : { assigneeId: options.assigneeId }),
      ...(options.respondedHoursAfter === undefined
        ? {}
        : { firstRespondedAt: new Date(createdAt.getTime() + options.respondedHoursAfter * HOUR) }),
      ...(options.resolvedHoursAfter === undefined
        ? {}
        : { resolvedAt: new Date(createdAt.getTime() + options.resolvedHoursAfter * HOUR) }),
    },
    select: { id: true },
  });

  if (options.withSla !== false) {
    await clock.applyOnCreate(row.id);
  }

  return row.id;
}

const overview = async (token?: string, query = '') =>
  get<TeamOverview>(`/tickets/team/overview${query}`, token);

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  prisma = app.get(PrismaService);
  tokens = app.get(TokenService);
  clock = app.get(SlaClockService);

  const mine = await prisma.department.create({
    data: { code: `TM1-${run}`, nameEn: 'Support', nameAr: 'الدعم' },
    select: { id: true },
  });
  departmentId = mine.id;

  const theirs = await prisma.department.create({
    data: { code: `TM2-${run}`, nameEn: 'Billing', nameAr: 'الفواتير' },
    select: { id: true },
  });
  otherDepartmentId = theirs.id;

  const customer = await prisma.customer.create({
    data: { firstName: 'Tara', lastName: `Team-${run}` },
    select: { id: true },
  });
  customerId = customer.id;

  // A manager: TEAM scope, and `report:view` — which is AC6's permission.
  const managerRole = await makeRole('team-manager', [
    ['ticket:view', 'TEAM'],
    ['ticket:assign', 'TEAM'],
    ['report:view', 'TEAM'],
  ]);

  // An administrator: ALL, so a department filter genuinely narrows.
  const adminRole = await makeRole('team-admin', [
    ['ticket:view', 'ALL'],
    ['report:view', 'ALL'],
  ]);

  // An agent: no `report:view` at all.
  const agentRole = await makeRole('team-agent', [['ticket:view', 'ASSIGNED']]);

  managerToken = (await makeUser(managerRole)).token;
  adminToken = (await makeUser(adminRole)).token;

  const agent = await makeUser(agentRole);
  agentId = agent.id;
  agentToken = agent.token;

  secondAgentId = (await makeUser(agentRole)).id;
  portalToken = (await makeUser(managerRole, { audience: 'crm-portal' })).token;
});

after(async () => {
  await prisma.ticket.deleteMany({ where: { subject: { startsWith: SUBJECT_PREFIX } } });
  await app.close();
});

// ---------------------------------------------------------------------------
// Scope — the substance of this story
// ---------------------------------------------------------------------------

test('a manager sees their whole department, not only their own assigned tickets', async () => {
  const before = (await overview(managerToken)).body.data!.open;

  // None of these is assigned to the manager.
  await makeTicket({ assigneeId: agentId });
  await makeTicket({ assigneeId: secondAgentId });
  await makeTicket({ assigneeId: null });

  const after = (await overview(managerToken)).body.data!;

  assert.equal(after.open, before + 3);
});

test('another department’s tickets are excluded from every figure', async () => {
  const before = (await overview(managerToken)).body.data!;

  await makeTicket({ departmentId: otherDepartmentId, assigneeId: agentId });
  await makeTicket({ departmentId: otherDepartmentId, status: 'ESCALATED', hoursAgo: 40 });

  const after = (await overview(managerToken)).body.data!;

  assert.equal(after.open, before.open);
  assert.equal(after.breached, before.breached);

  // And not in the distributions either.
  assert.ok(!after.byDepartment.some((slice) => slice.key === otherDepartmentId));

  // The administrator, whose scope is ALL, does see them.
  const admin = (await overview(adminToken)).body.data!;

  assert.ok(admin.byDepartment.some((slice) => slice.key === otherDepartmentId));
});

test('AC5 — a foreign departmentId filter returns zeros, not that department', async () => {
  await makeTicket({ departmentId: otherDepartmentId, assigneeId: agentId });

  const filtered = (await overview(managerToken, `?departmentId=${otherDepartmentId}`)).body.data!;

  // scope ∩ filter is empty. The filter narrowed; it did not select.
  assert.equal(filtered.open, 0);
  assert.equal(filtered.unassigned, 0);
  assert.equal(filtered.atRisk, 0);
  assert.equal(filtered.breached, 0);
  assert.deepEqual(filtered.byStatus, []);

  // The same filter for somebody whose scope covers it does narrow to it.
  const admin = (await overview(adminToken, `?departmentId=${otherDepartmentId}`)).body.data!;

  assert.ok(admin.open >= 1);
  assert.ok(admin.byDepartment.every((slice) => slice.key === otherDepartmentId));
});

test('AC5 — a department filter within scope narrows rather than widening', async () => {
  const unfiltered = (await overview(managerToken)).body.data!;
  const filtered = (await overview(managerToken, `?departmentId=${departmentId}`)).body.data!;

  // The manager's scope is already this department, so the filter is a no-op —
  // which is the point: it can never return more than the scope allows.
  assert.equal(filtered.open, unfiltered.open);
});

// ---------------------------------------------------------------------------
// AC1 — the figures, against rows the test counts itself
// ---------------------------------------------------------------------------

test('AC1 — open and unassigned match the scoped rows', async () => {
  const body = (await overview(managerToken)).body.data!;

  const openRows = await prisma.notDeleted.ticket.count({
    where: { departmentId, status: { notIn: ['RESOLVED', 'CLOSED'] } },
  });

  const unassignedRows = await prisma.notDeleted.ticket.count({
    where: { departmentId, assigneeId: null, status: { notIn: ['RESOLVED', 'CLOSED'] } },
  });

  assert.equal(body.open, openRows);
  assert.equal(body.unassigned, unassignedRows);
});

test('AC1 — an unassigned ticket is in both open and unassigned, and in no agent’s workload', async () => {
  const before = (await overview(managerToken)).body.data!;

  await makeTicket({ assigneeId: null });

  const after = (await overview(managerToken)).body.data!;

  assert.equal(after.open, before.open + 1);
  assert.equal(after.unassigned, before.unassigned + 1);

  // It appears as an explicit "nobody" slice rather than being dropped: ten
  // tickets belonging to no one is exactly what a manager needs to see.
  const nobody = after.byAgent.find((slice) => slice.key === 'none');

  assert.ok(nobody !== undefined);
  assert.ok(nobody.count >= 1);
});

test('AC1 — the SLA figures use slaFor: they partition, and finished work is in neither', async () => {
  const before = (await overview(managerToken)).body.data!;

  // 20 of 24 hours is inside the warning window; 30 is past the target.
  await makeTicket({ hoursAgo: 20, assigneeId: agentId });
  await makeTicket({ hoursAgo: 30, assigneeId: agentId });
  // Resolved past its target: its clock stopped.
  await makeTicket({ hoursAgo: 40, status: 'RESOLVED', resolvedHoursAfter: 1 });

  const after = (await overview(managerToken)).body.data!;

  assert.equal(after.atRisk, before.atRisk + 1);
  assert.equal(after.breached, before.breached + 1);
});

test('AC1 — a ticket with no SLA policy is open and in neither SLA figure', async () => {
  const before = (await overview(managerToken)).body.data!;

  await makeTicket({ hoursAgo: 100, withSla: false, assigneeId: agentId });

  const after = (await overview(managerToken)).body.data!;

  assert.equal(after.open, before.open + 1);
  assert.equal(after.atRisk, before.atRisk);
  assert.equal(after.breached, before.breached);
});

test('AC1 — the averages count only what has been responded to or resolved', async () => {
  // Two hours to reply, six to resolve.
  await makeTicket({
    hoursAgo: 10,
    respondedHoursAfter: 2,
    resolvedHoursAfter: 6,
    status: 'RESOLVED',
  });
  // Never replied to: absent from the average rather than dragging it to zero.
  await makeTicket({ hoursAgo: 10 });

  const body = (await overview(managerToken)).body.data!;

  assert.ok(body.averageResponseSeconds !== null);
  assert.ok(body.averageResolutionSeconds !== null);
  // The one responded ticket took two hours; the unanswered one is not a zero.
  assert.ok(body.averageResponseSeconds > 0);
});

test('AC1 — customer satisfaction is absent from the payload, not zero', async () => {
  const body = (await overview(managerToken)).body.data!;
  const payload = body as unknown as Record<string, unknown>;

  // There is no rating in the domain and US-88 owns it. A zero or a null would be
  // rendered as a score eventually; an absent key cannot be.
  assert.equal('customerSatisfaction' in payload, false);
  assert.equal('satisfaction' in payload, false);
});

// ---------------------------------------------------------------------------
// AC2 — the distributions
// ---------------------------------------------------------------------------

test('AC2 — the five distributions are present and scoped', async () => {
  await makeTicket({ status: 'ESCALATED', assigneeId: agentId, hoursAgo: 30 });

  const body = (await overview(managerToken)).body.data!;

  assert.ok(body.byStatus.length > 0);
  assert.ok(body.byPriority.length > 0);
  assert.ok(body.byDepartment.length > 0);
  assert.ok(body.byAgent.length > 0);
  // Every day in the window, including the quiet ones.
  assert.ok(body.overTime.length >= 30);

  // The status slices add up to the scoped total, resolved and closed included.
  const total = await prisma.notDeleted.ticket.count({ where: { departmentId } });

  assert.equal(
    body.byStatus.reduce((sum, slice) => sum + slice.count, 0),
    total,
  );
});

test('AC2 — an agent slice carries the agent’s name, not just an id', async () => {
  await makeTicket({ assigneeId: agentId });

  const body = (await overview(managerToken)).body.data!;
  const slice = body.byAgent.find((entry) => entry.key === agentId);

  assert.ok(slice !== undefined);
  assert.match(slice.label, /^Team Person/);
});

// ---------------------------------------------------------------------------
// AC3 — the attention filter
// ---------------------------------------------------------------------------

test('AC3 — attention returns breached and escalated tickets and not healthy ones', async () => {
  const breachedId = await makeTicket({ hoursAgo: 30, assigneeId: agentId });
  const escalatedId = await makeTicket({ hoursAgo: 2, status: 'ESCALATED', assigneeId: agentId });
  const healthyId = await makeTicket({ hoursAgo: 1, assigneeId: agentId });

  const { status, body } = await get<Ticket[]>(
    '/tickets?attention=true&pageSize=100&sort=sla&dir=asc',
    managerToken,
  );

  assert.equal(status, 200);

  const ids = body.data!.map((ticket) => ticket.id);

  assert.ok(ids.includes(breachedId));
  assert.ok(ids.includes(escalatedId));
  assert.ok(!ids.includes(healthyId));
});

test('AC3 — attention still respects the caller’s scope', async () => {
  const theirs = await makeTicket({
    departmentId: otherDepartmentId,
    hoursAgo: 40,
    assigneeId: agentId,
  });

  const { body } = await get<Ticket[]>('/tickets?attention=true&pageSize=100', managerToken);

  assert.ok(!body.data!.some((ticket) => ticket.id === theirs));
});

test('AC3 — a resolved ticket past its target is not requiring attention', async () => {
  const resolvedId = await makeTicket({ hoursAgo: 40, status: 'RESOLVED', resolvedHoursAfter: 1 });

  const { body } = await get<Ticket[]>('/tickets?attention=true&pageSize=100', managerToken);

  assert.ok(!body.data!.some((ticket) => ticket.id === resolvedId));
});

// ---------------------------------------------------------------------------
// Empty, and the boundary
// ---------------------------------------------------------------------------

test('a department with no tickets gets zeros and empty distributions, not an error', async () => {
  const emptyDepartment = await prisma.department.create({
    data: { code: `TM3-${run}`, nameEn: 'Empty', nameAr: 'فارغ' },
    select: { id: true },
  });

  const lonelyManager = await makeUser(
    await makeRole('team-empty', [
      ['ticket:view', 'TEAM'],
      ['report:view', 'TEAM'],
    ]),
    { departmentId: emptyDepartment.id },
  );

  const { status, body } = await overview(lonelyManager.token);

  assert.equal(status, 200, JSON.stringify(body));

  const summary = body.data!;

  assert.equal(summary.open, 0);
  assert.equal(summary.unassigned, 0);
  assert.equal(summary.atRisk, 0);
  assert.equal(summary.breached, 0);
  assert.deepEqual(summary.byStatus, []);
  assert.deepEqual(summary.byAgent, []);
  // Null, not zero: nothing to average is a different answer from "instant".
  assert.equal(summary.averageResponseSeconds, null);
  assert.equal(summary.averageResolutionSeconds, null);
  // The days still render, so a quiet month looks quiet rather than missing.
  assert.ok(summary.overTime.length >= 30);
});

test('AC6 — an agent without report:view is refused', async () => {
  const { status, body } = await overview(agentToken);

  assert.equal(status, 403);
  assert.equal(body.error?.code, 'FORBIDDEN');
});

test('a portal token cannot read the manager dashboard', async () => {
  assert.equal((await overview(portalToken)).status, 401);
});

test('an unauthenticated request is rejected', async () => {
  assert.equal((await overview()).status, 401);
});
