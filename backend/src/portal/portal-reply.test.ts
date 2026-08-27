/**
 * US-85 — the customer reads and replies, on the server.
 *
 * AC2's absence of anything internal, the attribution, the boundary, and — the
 * substance of this story — **US-47's reopen rule, called for the first time.**
 * AC6's event allowlist is asserted here too, because "plain language" must not
 * become a second door onto the ticket's history.
 *
 * AC1, AC3, AC4 and AC5 are presentation and live in
 * `frontend/src/features/portal/portal-request.test.tsx`.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PortalTicketDetail } from '@crm/shared';

import { AppModule } from '../app.module.js';
import { PasswordService, TokenService } from '../auth/index.js';
import { PrismaService } from '../prisma/index.js';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let tokens: TokenService;

const run = randomUUID().slice(0, 8);
const SUBJECT_PREFIX = `Reply ${run}`;

let customerId: string;
let portalToken: string;
let otherCustomerId: string;
let otherPortalToken: string;
let staffToken: string;
let agentUserId: string;

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
}

async function call<T>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Envelope<T>; raw: string }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const raw = await response.text();

  return {
    status: response.status,
    body: raw === '' ? {} : (JSON.parse(raw) as Envelope<T>),
    raw,
  };
}

async function makePortalCustomer(label: string): Promise<{ customerId: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      email: `reply-${label}-${run}@example.com`,
      passwordHash: await app.get(PasswordService).hash('irrelevant'),
      firstName: 'Nadia',
      lastName: `Reply-${label}`,
    },
    select: { id: true },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: `reply-hash-${label}-${run}`,
      audience: 'crm-portal',
      familyId: `reply-family-${label}-${run}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
    select: { id: true },
  });

  const customer = await prisma.customer.create({
    data: {
      firstName: 'Nadia',
      lastName: `Reply-${label}`,
      email: `reply-${label}-${run}@example.com`,
      userId: user.id,
    },
    select: { id: true },
  });

  return {
    customerId: customer.id,
    token: await tokens.signAccessToken({
      userId: user.id,
      roles: [],
      sessionId: session.id,
      audience: 'crm-portal',
    }),
  };
}

async function makeTicket(
  options: {
    status?: 'NEW' | 'WAITING_FOR_AGENT' | 'WAITING_FOR_CUSTOMER' | 'RESOLVED';
    customerId?: string;
  } = {},
): Promise<string> {
  const row = await prisma.ticket.create({
    data: {
      subject: `${SUBJECT_PREFIX} ${randomUUID().slice(0, 6)}`,
      description: 'The refund never arrived.',
      customerId: options.customerId ?? customerId,
      status: options.status ?? 'WAITING_FOR_AGENT',
      priority: 'MEDIUM',
      channel: 'WEB',
      ...(options.status === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
    },
    select: { id: true },
  });

  return row.id;
}

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  prisma = app.get(PrismaService);
  tokens = app.get(TokenService);

  const mine = await makePortalCustomer('mine');
  customerId = mine.customerId;
  portalToken = mine.token;

  const other = await makePortalCustomer('other');
  otherCustomerId = other.customerId;
  otherPortalToken = other.token;

  const agent = await prisma.user.create({
    data: {
      email: `reply-agent-${run}@example.com`,
      passwordHash: await app.get(PasswordService).hash('irrelevant'),
      firstName: 'Layla',
      lastName: `Haddad-${run}`,
    },
    select: { id: true },
  });
  agentUserId = agent.id;

  const staffSession = await prisma.session.create({
    data: {
      userId: agent.id,
      refreshTokenHash: `reply-hash-staff-${run}`,
      audience: 'crm-staff',
      familyId: `reply-family-staff-${run}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
    select: { id: true },
  });

  staffToken = await tokens.signAccessToken({
    userId: agent.id,
    roles: [],
    sessionId: staffSession.id,
    audience: 'crm-staff',
  });
});

after(async () => {
  await prisma.ticket.deleteMany({ where: { subject: { startsWith: SUBJECT_PREFIX } } });
  await app.close();
});

const reply = async (ticketId: string, body: unknown, token = portalToken) =>
  call<PortalTicketDetail>('POST', `/portal/tickets/${ticketId}/messages`, { token, body });

// ---------------------------------------------------------------------------
// The reply, and its attribution
// ---------------------------------------------------------------------------

test('a customer replies, and the message is attributed to them and is not internal', async () => {
  const ticketId = await makeTicket();

  const { status, body } = await reply(ticketId, { body: 'It still has not arrived.' });

  assert.equal(status, 201, JSON.stringify(body));

  const row = await prisma.message.findFirstOrThrow({
    where: { ticketId, senderType: 'CUSTOMER' },
    select: { isInternal: true, authorCustomerId: true, authorUserId: true, body: true },
  });

  assert.equal(row.isInternal, false);
  assert.equal(row.authorCustomerId, customerId);
  assert.equal(row.authorUserId, null);
  assert.equal(row.body, 'It still has not arrived.');

  // And it comes back in the thread, as the customer's own side of it.
  const mine = body.data!.messages.filter((message) => message.author === 'you');

  assert.equal(mine.length, 1);
  assert.equal(mine[0]?.body, 'It still has not arrived.');
});

test('`isInternal` in the body cannot make a customer reply internal', async () => {
  const ticketId = await makeTicket();

  // The field does not exist in the contract, so it is stripped. The assertion
  // is on the stored row: the flag the whole of rule #1 hangs on is not
  // reachable from a customer-facing request.
  await reply(ticketId, { body: 'A reply.', isInternal: true, senderType: 'AGENT' });

  const row = await prisma.message.findFirstOrThrow({
    where: { ticketId },
    select: { isInternal: true, senderType: true },
  });

  assert.equal(row.isInternal, false);
  assert.equal(row.senderType, 'CUSTOMER');
});

test('a customerId in the body cannot file the reply against somebody else', async () => {
  const ticketId = await makeTicket();

  await reply(ticketId, { body: 'A reply.', customerId: otherCustomerId });

  const row = await prisma.message.findFirstOrThrow({
    where: { ticketId },
    select: { authorCustomerId: true },
  });

  assert.equal(row.authorCustomerId, customerId);
});

test('a customer cannot reply to somebody else’s request', async () => {
  const theirs = await makeTicket({ customerId: otherCustomerId });

  const { status } = await reply(theirs, { body: 'Not mine.' });

  // 404, not 403 — a 403 would confirm the request exists.
  assert.equal(status, 404);
  assert.equal(await prisma.message.count({ where: { ticketId: theirs } }), 0);
});

test('a customer cannot open somebody else’s request', async () => {
  const theirs = await makeTicket({ customerId: otherCustomerId });

  assert.equal(
    (await call('GET', `/portal/tickets/${theirs}`, { token: portalToken })).status,
    404,
  );
  // And the owner can.
  assert.equal(
    (await call('GET', `/portal/tickets/${theirs}`, { token: otherPortalToken })).status,
    200,
  );
});

test('validation — an empty reply is refused and nothing is written', async () => {
  const ticketId = await makeTicket();

  for (const body of [{ body: '' }, { body: '   ' }, {}]) {
    assert.equal((await reply(ticketId, body)).status, 422, JSON.stringify(body));
  }

  assert.equal(await prisma.message.count({ where: { ticketId } }), 0);
});

// ---------------------------------------------------------------------------
// AC2 — nothing internal, on the read and after the write
// ---------------------------------------------------------------------------

test('AC2 — an internal note and its attachment stay invisible after the customer replies', async () => {
  const ticketId = await makeTicket();

  const note = await prisma.message.create({
    data: {
      ticketId,
      senderType: 'AGENT',
      authorUserId: agentUserId,
      body: 'Internal: customer is threatening a chargeback.',
      isInternal: true,
      channel: 'EMAIL',
    },
    select: { id: true },
  });

  await prisma.attachment.create({
    data: {
      messageId: note.id,
      ticketId,
      fileName: 'internal-escalation.pdf',
      contentType: 'application/pdf',
      sizeBytes: 512,
      storageKey: `reply-test-${run}-${randomUUID()}`,
      uploadedById: agentUserId,
    },
  });

  const { raw, body } = await reply(ticketId, { body: 'Any news?' });

  // The write path returns the thread, so this is the rule #1 assertion on the
  // response a reply produces.
  assert.ok(!raw.includes('chargeback'), 'the internal note leaked');
  assert.ok(!raw.includes('internal-escalation.pdf'), 'the internal attachment leaked');
  assert.ok(!raw.includes(note.id));

  // One message visible: the customer's own.
  assert.equal(body.data!.messages.length, 1);
  assert.equal(body.data!.messageCount, 1);
});

test('AC3 — a support reply carries a first name and nothing more', async () => {
  const ticketId = await makeTicket();

  await prisma.message.create({
    data: {
      ticketId,
      senderType: 'AGENT',
      authorUserId: agentUserId,
      body: 'We are looking into it.',
      isInternal: false,
      channel: 'EMAIL',
    },
  });

  const { body, raw } = await call<PortalTicketDetail>('GET', `/portal/tickets/${ticketId}`, {
    token: portalToken,
  });

  const support = body.data!.messages.find((message) => message.author === 'support');

  assert.equal(support?.authorName, 'Layla');
  // No surname, no email address anywhere in the payload.
  assert.ok(!raw.includes(`Haddad-${run}`));
  assert.ok(!raw.includes('reply-agent-'));
});

test('the reply response carries no internal fields', async () => {
  const ticketId = await makeTicket();

  const { body } = await reply(ticketId, { body: 'Hello.' });

  const payload = body.data as unknown as Record<string, unknown>;

  for (const forbidden of [
    'sla',
    'slaPolicyName',
    'assigneeId',
    'assigneeName',
    'departmentId',
    'branchId',
    'escalatedAt',
    'escalatedToId',
    'reopenCount',
    'tags',
    'history',
    'priority',
    'channel',
  ]) {
    assert.equal(forbidden in payload, false, `${forbidden} is present in the reply response`);
  }
});

// ---------------------------------------------------------------------------
// US-47's reopen rule — the substance of this story
// ---------------------------------------------------------------------------

test('a reply to a RESOLVED request reopens it, moving to WAITING_FOR_AGENT', async () => {
  const ticketId = await makeTicket({ status: 'RESOLVED' });

  const { status, body } = await reply(ticketId, { body: 'This is not fixed.' });

  assert.equal(status, 201, JSON.stringify(body));

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { status: true, resolvedAt: true, reopenCount: true },
  });

  // RESOLVED -> WAITING_FOR_AGENT, resolvedAt cleared, reopenCount incremented.
  assert.equal(row.status, 'WAITING_FOR_AGENT');
  assert.equal(row.resolvedAt, null);
  assert.equal(row.reopenCount, 1);

  const entry = await prisma.ticketHistory.findFirstOrThrow({
    where: { ticketId, eventType: 'REOPENED' },
    select: { actorUserId: true, fromValue: true, toValue: true },
  });

  // Attributed to nobody: no member of staff reopened it.
  assert.equal(entry.actorUserId, null);
  assert.equal(entry.fromValue, 'RESOLVED');
  assert.equal(entry.toValue, 'WAITING_FOR_AGENT');

  assert.equal(body.data!.status, 'WAITING_FOR_AGENT');
});

test('a reply to a WAITING_FOR_AGENT request changes its status not at all', async () => {
  const ticketId = await makeTicket({ status: 'WAITING_FOR_AGENT' });

  await reply(ticketId, { body: 'One more thing.' });

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { status: true, reopenCount: true },
  });

  assert.equal(row.status, 'WAITING_FOR_AGENT');
  assert.equal(row.reopenCount, 0);
});

test('a reply to a WAITING_FOR_CUSTOMER request moves it to WAITING_FOR_AGENT', async () => {
  const ticketId = await makeTicket({ status: 'WAITING_FOR_CUSTOMER' });

  const { status, body } = await reply(ticketId, { body: 'Here is the info you requested.' });

  assert.equal(status, 201, JSON.stringify(body));

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { status: true },
  });

  assert.equal(row.status, 'WAITING_FOR_AGENT');
  assert.equal(body.data!.status, 'WAITING_FOR_AGENT');
});

test('a reply records when the customer last replied', async () => {
  const ticketId = await makeTicket();

  await reply(ticketId, { body: 'Still waiting.' });

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { lastCustomerReplyAt: true },
  });

  // A column US-6 added that nothing had written. Denormalisation, not a
  // lifecycle rule.
  assert.ok(row.lastCustomerReplyAt !== null);
});

// ---------------------------------------------------------------------------
// AC6 — plain-language events, and what they must not become
// ---------------------------------------------------------------------------

test('AC6 — the events are a customer-facing allowlist, not the ticket’s history', async () => {
  const ticketId = await makeTicket({ status: 'NEW' });

  // A realistic mix: two the customer should hear about, four they should not.
  await prisma.ticketHistory.createMany({
    data: [
      { ticketId, eventType: 'CREATED', actorUserId: agentUserId },
      { ticketId, eventType: 'ASSIGNED', field: 'assigneeId', toValue: agentUserId },
      {
        ticketId,
        eventType: 'PRIORITY_CHANGED',
        field: 'priority',
        fromValue: 'LOW',
        toValue: 'URGENT',
      },
      { ticketId, eventType: 'CATEGORY_CHANGED', field: 'categoryId', toValue: randomUUID() },
      {
        ticketId,
        eventType: 'ESCALATED',
        field: 'status',
        fromValue: 'OPEN',
        toValue: 'ESCALATED',
      },
      { ticketId, eventType: 'SLA_BREACHED', field: 'resolutionDueAt' },
    ],
  });

  const { body, raw } = await call<PortalTicketDetail>('GET', `/portal/tickets/${ticketId}`, {
    token: portalToken,
  });

  const kinds = body.data!.events.map((event) => event.kind);

  assert.deepEqual(kinds, ['received', 'assigned']);

  // None of the internal vocabulary travels — not the event names, not the
  // priority, not the escalation.
  for (const internal of [
    'PRIORITY_CHANGED',
    'CATEGORY_CHANGED',
    'ESCALATED',
    'SLA_BREACHED',
    'URGENT',
  ]) {
    assert.ok(!raw.includes(internal), `${internal} leaked into the portal payload`);
  }

  // And no actor, field or value on the events themselves.
  const event = body.data!.events[0] as unknown as Record<string, unknown>;

  for (const forbidden of ['actorName', 'actorUserId', 'field', 'fromValue', 'toValue']) {
    assert.equal(forbidden in event, false, `${forbidden} is present on a portal event`);
  }
});

test('AC6 — a status change the customer cannot see produces no event', async () => {
  const ticketId = await makeTicket();

  await prisma.ticketHistory.createMany({
    data: [
      // Both sides read as "In Progress", so there is nothing to tell them.
      {
        ticketId,
        eventType: 'STATUS_CHANGED',
        field: 'status',
        fromValue: 'OPEN',
        toValue: 'PENDING_INTERNAL',
      },
      // This one they can see.
      {
        ticketId,
        eventType: 'STATUS_CHANGED',
        field: 'status',
        fromValue: 'OPEN',
        toValue: 'PENDING_CUSTOMER',
      },
    ],
  });

  const { body } = await call<PortalTicketDetail>('GET', `/portal/tickets/${ticketId}`, {
    token: portalToken,
  });

  assert.deepEqual(
    body.data!.events.map((event) => event.kind),
    ['waiting_on_you'],
  );
});

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

test('an unauthenticated reply is rejected', async () => {
  const ticketId = await makeTicket();

  const { status } = await call('POST', `/portal/tickets/${ticketId}/messages`, {
    body: { body: 'Hello.' },
  });

  assert.equal(status, 401);
  assert.equal(await prisma.message.count({ where: { ticketId } }), 0);
});

test('a staff token cannot reply through the portal', async () => {
  const ticketId = await makeTicket();

  const { status } = await reply(ticketId, { body: 'Hello.' }, staffToken);

  assert.equal(status, 401);
  assert.equal(await prisma.message.count({ where: { ticketId } }), 0);
});

test('a portal token cannot use the staff reply endpoint', async () => {
  const ticketId = await makeTicket();

  const { status } = await call('POST', `/tickets/${ticketId}/messages`, {
    token: portalToken,
    body: { body: 'Hello.', isInternal: true },
  });

  assert.equal(status, 401);
  assert.equal(await prisma.message.count({ where: { ticketId } }), 0);
});
