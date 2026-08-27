/**
 * US-21 — portal sign-in, the server half.
 *
 * AC1 a customer gets a `crm-portal` token · AC2 a staff account is refused with
 * a message pointing at the staff login.
 *
 * AC3 and AC4 are the client's, and AC3 is largely unbuildable — see the plan.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LoginResponse } from '@crm/shared';

import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/index.js';
import { PasswordService } from './password.service.js';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;

const run = randomUUID().slice(0, 8);
const PASSWORD = 'PortalPassw0rd!';

let customerEmail: string;
let staffEmail: string;
let inactiveCustomerEmail: string;

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
}

async function post<T>(
  path: string,
  body: unknown,
): Promise<{ status: number; body: Envelope<T>; raw: string }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = await response.text();

  return {
    status: response.status,
    body: raw === '' ? {} : (JSON.parse(raw) as Envelope<T>),
    raw,
  };
}

async function get(path: string, token: string): Promise<number> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return response.status;
}

/** A user, optionally linked to a `Customer` — which is what makes it a portal account. */
async function makeAccount(
  label: string,
  options: { withCustomer: boolean; isActive?: boolean },
): Promise<string> {
  const email = `pl-${label}-${run}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await app.get(PasswordService).hash(PASSWORD),
      firstName: 'Nadia',
      lastName: `Portal-${label}`,
      isActive: options.isActive ?? true,
    },
    select: { id: true },
  });

  if (options.withCustomer) {
    await prisma.customer.create({
      data: {
        firstName: 'Nadia',
        lastName: `Portal-${label}`,
        email,
        userId: user.id,
      },
    });
  }

  return email;
}

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  prisma = app.get(PrismaService);

  customerEmail = await makeAccount('customer', { withCustomer: true });
  staffEmail = await makeAccount('staff', { withCustomer: false });
  inactiveCustomerEmail = await makeAccount('inactive', { withCustomer: true, isActive: false });
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// AC1 — portal login
// ---------------------------------------------------------------------------

test('AC1 — a customer signs in and the session is a portal session', async () => {
  const { status, body } = await post<LoginResponse>('/auth/portal/login', {
    email: customerEmail,
    password: PASSWORD,
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.data?.accessToken !== undefined);

  const session = await prisma.session.findFirstOrThrow({
    where: { user: { email: customerEmail } },
    orderBy: { createdAt: 'desc' },
    select: { audience: true },
  });

  // The audience comes from the endpoint that was called, never from the body.
  assert.equal(session.audience, 'crm-portal');
});

test('AC1 — the token it issues works on the portal and is refused by the staff API', async () => {
  const { body } = await post<LoginResponse>('/auth/portal/login', {
    email: customerEmail,
    password: PASSWORD,
  });

  const token = body.data!.accessToken;

  // US-82's boundary, reached through a real sign-in rather than a minted token.
  assert.equal(await get('/portal/tickets', token), 200);
  assert.equal(await get('/tickets', token), 401);
});

// ---------------------------------------------------------------------------
// AC2 — audience isolation
// ---------------------------------------------------------------------------

test('AC2 — a staff account on the portal form is refused, and no session is created', async () => {
  const before = await prisma.session.count({ where: { user: { email: staffEmail } } });

  const { status, body } = await post('/auth/portal/login', {
    email: staffEmail,
    password: PASSWORD,
  });

  // 422, not 403: the client switches on the code, and 403 already means
  // "deactivated" on the login form.
  assert.equal(status, 422);
  assert.equal(body.error?.code, 'UNPROCESSABLE');
  assert.match(body.error.message, /staff/i);

  // Refused before anything was minted, so there is no session and no refresh
  // cookie left behind.
  assert.equal(await prisma.session.count({ where: { user: { email: staffEmail } } }), before);
});

test('AC2 — the specific message is unreachable without the correct password', async () => {
  const { status, body } = await post('/auth/portal/login', {
    email: staffEmail,
    password: 'WrongPassw0rd!',
  });

  // The check runs *after* the password for exactly this reason: a specific
  // message reachable before it would enumerate staff accounts for anyone
  // guessing addresses.
  assert.equal(status, 401);
  assert.equal(body.error?.code, 'UNAUTHENTICATED');
  assert.ok(!/staff/i.test(body.error.message));
});

test('AC2 — a staff account still signs in at the staff endpoint', async () => {
  const { status } = await post<LoginResponse>('/auth/login', {
    email: staffEmail,
    password: PASSWORD,
  });

  // The portal refusal must not have broken the door it points at.
  assert.equal(status, 200);
});

test('a deactivated customer is refused 403, which stays distinct from 422', async () => {
  const { status, body } = await post('/auth/portal/login', {
    email: inactiveCustomerEmail,
    password: PASSWORD,
  });

  assert.equal(status, 403);
  assert.equal(body.error?.code, 'FORBIDDEN');
});
