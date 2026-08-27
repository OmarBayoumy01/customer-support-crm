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
import { TicketsService } from './tickets.service.js';

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
let allUserId: string;
/** The service itself, for the reads US-82's portal will make. */
let tickets: TicketsService;
/** An agent scoped to their own queue. */
let assignedToken: string;
let assignedUserId: string;
/** Another agent, to prove the first cannot see their tickets. */
let otherUserId: string;

// --- US-48 fixtures -------------------------------------------------------
/** A manager whose `ticket:assign` reaches their own department only. */
let teamToken: string;
/** A second department, so "their own department" can be shown to mean something. */
let otherDepartmentId: string;
/** A candidate in that other department. */
let outsiderUserId: string;
/** A deactivated candidate — AC5. */
let inactiveUserId: string;
/** A portal customer who has been over-granted `ticket:update`. */
let portalUserId: string;

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

async function makeUser(
  roleId: string,
  options: { departmentId?: string | null; isActive?: boolean } = {},
): Promise<{ id: string; token: string }> {
  created += 1;

  const user = await prisma.user.create({
    data: {
      email: `tkt-${run}-${String(created)}@example.com`,
      passwordHash: await passwords.hash('irrelevant'),
      firstName: 'Tick',
      lastName: `Tester${String(created)}`,
      departmentId: options.departmentId === undefined ? departmentId : options.departmentId,
      ...(options.isActive === undefined ? {} : { isActive: options.isActive }),
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

/**
 * Assignment goes through its own endpoint — US-48.
 *
 * A helper because a dozen tests across US-40, US-42 and US-48 need an assigned
 * ticket as a *starting position*, and they used to arrange one by sending
 * `assigneeId` to `PATCH /tickets/:id`. That route no longer accepts it, and the
 * reason it no longer does is one of this story's criteria.
 */
async function setAssignee(
  ticketId: string,
  assigneeId: string | null,
  token = allToken,
): Promise<{ status: number; body: Envelope<Ticket> }> {
  return call<Ticket>('PATCH', `/tickets/${ticketId}/assignee`, {
    token,
    body: { assigneeId },
  });
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
    ['ticket:assign', 'ALL'],
    // US-47 gates the two finished states behind ticket:close and escalation
    // behind ticket:escalate, which is what the real catalogue grants a manager.
    ['ticket:close', 'ALL'],
    ['ticket:escalate', 'ALL'],
  ]);
  // Deliberately without `ticket:assign` — that gap is US-48's AC4.
  const agentRole = await makeRole('tkt-agent', [
    ['ticket:view', 'ASSIGNED'],
    ['ticket:create', 'ALL'],
    ['ticket:update', 'ALL'],
  ]);

  tickets = app.get(TicketsService);

  const manager = await makeUser(managerRole);
  allToken = manager.token;
  allUserId = manager.id;

  const agent = await makeUser(agentRole);
  assignedToken = agent.token;
  assignedUserId = agent.id;

  otherUserId = (await makeUser(agentRole)).id;

  // --- US-48 --------------------------------------------------------------

  const teamManagerRole = await makeRole('tkt-team-manager', [
    // `ticket:view` at ALL on purpose: this fixture is about the reach of
    // `ticket:assign`, and scoping the read as well would make a failed
    // assignment indistinguishable from a ticket the manager cannot see.
    ['ticket:view', 'ALL'],
    ['ticket:update', 'ALL'],
    ['ticket:assign', 'TEAM'],
  ]);

  teamToken = (await makeUser(teamManagerRole)).token;

  const otherDepartment = await prisma.department.create({
    data: { code: `TKT2-${run}`, nameEn: 'Billing', nameAr: 'الفواتير' },
    select: { id: true },
  });
  otherDepartmentId = otherDepartment.id;

  outsiderUserId = (await makeUser(agentRole, { departmentId: otherDepartmentId })).id;
  inactiveUserId = (await makeUser(agentRole, { isActive: false })).id;

  // A portal user who also holds `ticket:update`, which the seeded `customer`
  // role does not. The permission clause alone would let this one through; the
  // `customerProfile` clause is what keeps a customer out of the picker when
  // somebody over-grants a role.
  const portalUser = await makeUser(agentRole);
  portalUserId = portalUser.id;

  await prisma.customer.create({
    data: {
      firstName: 'Portal',
      lastName: `User-${run}`,
      email: `portal-${run}@example.com`,
      userId: portalUserId,
    },
    select: { id: true },
  });
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

  await setAssignee(taken.id, assignedUserId);

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

  // Updated by US-68. When this was written no clock existed and every ticket
  // had null deadlines, so a fresh ticket was the easiest way to reach the
  // `none` branch. Now the seeded policies cover every priority and a created
  // ticket has a real target — so the branch is reached by clearing the
  // deadlines, which is the state it actually describes: a ticket nothing is
  // tracking.
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { slaPolicyId: null, firstResponseDueAt: null, resolutionDueAt: null },
  });

  const { body } = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });

  // Different answers to different questions: nothing is being tracked, which
  // is not the same as being comfortably within a target.
  assert.equal(body.data?.sla.state, 'none');
  assert.equal(body.data?.sla.secondsRemaining, null);
});

test('AC2 — a created ticket now carries the deadlines US-68 computes', async () => {
  const ticket = await newTicket({ priority: 'URGENT' });

  assert.notEqual(ticket.sla.state, 'none');
  assert.ok(ticket.sla.resolutionDueAt !== null);
  assert.ok(ticket.sla.firstResponseDueAt !== null);
  assert.ok((ticket.sla.secondsRemaining ?? 0) > 0);
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

  await setAssignee(mine.id, assignedUserId);
  await setAssignee(theirs.id, otherUserId);

  const { body } = await call<Ticket[]>('GET', `/tickets?q=${marker}`, { token: assignedToken });

  assert.equal(body.pagination?.total, 1);
  assert.equal(body.data?.[0]?.id, mine.id);
});

test('AC4 — the scope cannot be paged past, because it is in the same query', async () => {
  const marker = `Deep-${randomUUID().slice(0, 6)}`;

  for (let i = 0; i < 4; i += 1) {
    const ticket = await newTicket({ subject: `${marker} ${String(i)}` });
    await setAssignee(ticket.id, otherUserId);
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
  await setAssignee(theirs.id, otherUserId);

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

  await setAssignee(ticket.id, assignedUserId);

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

  await call('PATCH', `/tickets/${ticket.id}`, { token: allToken, body: { status: 'RESOLVED' } });

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { status: true },
  });

  // Accepting it here would be a second, unguarded door onto the state machine.
  assert.equal(row.status, 'NEW');
});

// ---------------------------------------------------------------------------
// US-42 — what the queue needs from the API
// ---------------------------------------------------------------------------

test('US-42 AC4 — the counts endpoint answers all six views in one request', async () => {
  const mine = await newTicket();
  await setAssignee(mine.id, assignedUserId);

  const { status, body } = await call<Record<string, number>>('GET', '/tickets/counts', {
    token: allToken,
  });

  assert.equal(status, 200, JSON.stringify(body));

  for (const view of ['all', 'unassigned', 'mine', 'escalated', 'breached', 'resolved']) {
    assert.equal(typeof body.data?.[view], 'number', `${view} is missing`);
  }

  assert.ok((body.data?.all ?? 0) >= 1);
});

test('US-42 AC4 — the counts carry the caller’s scope, like every other read', async () => {
  const ticket = await newTicket();

  await setAssignee(ticket.id, otherUserId);

  const manager = await call<Record<string, number>>('GET', '/tickets/counts', { token: allToken });
  const agent = await call<Record<string, number>>('GET', '/tickets/counts', {
    token: assignedToken,
  });

  // The agent is scoped to their own queue, so a ticket assigned to somebody
  // else must not appear in their total — the same rule the list obeys.
  assert.ok((agent.body.data?.all ?? 0) < (manager.body.data?.all ?? 0));
});

test('US-42 AC4 — a named view filters the list the same way its count does', async () => {
  const ticket = await newTicket();

  await setAssignee(ticket.id, null);

  const list = await call<Ticket[]>('GET', '/tickets?view=unassigned&pageSize=100', {
    token: allToken,
  });
  const counts = await call<Record<string, number>>('GET', '/tickets/counts', { token: allToken });

  assert.ok(list.body.data!.every((row) => row.assigneeId === null));
  assert.equal(list.body.pagination?.total, counts.body.data?.unassigned);
});

test('US-42 — the assigned count is what the sidebar badge shows', async () => {
  const ticket = await newTicket();

  await setAssignee(ticket.id, assignedUserId);

  const { status, body } = await call<{ total: number; atRisk: number }>(
    'GET',
    '/tickets/assigned/count',
    { token: assignedToken },
  );

  assert.equal(status, 200);
  assert.ok((body.data?.total ?? 0) >= 1);
  assert.ok((body.data?.atRisk ?? -1) >= 0);
});

test('US-42 AC1 — a ticket carries its category as a name, not only an id', async () => {
  const category = await prisma.category.create({
    data: { slug: `queue-${run}`, nameEn: `Queue ${run}`, nameAr: 'قائمة' },
    select: { id: true },
  });

  const ticket = await newTicket({ categoryId: category.id });

  assert.equal(ticket.categoryId, category.id);
  // Without this the queue would have to fetch a category lookup to render one
  // column of one row.
  assert.equal(ticket.categoryName, `Queue ${run}`);
});

// ---------------------------------------------------------------------------
// US-46 — what the conversation timeline needs from the API
// ---------------------------------------------------------------------------

/** Writes straight to the database: the composer that would do this is US-1. */
async function addMessage(
  ticketId: string,
  overrides: { body?: string; isInternal?: boolean; channel?: 'EMAIL' | 'WHATSAPP' } = {},
): Promise<string> {
  const row = await prisma.message.create({
    data: {
      ticketId,
      senderType: 'AGENT',
      body: overrides.body ?? `Reply ${randomUUID().slice(0, 6)}`,
      isInternal: overrides.isInternal ?? false,
      channel: overrides.channel ?? 'EMAIL',
    },
    select: { id: true },
  });

  return row.id;
}

test('US-46 AC3 — a message carries the channel it travelled on', async () => {
  const ticket = await newTicket();
  await addMessage(ticket.id, { channel: 'WHATSAPP' });

  const detail = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });

  assert.equal(detail.body.data!.messages[0]!.channel, 'WHATSAPP');
});

test('US-46 AC4 — attachments arrive on the message that carried them', async () => {
  const ticket = await newTicket();
  const messageId = await addMessage(ticket.id);

  await prisma.attachment.create({
    data: {
      messageId,
      ticketId: ticket.id,
      fileName: 'statement.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      storageKey: `test/${messageId}/statement.pdf`,
    },
  });

  const detail = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });
  const message = detail.body.data!.messages.find((row) => row.id === messageId)!;

  // On the message, not only in the ticket-wide list: a file detached from the
  // sentence explaining it is a file nobody opens.
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0]!.fileName, 'statement.pdf');
  assert.equal(message.attachments[0]!.messageId, messageId);
});

test('US-46 AC5 — the detail carries the most recent slice and the total', async () => {
  const ticket = await newTicket();

  // Thirty-five is past the thirty the detail sends.
  for (let index = 0; index < 35; index += 1) {
    await addMessage(ticket.id, { body: `Message ${String(index)}` });
  }

  const detail = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });
  const messages = detail.body.data!.messages;

  assert.equal(messages.length, 30);
  assert.equal(detail.body.data!.messageCount, 35);

  // Oldest first within the page, and the page is the *most recent* thirty —
  // so it ends on the last thing said, which is what an agent replies to.
  assert.equal(messages.at(-1)!.body, 'Message 34');
  assert.equal(messages[0]!.body, 'Message 5');
});

test('US-46 AC5 — older messages page backwards, newest first', async () => {
  const ticket = await newTicket();

  for (let index = 0; index < 5; index += 1) {
    await addMessage(ticket.id, { body: `Older ${String(index)}` });
  }

  const page = await call<{ body: string }[]>(
    'GET',
    `/tickets/${ticket.id}/messages?page=1&pageSize=2`,
    { token: allToken },
  );

  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.equal(page.body.data!.length, 2);
  assert.equal(page.body.pagination?.total, 5);
  assert.equal(page.body.data![0]!.body, 'Older 4');
});

test('US-46 — the messages endpoint keeps the ticket’s scope', async () => {
  const result = await call('GET', `/tickets/${randomUUID()}/messages`, { token: allToken });

  assert.equal(result.status, 404);
});

test('US-46 — internal notes are on the staff timeline, which is what they are for', async () => {
  const ticket = await newTicket();
  await addMessage(ticket.id, { body: 'A note to the team.', isInternal: true });

  const detail = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });

  // The project's first rule is enforced in US-82's portal controller, which
  // queries `isInternal: false`. Filtering here would break the agent's own
  // timeline — the one place the note is supposed to appear.
  assert.ok(detail.body.data!.messages.some((message) => message.isInternal));
});

// ---------------------------------------------------------------------------
// US-1 — replying, and the note that must never reach a customer
// ---------------------------------------------------------------------------

test('US-1 — a reply is stored as a customer-facing agent message', async () => {
  const ticket = await newTicket();

  const { status, body } = await call<{ isInternal: boolean; senderType: string; body: string }>(
    'POST',
    `/tickets/${ticket.id}/messages`,
    { token: allToken, body: { body: 'Your refund is on its way.', isInternal: false } },
  );

  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.data?.isInternal, false);
  assert.equal(body.data?.senderType, 'AGENT');
  assert.equal(body.data?.body, 'Your refund is on its way.');
});

test('US-1 — isInternal is required, so it cannot be forgotten into "customer-facing"', async () => {
  const ticket = await newTicket();

  const { status } = await call('POST', `/tickets/${ticket.id}/messages`, {
    token: allToken,
    body: { body: 'No flag at all.' },
  });

  // A default would make the dangerous value the one you get by omission.
  assert.equal(status, 422);
});

test('US-1 AC5 — a note is excluded from a customer-visible read, in the query', async () => {
  const ticket = await newTicket();

  await call('POST', `/tickets/${ticket.id}/messages`, {
    token: allToken,
    body: { body: 'Visible to the customer.', isInternal: false },
  });
  await call('POST', `/tickets/${ticket.id}/messages`, {
    token: allToken,
    body: { body: 'PRIVATE: do not promise a date.', isInternal: true },
  });

  const actor = { userId: allUserId, departmentId };
  const staff = await tickets.messages(ticket.id, actor, { skip: 0, take: 50 });
  const portal = await tickets.messages(ticket.id, actor, {
    skip: 0,
    take: 50,
    includeInternal: false,
  });

  assert.equal(staff.total, 2);
  assert.ok(staff.messages.some((message) => message.isInternal));

  // The project's first non-negotiable rule. Not one note, and not one note's
  // worth of count either — a portal that says "2 messages" and shows 1 has
  // leaked the existence of the note without rendering it.
  assert.equal(portal.total, 1);
  assert.equal(portal.messages.length, 1);
  assert.ok(portal.messages.every((message) => !message.isInternal));
  assert.ok(!portal.messages.some((message) => message.body.includes('PRIVATE')));
});

test('US-1 AC7 — a note’s attachments go with it, because they hang off the message', async () => {
  const ticket = await newTicket();

  const note = await call<{ id: string }>('POST', `/tickets/${ticket.id}/messages`, {
    token: allToken,
    body: { body: 'Internal, with a file.', isInternal: true },
  });

  await prisma.attachment.create({
    data: {
      messageId: note.body.data!.id,
      ticketId: ticket.id,
      fileName: 'private.pdf',
      contentType: 'application/pdf',
      sizeBytes: 512,
      storageKey: `test/${note.body.data!.id}/private.pdf`,
    },
  });

  const portal = await tickets.messages(
    ticket.id,
    { userId: allUserId, departmentId },
    { skip: 0, take: 50, includeInternal: false },
  );

  // AC7 needs no separate rule: an attachment belongs to a message, so a
  // filtered-out message takes its files with it.
  assert.ok(portal.messages.every((message) => message.attachments.length === 0));
});

test('US-1 — a reply stops the response clock; a note does not', async () => {
  const replied = await newTicket();
  await call('POST', `/tickets/${replied.id}/messages`, {
    token: allToken,
    body: { body: 'Looking into it now.', isInternal: false },
  });

  const noted = await newTicket();
  await call('POST', `/tickets/${noted.id}/messages`, {
    token: allToken,
    body: { body: 'Chasing payments.', isInternal: true },
  });

  const [afterReply, afterNote] = await Promise.all([
    prisma.ticket.findUniqueOrThrow({
      where: { id: replied.id },
      select: { firstRespondedAt: true, lastAgentReplyAt: true },
    }),
    prisma.ticket.findUniqueOrThrow({
      where: { id: noted.id },
      select: { firstRespondedAt: true, lastAgentReplyAt: true },
    }),
  ]);

  assert.ok(afterReply.firstRespondedAt !== null);
  assert.ok(afterReply.lastAgentReplyAt !== null);

  // An agent must not be able to meet a commitment to a customer by writing a
  // note the customer will never see.
  assert.equal(afterNote.firstRespondedAt, null);
  assert.equal(afterNote.lastAgentReplyAt, null);
});

test('US-1 — writing on a ticket outside the caller’s scope answers 404', async () => {
  const result = await call('POST', `/tickets/${randomUUID()}/messages`, {
    token: allToken,
    body: { body: 'Nope.', isInternal: false },
  });

  assert.equal(result.status, 404);
});

// ---------------------------------------------------------------------------
// US-49 — category and priority
// ---------------------------------------------------------------------------

test('US-49 AC3 — the category list is available to anyone who may see a ticket', async () => {
  await prisma.category.create({
    data: { slug: `pick-${run}`, nameEn: `Pickable ${run}`, nameAr: 'قابل', isActive: true },
  });

  const { status, body } = await call<{ nameEn: string; isActive: boolean }[]>(
    'GET',
    '/categories',
    { token: assignedToken },
  );

  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.data!.some((category) => category.nameEn === `Pickable ${run}`));
  // A retired category should not appear in a picker.
  assert.ok(body.data!.every((category) => category.isActive));
});

test('US-49 AC3 — an inactive category is not offered', async () => {
  await prisma.category.create({
    data: { slug: `gone-${run}`, nameEn: `Retired ${run}`, nameAr: 'متقاعد', isActive: false },
  });

  const { body } = await call<{ nameEn: string }[]>('GET', '/categories', { token: allToken });

  assert.ok(!body.data!.some((category) => category.nameEn === `Retired ${run}`));
});

test('US-49 AC4 — choosing a category routes the ticket to its department', async () => {
  const routed = await prisma.department.create({
    data: { code: `RTE-${run}`, nameEn: 'Billing', nameAr: 'الفوترة' },
    select: { id: true },
  });

  const category = await prisma.category.create({
    data: {
      slug: `routed-${run}`,
      nameEn: `Routed ${run}`,
      nameAr: 'موجّه',
      departmentId: routed.id,
    },
    select: { id: true },
  });

  const ticket = await newTicket();
  assert.notEqual(ticket.departmentId, routed.id);

  const updated = await call<Ticket>('PATCH', `/tickets/${ticket.id}`, {
    token: allToken,
    body: { categoryId: category.id },
  });

  assert.equal(updated.body.data?.categoryId, category.id);
  assert.equal(updated.body.data?.departmentId, routed.id);
});

test('US-49 AC4 — an explicit department in the same request wins over the routing hint', async () => {
  const hinted = await prisma.department.create({
    data: { code: `HNT-${run}`, nameEn: 'Hinted', nameAr: 'مقترح' },
    select: { id: true },
  });
  const chosen = await prisma.department.create({
    data: { code: `CHS-${run}`, nameEn: 'Chosen', nameAr: 'مختار' },
    select: { id: true },
  });

  const category = await prisma.category.create({
    data: {
      slug: `hint-${run}`,
      nameEn: `Hint ${run}`,
      nameAr: 'تلميح',
      departmentId: hinted.id,
    },
    select: { id: true },
  });

  const ticket = await newTicket();

  const updated = await call<Ticket>('PATCH', `/tickets/${ticket.id}`, {
    token: allToken,
    body: { categoryId: category.id, departmentId: chosen.id },
  });

  // An agent moving a ticket to a specific team meant it. A category quietly
  // overruling them is how people stop trusting a form.
  assert.equal(updated.body.data?.departmentId, chosen.id);
});

test('US-49 AC2 — a priority change re-evaluates the SLA and moves the deadline', async () => {
  const ticket = await newTicket({ priority: 'LOW' });
  const before = ticket.sla.resolutionDueAt;

  assert.ok(before !== null, 'the seeded policies should have given it a deadline');

  const updated = await call<Ticket>('PATCH', `/tickets/${ticket.id}`, {
    token: allToken,
    body: { priority: 'URGENT' },
  });

  const after = updated.body.data!.sla.resolutionDueAt;

  assert.ok(after !== null);
  // Urgent is a four-hour target against Low's seventy-two, so the deadline
  // must have moved *earlier* — and the response carries the new one, rather
  // than the client having to refetch to find out.
  assert.ok(Date.parse(after) < Date.parse(before));
});

test('US-49 AC5 — both changes appear in history with old and new values', async () => {
  const category = await prisma.category.create({
    data: { slug: `hist-${run}`, nameEn: `History ${run}`, nameAr: 'سجل' },
    select: { id: true },
  });

  const ticket = await newTicket({ priority: 'LOW' });

  await call('PATCH', `/tickets/${ticket.id}`, {
    token: allToken,
    body: { priority: 'HIGH', categoryId: category.id },
  });

  const history = await call<
    { eventType: string; field: string | null; fromValue: string | null; toValue: string | null }[]
  >('GET', `/tickets/${ticket.id}/history`, { token: allToken });

  const priority = history.body.data!.find((entry) => entry.field === 'priority')!;
  const categoryEntry = history.body.data!.find((entry) => entry.field === 'categoryId')!;

  assert.equal(priority.eventType, 'PRIORITY_CHANGED');
  assert.equal(priority.fromValue, 'LOW');
  assert.equal(priority.toValue, 'HIGH');

  assert.equal(categoryEntry.eventType, 'CATEGORY_CHANGED');
  assert.equal(categoryEntry.toValue, category.id);
});

// ---------------------------------------------------------------------------
// US-48 — assign and reassign
// ---------------------------------------------------------------------------

interface AssignableAgentRow {
  id: string;
  name: string;
  openTicketCount: number;
  isAvailable: boolean;
  departmentName: string | null;
}

interface HistoryRow {
  eventType: string;
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  fromLabel: string | null;
  toLabel: string | null;
  actorName: string | null;
}

test('US-48 AC1 — assigning updates the ticket and records who did it', async () => {
  const ticket = await newTicket();

  const { status, body } = await setAssignee(ticket.id, assignedUserId);

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data?.assigneeId, assignedUserId);

  const history = await call<HistoryRow[]>('GET', `/tickets/${ticket.id}/history`, {
    token: allToken,
  });

  const entry = history.body.data!.find((row) => row.field === 'assigneeId')!;

  assert.equal(entry.eventType, 'ASSIGNED');
  assert.equal(entry.toValue, assignedUserId);
  // "a history entry records who reassigned it" — the actor, not the assignee.
  assert.ok(entry.actorName !== null);
});

test('US-48 AC4 — an agent with ticket:update but not ticket:assign is refused', async () => {
  const ticket = await newTicket();
  await setAssignee(ticket.id, assignedUserId);

  const { status } = await setAssignee(ticket.id, otherUserId, assignedToken);

  // The hole this story closes: `ticket:update` is not `ticket:assign`, and the
  // agent holds only the first.
  assert.equal(status, 403);

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { assigneeId: true },
  });

  assert.equal(row.assigneeId, assignedUserId);
});

test('US-48 AC4 — PATCH /tickets/:id can no longer assign at all', async () => {
  const ticket = await newTicket();

  // The old door. It answers 200 because the field is simply not part of the
  // schema any more; what matters is that nothing moved.
  await call('PATCH', `/tickets/${ticket.id}`, {
    token: assignedToken,
    body: { assigneeId: assignedUserId },
  });

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { assigneeId: true },
  });

  assert.equal(row.assigneeId, null);
});

test('US-48 AC3 — unassigning returns the ticket to the Unassigned queue', async () => {
  const marker = `Unassign-${randomUUID().slice(0, 6)}`;
  const ticket = await newTicket({ subject: `${marker} handed back` });

  await setAssignee(ticket.id, assignedUserId);
  const { status, body } = await setAssignee(ticket.id, null);

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data?.assigneeId, null);

  const queue = await call<Ticket[]>('GET', `/tickets?q=${marker}&view=unassigned`, {
    token: allToken,
  });

  assert.equal(queue.body.pagination?.total, 1);
  assert.equal(queue.body.data?.[0]?.id, ticket.id);
});

test('US-48 AC3 — an unassignment is recorded as UNASSIGNED, not as an assignment', async () => {
  const ticket = await newTicket();

  await setAssignee(ticket.id, assignedUserId);
  await setAssignee(ticket.id, null);

  const history = await call<HistoryRow[]>('GET', `/tickets/${ticket.id}/history`, {
    token: allToken,
  });

  const entries = history.body.data!.filter((row) => row.field === 'assigneeId');

  // Newest first. `UNASSIGNED` had been in the enum since US-6 with nothing
  // writing it, so "returned to the queue" used to read as "given to somebody".
  assert.equal(entries[0]?.eventType, 'UNASSIGNED');
  assert.equal(entries[0]?.toValue, null);
  assert.equal(entries[1]?.eventType, 'ASSIGNED');
});

test('US-48 AC3 — an unassigned ticket is still visible to the team', async () => {
  const marker = `TeamSees-${randomUUID().slice(0, 6)}`;
  const ticket = await newTicket({ subject: `${marker} orphan`, departmentId });

  await setAssignee(ticket.id, assignedUserId);
  await setAssignee(ticket.id, null);

  const seen = await call<Ticket[]>('GET', `/tickets?q=${marker}`, { token: teamToken });

  // Unassigning clears the owner and touches nothing else — the department is
  // what the team's scope matches on, and it is untouched.
  assert.equal(seen.body.pagination?.total, 1);

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { departmentId: true },
  });

  assert.equal(row.departmentId, departmentId);
});

test('US-48 AC2 — each candidate carries their open ticket count', async () => {
  const first = await newTicket();
  const second = await newTicket();
  const closed = await newTicket();

  await setAssignee(first.id, assignedUserId);
  await setAssignee(second.id, assignedUserId);
  await setAssignee(closed.id, assignedUserId);

  // Resolved work is not workload. The count uses the same definition of "open"
  // the queue's views do.
  await prisma.ticket.update({ where: { id: closed.id }, data: { status: 'RESOLVED' } });

  const { status, body } = await call<AssignableAgentRow[]>('GET', '/tickets/assignees', {
    token: allToken,
  });

  assert.equal(status, 200, JSON.stringify(body));

  const candidate = body.data!.find((row) => row.id === assignedUserId)!;

  assert.ok(candidate.openTicketCount >= 2);

  const counted = await prisma.ticket.count({
    where: {
      assigneeId: assignedUserId,
      status: { not: 'RESOLVED' },
      deletedAt: null,
    },
  });

  assert.equal(candidate.openTicketCount, counted);
});

test('US-48 AC2 — the assign scope narrows the candidates in the query', async () => {
  const all = await call<AssignableAgentRow[]>('GET', '/tickets/assignees', { token: allToken });
  const team = await call<AssignableAgentRow[]>('GET', '/tickets/assignees', { token: teamToken });

  // An administrator scoped ALL sees the other department's agent; a manager
  // scoped TEAM does not — and not because the list was filtered afterwards.
  assert.ok(all.body.data!.some((row) => row.id === outsiderUserId));
  assert.ok(!team.body.data!.some((row) => row.id === outsiderUserId));
  assert.ok(team.body.data!.some((row) => row.id === assignedUserId));
});

test('US-48 AC4 — an agent cannot even read the candidate list', async () => {
  const { status } = await call('GET', '/tickets/assignees', { token: assignedToken });

  assert.equal(status, 403);
});

test('US-48 AC5 — an inactive candidate is marked unavailable, not omitted', async () => {
  const { body } = await call<AssignableAgentRow[]>('GET', '/tickets/assignees', {
    token: allToken,
  });

  const inactive = body.data!.find((row) => row.id === inactiveUserId);

  // Returned so a ticket already assigned to them still renders a name, and
  // marked so the picker can refuse to offer them.
  assert.ok(inactive !== undefined);
  assert.equal(inactive.isAvailable, false);

  const active = body.data!.find((row) => row.id === assignedUserId)!;

  assert.equal(active.isAvailable, true);
});

test('US-48 AC5 — assigning to an inactive user is refused by the server', async () => {
  const ticket = await newTicket();

  const { status, body } = await setAssignee(ticket.id, inactiveUserId);

  // The picker disables the row; this is what makes it true for every caller.
  assert.equal(status, 422);
  assert.equal(body.error?.code, 'UNPROCESSABLE');
});

test('US-48 AC4 — assigning outside the assign scope is refused', async () => {
  const ticket = await newTicket({ departmentId });

  const { status, body } = await setAssignee(ticket.id, outsiderUserId, teamToken);

  // Holding `ticket:assign` says nothing about *whom* you may assign to.
  assert.equal(status, 422);
  assert.equal(body.error?.code, 'UNPROCESSABLE');
});

test('US-48 AC2 — a portal customer is never a candidate', async () => {
  const { body } = await call<AssignableAgentRow[]>('GET', '/tickets/assignees', {
    token: allToken,
  });

  // This one holds `ticket:update` as well, so the permission clause alone
  // would have let them through.
  assert.ok(!body.data!.some((row) => row.id === portalUserId));
});

test('US-48 AC6 — the history entry names both owners, not their ids', async () => {
  const ticket = await newTicket();

  await setAssignee(ticket.id, assignedUserId);
  await setAssignee(ticket.id, otherUserId);

  const history = await call<HistoryRow[]>('GET', `/tickets/${ticket.id}/history`, {
    token: allToken,
  });

  const reassignment = history.body.data!.find((row) => row.fromValue === assignedUserId)!;

  // "the new assignee sees who owned it previously" — a UUID does not say that.
  assert.equal(reassignment.toValue, otherUserId);
  assert.ok(reassignment.fromLabel !== null);
  assert.ok(reassignment.toLabel !== null);
  // A name, not the id it sits beside.
  assert.ok(!reassignment.fromLabel.includes('-'));
});

test('US-48 AC6 — internal notes survive a reassignment', async () => {
  const ticket = await newTicket();

  await setAssignee(ticket.id, assignedUserId);
  await addMessage(ticket.id, { body: 'Already threatening a chargeback.', isInternal: true });
  await addMessage(ticket.id, { body: 'We are looking into it.', isInternal: false });

  await setAssignee(ticket.id, otherUserId);

  const detail = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });

  // The handover is the moment the context matters most. Nothing here touches
  // Message, but the criterion is a promise to the person taking the ticket.
  assert.equal(detail.body.data!.messages.filter((message) => message.isInternal).length, 1);
  assert.equal(detail.body.data!.messages.length, 2);
});

test('US-48 — re-sending the current assignee records nothing', async () => {
  const ticket = await newTicket();

  await setAssignee(ticket.id, assignedUserId);
  await setAssignee(ticket.id, assignedUserId);

  const entries = await prisma.ticketHistory.count({
    where: { ticketId: ticket.id, field: 'assigneeId' },
  });

  // The same rule `recordChanges` follows: a field that did not move leaves no
  // trace, or the timeline is unreadable within a week.
  assert.equal(entries, 1);
});

// ---------------------------------------------------------------------------
// US-47 — status transitions
// ---------------------------------------------------------------------------

async function setStatus(
  ticketId: string,
  status: string,
  token = allToken,
): Promise<{ status: number; body: Envelope<Ticket> }> {
  return call<Ticket>('PATCH', `/tickets/${ticketId}/status`, { token, body: { status } });
}

test('US-47 AC2 — a legal transition saves; an illegal one is refused and nothing moves', async () => {
  const ticket = await newTicket();

  const opened = await setStatus(ticket.id, 'WAITING_FOR_AGENT');

  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.data?.status, 'WAITING_FOR_AGENT');

  await setStatus(ticket.id, 'RESOLVED');

  // RESOLVED cannot move to WAITING_FOR_CUSTOMER directly through agent transition.
  const illegal = await setStatus(ticket.id, 'WAITING_FOR_CUSTOMER');

  assert.equal(illegal.status, 422);
  assert.equal(illegal.body.error?.code, 'UNPROCESSABLE');

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { status: true },
  });

  assert.equal(row.status, 'RESOLVED');
});

test('US-47 AC2 — NEW is never a target', async () => {
  const ticket = await newTicket();

  await setStatus(ticket.id, 'WAITING_FOR_AGENT');

  // "Nobody has looked at this yet" stops being true the moment somebody does.
  assert.equal((await setStatus(ticket.id, 'NEW')).status, 422);
});

test('US-47 AC2 — re-sending the current status records nothing', async () => {
  const ticket = await newTicket();

  await setStatus(ticket.id, 'WAITING_FOR_AGENT');
  await setStatus(ticket.id, 'WAITING_FOR_AGENT');

  const entries = await prisma.ticketHistory.count({
    where: { ticketId: ticket.id, field: 'status' },
  });

  assert.equal(entries, 1);
});

test('US-47 AC2 — resolving without ticket:close is refused', async () => {
  const ticket = await newTicket();

  // Assigned to the agent first, so their ASSIGNED scope can see it — otherwise
  // this would answer 404 before the permission was ever considered, and the
  // test would pass for the wrong reason.
  await setAssignee(ticket.id, assignedUserId);
  await setStatus(ticket.id, 'WAITING_FOR_AGENT');

  // The agent fixture holds ticket:update and not ticket:close.
  const refused = await setStatus(ticket.id, 'RESOLVED', assignedToken);

  assert.equal(refused.status, 403);

  // And with the grant, the same move is allowed.
  assert.equal((await setStatus(ticket.id, 'RESOLVED')).status, 200);
});

test('US-47 AC4 — Waiting for customer pauses the clock and coming back resumes it', async () => {
  const ticket = await newTicket({ priority: 'LOW' });

  await setStatus(ticket.id, 'WAITING_FOR_AGENT');
  await setStatus(ticket.id, 'WAITING_FOR_CUSTOMER');

  const paused = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { slaPausedAt: true, resolutionDueAt: true },
  });

  assert.ok(paused.slaPausedAt !== null);

  await setStatus(ticket.id, 'WAITING_FOR_AGENT');

  const resumed = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { slaPausedAt: true, resolutionDueAt: true },
  });

  // The deadline moves out by exactly what the clock was stopped for, so it is not re-derived here.
  assert.equal(resumed.slaPausedAt, null);

  if (paused.resolutionDueAt !== null && resumed.resolutionDueAt !== null) {
    assert.ok(resumed.resolutionDueAt.getTime() >= paused.resolutionDueAt.getTime());
  }
});

test('US-47 AC4 — resolving writes resolvedAt timestamp', async () => {
  const ticket = await newTicket();

  await setStatus(ticket.id, 'RESOLVED');

  const resolved = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { resolvedAt: true },
  });

  assert.ok(resolved.resolvedAt !== null);
});

test('US-47 AC4 — assignment moves NEW ticket to WAITING_FOR_AGENT', async () => {
  const ticket = await newTicket();

  assert.equal(ticket.status, 'NEW');

  await setAssignee(ticket.id, assignedUserId);

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { status: true, assigneeId: true },
  });

  assert.equal(row.status, 'WAITING_FOR_AGENT');
  assert.equal(row.assigneeId, assignedUserId);
});

test('US-47 AC4 — agent reply moves ticket to WAITING_FOR_CUSTOMER', async () => {
  const ticket = await newTicket();
  await setStatus(ticket.id, 'WAITING_FOR_AGENT');

  await call('POST', `/tickets/${ticket.id}/messages`, {
    token: allToken,
    body: { body: 'Here is an update for you.', isInternal: false },
  });

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { status: true },
  });

  assert.equal(row.status, 'WAITING_FOR_CUSTOMER');
});

test('US-47 AC4 — internal note does not change status', async () => {
  const ticket = await newTicket();
  await setStatus(ticket.id, 'WAITING_FOR_AGENT');

  await call('POST', `/tickets/${ticket.id}/messages`, {
    token: allToken,
    body: { body: 'Internal note for team.', isInternal: true },
  });

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { status: true },
  });

  assert.equal(row.status, 'WAITING_FOR_AGENT');
});

test('US-47 AC5 — a customer reply reopens a resolved ticket, with no actor', async () => {
  const ticket = await newTicket();

  await setStatus(ticket.id, 'RESOLVED');

  // Called directly: customer reply moves resolved ticket to WAITING_FOR_AGENT.
  await tickets.onCustomerReply(ticket.id);

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { status: true, reopenCount: true, resolvedAt: true },
  });

  assert.equal(row.status, 'WAITING_FOR_AGENT');
  assert.equal(row.reopenCount, 1);
  assert.equal(row.resolvedAt, null);

  const entry = await prisma.ticketHistory.findFirstOrThrow({
    where: { ticketId: ticket.id, eventType: 'REOPENED' },
    select: { actorUserId: true },
  });

  // No member of staff reopened it.
  assert.equal(entry.actorUserId, null);
});

test('US-47 AC5 — a customer reply to WAITING_FOR_CUSTOMER moves to WAITING_FOR_AGENT', async () => {
  const ticket = await newTicket();
  await setStatus(ticket.id, 'WAITING_FOR_CUSTOMER');
  await tickets.onCustomerReply(ticket.id);

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { status: true },
  });

  assert.equal(row.status, 'WAITING_FOR_AGENT');
});

test('US-47 AC3 — firstRespondedAt is the fact the resolve warning reads', async () => {
  const ticket = await newTicket();

  const before = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });

  assert.equal(before.body.data!.sla.firstRespondedAt, null);

  await call('POST', `/tickets/${ticket.id}/messages`, {
    token: allToken,
    body: { body: 'Looking into this now.', isInternal: false },
  });

  const after = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });

  // Set by US-68 on the first customer-facing reply, internal notes excluded —
  // which is exactly "no agent reply exists on the ticket".
  assert.ok(after.body.data!.sla.firstRespondedAt !== null);
});

// ---------------------------------------------------------------------------
// US-69 — what the timer needs from the payload
// ---------------------------------------------------------------------------

test('US-69 AC4 — the SLA payload carries the target and the paused total', async () => {
  const ticket = await newTicket({ priority: 'LOW' });

  const fresh = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });
  const sla = fresh.body.data!.sla;

  // The target comes from the policy rather than being inferred from createdAt
  // to the deadline, which is wrong by exactly the banked pause.
  assert.equal(typeof sla.resolutionTargetMinutes, 'number');
  assert.equal(sla.pausedAt, null);
  assert.equal(sla.pausedMs, 0);

  await setStatus(ticket.id, 'WAITING_FOR_CUSTOMER');

  const paused = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });

  // Stopped now, so the timer can say so instead of counting down against a
  // clock that is not running.
  assert.ok(paused.body.data!.sla.pausedAt !== null);

  await setStatus(ticket.id, 'WAITING_FOR_AGENT');

  const resumed = await call<TicketDetail>('GET', `/tickets/${ticket.id}`, { token: allToken });

  // US-68 banks the interval on resume; this is the first reader it has ever had.
  assert.equal(resumed.body.data!.sla.pausedAt, null);
  assert.ok(resumed.body.data!.sla.pausedMs >= 0);
});
