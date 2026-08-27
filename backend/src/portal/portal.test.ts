/**
 * US-82 — the customer-scoped portal API.
 *
 * AC1 own scope in the query · AC2 internal data absent from the payload ·
 * AC3 status translation · AC4 audience enforcement both ways · AC5 throttling.
 *
 * **The first test in this file is the regression test the project's first
 * non-negotiable rule demands.** It asserts against the serialised JSON rather
 * than a service return value, because the rule is about what leaves the process.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PortalTicket, PortalTicketDetail } from '@crm/shared';

import { AppModule } from '../app.module.js';
import { PasswordService, TokenService } from '../auth/index.js';
import { PrismaService } from '../prisma/index.js';
import { RedisService } from '../redis/index.js';
import { SlaClockService } from '../sla/index.js';
import { PortalThrottleService } from './portal-throttle.service.js';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let tokens: TokenService;
let clock: SlaClockService;

const run = randomUUID().slice(0, 8);
const SUBJECT_PREFIX = `Portal ${run}`;

/** The signed-in customer. */
let customerId: string;
let portalToken: string;
/** Another customer, whose tickets must never be visible to the first.  */
let otherCustomerId: string;
/** A staff agent — for the wrong-audience half of AC4. */
let staffToken: string;
let agentUserId: string;
/** A portal user with no linked customer record — the fail-closed path. */
let orphanPortalToken: string;

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
  pagination?: { total: number };
}

async function call<T>(
  path: string,
  options: { token?: string } = {},
): Promise<{ status: number; body: Envelope<T>; raw: string }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: options.token === undefined ? {} : { authorization: `Bearer ${options.token}` },
  });

  const raw = await response.text();

  return {
    status: response.status,
    body: raw === '' ? {} : (JSON.parse(raw) as Envelope<T>),
    raw,
  };
}

/** A user plus a session, and an access token for the given audience. */
async function makeUser(
  audience: 'crm-staff' | 'crm-portal',
  label: string,
): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      email: `portal-${label}-${run}@example.com`,
      passwordHash: await app.get(PasswordService).hash('irrelevant'),
      firstName: 'Layla',
      lastName: `Haddad-${label}`,
    },
    select: { id: true },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: `portal-hash-${label}-${run}`,
      audience,
      familyId: `portal-family-${label}-${run}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
    select: { id: true },
  });

  const token = await tokens.signAccessToken({
    userId: user.id,
    roles: [],
    sessionId: session.id,
    audience,
  });

  return { id: user.id, token };
}

type InternalStatus =
  'NEW' | 'OPEN' | 'PENDING_CUSTOMER' | 'PENDING_INTERNAL' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

async function makeTicket(
  overrides: { customerId?: string; status?: InternalStatus } = {},
): Promise<string> {
  const row = await prisma.ticket.create({
    data: {
      subject: `${SUBJECT_PREFIX} ${randomUUID().slice(0, 6)}`,
      description: 'The refund never arrived.',
      customerId: overrides.customerId ?? customerId,
      status: overrides.status ?? 'OPEN',
      priority: 'MEDIUM',
    },
    select: { id: true },
  });

  await clock.applyOnCreate(row.id);

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
  clock = app.get(SlaClockService);

  const portalUser = await makeUser('crm-portal', 'customer');
  portalToken = portalUser.token;

  const customer = await prisma.customer.create({
    data: {
      firstName: 'Nadia',
      lastName: `Saeed-${run}`,
      email: `nadia-${run}@example.com`,
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

  const staff = await makeUser('crm-staff', 'agent');
  agentUserId = staff.id;
  staffToken = staff.token;

  // A portal token whose user has no Customer row at all.
  orphanPortalToken = (await makeUser('crm-portal', 'orphan')).token;
});

after(async () => {
  await prisma.ticket.deleteMany({ where: { subject: { startsWith: SUBJECT_PREFIX } } });
  await app.close();
});

// ---------------------------------------------------------------------------
// Non-negotiable rule #1
// ---------------------------------------------------------------------------

test('RULE #1 — an internal note, its author and its attachment never reach the portal', async () => {
  const ticketId = await makeTicket();

  const reply = await prisma.message.create({
    data: {
      ticketId,
      senderType: 'AGENT',
      authorUserId: agentUserId,
      body: 'Your refund is on its way.',
      isInternal: false,
      channel: 'EMAIL',
    },
    select: { id: true },
  });

  const note = await prisma.message.create({
    data: {
      ticketId,
      senderType: 'AGENT',
      authorUserId: agentUserId,
      body: 'Customer is threatening a chargeback — escalate if they call again.',
      isInternal: true,
      channel: 'EMAIL',
    },
    select: { id: true },
  });

  // An attachment on the **internal** note. `Attachment` has no `isInternal` of
  // its own, so this is the vector that filtering messages alone does not close.
  await prisma.attachment.create({
    data: {
      messageId: note.id,
      ticketId,
      fileName: 'escalation-to-legal.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1_024,
      storageKey: `portal-test-${run}-${randomUUID()}`,
      uploadedById: agentUserId,
    },
  });

  const detail = await call<PortalTicketDetail>(`/portal/tickets/${ticketId}`, {
    token: portalToken,
  });

  assert.equal(detail.status, 200, detail.raw);

  // Asserted against the serialised response, because the rule is about what
  // leaves the process — not about what a service happened to return.
  assert.ok(!detail.raw.includes('chargeback'), 'the note body leaked');
  assert.ok(!detail.raw.includes('escalation-to-legal.pdf'), 'the note’s attachment leaked');
  assert.ok(!detail.raw.includes(note.id), 'the note’s id leaked');

  const messages = detail.body.data!.messages;

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, reply.id);
  assert.deepEqual(messages[0]?.attachments, []);

  // The count comes from the same filtered query. "2 messages" beside one
  // rendered message discloses that a second exists.
  assert.equal(detail.body.data!.messageCount, 1);

  // And the same through the paging endpoint, which is a second door onto the
  // same conversation.
  const page = await call<PortalTicketDetail['messages']>(`/portal/tickets/${ticketId}/messages`, {
    token: portalToken,
  });

  assert.equal(page.status, 200, page.raw);
  assert.ok(!page.raw.includes('chargeback'), 'the note body leaked through paging');
  assert.ok(!page.raw.includes('escalation-to-legal.pdf'), 'the attachment leaked through paging');
  assert.equal(page.body.pagination?.total, 1);
});

// ---------------------------------------------------------------------------
// AC1 — own scope
// ---------------------------------------------------------------------------

test('AC1 — the list contains only the caller’s own requests', async () => {
  await makeTicket();
  const theirs = await makeTicket({ customerId: otherCustomerId });

  const { status, body, raw } = await call<PortalTicket[]>('/portal/tickets?pageSize=50', {
    token: portalToken,
  });

  assert.equal(status, 200, raw);
  assert.ok(body.data!.length >= 1);
  assert.ok(!body.data!.some((ticket) => ticket.id === theirs));
});

test('AC1 — somebody else’s request answers 404, not 403', async () => {
  const theirs = await makeTicket({ customerId: otherCustomerId });

  const { status } = await call(`/portal/tickets/${theirs}`, { token: portalToken });

  // A 403 would confirm the ticket exists, which is itself a disclosure.
  assert.equal(status, 404);
});

test('AC1 — a portal user with no customer record is refused, never unscoped', async () => {
  const { status, body } = await call<PortalTicket[]>('/portal/tickets', {
    token: orphanPortalToken,
  });

  // Fails closed. The only two outcomes are a customer id or a refusal — there
  // is no path that returns an unfiltered list.
  assert.equal(status, 403);
  assert.equal(body.error?.code, 'FORBIDDEN');
});

// ---------------------------------------------------------------------------
// AC2 — internal data absent from the payload
// ---------------------------------------------------------------------------

test('AC2 — the internal fields are absent as keys, not merely null', async () => {
  const ticketId = await makeTicket();

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { assigneeId: agentUserId, escalatedAt: new Date() },
  });

  const { body } = await call<PortalTicketDetail>(`/portal/tickets/${ticketId}`, {
    token: portalToken,
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
    'escalatedToId',
    'reopenCount',
    'tags',
    'history',
    'customer',
  ]) {
    // Key absence, not a null value: a null field is a field a future change can
    // start filling in.
    assert.equal(forbidden in payload, false, `${forbidden} is present in the portal payload`);
  }
});

test('AC2 — the assignee is a first name and nothing more', async () => {
  const ticketId = await makeTicket();

  await prisma.ticket.update({ where: { id: ticketId }, data: { assigneeId: agentUserId } });

  const { body, raw } = await call<PortalTicketDetail>(`/portal/tickets/${ticketId}`, {
    token: portalToken,
  });

  assert.equal(body.data!.assigneeFirstName, 'Layla');
  // The surname is the rest of the staff directory, and AC2 stops at a first
  // name.
  assert.ok(!raw.includes('Haddad-agent'));
});

// ---------------------------------------------------------------------------
// AC3 — status translation
// ---------------------------------------------------------------------------

test('AC3 — every internal status maps to the customer-facing set', async () => {
  const expected: [InternalStatus, string][] = [
    ['NEW', 'OPEN'],
    ['OPEN', 'IN_PROGRESS'],
    ['PENDING_INTERNAL', 'IN_PROGRESS'],
    ['ESCALATED', 'IN_PROGRESS'],
    ['PENDING_CUSTOMER', 'WAITING_ON_YOU'],
    ['RESOLVED', 'RESOLVED'],
    ['CLOSED', 'CLOSED'],
  ];

  for (const [internal, portal] of expected) {
    const ticketId = await makeTicket({ status: internal });

    const { body, raw } = await call<PortalTicketDetail>(`/portal/tickets/${ticketId}`, {
      token: portalToken,
    });

    assert.equal(body.data!.status, portal, `${internal} should read as ${portal}`);

    // The internal name must not appear anywhere in the payload — AC2's
    // "internal statuses" and AC3's mapping are the same requirement twice.
    if (internal === 'PENDING_INTERNAL' || internal === 'ESCALATED') {
      assert.ok(!raw.includes(internal), `${internal} leaked into the payload`);
    }
  }
});

test('AC3 — filtering by a customer-facing status filters in the query', async () => {
  await makeTicket({ status: 'PENDING_CUSTOMER' });

  const { body } = await call<PortalTicket[]>('/portal/tickets?status=WAITING_ON_YOU&pageSize=50', {
    token: portalToken,
  });

  assert.ok(body.data!.length >= 1);
  assert.ok(body.data!.every((ticket) => ticket.status === 'WAITING_ON_YOU'));
});

// ---------------------------------------------------------------------------
// AC4 — audience enforcement, both directions
// ---------------------------------------------------------------------------

test('AC4 — a staff token is rejected by a portal endpoint', async () => {
  const { status } = await call('/portal/tickets', { token: staffToken });

  assert.equal(status, 401);
});

test('AC4 — a portal token is rejected by a staff endpoint', async () => {
  const { status } = await call('/tickets', { token: portalToken });

  assert.equal(status, 401);
});

test('AC4 — an unauthenticated portal request is 401', async () => {
  const { status, body } = await call('/portal/tickets');

  // **This test is load-bearing.** The portal controller carries `@Public()` to
  // bypass the global staff guard, so if `PortalAuthGuard` were ever dropped
  // this endpoint would be open to the internet and this is what would catch it.
  assert.equal(status, 401);
  assert.equal(body.error?.code, 'UNAUTHENTICATED');
});

// ---------------------------------------------------------------------------
// AC5 — rate limiting
// ---------------------------------------------------------------------------

test('AC5 — the account limit answers 429 once the window is exceeded', async () => {
  const throttle = app.get(PortalThrottleService);
  const before = throttle.degradations();

  // The limit is read from config at construction, so the window is exercised
  // by exhausting the counter directly rather than by firing 120 requests.
  let limited = 0;

  for (let i = 0; i < 500; i += 1) {
    try {
      await throttle.check({ customerId, ip: undefined });
    } catch {
      limited += 1;
      break;
    }
  }

  if (throttle.degradations() > before) {
    // Redis was unavailable, so the limit failed open on purpose. Asserting a
    // 429 here would be asserting that the fail-open path does not work.
    assert.ok(true, 'throttle degraded; fail-open path taken');

    return;
  }

  assert.equal(limited, 1, 'the account counter never tripped');

  // And the limit is visible through the API, not only through the service.
  const { status, body } = await call('/portal/tickets', { token: portalToken });

  assert.equal(status, 429);
  assert.equal(body.error?.code, 'RATE_LIMITED');

  // Cleared so the assertions above do not poison later runs in this suite.
  await app.get(RedisService).client.del(`portal:rate:account:${customerId}`);
});

test('AC5 — the IP counter is independent of the account counter', async () => {
  const throttle = app.get(PortalThrottleService);
  const before = throttle.degradations();
  const ip = `203.0.113.${String(Math.floor(Math.random() * 200) + 1)}`;

  await throttle.check({ customerId: `other-${run}`, ip });

  if (throttle.degradations() > before) {
    return;
  }

  const redis = app.get(RedisService);

  // One request counted against each, and neither key is the other's.
  assert.equal(await redis.client.get(`portal:rate:ip:${ip}`), '1');
  assert.equal(await redis.client.get(`portal:rate:account:other-${run}`), '1');

  await redis.client.del(`portal:rate:ip:${ip}`, `portal:rate:account:other-${run}`);
});
