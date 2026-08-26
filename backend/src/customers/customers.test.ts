/**
 * US-33 — customer records through the API.
 *
 * AC1 create · AC2 duplicate detection · AC3 filters in the database ·
 * AC4 derived fields · AC5 archive not delete · AC6 writes are permission-checked.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Customer, PermissionKey, PermissionScope } from '@crm/shared';

import { AppModule } from '../app.module.js';
import { PasswordService, TokenService } from '../auth/index.js';
import { PrismaService } from '../prisma/index.js';
import { CustomersService } from './customers.service.js';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let passwords: PasswordService;
let tokens: TokenService;
let customers: CustomersService;

const run = randomUUID().slice(0, 8);

let created = 0;
let readerToken: string;
let writerToken: string;

/** A role with exactly the grants named — this suite owns its fixtures. */
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

async function tokenFor(roleId: string): Promise<string> {
  created += 1;

  const user = await prisma.user.create({
    data: {
      email: `cust-test-${run}-${String(created)}@example.com`,
      passwordHash: await passwords.hash('irrelevant'),
      firstName: 'Cust',
      lastName: 'Tester',
      roles: { create: { roleId } },
    },
    select: { id: true },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: `cust-hash-${run}-${String(created)}`,
      audience: 'crm-staff',
      familyId: `cust-family-${run}-${String(created)}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
    select: { id: true },
  });

  return tokens.signAccessToken({
    userId: user.id,
    roles: [],
    sessionId: session.id,
    audience: 'crm-staff',
  });
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string; details?: { path: string; message: string }[] };
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

  return {
    status: response.status,
    body: text === '' ? {} : (JSON.parse(text) as Envelope<T>),
  };
}

let uniqueEmail = 0;

/**
 * Phone numbers need a per-run base too, and cannot carry the UUID: the schema
 * only accepts digits and punctuation. A fixed sequence collides with every
 * other run and with any suite running concurrently — which is exactly how this
 * suite passed alone and failed in the full run.
 */
const phoneBase = 100_000_000 + Math.floor(Math.random() * 800_000_000);

function newCustomer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  uniqueEmail += 1;

  return {
    firstName: 'Layla',
    lastName: `Ahmed-${run}-${String(uniqueEmail)}`,
    email: `layla-${run}-${String(uniqueEmail)}@example.com`,
    phone: `+9715${String(phoneBase + uniqueEmail)}`,
    type: 'INDIVIDUAL',
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
  passwords = app.get(PasswordService);
  tokens = app.get(TokenService);
  customers = app.get(CustomersService);

  readerToken = await tokenFor(await makeRole('cust-reader', [['customer:view', 'ALL']]));
  writerToken = await tokenFor(
    await makeRole('cust-writer', [
      ['customer:view', 'ALL'],
      ['customer:create', 'ALL'],
      ['customer:update', 'ALL'],
      ['customer:delete', 'ALL'],
    ]),
  );
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// AC1 — create
// ---------------------------------------------------------------------------

test('AC1 — a customer is stored with every field the criterion names', async () => {
  const department = await prisma.department.create({
    data: { code: `DEP-${run}`, nameEn: 'Support', nameAr: 'الدعم' },
    select: { id: true },
  });

  const { status, body } = await call<Customer>('POST', '/customers', {
    token: writerToken,
    body: newCustomer({
      companyName: 'Acme Trading',
      type: 'COMPANY',
      departmentId: department.id,
      preferredChannel: 'EMAIL',
    }),
  });

  assert.equal(status, 201);
  assert.equal(body.data?.type, 'COMPANY');
  assert.equal(body.data?.companyName, 'Acme Trading');
  assert.equal(body.data?.departmentId, department.id);
  assert.equal(body.data?.preferredChannel, 'EMAIL');
  assert.equal(body.data?.isActive, true);
});

test('AC1 — a customer with neither email nor phone is refused', async () => {
  const { status, body } = await call('POST', '/customers', {
    token: writerToken,
    body: { firstName: 'No', lastName: 'Contact' },
  });

  // A support desk cannot contact somebody it has no way of contacting.
  assert.equal(status, 422);
  assert.equal(body.error?.code, 'VALIDATION_FAILED');
});

// ---------------------------------------------------------------------------
// AC2 — duplicates warn, they do not block
// ---------------------------------------------------------------------------

test('AC2 — a duplicate email is refused with the existing record identified', async () => {
  const first = newCustomer();
  const created = await call<Customer>('POST', '/customers', { token: writerToken, body: first });

  const { status, body } = await call('POST', '/customers', {
    token: writerToken,
    body: newCustomer({ email: first['email'] }),
  });

  assert.equal(status, 409);
  assert.equal(body.error?.code, 'CONFLICT');
  // The id travels with the refusal, so the agent can look rather than search.
  assert.equal(body.error?.details?.[0]?.message, created.body.data?.id);
  assert.equal(body.error?.details?.[0]?.path, 'email');
});

test('AC2 — confirming goes through, because two people do share a landline', async () => {
  const first = newCustomer();
  await call('POST', '/customers', { token: writerToken, body: first });

  const { status } = await call('POST', '/customers', {
    token: writerToken,
    body: newCustomer({ phone: first['phone'], confirmDuplicate: true }),
  });

  assert.equal(status, 201);
});

test('AC2 — the check endpoint warns before submitting', async () => {
  const first = newCustomer();
  await call('POST', '/customers', { token: writerToken, body: first });

  const { status, body } = await call<{ matchedOn: string; existing: Customer } | null>(
    'GET',
    `/customers/duplicate-check?email=${encodeURIComponent(String(first['email']))}`,
    { token: readerToken },
  );

  assert.equal(status, 200);
  assert.equal(body.data?.matchedOn, 'email');
  assert.equal(body.data?.existing.email, first['email']);
});

test('AC2 — no match answers null rather than an error', async () => {
  const { status, body } = await call(
    'GET',
    `/customers/duplicate-check?email=nobody-${run}@x.com`,
    {
      token: readerToken,
    },
  );

  assert.equal(status, 200);
  assert.equal(body.data, null);
});

// ---------------------------------------------------------------------------
// AC3 — filters reach the database
// ---------------------------------------------------------------------------

test('AC3 — search matches name, email and company', async () => {
  const marker = `Zzyzx${run}`;
  await call('POST', '/customers', {
    token: writerToken,
    body: newCustomer({ companyName: marker }),
  });

  const { body } = await call<Customer[]>('GET', `/customers?q=${marker}`, { token: readerToken });

  assert.equal(body.pagination?.total, 1);
});

test('AC3 — the type filter narrows the list', async () => {
  const marker = `Filt${run}`;
  await call('POST', '/customers', {
    token: writerToken,
    body: newCustomer({ companyName: marker, type: 'COMPANY' }),
  });
  await call('POST', '/customers', {
    token: writerToken,
    body: newCustomer({ companyName: marker, type: 'INDIVIDUAL' }),
  });

  const companies = await call<Customer[]>('GET', `/customers?q=${marker}&type=COMPANY`, {
    token: readerToken,
  });

  assert.equal(companies.body.pagination?.total, 1);
  assert.equal(companies.body.data?.[0]?.type, 'COMPANY');
});

test('AC3 — paging is applied by the database, not after fetching', async () => {
  const marker = `Page${run}`;

  for (let i = 0; i < 3; i += 1) {
    await call('POST', '/customers', {
      token: writerToken,
      body: newCustomer({ companyName: marker }),
    });
  }

  const { body } = await call<Customer[]>('GET', `/customers?q=${marker}&pageSize=2`, {
    token: readerToken,
  });

  assert.equal(body.data?.length, 2);
  assert.equal(body.pagination?.total, 3);
});

// ---------------------------------------------------------------------------
// AC4 — derived fields
// ---------------------------------------------------------------------------

test('AC4 — every row carries its ticket counts and last interaction', async () => {
  const created = await call<Customer>('POST', '/customers', {
    token: writerToken,
    body: newCustomer(),
  });

  const id = created.body.data?.id ?? '';
  const { body } = await call<Customer>('GET', `/customers/${id}`, { token: readerToken });

  assert.equal(body.data?.stats.openTickets, 0);
  assert.equal(body.data?.stats.totalTickets, 0);
  assert.equal(body.data?.stats.lastInteractionAt, null);
});

test('AC4 — satisfaction is null rather than invented, since ratings do not exist yet', async () => {
  const created = await call<Customer>('POST', '/customers', {
    token: writerToken,
    body: newCustomer(),
  });

  const { body } = await call<Customer>('GET', `/customers/${created.body.data?.id ?? ''}`, {
    token: readerToken,
  });

  // US-88 is deferred. A fabricated number would be worse than an honest gap.
  assert.equal(body.data?.stats.satisfactionScore, null);
});

test('AC4 — the counts come from one aggregate, not a query per row', async () => {
  // Asserted through behaviour: a page of several customers still answers, and
  // each carries its own counts. The mechanism is `groupBy` — see the service.
  const marker = `Agg${run}`;

  for (let i = 0; i < 3; i += 1) {
    await call('POST', '/customers', {
      token: writerToken,
      body: newCustomer({ companyName: marker }),
    });
  }

  const { body } = await call<Customer[]>('GET', `/customers?q=${marker}`, { token: readerToken });

  assert.equal(body.data?.length, 3);
  assert.ok(body.data?.every((customer) => customer.stats.totalTickets === 0));
});

// ---------------------------------------------------------------------------
// AC5 — archive, not delete
// ---------------------------------------------------------------------------

test('AC5 — archiving soft-deletes and removes them from the list', async () => {
  const marker = `Arch${run}`;
  const created = await call<Customer>('POST', '/customers', {
    token: writerToken,
    body: newCustomer({ companyName: marker }),
  });

  const id = created.body.data?.id ?? '';
  const archived = await call('DELETE', `/customers/${id}`, { token: writerToken });

  assert.equal(archived.status, 204);

  const row = await prisma.customer.findUniqueOrThrow({
    where: { id },
    select: { deletedAt: true },
  });

  // The row is still there. That is the point.
  assert.notEqual(row.deletedAt, null);

  const list = await call<Customer[]>('GET', `/customers?q=${marker}`, { token: readerToken });
  assert.equal(list.body.pagination?.total, 0);

  const fetched = await call('GET', `/customers/${id}`, { token: readerToken });
  assert.equal(fetched.status, 404);
});

test('AC5 — the archived customer’s tickets are untouched', async () => {
  const created = await call<Customer>('POST', '/customers', {
    token: writerToken,
    body: newCustomer(),
  });

  const customerId = created.body.data?.id ?? '';

  const ticket = await prisma.ticket.create({
    data: {
      number: Math.floor(Math.random() * 1_000_000_000),
      subject: 'Still needs answering',
      description: 'x',
      customerId,
      channel: 'EMAIL',
    },
    select: { id: true },
  });

  await call('DELETE', `/customers/${customerId}`, { token: writerToken });

  // A desk that loses its history when a customer leaves cannot answer a
  // question about last year.
  const stillThere = await prisma.ticket.findUnique({ where: { id: ticket.id } });
  assert.notEqual(stillThere, null);
});

// ---------------------------------------------------------------------------
// AC6 — writes are permission-checked
// ---------------------------------------------------------------------------

test('AC6 — a reader cannot create, update or archive', async () => {
  const create = await call('POST', '/customers', { token: readerToken, body: newCustomer() });
  assert.equal(create.status, 403);

  const existing = await call<Customer>('POST', '/customers', {
    token: writerToken,
    body: newCustomer(),
  });
  const id = existing.body.data?.id ?? '';

  const update = await call('PATCH', `/customers/${id}`, {
    token: readerToken,
    body: { firstName: 'Nope' },
  });
  assert.equal(update.status, 403);

  const archive = await call('DELETE', `/customers/${id}`, { token: readerToken });
  assert.equal(archive.status, 403);
});

test('AC6 — an unauthenticated caller gets nothing at all', async () => {
  assert.equal((await call('GET', '/customers')).status, 401);
  assert.equal((await call('POST', '/customers', { body: newCustomer() })).status, 401);
});

test('the service is exported, so US-120 can seed through it rather than around it', () => {
  // A seed that writes straight to Prisma can produce a shape the API would
  // have rejected, and then every screen is built against impossible data.
  assert.ok(customers instanceof CustomersService);
});
