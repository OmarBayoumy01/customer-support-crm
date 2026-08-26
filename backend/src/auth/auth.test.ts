/**
 * US-14 end to end, against a real Postgres and Redis.
 *
 * AC1 (successful login), AC2 (indistinguishable failures), AC3 (deactivated
 * account), AC4 (nothing leaks the hash), AC5 (brute-force lockout).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/index.js';
import { RedisService } from '../redis/index.js';
import { PasswordService } from './password.service.js';
import { REFRESH_COOKIE } from './cookies.js';
import { TokenService } from './token.service.js';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let passwords: PasswordService;
let redis: RedisService;

/** Namespaces this run's rows and cache keys — both databases persist. */
const run = randomUUID().slice(0, 8);

const PASSWORD = 'correct-horse-battery-staple';
const WRONG_PASSWORD = 'incorrect-horse-battery-staple';

let created = 0;
let roleId: string;

interface LoginBody {
  data?: {
    accessToken: string;
    expiresIn: number;
    user: { id: string; email: string; roles: string[] };
    permissions: { userId: string; roles: string[] };
  };
  error?: {
    statusCode: number;
    code: string;
    message: string;
    requestId: string;
    timestamp: string;
  };
}

async function createUser(options: { isActive?: boolean; deleted?: boolean } = {}): Promise<{
  id: string;
  email: string;
}> {
  created += 1;

  const email = `auth-${run}-${String(created)}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await passwords.hash(PASSWORD),
      firstName: 'Test',
      lastName: 'User',
      isActive: options.isActive ?? true,
      deletedAt: options.deleted === true ? new Date() : null,
      roles: { create: { roleId } },
    },
    select: { id: true, email: true },
  });

  return user;
}

async function login(
  email: string,
  password: string,
): Promise<{ status: number; body: LoginBody; setCookie: string | null }> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  return {
    status: response.status,
    body: (await response.json()) as LoginBody,
    setCookie: response.headers.get('set-cookie'),
  };
}

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  prisma = app.get(PrismaService);
  passwords = app.get(PasswordService);
  redis = app.get(RedisService);

  // A role of this suite's own, so the tests do not depend on the seed having
  // run — `node --test` runs files in separate processes, concurrently.
  const role = await prisma.role.create({
    data: { key: `auth-test-${run}`, nameEn: 'Auth Test', nameAr: 'اختبار', isSystem: false },
    select: { id: true },
  });

  roleId = role.id;
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// AC1 — successful login
// ---------------------------------------------------------------------------

test('AC1 — valid credentials return an access token and the signed-in user', async () => {
  const user = await createUser();

  const { status, body } = await login(user.email, PASSWORD);

  assert.equal(status, 200);
  assert.ok(body.data, `expected a data envelope, got ${JSON.stringify(body)}`);
  assert.ok(body.data.accessToken.length > 0);
  assert.equal(body.data.user.id, user.id);
  assert.equal(body.data.user.email, user.email);
  assert.deepEqual(body.data.user.roles, [`auth-test-${run}`]);
});

test('AC1 — the response carries the token lifetime and the effective permissions', async () => {
  const user = await createUser();

  const { body } = await login(user.email, PASSWORD);

  // So the client can schedule US-15's refresh without decoding the token.
  assert.equal(body.data?.expiresIn, 900);
  // So US-23 can gate the UI without a second round trip.
  assert.equal(body.data?.permissions.userId, user.id);
});

test('AC1 — a refresh cookie is set, httpOnly and SameSite=Strict', async () => {
  const user = await createUser();

  const { setCookie } = await login(user.email, PASSWORD);

  assert.ok(setCookie, 'expected a Set-Cookie header');
  assert.ok(setCookie.includes(`${REFRESH_COOKIE}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  // Scoped, so a long-lived credential is not attached to every API call.
  assert.match(setCookie, /Path=\/auth/i);
});

test('AC1 — the session row stores a hash, never the cookie value', async () => {
  const user = await createUser();

  const { setCookie } = await login(user.email, PASSWORD);
  const cookieValue = /crm_refresh_token=([^;]+)/.exec(setCookie ?? '')?.[1] ?? '';

  assert.ok(cookieValue.length > 0);

  const sessions = await prisma.session.findMany({
    where: { userId: user.id },
    select: { refreshTokenHash: true, audience: true, revokedAt: true, expiresAt: true },
  });

  assert.equal(sessions.length, 1);
  const session = sessions[0];
  assert.ok(session);

  // A leaked database backup must not hand out live sessions.
  assert.notEqual(session.refreshTokenHash, cookieValue);
  assert.equal(session.refreshTokenHash, TokenService.hashRefreshToken(cookieValue));
  assert.equal(session.audience, 'crm-staff');
  assert.equal(session.revokedAt, null);
  assert.ok(session.expiresAt.getTime() > Date.now());
});

test('AC1 — lastLoginAt is updated and a LOGIN audit row is written', async () => {
  const user = await createUser();

  await login(user.email, PASSWORD);

  const stored = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { lastLoginAt: true },
  });

  assert.ok(stored.lastLoginAt !== null);

  const audits = await prisma.auditLog.findMany({
    where: { actorUserId: user.id, action: 'LOGIN' },
    select: { entityType: true },
  });

  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.entityType, 'User');
});

test('AC1 — signing in twice gives two sessions, because a laptop and a phone are both real', async () => {
  const user = await createUser();

  await login(user.email, PASSWORD);
  await login(user.email, PASSWORD);

  const count = await prisma.session.count({ where: { userId: user.id } });

  assert.equal(count, 2);
});

// ---------------------------------------------------------------------------
// AC2 — one generic message, and no other tell
// ---------------------------------------------------------------------------

test('AC2 — an unknown email and a wrong password are byte-identical apart from the request id', async () => {
  const user = await createUser();

  const unknown = await login(`nobody-${run}@example.com`, PASSWORD);
  const wrong = await login(user.email, WRONG_PASSWORD);

  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);

  // Everything a client can see, except the two fields that are *supposed* to
  // differ per request. If this test ever fails, an account oracle has been
  // introduced — do not "fix" it by loosening the assertion.
  const comparable = (body: LoginBody): unknown => ({
    ...body.error,
    requestId: undefined,
    timestamp: undefined,
  });

  assert.deepEqual(comparable(unknown.body), comparable(wrong.body));
  assert.equal(unknown.body.error?.code, 'UNAUTHENTICATED');
});

test('AC2 — the message names neither the email nor which half was wrong', async () => {
  const user = await createUser();

  const { body } = await login(user.email, WRONG_PASSWORD);
  const message = body.error?.message ?? '';

  assert.ok(!message.includes(user.email));
  assert.ok(!/no such|not found|unknown user|does not exist/i.test(message));
  // "Email or password is incorrect" is fine; "password is incorrect" is not.
  assert.match(message, /email or password/i);
});

test('AC2 — the unknown-email path still runs a hash, so the clock does not give it away', async () => {
  const passwordService = app.get(PasswordService);
  const original = passwordService.verifyDummy.bind(passwordService);

  let calls = 0;
  passwordService.verifyDummy = async (): Promise<void> => {
    calls += 1;
    await original();
  };

  try {
    await login(`nobody-else-${run}@example.com`, PASSWORD);
  } finally {
    passwordService.verifyDummy = original;
  }

  // Returning early for an unknown email answers in about a millisecond while a
  // real check takes fifty, and that difference enumerates accounts just as
  // well as a different message would.
  assert.equal(calls, 1);
});

test('AC2 — a soft-deleted user is indistinguishable from one that never existed', async () => {
  const deleted = await createUser({ deleted: true });

  const removed = await login(deleted.email, PASSWORD);
  const unknown = await login(`never-existed-${run}@example.com`, PASSWORD);

  assert.equal(removed.status, 401);
  assert.equal(removed.body.error?.code, unknown.body.error?.code);
  assert.equal(removed.body.error?.message, unknown.body.error?.message);
});

test('AC2 — the email is normalised, so capitalisation is not a way around anything', async () => {
  const user = await createUser();

  const { status } = await login(user.email.toUpperCase(), PASSWORD);

  assert.equal(status, 200);
});

// ---------------------------------------------------------------------------
// AC3 — deactivated account
// ---------------------------------------------------------------------------

test('AC3 — a deactivated account is refused and told to contact an administrator', async () => {
  const user = await createUser({ isActive: false });

  const { status, body } = await login(user.email, PASSWORD);

  assert.equal(status, 403);
  assert.equal(body.error?.code, 'FORBIDDEN');
  assert.match(body.error?.message ?? '', /deactivated/i);
  assert.match(body.error?.message ?? '', /administrator/i);
});

test('AC3 — a deactivated account with the WRONG password gets the generic error', async () => {
  const inactive = await createUser({ isActive: false });

  const { status, body } = await login(inactive.email, WRONG_PASSWORD);

  // The password is checked before `isActive` precisely so that AC3's specific
  // message is only reachable by someone who already knows the password. Check
  // `isActive` first and this becomes a free account-enumeration oracle for
  // anyone guessing email addresses.
  assert.equal(status, 401);
  assert.equal(body.error?.code, 'UNAUTHENTICATED');
  assert.match(body.error?.message ?? '', /email or password/i);
});

test('AC3 — a refused login opens no session', async () => {
  const user = await createUser({ isActive: false });

  await login(user.email, PASSWORD);

  assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
});

// ---------------------------------------------------------------------------
// AC4 — nothing reversible, and nothing leaked
// ---------------------------------------------------------------------------

test('AC4 — the stored password is an argon2id hash', async () => {
  const user = await createUser();

  const stored = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  assert.ok(stored.passwordHash.startsWith('$argon2id$'));
  assert.ok(!stored.passwordHash.includes(PASSWORD));
});

test('AC4 — no response body ever contains the hash or the password', async () => {
  const user = await createUser();

  const success = await login(user.email, PASSWORD);
  const failure = await login(user.email, WRONG_PASSWORD);

  for (const body of [success.body, failure.body]) {
    const serialised = JSON.stringify(body);

    assert.ok(!serialised.includes('$argon2id$'));
    assert.ok(!serialised.includes('passwordHash'));
    assert.ok(!serialised.includes(PASSWORD));
  }
});

test('AC4 — no audit row records the password or the hash', async () => {
  const user = await createUser();

  await login(user.email, PASSWORD);
  await login(user.email, WRONG_PASSWORD);

  const audits = await prisma.auditLog.findMany({
    where: { actorUserId: user.id },
    select: { before: true, after: true },
  });

  assert.ok(audits.length >= 2);

  for (const row of audits) {
    const serialised = JSON.stringify(row);

    assert.ok(!serialised.includes('$argon2id$'));
    assert.ok(!serialised.includes(PASSWORD));
  }
});

// ---------------------------------------------------------------------------
// AC5 — brute force
// ---------------------------------------------------------------------------

test('AC5 — repeated failures for one account are throttled, and the lockout is audited', async () => {
  const user = await createUser();

  // `.env.test` leaves LOGIN_MAX_ATTEMPTS_PER_EMAIL at its default of 5.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { status } = await login(user.email, WRONG_PASSWORD);
    assert.equal(status, 401, `attempt ${String(attempt + 1)} should still be a plain refusal`);
  }

  // The sixth attempt is refused before the credentials are even considered —
  // note that this one uses the CORRECT password and is still turned away.
  const locked = await login(user.email, PASSWORD);

  assert.equal(locked.status, 429);
  assert.equal(locked.body.error?.code, 'RATE_LIMITED');

  const failures = await prisma.auditLog.count({
    where: { actorUserId: user.id, action: 'LOGIN_FAILED' },
  });

  assert.equal(failures, 5);
});

test('AC5 — the lockout does not leak whether the account exists', async () => {
  const email = `ghost-${run}@example.com`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await login(email, WRONG_PASSWORD);
  }

  const locked = await login(email, WRONG_PASSWORD);

  // An account that does not exist locks out exactly like one that does.
  assert.equal(locked.status, 429);
});

test('AC5 — a success clears the counter', async () => {
  const user = await createUser();

  await login(user.email, WRONG_PASSWORD);
  await login(user.email, WRONG_PASSWORD);
  assert.equal((await login(user.email, PASSWORD)).status, 200);

  // Four more failures would trip the threshold if the earlier two were still
  // being counted.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal((await login(user.email, WRONG_PASSWORD)).status, 401);
  }
});

// ---------------------------------------------------------------------------
// Validation and shape
// ---------------------------------------------------------------------------

test('a malformed body is rejected by the global pipe, not by the login logic', async () => {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', password: '' }),
  });

  const body = (await response.json()) as LoginBody;

  assert.equal(response.status, 422);
  assert.equal(body.error?.code, 'VALIDATION_FAILED');
});

test('Redis is actually reachable for this run, so the throttle tests mean something', () => {
  // Guards against the whole AC5 section silently passing for the wrong reason:
  // with Redis down the throttle fails open by design, and every lockout
  // assertion above would fail loudly rather than quietly — but a reader
  // deserves to see this stated.
  assert.equal(redis.isReady(), true);
});
