/**
 * US-50 — the ticket audit trail.
 *
 * AC1 every event kind is captured · AC2 actor, timestamp and both values ·
 * AC3 an automated change names the rule, not a person ·
 * AC4 append-only, refused by the database itself.
 *
 * AC5 is presentation and is covered by
 * `frontend/src/components/domain/ticket-timeline.test.tsx`.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  PermissionKey,
  PermissionScope,
  Ticket,
  TicketDetail,
  TicketHistoryEntry,
} from '@crm/shared';

import { AppModule } from '../app.module.js';
import { PasswordService, TokenService } from '../auth/index.js';
import { PrismaService } from '../prisma/index.js';
import { TicketHistoryService } from './ticket-history.service.js';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let history: TicketHistoryService;

const run = randomUUID().slice(0, 8);

let customerId: string;
let departmentId: string;
let token: string;
let userId: string;
/** Somebody to be reassigned to, so AC1's "reassigned" has two ends. */
let otherUserId: string;

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

async function makeUser(roleId: string): Promise<{ id: string; token: string }> {
  created += 1;

  const user = await prisma.user.create({
    data: {
      email: `hist-${run}-${String(created)}@example.com`,
      passwordHash: await app.get(PasswordService).hash('irrelevant'),
      firstName: 'Hana',
      lastName: `Historian${String(created)}`,
      departmentId,
      roles: { create: { roleId } },
    },
    select: { id: true },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: `hist-hash-${run}-${String(created)}`,
      audience: 'crm-staff',
      familyId: `hist-family-${run}-${String(created)}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
    select: { id: true },
  });

  return {
    id: user.id,
    token: await app.get(TokenService).signAccessToken({
      userId: user.id,
      roles: [],
      sessionId: session.id,
      audience: 'crm-staff',
    }),
  };
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
  pagination?: { total: number; page: number; pageSize: number };
}

async function call<T>(
  method: string,
  path: string,
  options: { body?: unknown } = {},
): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const text = await response.text();

  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Envelope<T>) };
}

async function newTicket(): Promise<Ticket> {
  const result = await call<Ticket>('POST', '/tickets', {
    body: { customerId, subject: `History ${run} ${randomUUID().slice(0, 6)}` },
  });

  assert.equal(result.status, 201, JSON.stringify(result.body));

  return result.body.data!;
}

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  prisma = app.get(PrismaService);
  history = app.get(TicketHistoryService);

  const department = await prisma.department.create({
    data: { code: `HST-${run}`, nameEn: 'Support', nameAr: 'الدعم' },
    select: { id: true },
  });
  departmentId = department.id;

  const customer = await prisma.customer.create({
    data: { firstName: 'Rami', lastName: `Fahd-${run}`, email: `rami-${run}@example.com` },
    select: { id: true },
  });
  customerId = customer.id;

  const roleId = await makeRole('hist-manager', [
    ['ticket:view', 'ALL'],
    ['ticket:create', 'ALL'],
    ['ticket:update', 'ALL'],
    // Assignment moved to its own guarded endpoint with US-48.
    ['ticket:assign', 'ALL'],
  ]);

  const manager = await makeUser(roleId);
  token = manager.token;
  userId = manager.id;

  otherUserId = (await makeUser(roleId)).id;
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// AC1 — every event kind the criterion names
// ---------------------------------------------------------------------------

test('AC1 — creation, assignment, reassignment and priority all appear', async () => {
  const ticket = await newTicket();

  await call('PATCH', `/tickets/${ticket.id}/assignee`, { body: { assigneeId: userId } });
  await call('PATCH', `/tickets/${ticket.id}/assignee`, { body: { assigneeId: otherUserId } });
  await call('PATCH', `/tickets/${ticket.id}`, { body: { priority: 'URGENT' } });

  const page = await call<TicketHistoryEntry[]>('GET', `/tickets/${ticket.id}/history`);

  assert.equal(page.status, 200, JSON.stringify(page.body));

  const entries = page.body.data!;
  const events = entries.map((entry) => entry.eventType);

  assert.ok(events.includes('CREATED'));
  assert.ok(events.includes('PRIORITY_CHANGED'));
  assert.equal(events.filter((event) => event === 'ASSIGNED').length, 2);

  // The second assignment is AC1's "reassigned": an ASSIGNED entry that names
  // who it moved away from. There is no separate event type, and adding one
  // would leave US-47 choosing between two names for the same change.
  const assignments = entries.filter((entry) => entry.eventType === 'ASSIGNED');
  assert.equal(assignments[0]!.fromValue, userId);
  assert.equal(assignments[0]!.toValue, otherUserId);
});

test('AC1 — status changes carry the status they moved to, including resolved', async () => {
  const ticket = await newTicket();

  // US-47 owns the transition endpoint; until it exists the recorder is what
  // this story delivers, so it is exercised directly. The entry it writes is
  // the one the timeline renders as "Resolved".
  await history.record({
    ticketId: ticket.id,
    actorUserId: userId,
    eventType: 'STATUS_CHANGED',
    field: 'status',
    fromValue: 'OPEN',
    toValue: 'RESOLVED',
  });

  const page = await call<TicketHistoryEntry[]>('GET', `/tickets/${ticket.id}/history`);
  const resolved = page.body.data!.find((entry) => entry.toValue === 'RESOLVED');

  assert.ok(resolved !== undefined);
  assert.equal(resolved.eventType, 'STATUS_CHANGED');
});

test('AC1 — the timeline is newest first and pages', async () => {
  const ticket = await newTicket();

  await call('PATCH', `/tickets/${ticket.id}`, { body: { priority: 'HIGH' } });
  await call('PATCH', `/tickets/${ticket.id}`, { body: { priority: 'LOW' } });

  const first = await call<TicketHistoryEntry[]>(
    'GET',
    `/tickets/${ticket.id}/history?page=1&pageSize=1`,
  );

  assert.equal(first.body.data!.length, 1);
  assert.equal(first.body.pagination!.total, 3);
  assert.equal(first.body.data![0]!.toValue, 'LOW');

  const last = await call<TicketHistoryEntry[]>(
    'GET',
    `/tickets/${ticket.id}/history?page=3&pageSize=1`,
  );

  assert.equal(last.body.data![0]!.eventType, 'CREATED');
});

// ---------------------------------------------------------------------------
// AC2 — attribution
// ---------------------------------------------------------------------------

test('AC2 — an entry names the actor, the timestamp and both values', async () => {
  const ticket = await newTicket();

  await call('PATCH', `/tickets/${ticket.id}`, { body: { priority: 'URGENT' } });

  const page = await call<TicketHistoryEntry[]>('GET', `/tickets/${ticket.id}/history`);
  const entry = page.body.data!.find((row) => row.eventType === 'PRIORITY_CHANGED')!;

  assert.match(entry.actorName!, /^Hana Historian/);
  assert.equal(entry.field, 'priority');
  assert.equal(entry.fromValue, 'MEDIUM');
  assert.equal(entry.toValue, 'URGENT');
  assert.ok(!Number.isNaN(Date.parse(entry.createdAt)));
});

// ---------------------------------------------------------------------------
// AC3 — automation is not a person
// ---------------------------------------------------------------------------

test('AC3 — an automated change names the rule and no actor', async () => {
  const ticket = await newTicket();

  await history.record({
    ticketId: ticket.id,
    // Deliberately supplied: the service must drop it, because a caller passing
    // both is exactly how an escalation ends up blamed on whoever last typed.
    actorUserId: userId,
    eventType: 'ESCALATED',
    field: 'status',
    fromValue: 'OPEN',
    toValue: 'ESCALATED',
    automationRule: 'sla.first-response-breached',
  });

  const page = await call<TicketHistoryEntry[]>('GET', `/tickets/${ticket.id}/history`);
  const entry = page.body.data!.find((row) => row.eventType === 'ESCALATED')!;

  assert.equal(entry.actorName, null);
  assert.equal(entry.automationRule, 'sla.first-response-breached');
});

test('AC3 — a human change carries no rule', async () => {
  const ticket = await newTicket();

  await call('PATCH', `/tickets/${ticket.id}`, { body: { priority: 'HIGH' } });

  const page = await call<TicketHistoryEntry[]>('GET', `/tickets/${ticket.id}/history`);
  const entry = page.body.data!.find((row) => row.eventType === 'PRIORITY_CHANGED')!;

  assert.equal(entry.automationRule, null);
  assert.ok(entry.actorName !== null);
});

// ---------------------------------------------------------------------------
// AC4 — append-only, and the database is what says so
// ---------------------------------------------------------------------------

test('AC4 — an UPDATE is refused', async () => {
  const ticket = await newTicket();

  const entry = await prisma.ticketHistory.findFirstOrThrow({
    where: { ticketId: ticket.id },
    select: { id: true },
  });

  await assert.rejects(
    prisma.ticketHistory.update({ where: { id: entry.id }, data: { toValue: 'tampered' } }),
    /append-only/,
  );
});

test('AC4 — a DELETE is refused while the ticket exists', async () => {
  const ticket = await newTicket();

  const entry = await prisma.ticketHistory.findFirstOrThrow({
    where: { ticketId: ticket.id },
    select: { id: true },
  });

  await assert.rejects(prisma.ticketHistory.delete({ where: { id: entry.id } }), /append-only/);

  // Still there — the refusal is not a silent no-op.
  assert.equal(await prisma.ticketHistory.count({ where: { ticketId: ticket.id } }), 1);
});

test('AC4 — but a genuine cascade still works', async () => {
  const ticket = await newTicket();

  await prisma.ticket.delete({ where: { id: ticket.id } });

  assert.equal(await prisma.ticketHistory.count({ where: { ticketId: ticket.id } }), 0);
});

// ---------------------------------------------------------------------------
// Scope — the history endpoint is not a way around the ticket's own scope
// ---------------------------------------------------------------------------

test('history of a ticket the caller cannot see answers 404', async () => {
  const result = await call<TicketHistoryEntry[]>('GET', `/tickets/${randomUUID()}/history`);

  assert.equal(result.status, 404);
});

test('the detail payload still carries history inline', async () => {
  const ticket = await newTicket();

  const detail = await call<TicketDetail>('GET', `/tickets/${ticket.id}`);

  assert.equal(detail.body.data!.history[0]!.eventType, 'CREATED');
  assert.equal(detail.body.data!.history[0]!.automationRule, null);
});

// ---------------------------------------------------------------------------
// US-48 — what assignment adds to the recorder
// ---------------------------------------------------------------------------

test('US-48 — clearing an assignee records UNASSIGNED, not ASSIGNED', async () => {
  const ticket = await newTicket();

  await call('PATCH', `/tickets/${ticket.id}/assignee`, { body: { assigneeId: userId } });
  await call('PATCH', `/tickets/${ticket.id}/assignee`, { body: { assigneeId: null } });

  const page = await call<TicketHistoryEntry[]>('GET', `/tickets/${ticket.id}/history`);
  const assignmentEvents = page.body
    .data!.filter((entry) => entry.field === 'assigneeId')
    .map((entry) => entry.eventType);

  // Newest first. `UNASSIGNED` existed in the enum from US-6 and nothing wrote
  // it, so a ticket handed back read as a ticket handed over.
  assert.deepEqual(assignmentEvents, ['UNASSIGNED', 'ASSIGNED']);
});

test('US-48 — an id-valued change carries a label a person can read', async () => {
  const ticket = await newTicket();

  await call('PATCH', `/tickets/${ticket.id}/assignee`, { body: { assigneeId: userId } });
  await call('PATCH', `/tickets/${ticket.id}/assignee`, { body: { assigneeId: otherUserId } });

  const page = await call<TicketHistoryEntry[]>('GET', `/tickets/${ticket.id}/history`);
  const reassignment = page.body.data!.find((entry) => entry.fromValue === userId)!;

  // The ids stay, because a report wants them and an id survives a rename. The
  // labels are what a timeline can show.
  assert.equal(reassignment.toValue, otherUserId);
  assert.match(reassignment.fromLabel!, /^Hana Historian/);
  assert.match(reassignment.toLabel!, /^Hana Historian/);
});

test('US-48 — a label written now is not rewritten when the name changes later', async () => {
  const ticket = await newTicket();

  await call('PATCH', `/tickets/${ticket.id}/assignee`, { body: { assigneeId: otherUserId } });

  const before = await call<TicketHistoryEntry[]>('GET', `/tickets/${ticket.id}/history`);
  const recorded = before.body.data!.find((entry) => entry.field === 'assigneeId')!.toLabel;

  await prisma.user.update({ where: { id: otherUserId }, data: { lastName: `Renamed-${run}` } });

  const after = await call<TicketHistoryEntry[]>('GET', `/tickets/${ticket.id}/history`);
  const stillSays = after.body.data!.find((entry) => entry.field === 'assigneeId')!.toLabel;

  // The whole reason the label is stored rather than joined: history describes
  // what was true when it happened.
  assert.equal(stillSays, recorded);
  assert.ok(!stillSays!.includes('Renamed'));
});

test('US-48 — a change with nothing to translate stores no label', async () => {
  const ticket = await newTicket();

  await call('PATCH', `/tickets/${ticket.id}`, { body: { priority: 'URGENT' } });

  const page = await call<TicketHistoryEntry[]>('GET', `/tickets/${ticket.id}/history`);
  const priority = page.body.data!.find((entry) => entry.field === 'priority')!;

  // A priority is already legible, so writing a label for it would put a key in
  // the metadata of every entry for no reader.
  assert.equal(priority.fromLabel, null);
  assert.equal(priority.toLabel, null);
});
