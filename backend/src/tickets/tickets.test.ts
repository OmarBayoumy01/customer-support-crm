/**
 * US-40 — the ticket API.
 *
 * AC1 create with a sequential number · AC2 filters in the database ·
 * AC3 the whole workspace in one response · AC4 scope enforced in the query ·
 * AC5 every change recorded.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PermissionKey, PermissionScope, Ticket, TicketDetail } from '@crm/shared';

import { AppModule } from '../app.module.js';
import { PasswordService, TokenService } from '../auth/index.js';
import { PrismaService } from '../prisma/index.js';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let passwords: PasswordService;
let tokens: TokenService;

const run = randomUUID().slice(0, 8);

let created = 0;
let customerId: string;
let departmentId: string;

/** A manager — sees everything. */
let allToken: string;
/** An agent scoped to their own queue. */
let assignedToken: string;
let assignedUserId: string;
/** Another agent, to prove the first cannot see their tickets. */
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

async function makeUser(roleId: string): Promise<{ id: string; token: string }> {
  created += 1;

  const user = await prisma.user.create({
    data: {
      email: `tkt-${run}-${String(created)}@example.com`,
      passwordHash: await passwords.hash('irrelevant'),
      firstName: 'Tick',
      lastName: `Tester${String(created)}`,
      departmentId,
      roles: { create: { roleId } },
    },
    select: { id: true },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: `tkt-hash-${run}-${String(created)}`,
      audience: 'crm-staff',
      familyId: `tkt-family-${run}-${String(created)}`,
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
      audience: 'crm-staff',
    }),
  };
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
  pagination?: { total: number };
}

async function call<T>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const text = await response.text();

  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Envelope<T>) };
}

/** Creates through the API, so nothing is tested against a shape the API rejects. */
async function newTicket(
  overrides: Record<string, unknown> = {},
  token = allToken,
): Promise<Ticket> {
  const result = await call<Ticket>('POST', '/tickets', {
    token,
    body: { customerId, subject: `Ticket ${run} ${String(Math.random())}`, ...overrides },
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
  passwords = app.get(PasswordService);
  tokens = app.get(TokenService);

  const department = await prisma.department.create({
    data: { code: `TKT-${run}`, nameEn: 'Support', nameAr: 'الدعم' },
    select: { id: true },
  });
  departmentId = department.id;

  const customer = await prisma.customer.create({
    data: { firstName: 'Nadia', lastName: `Saeed-${run}`, email: `nadia-${run}@example.com` },
    select: { id: true },
  });
  customerId = customer.id;

  const managerRole = await makeRole('tkt-manager', [
    ['ticket:view', 'ALL'],
    ['ticket:create', 'ALL'],
    ['ticket:update', 'ALL'],
  ]);
  const agentRole = await makeRole('tkt-agent', [
    ['ticket:view', 'ASSIGNED'],
    ['ticket:create', 'ALL'],
    ['ticket:update', 'ALL'],
  ]);

  allToken = (await makeUser(managerRole)).token;

  const agent = await makeUser(agentRole);
  assignedToken = agent.token;
  assignedUserId = agent.id;

  otherUserId = (await makeUser(agentRole)).id;
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// AC1 — create
// ---------------------------------------------------------------------------

test('AC1 — a ticket is stored with every field the criterion names', async () => {
  const ticket = await newTicket({
    description: 'The refund never arrived.',
    priority: 'HIGH',
    departmentId,
    channel: 'EMAIL',
    tags: ['refund'],
  });

  assert.equal(ticket.priority, 'HIGH');
  assert.equal(ticket.channel, 'EMAIL');
  assert.equal(ticket.departmentId, departmentId);
  assert.deepEqual(ticket.tags, ['refund']);
  assert.equal(ticket.customer.id, customerId);
  assert.equal(ticket.status, 'NEW');
});

test('AC1 — the number is sequential and unique, from the database', async () => {
  const first = await newTicket();
  const second = await newTicket();

  assert.ok(first.number > 0);
  // Generated by PostgreSQL's own sequence, so two concurrent submissions
  // cannot collide the way an application-side counter would.
  assert.ok(second.number > first.number);
});

test('AC1 — a ticket for a customer that does not exist is refused', async () => {
  const { status, body } = await call('POST', '/tickets', {
    token: allToken,
    body: { customerId: randomUUID(), subject: 'Orphan ticket' },
  });

  assert.equal(status, 422);
  assert.equal(body.error?.code, 'UNPROCESSABLE');
});

// ---------------------------------------------------------------------------
// AC2 — filters in the database
// ---------------------------------------------------------------------------

test('AC2 — status, priority and channel each narrow the list', async () => {
  const marker = `Filter-${randomUUID().slice(0, 6)}`;
  await newTicket({ subject: `${marker} urgent`, priority: 'URGENT', channel: 'CHAT' });
  await newTicket({ subject: `${marker} low`, priority: 'LOW', channel: 'EMAIL' });

  const urgent = await call<Ticket[]>('GET', `/tickets?q=${marker}&priority=URGENT`, {
    token: allToken,
  });

  assert.equal(urgent.body.pagination?.total, 1);
  assert.equal(urgent.body.data?.[0]?.priority, 'URGENT');

  const chat = await call<Ticket[]>('GET', `/tickets?q=${marker}&channel=CHAT`, {
    token: allToken,
  });

  assert.equal(chat.body.pagination?.total, 1);
});

test('AC2 — searching by ticket number finds it, because that is what a caller reads out', async () => {
  const ticket = await newTicket();

  const { body } = await call<Ticket[]>('GET', `/tickets?q=${String(ticket.number)}`, {
    token: allToken,
  });

  assert.ok(body.data?.some((row) => row.id === ticket.id));
});

test('AC2 — unassigned is its own filter, since a query string cannot carry null', async () => {
  const marker = `Unassigned-${randomUUID().slice(0, 6)}`;
  await newTicket({ subject: `${marker} free` });
  const taken = await newTicket({ subject: `${marker} taken` });

  await call('PATCH', `/tickets/${taken.id}`, {
    token: allToken,
    body: { assigneeId: assignedUserId },
  });

  const { body } = await call<Ticket[]>('GET', `/tickets?q=${marker}&unassigned=true`, {
    token: allToken,
  });

  assert.equal(body.pagination?.total, 1);
  assert.equal(body.data?.[0]?.assigneeId, null);
});

test('AC2 — paging happens in the database, not in memory', async () => {
  const marker = `Paged-${randomUUID().slice(0, 6)}`;

  for (let i = 0; i < 3; i += 1) {
    await newTicket({ subject: `${marker} ${String(i)}` });
  }

  const { body } = await call<Ticket[]>('GET', `/tickets?q=${marker}&pageSize=2`, {
    token: allToken,
  });

  assert.equal(body.data?.length, 2);
  assert.equal(body.pagination?.total, 3);
});

test('AC2 — a ticket with no SLA policy reports state "none", not "on track"', async () => {
  const ticket = await newTicket();

  // Different answers to different questions: nothing is being tracked, which
  // is not the same as being comfortably within a target.
  assert.equal(ticket.sla.state, 'none');
  assert.equal(ticket.sla.secondsRemaining, null);
});

test('AC2 — a breached ticket is found by the SLA filter, as a column comparison', async () => {
  const marker = `Sla-${randomUUID().slice(0, 6)}`;
  const ticket = await newTicket({ subject: `${marker} late` });

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { resolutionDueAt: new Date(Date.now() - 60_000) },
  });

  const { body } = await call<Ticket[]>('GET', `/tickets?q=${marker}&slaState=breach`, {
    token: allToken,
  });

  assert.equal(body.pagination?.total, 1);
  assert.equal(body.data?.[0]?.sla.state, 'breach');
});

// ---------------------------------------------------------------------------
// AC3 — the whole workspace in one response
// ---------------------------------------------------------------------------

test('AC3 — detail carries ticket, customer, messages, attachments, history and SLA', async () => {
  const ticket = await newTicket({ description: 'Everything in one go.' });

  await prisma.message.create({
    data: {
      ticketId: ticket.id,
      senderType: 'CUSTOMER',
      authorCustomerId: customerId,
      body: 'Any update?',
    },
  });

  const { body } = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });
  const detail = body.data!;

  assert.equal(detail.customer.id, customerId);
  assert.equal(detail.description, 'Everything in one go.');
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.messages[0]?.authorName, `Nadia Saeed-${run}`);
  assert.ok(Array.isArray(detail.attachments));
  // The CREATED entry from AC5.
  assert.ok(detail.history.length >= 1);
  assert.ok(detail.sla !== undefined);
});

test('AC3 — the staff API returns internal notes; filtering them here would break the agent', async () => {
  const ticket = await newTicket();

  await prisma.message.create({
    data: {
      ticketId: ticket.id,
      senderType: 'AGENT',
      authorUserId: assignedUserId,
      body: 'Customer has called three times about this.',
      isInternal: true,
    },
  });

  const { body } = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });

  // The portal (US-82) is a different controller with `isInternal: false` in
  // its query. That is where the rule is enforced; here they must be visible.
  assert.equal(body.data?.messages.filter((message) => message.isInternal).length, 1);
});

// ---------------------------------------------------------------------------
// AC4 — scope, enforced in the query
// ---------------------------------------------------------------------------

test('AC4 — an agent scoped to ASSIGNED sees only their own tickets', async () => {
  const marker = `Scope-${randomUUID().slice(0, 6)}`;

  const mine = await newTicket({ subject: `${marker} mine` });
  const theirs = await newTicket({ subject: `${marker} theirs` });

  await call('PATCH', `/tickets/${mine.id}`, {
    token: allToken,
    body: { assigneeId: assignedUserId },
  });
  await call('PATCH', `/tickets/${theirs.id}`, {
    token: allToken,
    body: { assigneeId: otherUserId },
  });

  const { body } = await call<Ticket[]>('GET', `/tickets?q=${marker}`, { token: assignedToken });

  assert.equal(body.pagination?.total, 1);
  assert.equal(body.data?.[0]?.id, mine.id);
});

test('AC4 — the scope cannot be paged past, because it is in the same query', async () => {
  const marker = `Deep-${randomUUID().slice(0, 6)}`;

  for (let i = 0; i < 4; i += 1) {
    const ticket = await newTicket({ subject: `${marker} ${String(i)}` });
    await call('PATCH', `/tickets/${ticket.id}`, {
      token: allToken,
      body: { assigneeId: otherUserId },
    });
  }

  const { body } = await call<Ticket[]>('GET', `/tickets?q=${marker}&page=1&pageSize=50`, {
    token: assignedToken,
  });

  // Filtering after fetching would have returned four rows and then hidden
  // them. The count proves the database never selected them.
  assert.equal(body.pagination?.total, 0);
  assert.equal(body.data?.length, 0);
});

test('AC4 — a ticket outside the scope answers 404, not 403', async () => {
  const theirs = await newTicket();
  await call('PATCH', `/tickets/${theirs.id}`, {
    token: allToken,
    body: { assigneeId: otherUserId },
  });

  const { status } = await call('GET', `/tickets/${theirs.id}`, { token: assignedToken });

  // Telling somebody a ticket exists but is not theirs still tells them it
  // exists.
  assert.equal(status, 404);
});

test('AC4 — an unauthenticated caller gets nothing', async () => {
  assert.equal((await call('GET', '/tickets')).status, 401);
});

// ---------------------------------------------------------------------------
// AC5 — every change is recorded
// ---------------------------------------------------------------------------

test('AC5 — creating a ticket records it', async () => {
  const ticket = await newTicket();

  const entries = await prisma.ticketHistory.findMany({
    where: { ticketId: ticket.id },
    select: { eventType: true },
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.eventType, 'CREATED');
});

test('AC5 — a field change records the field, both values, the actor and the time', async () => {
  const ticket = await newTicket({ priority: 'LOW' });

  await call('PATCH', `/tickets/${ticket.id}`, { token: allToken, body: { priority: 'URGENT' } });

  const entry = await prisma.ticketHistory.findFirstOrThrow({
    where: { ticketId: ticket.id, field: 'priority' },
    select: {
      eventType: true,
      field: true,
      fromValue: true,
      toValue: true,
      actorUserId: true,
      createdAt: true,
    },
  });

  assert.equal(entry.eventType, 'PRIORITY_CHANGED');
  assert.equal(entry.fromValue, 'LOW');
  assert.equal(entry.toValue, 'URGENT');
  assert.ok(entry.actorUserId !== null);
  assert.ok(entry.createdAt instanceof Date);
});

test('AC5 — a reassignment is recorded as an assignment, not a generic edit', async () => {
  const ticket = await newTicket();

  await call('PATCH', `/tickets/${ticket.id}`, {
    token: allToken,
    body: { assigneeId: assignedUserId },
  });

  const entry = await prisma.ticketHistory.findFirstOrThrow({
    where: { ticketId: ticket.id, field: 'assigneeId' },
    select: { eventType: true, toValue: true },
  });

  // A reassignment and a priority change are both "a column moved", but they
  // read completely differently in a timeline.
  assert.equal(entry.eventType, 'ASSIGNED');
  assert.equal(entry.toValue, assignedUserId);
});

test('AC5 — sending a field back unchanged records nothing', async () => {
  const ticket = await newTicket({ priority: 'MEDIUM' });

  await call('PATCH', `/tickets/${ticket.id}`, { token: allToken, body: { priority: 'MEDIUM' } });

  const entries = await prisma.ticketHistory.count({
    where: { ticketId: ticket.id, field: 'priority' },
  });

  // A PATCH that sends the whole object back should leave no trace, or a
  // timeline is unreadable within a week.
  assert.equal(entries, 0);
});

test('status cannot be changed through PATCH — that is US-47’s guarded transition', async () => {
  const ticket = await newTicket();

  await call('PATCH', `/tickets/${ticket.id}`, { token: allToken, body: { status: 'CLOSED' } });

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { status: true },
  });

  // Accepting it here would be a second, unguarded door onto the state machine.
  assert.equal(row.status, 'NEW');
});
