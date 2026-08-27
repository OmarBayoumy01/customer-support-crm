/**
 * One login endpoint, and the audience comes from the account.
 *
 * US-21 built a second endpoint so that a customer got a portal token and a
 * staff member a staff one — the audience being decided by **which URL was
 * called**. There is one URL now and the audience is decided by **which kind of
 * account signed in**, which is stricter: a client cannot prefer an audience it
 * has no endpoint for.
 *
 * AC1 survives as written — a customer gets a `crm-portal` token, and it works on
 * the portal and is refused by the staff API. **AC2 is superseded**: there is no
 * portal form left to refuse a staff account at, and refusing was only ever a
 * consequence of there being two doors.
 *
 * What is asserted here is the boundary itself, which never was the form: the
 * token. A portal token is refused by every staff route and a staff token by
 * every portal route.
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
): Promise<{ status: number; body: Envelope<T>; raw: string; cookies: string[] }> {
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
    // `getSetCookie` rather than `get('set-cookie')`: a single header value
    // would hide a second cookie, and the assertion is about *no* cookie.
    cookies: response.headers.getSetCookie(),
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

test('AC1 — a customer signs in at the only endpoint and gets a portal session', async () => {
  const { status, body } = await post<LoginResponse>('/auth/login', {
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

  // The audience comes from the account, never from the request. There is one
  // endpoint, so there is nothing here a client could have chosen.
  assert.equal(session.audience, 'crm-portal');
});

test('AC1 — a customer’s token works on the portal and is refused by the staff API', async () => {
  const { body } = await post<LoginResponse>('/auth/login', {
    email: customerEmail,
    password: PASSWORD,
  });

  const token = body.data!.accessToken;

  // US-82's boundary, reached through a real sign-in rather than a minted token.
  assert.equal(await get('/portal/tickets', token), 200);
  assert.equal(await get('/tickets', token), 401);
});

// ---------------------------------------------------------------------------
// The audience is a property of the account
// ---------------------------------------------------------------------------

test('a staff account at the same endpoint gets a staff session', async () => {
  const { status, body } = await post<LoginResponse>('/auth/login', {
    email: staffEmail,
    password: PASSWORD,
  });

  assert.equal(status, 200, JSON.stringify(body));

  const session = await prisma.session.findFirstOrThrow({
    where: { user: { email: staffEmail } },
    orderBy: { createdAt: 'desc' },
    select: { audience: true },
  });

  assert.equal(session.audience, 'crm-staff');
  // And the response says so, which is what the client routes on.
  assert.equal(body.data?.audience, 'crm-staff');
});

test('the client cannot ask for an audience it does not belong to', async () => {
  // The body is the only channel a client has, and there is no field for this.
  // Sending one anyway must change nothing: Zod strips what the schema does
  // not name, and the audience is read off the account regardless.
  const { status, body } = await post<LoginResponse>('/auth/login', {
    email: customerEmail,
    password: PASSWORD,
    audience: 'crm-staff',
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data?.audience, 'crm-portal');

  const session = await prisma.session.findFirstOrThrow({
    where: { user: { email: customerEmail } },
    orderBy: { createdAt: 'desc' },
    select: { audience: true },
  });

  assert.equal(session.audience, 'crm-portal');
});

test('the removed portal endpoint is gone rather than quietly still working', async () => {
  // A second door left standing is a second thing to keep in step. If it comes
  // back it should come back deliberately, and this fails if it does.
  const response = await fetch(`${baseUrl}/auth/portal/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: customerEmail, password: PASSWORD }),
  });

  assert.equal(response.status, 404);
});

test('a wrong password is still refused generically, for either kind of account', async () => {
  const asCustomer = await post('/auth/login', {
    email: customerEmail,
    password: 'WrongPassw0rd!',
  });

  const asStaff = await post('/auth/login', {
    email: staffEmail,
    password: 'WrongPassw0rd!',
  });

  const unknown = await post('/auth/login', {
    email: `pl-nobody-${run}@example.com`,
    password: PASSWORD,
  });

  // US-14 AC2. The audience decision reads the account, so this is the
  // assertion that keeps it from becoming an enumeration oracle.
  for (const attempt of [asCustomer, asStaff, unknown]) {
    assert.equal(attempt.status, 401);
    assert.equal(attempt.body.error?.code, 'UNAUTHENTICATED');
    assert.equal(attempt.body.error.message, asCustomer.body.error?.message);
  }
});

test('a refused sign-in leaves no session and no refresh cookie', async () => {
  const before = await prisma.session.count({ where: { user: { email: customerEmail } } });

  const { status, cookies } = await post('/auth/login', {
    email: customerEmail,
    password: 'WrongPassw0rd!',
  });

  assert.equal(status, 401);
  assert.equal(await prisma.session.count({ where: { user: { email: customerEmail } } }), before);
  assert.deepEqual(
    cookies.filter((cookie) => cookie.startsWith('refresh_token=')),
    [],
  );
});

test('neither token can reach the other application', async () => {
  const asCustomer = await post<LoginResponse>('/auth/login', {
    email: customerEmail,
    password: PASSWORD,
  });

  const asStaff = await post<LoginResponse>('/auth/login', {
    email: staffEmail,
    password: PASSWORD,
  });

  const portalToken = asCustomer.body.data!.accessToken;
  const staffToken = asStaff.body.data!.accessToken;

  // The boundary, which was never the form and is unchanged by removing it.
  assert.equal(await get('/portal/tickets', portalToken), 200);
  assert.equal(await get('/tickets', portalToken), 401);
  assert.equal(await get('/tickets/team/overview', portalToken), 401);

  assert.equal(await get('/portal/tickets', staffToken), 401);
});
test('a deactivated customer is refused 403, which stays distinct from 422', async () => {
  const { status, body } = await post('/auth/login', {
    email: inactiveCustomerEmail,
    password: PASSWORD,
  });

  assert.equal(status, 403);
  assert.equal(body.error?.code, 'FORBIDDEN');
});
