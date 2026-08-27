/**
 * US-84 — the customer's own request list.
 *
 * AC2's filters (search, status, date and nothing else), the ownership isolation
 * they are applied inside, the empty case, paging, and the serialised shape.
 *
 * AC1, AC3 and AC5 are presentation and live in
 * `frontend/src/features/portal/portal-requests.test.tsx`. **AC4 (star rating) is
 * unmet** — rating is US-88, deferred, with no column and no endpoint — and there
 * is nothing here pretending otherwise.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PortalTicket } from '@crm/shared';

import { AppModule } from '../app.module.js';
import { PasswordService, TokenService } from '../auth/index.js';
import { PrismaService } from '../prisma/index.js';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let tokens: TokenService;

const run = randomUUID().slice(0, 8);
const MINE = `List ${run} mine`;
const THEIRS = `List ${run} theirs`;

let customerId: string;
let portalToken: string;
let otherCustomerId: string;
let staffToken: string;
/** A customer with a portal login and no requests at all — AC5's case. */
let emptyToken: string;

let refundTicketId: string;
let refundNumber: number;
let waitingTicketId: string;

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
  pagination?: { total: number; page: number; pageSize: number };
}

async function get<T>(
  path: string,
  token?: string,
): Promise<{ status: number; body: Envelope<T>; raw: string }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
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
      email: `list-${label}-${run}@example.com`,
      passwordHash: await app.get(PasswordService).hash('irrelevant'),
      firstName: 'Nadia',
      lastName: `List-${label}`,
    },
    select: { id: true },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: `list-hash-${label}-${run}`,
      audience: 'crm-portal',
      familyId: `list-family-${label}-${run}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
    select: { id: true },
  });

  const customer = await prisma.customer.create({
    data: {
      firstName: 'Nadia',
      lastName: `List-${label}`,
      email: `list-${label}-${run}@example.com`,
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

async function makeTicket(overrides: {
  subject: string;
  customerId?: string;
  status?: 'NEW' | 'OPEN' | 'PENDING_CUSTOMER' | 'ESCALATED' | 'RESOLVED';
  description?: string;
  daysAgo?: number;
}): Promise<{ id: string; number: number }> {
  const created = new Date(Date.now() - (overrides.daysAgo ?? 0) * 86_400_000);

  return prisma.ticket.create({
    data: {
      subject: overrides.subject,
      description: overrides.description ?? 'Something happened.',
      customerId: overrides.customerId ?? customerId,
      status: overrides.status ?? 'OPEN',
      priority: 'MEDIUM',
      channel: 'WEB',
      createdAt: created,
      updatedAt: created,
    },
    select: { id: true, number: true },
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
  tokens = app.get(TokenService);

  const mine = await makePortalCustomer('mine');
  customerId = mine.customerId;
  portalToken = mine.token;

  const other = await makePortalCustomer('other');
  otherCustomerId = other.customerId;

  emptyToken = (await makePortalCustomer('empty')).token;

  // Staff, for the wrong-audience case.
  const staffUser = await prisma.user.create({
    data: {
      email: `list-staff-${run}@example.com`,
      passwordHash: await app.get(PasswordService).hash('irrelevant'),
      firstName: 'Sami',
      lastName: `Staff-${run}`,
    },
    select: { id: true },
  });

  const staffSession = await prisma.session.create({
    data: {
      userId: staffUser.id,
      refreshTokenHash: `list-hash-staff-${run}`,
      audience: 'crm-staff',
      familyId: `list-family-staff-${run}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
    select: { id: true },
  });

  staffToken = await tokens.signAccessToken({
    userId: staffUser.id,
    roles: [],
    sessionId: staffSession.id,
    audience: 'crm-staff',
  });

  const refund = await makeTicket({
    subject: `${MINE} refund not arrived`,
    description: 'A very distinctive description phrase: zephyr',
    daysAgo: 10,
  });
  refundTicketId = refund.id;
  refundNumber = refund.number;

  const waiting = await makeTicket({
    subject: `${MINE} waiting on me`,
    status: 'PENDING_CUSTOMER',
    daysAgo: 2,
  });
  waitingTicketId = waiting.id;

  await makeTicket({ subject: `${MINE} escalated internally`, status: 'ESCALATED', daysAgo: 1 });
  await makeTicket({ subject: `${THEIRS} not yours`, customerId: otherCustomerId });
});

after(async () => {
  await prisma.ticket.deleteMany({ where: { subject: { startsWith: `List ${run}` } } });
  await app.close();
});

/** The caller's own list, filtered however the test asks. */
async function list(query: string, token = portalToken) {
  return get<PortalTicket[]>(`/portal/tickets?pageSize=50${query}`, token);
}

// ---------------------------------------------------------------------------
// Ownership isolation
// ---------------------------------------------------------------------------

test('only the caller’s own requests are listed', async () => {
  const { status, body } = await list('');

  assert.equal(status, 200, JSON.stringify(body));

  const subjects = body.data!.map((ticket) => ticket.subject);

  assert.ok(subjects.some((subject) => subject.startsWith(MINE)));
  assert.ok(!subjects.some((subject) => subject.startsWith(THEIRS)));
});

test('a customerId query parameter is ignored — the scope is still the token’s', async () => {
  const { body } = await list(`&customerId=${otherCustomerId}`);

  // There is no such field in the query contract, and the service takes the
  // customer as an argument the controller resolved from the token.
  assert.ok(!body.data!.some((ticket) => ticket.subject.startsWith(THEIRS)));
  assert.ok(body.data!.length > 0);
});

test('a customer with no requests gets an empty list, not an error — AC5', async () => {
  const { status, body } = await list('', emptyToken);

  assert.equal(status, 200);
  assert.deepEqual(body.data, []);
  assert.equal(body.pagination?.total, 0);
});

// ---------------------------------------------------------------------------
// AC2 — search
// ---------------------------------------------------------------------------

test('AC2 — search matches the subject', async () => {
  const { body } = await list('&q=refund');

  assert.equal(body.data!.length, 1);
  assert.equal(body.data![0]?.id, refundTicketId);
});

test('AC2 — search matches the request number a customer would quote', async () => {
  const { body } = await list(`&q=${String(refundNumber)}`);

  assert.ok(body.data!.some((ticket) => ticket.id === refundTicketId));
});

test('AC2 — search does not reach into descriptions or message bodies', async () => {
  await prisma.message.create({
    data: {
      ticketId: waitingTicketId,
      senderType: 'AGENT',
      body: 'Another distinctive phrase: quokka',
      isInternal: false,
      channel: 'EMAIL',
    },
  });

  // "zephyr" is only in a description; "quokka" only in a message body. Neither
  // is searched: a customer recognises a request by its subject or number, and
  // searching message text would have a portal query reading rows the
  // internal-note filter exists to keep out of reach.
  assert.equal((await list('&q=zephyr')).body.data!.length, 0);
  assert.equal((await list('&q=quokka')).body.data!.length, 0);
});

test('AC2 — a search that matches nothing returns an empty list', async () => {
  const { status, body } = await list('&q=nothingmatchesthis');

  assert.equal(status, 200);
  assert.deepEqual(body.data, []);
  assert.equal(body.pagination?.total, 0);
});

// ---------------------------------------------------------------------------
// AC2 — status and date
// ---------------------------------------------------------------------------

test('AC2 — the status filter uses the customer-facing name and hides the internal one', async () => {
  const { body, raw } = await list('&status=WAITING_ON_YOU');

  assert.equal(body.data!.length, 1);
  assert.equal(body.data![0]?.id, waitingTicketId);
  assert.equal(body.data![0]?.status, 'WAITING_ON_YOU');

  // The internal name never travels, even as a filter value's translation.
  assert.ok(!raw.includes('PENDING_CUSTOMER'));
});

test('AC2 — an escalated request reads as In Progress, never as escalated', async () => {
  const { body, raw } = await list('&status=IN_PROGRESS');

  assert.ok(body.data!.some((ticket) => ticket.subject.includes('escalated internally')));
  assert.ok(body.data!.every((ticket) => ticket.status === 'IN_PROGRESS'));
  assert.ok(!raw.includes('ESCALATED'));
});

test('AC2 — the date filter narrows by when the request was opened', async () => {
  const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();

  const recent = await list(`&createdFrom=${fiveDaysAgo}`);

  // The ten-day-old refund is outside the window; the newer ones are not.
  assert.ok(!recent.body.data!.some((ticket) => ticket.id === refundTicketId));
  assert.ok(recent.body.data!.length >= 2);

  const older = await list(`&createdTo=${fiveDaysAgo}`);

  assert.ok(older.body.data!.some((ticket) => ticket.id === refundTicketId));
});

test('AC2 — a date filter still cannot reach another customer’s requests', async () => {
  const longAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();

  const { body } = await list(`&createdFrom=${longAgo}`);

  // Scope and filter are the same `where`, so a wide filter cannot widen the
  // scope it is applied inside.
  assert.ok(!body.data!.some((ticket) => ticket.subject.startsWith(THEIRS)));
});

// ---------------------------------------------------------------------------
// Paging and shape
// ---------------------------------------------------------------------------

test('paging bounds the page while the total counts the whole scoped set', async () => {
  const { body } = await get<PortalTicket[]>('/portal/tickets?pageSize=1', portalToken);

  assert.equal(body.data!.length, 1);
  assert.equal(body.pagination?.pageSize, 1);
  // Three of mine, and the total must not include the other customer's.
  assert.equal(body.pagination?.total, 3);
});

test('AC1 — each row carries the fields the card renders, and nothing internal', async () => {
  const { body } = await list('&q=refund');

  const ticket = body.data![0]!;

  assert.equal(typeof ticket.number, 'number');
  assert.equal(typeof ticket.subject, 'string');
  assert.equal(typeof ticket.createdAt, 'string');
  assert.equal(typeof ticket.updatedAt, 'string');
  assert.ok('categoryName' in ticket);
  assert.ok('status' in ticket);

  const payload = ticket as unknown as Record<string, unknown>;

  for (const forbidden of [
    'sla',
    'assigneeId',
    'assigneeName',
    'departmentId',
    'branchId',
    'escalatedAt',
    'priority',
    'channel',
    'tags',
    'customerId',
  ]) {
    assert.equal(forbidden in payload, false, `${forbidden} is present in a portal list row`);
  }
});

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

test('an unauthenticated request is rejected', async () => {
  const { status, body } = await get('/portal/tickets');

  assert.equal(status, 401);
  assert.equal(body.error?.code, 'UNAUTHENTICATED');
});

test('a staff token cannot read the portal list', async () => {
  assert.equal((await get('/portal/tickets', staffToken)).status, 401);
});
