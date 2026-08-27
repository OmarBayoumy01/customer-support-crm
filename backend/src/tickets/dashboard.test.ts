/**
 * US-55 — the agent dashboard's KPI row.
 *
 * AC1's four figures, the scope they are computed inside, and the edges where an
 * SLA metric must not double-count: a resolved ticket past its target, a ticket
 * with no policy, and an agent with nothing assigned.
 *
 * AC2 and AC3 reuse `GET /tickets?view=mine&sort=sla`, which US-42's suite
 * already covers; AC4 and AC5 are presentation and live in
 * `frontend/src/features/dashboard/dashboard-page.test.tsx`.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AssignedSummary, PermissionKey, PermissionScope } from '@crm/shared';

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
const SUBJECT_PREFIX = `Dash ${run}`;

const HOUR = 60 * 60 * 1000;

let customerId: string;
let departmentId: string;
/** The agent whose dashboard this is. */
let agentId: string;
let agentToken: string;
/** Another agent, whose work must never appear in the first one's figures. */
let otherAgentId: string;
/** An agent with nothing assigned — the empty case. */
let emptyAgentToken: string;
/** A portal token, for the wrong-audience case. */
let portalToken: string;

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
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
  audience: 'crm-staff' | 'crm-portal' = 'crm-staff',
): Promise<{ id: string; token: string }> {
  created += 1;

  const user = await prisma.user.create({
    data: {
      email: `dash-${run}-${String(created)}@example.com`,
      passwordHash: await app.get(PasswordService).hash('irrelevant'),
      firstName: 'Dash',
      lastName: `Agent${String(created)}`,
      departmentId,
      roles: { create: { roleId } },
    },
    select: { id: true },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: `dash-hash-${run}-${String(created)}`,
      audience,
      familyId: `dash-family-${run}-${String(created)}`,
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

/**
 * A ticket, with its deadlines computed by the real clock.
 *
 * `hoursAgo` is what makes an SLA state reachable: a MEDIUM ticket has a
 * 24-hour resolution target, so 20 hours in is inside the warning window and 30
 * is past it.
 */
async function makeTicket(options: {
  assigneeId?: string | null;
  status?: 'NEW' | 'WAITING_FOR_AGENT' | 'WAITING_FOR_CUSTOMER' | 'RESOLVED';
  hoursAgo?: number;
  withSla?: boolean;
  resolvedHoursAgo?: number;
  closedHoursAgo?: number;
}): Promise<string> {
  const createdAt = new Date(Date.now() - (options.hoursAgo ?? 0) * HOUR);

  const row = await prisma.ticket.create({
    data: {
      subject: `${SUBJECT_PREFIX} ${randomUUID().slice(0, 6)}`,
      customerId,
      departmentId,
      priority: 'MEDIUM',
      status: options.status ?? 'WAITING_FOR_AGENT',
      createdAt,
      updatedAt: createdAt,
      ...(options.assigneeId === undefined ? { assigneeId: agentId } : {}),
      ...(options.assigneeId == null ? {} : { assigneeId: options.assigneeId }),
      ...(options.resolvedHoursAgo === undefined
        ? {}
        : { resolvedAt: new Date(Date.now() - options.resolvedHoursAgo * HOUR) }),
      ...(options.closedHoursAgo === undefined
        ? {}
        : { closedAt: new Date(Date.now() - options.closedHoursAgo * HOUR) }),
    },
    select: { id: true },
  });

  // Real deadlines from the real policy, unless the test wants a ticket that no
  // policy governs.
  if (options.withSla !== false) {
    await clock.applyOnCreate(row.id);
  }

  return row.id;
}

const summaryFor = async (token: string) =>
  get<AssignedSummary>('/tickets/assigned/summary', token);

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

  const department = await prisma.department.create({
    data: { code: `DSH-${run}`, nameEn: 'Support', nameAr: 'الدعم' },
    select: { id: true },
  });
  departmentId = department.id;

  const customer = await prisma.customer.create({
    data: { firstName: 'Dana', lastName: `Dash-${run}` },
    select: { id: true },
  });
  customerId = customer.id;

  // The scope the story is about: an agent who may only see what is theirs.
  const agentRole = await makeRole('dash-agent', [['ticket:view', 'ASSIGNED']]);

  const agent = await makeUser(agentRole);
  agentId = agent.id;
  agentToken = agent.token;

  otherAgentId = (await makeUser(agentRole)).id;
  emptyAgentToken = (await makeUser(agentRole)).token;
  portalToken = (await makeUser(agentRole, 'crm-portal')).token;
});

after(async () => {
  await prisma.ticket.deleteMany({ where: { subject: { startsWith: SUBJECT_PREFIX } } });
  await app.close();
});

// ---------------------------------------------------------------------------
// The empty case first, so later counts are read against a known baseline
// ---------------------------------------------------------------------------

test('an agent with nothing assigned gets four zeros, not an error and not nulls', async () => {
  const { status, body } = await summaryFor(emptyAgentToken);

  assert.equal(status, 200, JSON.stringify(body));

  const summary = body.data!;

  assert.equal(summary.open.value, 0);
  assert.equal(summary.pending.value, 0);
  assert.equal(summary.dueSoon.value, 0);
  assert.equal(summary.breached.value, 0);

  // `open` has an honest past value even when it is zero.
  assert.equal(summary.open.previous, 0);
});

// ---------------------------------------------------------------------------
// AC1 — open
// ---------------------------------------------------------------------------

test('AC1 — open counts my unfinished tickets and excludes resolved ones', async () => {
  const before = (await summaryFor(agentToken)).body.data!.open.value;

  await makeTicket({ hoursAgo: 1 });
  await makeTicket({ status: 'NEW', hoursAgo: 1 });
  await makeTicket({ status: 'RESOLVED', hoursAgo: 1, resolvedHoursAgo: 1 });

  const summary = (await summaryFor(agentToken)).body.data!;

  assert.equal(summary.open.value, before + 2);
});

test('AC1 — another agent’s tickets and unassigned ones are not mine', async () => {
  const before = (await summaryFor(agentToken)).body.data!.open.value;

  await makeTicket({ assigneeId: otherAgentId, hoursAgo: 1 });
  await makeTicket({ assigneeId: null, hoursAgo: 1 });

  assert.equal((await summaryFor(agentToken)).body.data!.open.value, before);
});

// ---------------------------------------------------------------------------
// AC1 — pending
// ---------------------------------------------------------------------------

test('AC1 — pending counts WAITING_FOR_CUSTOMER and nothing else', async () => {
  const before = (await summaryFor(agentToken)).body.data!.pending.value;

  await makeTicket({ status: 'WAITING_FOR_CUSTOMER', hoursAgo: 1 });
  await makeTicket({ status: 'WAITING_FOR_AGENT', hoursAgo: 1 });
  await makeTicket({ status: 'NEW', hoursAgo: 1 });

  const summary = (await summaryFor(agentToken)).body.data!;

  assert.equal(summary.pending.value, before + 1);
  // A subset of open, deliberately — see the schema.
  assert.ok(summary.pending.value <= summary.open.value);
});

// ---------------------------------------------------------------------------
// AC1 — the SLA figures, and the edges where they must not double-count
// ---------------------------------------------------------------------------

test('AC1 — due soon counts a ticket inside its warning window, not a comfortable one', async () => {
  const before = (await summaryFor(agentToken)).body.data!.dueSoon.value;

  // A MEDIUM ticket has a 24-hour resolution target. 20 hours in is 83% — past
  // the 75% warning threshold and not yet breached.
  await makeTicket({ hoursAgo: 20 });
  // Two hours in is comfortable.
  await makeTicket({ hoursAgo: 2 });

  assert.equal((await summaryFor(agentToken)).body.data!.dueSoon.value, before + 1);
});

test('AC1 — breached counts a ticket past its resolution target', async () => {
  const before = (await summaryFor(agentToken)).body.data!.breached.value;

  await makeTicket({ hoursAgo: 30 });

  assert.equal((await summaryFor(agentToken)).body.data!.breached.value, before + 1);
});

test('AC1 — a response breach counts even when the resolution clock is comfortable', async () => {
  const before = (await summaryFor(agentToken)).body.data!.breached.value;

  const ticketId = await makeTicket({ hoursAgo: 1 });

  // What the sweep does: the response target passed and was flagged, while the
  // resolution clock still has 23 hours on it.
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { firstResponseBreached: true },
  });

  assert.equal((await summaryFor(agentToken)).body.data!.breached.value, before + 1);
});

test('AC1 — a ticket cannot be both due soon and breached', async () => {
  const start = (await summaryFor(agentToken)).body.data!;

  await makeTicket({ hoursAgo: 30 });

  const after = (await summaryFor(agentToken)).body.data!;

  // `slaFor` returns one state, so the two figures partition rather than overlap.
  assert.equal(after.breached.value, start.breached.value + 1);
  assert.equal(after.dueSoon.value, start.dueSoon.value);
});

test('AC1 — a resolved ticket past its target counts in neither SLA figure', async () => {
  const before = (await summaryFor(agentToken)).body.data!;

  await makeTicket({ status: 'RESOLVED', hoursAgo: 40, resolvedHoursAgo: 1 });

  const after = (await summaryFor(agentToken)).body.data!;

  // Its clock stopped when it was resolved. Counting it would put finished work
  // on the pile an agent is deciding what to do next from.
  assert.equal(after.dueSoon.value, before.dueSoon.value);
  assert.equal(after.breached.value, before.breached.value);
});

test('AC1 — a ticket no policy governs is open and in neither SLA figure', async () => {
  const before = (await summaryFor(agentToken)).body.data!;

  await makeTicket({ hoursAgo: 100, withSla: false });

  const after = (await summaryFor(agentToken)).body.data!;

  assert.equal(after.open.value, before.open.value + 1);
  // `state: 'none'` is not `ok` and not `breach` — a ticket nobody promised
  // anything about is not late.
  assert.equal(after.dueSoon.value, before.dueSoon.value);
  assert.equal(after.breached.value, before.breached.value);
});

// ---------------------------------------------------------------------------
// AC1 — the comparison, and where there honestly is not one
// ---------------------------------------------------------------------------

test('AC1 — the comparison reflects what was open a week ago', async () => {
  const fresh = (await makeUser(await makeRole('dash-week', [['ticket:view', 'ASSIGNED']]))).token;
  const mine = await prisma.user.findFirstOrThrow({
    where: { email: `dash-${run}-${String(created)}@example.com` },
    select: { id: true },
  });

  // Raised ten days ago and resolved two days ago: open then, not open now.
  await makeTicket({
    assigneeId: mine.id,
    status: 'RESOLVED',
    hoursAgo: 240,
    resolvedHoursAgo: 48,
  });
  // Raised yesterday: open now, did not exist then.
  await makeTicket({ assigneeId: mine.id, hoursAgo: 24 });

  const summary = (await summaryFor(fresh)).body.data!;

  assert.equal(summary.open.value, 1);
  assert.equal(summary.open.previous, 1);
});

test('AC1 — the three metrics with no honest past value return null', async () => {
  const summary = (await summaryFor(agentToken)).body.data!;

  // Not zero: a null renders no indicator, where a zero would claim a rise from
  // nothing. Reconstructing these needs a daily snapshot, which is P11's.
  assert.equal(summary.pending.previous, null);
  assert.equal(summary.dueSoon.previous, null);
  assert.equal(summary.breached.previous, null);

  assert.equal(typeof summary.open.previous, 'number');
});

// ---------------------------------------------------------------------------
// Scope and the boundary
// ---------------------------------------------------------------------------

test('the summary is the caller’s own workload and cannot be made to report another’s', async () => {
  // The other agent holds work of their own.
  await makeTicket({ assigneeId: otherAgentId, hoursAgo: 30 });

  const mine = (await summaryFor(agentToken)).body.data!;

  const theirOpen = await prisma.notDeleted.ticket.count({
    where: { assigneeId: otherAgentId, status: { not: 'RESOLVED' } },
  });

  assert.ok(theirOpen > 0);

  const myOpen = await prisma.notDeleted.ticket.count({
    where: { assigneeId: agentId, status: { not: 'RESOLVED' } },
  });

  // The endpoint takes no parameters at all, and the figure matches the caller's
  // own rows rather than the pair's.
  assert.equal(mine.open.value, myOpen);
});

test('an unauthenticated request is rejected', async () => {
  assert.equal((await get('/tickets/assigned/summary')).status, 401);
});

test('a portal token cannot read the agent dashboard', async () => {
  assert.equal((await summaryFor(portalToken)).status, 401);
});
