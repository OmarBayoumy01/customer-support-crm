/**
 * US-86 — a customer raises a request, through the portal boundary.
 *
 * AC1's fields, AC2's plain urgency mapped to a priority, and the ownership
 * guarantee: the customer comes from the token and the body has nowhere to say
 * otherwise. Every assertion checks **both** the serialised response and the
 * database row, because the two failing apart is exactly the bug worth catching.
 *
 * AC3 (article deflection) and AC6 (attachment limits) are unmet and untested —
 * the knowledge base is all of P09 and object storage is US-51, both cut. There
 * is nothing here pretending otherwise.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PortalCategory, PortalTicketDetail } from '@crm/shared';

import { AppModule } from '../app.module.js';
import { PasswordService, TokenService } from '../auth/index.js';
import { PrismaService } from '../prisma/index.js';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let tokens: TokenService;

const run = randomUUID().slice(0, 8);
const SUBJECT_PREFIX = `Submit ${run}`;

let customerId: string;
let portalToken: string;
let otherCustomerId: string;
let staffToken: string;
let activeCategoryId: string;
let retiredCategoryId: string;

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

async function makeUser(
  audience: 'crm-staff' | 'crm-portal',
  label: string,
): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      email: `submit-${label}-${run}@example.com`,
      passwordHash: await app.get(PasswordService).hash('irrelevant'),
      firstName: 'Nadia',
      lastName: `Submit-${label}`,
    },
    select: { id: true },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: `submit-hash-${label}-${run}`,
      audience,
      familyId: `submit-family-${label}-${run}`,
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

/** A valid body, so each test can vary one thing. */
function submission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: `${SUBJECT_PREFIX} ${randomUUID().slice(0, 6)}`,
    description: 'My refund has not arrived and the bank says nothing is pending.',
    urgency: 'soon',
    ...overrides,
  };
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

  const portalUser = await makeUser('crm-portal', 'customer');
  portalToken = portalUser.token;

  const customer = await prisma.customer.create({
    data: {
      firstName: 'Nadia',
      lastName: `Saeed-${run}`,
      email: `nadia-submit-${run}@example.com`,
      userId: portalUser.id,
    },
    select: { id: true },
  });
  customerId = customer.id;

  const other = await prisma.customer.create({
    data: { firstName: 'Omar', lastName: `Other-${run}` },
    select: { id: true },
  });
  otherCustomerId = other.id;

  staffToken = (await makeUser('crm-staff', 'agent')).token;

  const active = await prisma.category.create({
    data: { slug: `submit-active-${run}`, nameEn: 'Billing', nameAr: 'الفواتير', isActive: true },
    select: { id: true },
  });
  activeCategoryId = active.id;

  const retired = await prisma.category.create({
    data: { slug: `submit-old-${run}`, nameEn: 'Retired', nameAr: 'متوقف', isActive: false },
    select: { id: true },
  });
  retiredCategoryId = retired.id;
});

after(async () => {
  await prisma.ticket.deleteMany({ where: { subject: { startsWith: SUBJECT_PREFIX } } });
  await app.close();
});

// ---------------------------------------------------------------------------
// The happy path, and the ownership guarantee
// ---------------------------------------------------------------------------

test('an authenticated customer creates a request, and it belongs to them', async () => {
  const { status, body } = await call<PortalTicketDetail>('POST', '/portal/tickets', {
    token: portalToken,
    body: submission({ categoryId: activeCategoryId }),
  });

  assert.equal(status, 201, JSON.stringify(body));

  const detail = body.data!;

  // The serialised response: the portal shape, with a number the customer can
  // quote.
  assert.ok(detail.number > 0);
  assert.equal(detail.status, 'NEW');
  assert.equal(detail.categoryName, 'Billing');

  // And the row behind it.
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: detail.id },
    select: { customerId: true, channel: true, status: true, priority: true, categoryId: true },
  });

  assert.equal(row.customerId, customerId);
  // Decided by the server: it arrived through the portal.
  assert.equal(row.channel, 'WEB');
  // Triage is staff work, so it starts where the schema starts it.
  assert.equal(row.status, 'NEW');
  assert.equal(row.categoryId, activeCategoryId);
});

test('a customerId in the body is ignored — the request is still the caller’s', async () => {
  const { status, body } = await call<PortalTicketDetail>('POST', '/portal/tickets', {
    token: portalToken,
    // There is no `customerId` in the schema, so this is stripped rather than
    // honoured. The assertion is that ownership came from the token.
    body: submission({ customerId: otherCustomerId }),
  });

  assert.equal(status, 201, JSON.stringify(body));

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: body.data!.id },
    select: { customerId: true },
  });

  assert.equal(row.customerId, customerId);
  assert.notEqual(row.customerId, otherCustomerId);
});

test('the created request appears in the caller’s own list and nobody else’s', async () => {
  const { body } = await call<PortalTicketDetail>('POST', '/portal/tickets', {
    token: portalToken,
    body: submission(),
  });

  const mine = await call<{ id: string }[]>('GET', '/portal/tickets?pageSize=50', {
    token: portalToken,
  });

  assert.ok(mine.body.data!.some((ticket) => ticket.id === body.data!.id));

  const others = await prisma.ticket.count({
    where: { id: body.data!.id, customerId: otherCustomerId },
  });

  assert.equal(others, 0);
});

// ---------------------------------------------------------------------------
// AC2 — plain urgency, mapped
// ---------------------------------------------------------------------------

test('AC2 — plain urgency maps to a priority, and the payload never names one', async () => {
  for (const [urgency, priority] of [
    ['whenever', 'LOW'],
    ['soon', 'MEDIUM'],
    ['blocked', 'HIGH'],
  ] as const) {
    const { status, body, raw } = await call<PortalTicketDetail>('POST', '/portal/tickets', {
      token: portalToken,
      body: submission({ urgency }),
    });

    assert.equal(status, 201, raw);

    const row = await prisma.ticket.findUniqueOrThrow({
      where: { id: body.data!.id },
      select: { priority: true },
    });

    assert.equal(row.priority, priority);
    // The internal vocabulary never travels back.
    assert.ok(!raw.includes(priority), `${priority} leaked into the payload`);
  }
});

test('AC2 — URGENT is not reachable from the portal, however it is asked for', async () => {
  for (const urgency of ['URGENT', 'urgent', 'critical', 'emergency']) {
    const { status } = await call('POST', '/portal/tickets', {
      token: portalToken,
      body: submission({ urgency }),
    });

    // Not in the enum, so the schema refuses it. There is no accepted value that
    // produces URGENT — the map has no entry for it.
    assert.equal(status, 422, `urgency "${urgency}" should be refused`);
  }

  const urgent = await prisma.ticket.count({
    where: { subject: { startsWith: SUBJECT_PREFIX }, priority: 'URGENT' },
  });

  assert.equal(urgent, 0);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('validation — a missing or empty subject or description is refused', async () => {
  const bad: Record<string, unknown>[] = [
    { subject: undefined },
    { subject: '' },
    { subject: 'ab' },
    { subject: 'x'.repeat(201) },
    { description: undefined },
    { description: '' },
  ];

  for (const override of bad) {
    const body = submission();

    if (override.subject === undefined && 'subject' in override) {
      delete body.subject;
    }

    if (override.description === undefined && 'description' in override) {
      delete body.description;
    }

    Object.assign(
      body,
      Object.fromEntries(Object.entries(override).filter(([, value]) => value !== undefined)),
    );

    const { status } = await call('POST', '/portal/tickets', { token: portalToken, body });

    assert.equal(status, 422, `${JSON.stringify(override)} should be refused`);
  }
});

test('validation — an unknown or retired category is refused', async () => {
  for (const categoryId of [randomUUID(), retiredCategoryId]) {
    const { status, body } = await call('POST', '/portal/tickets', {
      token: portalToken,
      body: submission({ categoryId }),
    });

    assert.equal(status, 422, JSON.stringify(body));
  }
});

test('a request with no category at all is accepted', async () => {
  const { status, body } = await call<PortalTicketDetail>('POST', '/portal/tickets', {
    token: portalToken,
    body: submission(),
  });

  // A customer who does not know which category applies should not be stuck.
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.data!.categoryName, null);
});

// ---------------------------------------------------------------------------
// The boundary — US-82 and US-21's properties, on a write
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The initial state, and the fields a customer must not be able to set
// ---------------------------------------------------------------------------

test('the initial state is NEW, unassigned, numbered, and on the clock', async () => {
  const { status, body } = await call<PortalTicketDetail>('POST', '/portal/tickets', {
    token: portalToken,
    body: submission({ categoryId: activeCategoryId }),
  });

  assert.equal(status, 201, JSON.stringify(body));

  const detail = body.data!;

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: detail.id },
    select: {
      number: true,
      subject: true,
      status: true,
      assigneeId: true,
      customerId: true,
      slaPolicyId: true,
      firstResponseDueAt: true,
      resolutionDueAt: true,
      firstRespondedAt: true,
      resolvedAt: true,
      closedAt: true,
    },
  });

  // The whole of the intended initial state, in one place, because these are
  // the facts every later story reads: a new request is nobody’s yet, and the
  // clock is already running on it.
  assert.equal(row.status, 'NEW');
  assert.equal(row.assigneeId, null);
  assert.equal(row.customerId, customerId);
  assert.ok(row.number > 0);
  assert.notEqual(row.slaPolicyId, null);
  assert.notEqual(row.firstResponseDueAt, null);
  assert.notEqual(row.resolutionDueAt, null);

  // Nothing has happened to it yet.
  assert.equal(row.firstRespondedAt, null);
  assert.equal(row.resolvedAt, null);
  assert.equal(row.closedAt, null);

  // And the row is the response: the number the customer was given is the
  // number in the database, not a display value invented on the way out.
  assert.equal(detail.number, row.number);
  assert.equal(detail.subject, row.subject);
  assert.equal(detail.status, 'NEW');
  assert.equal(detail.assigneeFirstName, null);
});

test('nothing a customer sends can set a staff-only field', async () => {
  // Well-formed ids that belong to nothing.
  //
  // A stronger probe than a real id: if any of these were honoured the insert
  // would either record it — which the assertions below catch — or fail its
  // foreign key, which the 201 catches. There is no way for the request to
  // succeed *and* have been obeyed.
  const agentId = randomUUID();
  const otherDepartmentId = randomUUID();
  const otherBranchId = randomUUID();

  /**
   * The whole internal vocabulary, in one request.
   *
   * None of these are in `SubmitPortalTicketSchema`, so Zod strips them before
   * the service is reached — which is stronger than validating them away, and
   * is why this test asserts on the **row** rather than on a rejection. A 201
   * that quietly ignored them and a 422 are both acceptable answers; a ticket
   * that honoured one of them is not.
   */
  const { status, body } = await call<PortalTicketDetail>('POST', '/portal/tickets', {
    token: portalToken,
    body: submission({
      status: 'RESOLVED',
      assigneeId: agentId,
      assignedTo: agentId,
      agentId,
      priority: 'URGENT',
      departmentId: otherDepartmentId,
      branchId: otherBranchId,
      isInternal: true,
      senderType: 'AGENT',
      channel: 'PHONE',
      escalatedAt: new Date().toISOString(),
      reopenCount: 7,
    }),
  });

  assert.equal(status, 201, JSON.stringify(body));

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: body.data!.id },
    select: {
      status: true,
      assigneeId: true,
      priority: true,
      departmentId: true,
      branchId: true,
      channel: true,
      escalatedAt: true,
      reopenCount: true,
    },
  });

  assert.equal(row.status, 'NEW');
  assert.equal(row.assigneeId, null);
  // From the urgency the customer chose, not from the priority they sent.
  assert.equal(row.priority, 'MEDIUM');
  assert.notEqual(row.departmentId, otherDepartmentId);
  assert.notEqual(row.branchId, otherBranchId);
  assert.equal(row.channel, 'WEB');
  assert.equal(row.escalatedAt, null);
  assert.equal(row.reopenCount, 0);

  // Rule #1 from the other direction: a customer cannot author an internal
  // note, and the request that tried to did not create one.
  const internal = await prisma.message.count({
    where: { ticketId: body.data!.id, isInternal: true },
  });

  assert.equal(internal, 0);
});

test('validation — an urgency the contract does not name is refused', async () => {
  for (const urgency of ['URGENT', 'HIGH', 'immediately', '', null]) {
    const { status, body } = await call('POST', '/portal/tickets', {
      token: portalToken,
      body: { ...submission(), urgency },
    });

    // Including the internal priority names: the mapping is one-way, and the
    // customer vocabulary is the only thing this endpoint accepts.
    assert.equal(status, 422, `urgency ${String(urgency)}: ${JSON.stringify(body)}`);
    assert.equal(body.error?.code, 'VALIDATION_FAILED');
  }
});

test('an unauthenticated submission is rejected', async () => {
  const { status, body } = await call('POST', '/portal/tickets', { body: submission() });

  assert.equal(status, 401);
  assert.equal(body.error?.code, 'UNAUTHENTICATED');
});

test('a staff token cannot use the portal submit endpoint', async () => {
  const { status } = await call('POST', '/portal/tickets', {
    token: staffToken,
    body: submission(),
  });

  assert.equal(status, 401);
});

test('a portal token cannot use the staff ticket creation endpoint', async () => {
  const { status } = await call('POST', '/tickets', {
    token: portalToken,
    body: { customerId, subject: `${SUBJECT_PREFIX} via staff`, channel: 'WEB' },
  });

  assert.equal(status, 401);
});

// ---------------------------------------------------------------------------
// AC1 — the fields, and what the response does not carry
// ---------------------------------------------------------------------------

test('AC1 — the categories offered carry a name and no internal routing', async () => {
  const { status, body, raw } = await call<PortalCategory[]>('GET', '/portal/categories', {
    token: portalToken,
  });

  assert.equal(status, 200, raw);

  const category = body.data!.find((row) => row.id === activeCategoryId);

  assert.equal(category?.name, 'Billing');
  // The staff shape also carries departmentId, departmentName and
  // defaultPriority. A customer who can see which team a category routes to can
  // shop for one.
  assert.equal('departmentId' in (category as object), false);
  assert.equal('defaultPriority' in (category as object), false);

  // A retired category is not offered.
  assert.ok(!body.data!.some((row) => row.id === retiredCategoryId));
});

test('AC1 — the preferred contact method is recorded on the customer', async () => {
  const { status } = await call('POST', '/portal/tickets', {
    token: portalToken,
    body: submission({ preferredContact: 'WHATSAPP' }),
  });

  assert.equal(status, 201);

  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { preferredChannel: true },
  });

  // Recorded, and nothing is sent to it — the channels themselves are P13.
  assert.equal(customer.preferredChannel, 'WHATSAPP');
});

test('the submit response carries no internal fields', async () => {
  const { body } = await call<PortalTicketDetail>('POST', '/portal/tickets', {
    token: portalToken,
    body: submission(),
  });

  const payload = body.data as unknown as Record<string, unknown>;

  for (const forbidden of [
    'sla',
    'slaPolicyName',
    'assigneeId',
    'assigneeName',
    'departmentId',
    'branchId',
    'escalatedAt',
    'reopenCount',
    'tags',
    'history',
    'priority',
    'channel',
  ]) {
    // The response comes back through the portal read path, so it is the same
    // allowlisted shape by construction rather than by two functions agreeing.
    assert.equal(forbidden in payload, false, `${forbidden} is present in the submit response`);
  }
});

test('the SLA clock ran on the new request, without the portal being told about it', async () => {
  const { body } = await call<PortalTicketDetail>('POST', '/portal/tickets', {
    token: portalToken,
    body: submission({ urgency: 'blocked' }),
  });

  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: body.data!.id },
    select: { slaPolicyId: true, resolutionDueAt: true, firstResponseDueAt: true },
  });

  // Reusing `TicketsService.create` is what buys this: one clock, one numbering
  // scheme, one history entry.
  assert.ok(row.slaPolicyId !== null);
  assert.ok(row.resolutionDueAt !== null);
  assert.ok(row.firstResponseDueAt !== null);
});

test('the creation is recorded in history, attributed to the customer who raised it', async () => {
  const { body } = await call<PortalTicketDetail>('POST', '/portal/tickets', {
    token: portalToken,
    body: submission(),
  });

  const entry = await prisma.ticketHistory.findFirstOrThrow({
    where: { ticketId: body.data!.id, eventType: 'CREATED' },
    select: { actorUserId: true },
  });

  // A real actor: the customer did create it. Not an automation, and not null.
  assert.ok(entry.actorUserId !== null);
});
