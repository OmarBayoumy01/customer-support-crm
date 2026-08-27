/**
 * US-16 — signing out actually ends the session.
 *
 * AC1 (sign out), AC2 (the revoked token is refused), AC3 (everywhere),
 * AC4 (a role change invalidates a session rather than letting it run on with
 * stale permissions).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { RolesService } from '../permissions/index.js';
import { PrismaService } from '../prisma/index.js';
import { REFRESH_COOKIE } from './cookies.js';
import { PasswordService } from './password.service.js';

/** Something protected to prove a revoked token no longer opens anything. */
@Controller('logout-fixture')
class LogoutFixtureController {
  @Get('protected')
  protectedRoute(): { ok: boolean } {
    return { ok: true };
  }
}

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let passwords: PasswordService;
let roles: RolesService;

const run = randomUUID().slice(0, 8);
const PASSWORD = 'correct-horse-battery-staple';

let created = 0;
let roleId: string;

interface Session {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

async function signIn(email?: string): Promise<Session> {
  created += 1;
  const address = email ?? `logout-${run}-${String(created)}@example.com`;

  const existing = await prisma.user.findUnique({ where: { email: address } });

  const user =
    existing ??
    (await prisma.user.create({
      data: {
        email: address,
        passwordHash: await passwords.hash(PASSWORD),
        firstName: 'Logout',
        lastName: 'User',
        roles: { create: { roleId } },
      },
    }));

  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: address, password: PASSWORD }),
  });

  const body = (await response.json()) as { data: { accessToken: string } };

  return {
    userId: user.id,
    accessToken: body.data.accessToken,
    refreshToken:
      /crm_refresh_token=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '',
  };
}

async function callProtected(token: string): Promise<number> {
  const response = await fetch(`${baseUrl}/logout-fixture/protected`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return response.status;
}

async function logout(session: Session, everywhere = false): Promise<number> {
  const response = await fetch(`${baseUrl}/auth/${everywhere ? 'logout-all' : 'logout'}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      cookie: `${REFRESH_COOKIE}=${session.refreshToken}`,
    },
  });

  return response.status;
}

before(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [LogoutFixtureController],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  prisma = app.get(PrismaService);
  passwords = app.get(PasswordService);
  roles = app.get(RolesService);

  const role = await prisma.role.create({
    data: { key: `logout-test-${run}`, nameEn: 'Logout Test', nameAr: 'خروج', isSystem: false },
    select: { id: true },
  });

  roleId = role.id;
});

after(async () => {
  await app.close();
});

test('AC1 — signing out revokes the session and clears the cookie', async () => {
  const session = await signIn();

  assert.equal(await callProtected(session.accessToken), 200, 'should work before signing out');

  const response = await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      cookie: `${REFRESH_COOKIE}=${session.refreshToken}`,
    },
  });

  assert.equal(response.status, 204);
  // Cleared by setting it to empty with a past expiry — the browser drops it.
  assert.match(response.headers.get('set-cookie') ?? '', /crm_refresh_token=;/);

  assert.equal(
    await prisma.session.count({ where: { userId: session.userId, revokedAt: null } }),
    0,
  );
});

test('AC2 — the access token is refused immediately, not in fifteen minutes', async () => {
  const session = await signIn();

  await logout(session);

  // This is the whole point of the denylist. A signed JWT cannot be recalled,
  // so without it "sign out" would mean "sign out eventually".
  assert.equal(await callProtected(session.accessToken), 401);
});

test('AC2 — the refresh token is dead too, so the session cannot be resurrected', async () => {
  const session = await signIn();

  await logout(session);

  const response = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `${REFRESH_COOKIE}=${session.refreshToken}` },
  });

  assert.equal(response.status, 401);
});

test('AC2 — signing out on one device leaves the others alone', async () => {
  const email = `two-devices-${run}@example.com`;

  const laptop = await signIn(email);
  const phone = await signIn(email);

  await logout(laptop);

  assert.equal(await callProtected(laptop.accessToken), 401);
  // Revoking by session, not by user. Signing out of one browser must not sign
  // you out of your phone.
  assert.equal(await callProtected(phone.accessToken), 200);
});

test('AC3 — signing out everywhere ends every session on the account', async () => {
  const email = `all-devices-${run}@example.com`;

  const laptop = await signIn(email);
  const phone = await signIn(email);

  assert.equal(await logout(laptop, true), 204);

  assert.equal(await callProtected(laptop.accessToken), 401);
  assert.equal(
    await callProtected(phone.accessToken),
    401,
    'the other device should be signed out too',
  );

  assert.equal(
    await prisma.session.count({ where: { userId: laptop.userId, revokedAt: null } }),
    0,
  );
});

test('AC4 — a role change invalidates the session rather than running on stale permissions', async () => {
  const session = await signIn();

  assert.equal(await callProtected(session.accessToken), 200);

  const extra = await prisma.role.create({
    data: { key: `logout-extra-${run}`, nameEn: 'Extra', nameAr: 'إضافي', isSystem: false },
    select: { id: true },
  });

  await roles.assignRole(session.userId, extra.id);

  // The token in the user's hand still lists the old roles, and a signed token
  // cannot be edited. Refusing it is the only way the next request does not
  // proceed on permissions that are no longer true.
  assert.equal(await callProtected(session.accessToken), 401);
});

test('AC4 — after a forced logout the user can simply sign in again', async () => {
  const email = `re-signin-${run}@example.com`;
  const session = await signIn(email);

  const extra = await prisma.role.create({
    data: { key: `logout-extra2-${run}`, nameEn: 'Extra2', nameAr: 'إضافي٢', isSystem: false },
    select: { id: true },
  });

  await roles.assignRole(session.userId, extra.id);
  assert.equal(await callProtected(session.accessToken), 401);

  // The revocation cutoff must not lock the account out of new tokens — it
  // applies to tokens issued *before* the change, not to the account.
  const fresh = await signIn(email);
  assert.equal(await callProtected(fresh.accessToken), 200);
});

// ---------------------------------------------------------------------------
// A customer can sign out — the bug that read as a stale cache
// ---------------------------------------------------------------------------

/**
 * A portal account: a user with a linked `Customer` row, which is what decides
 * the audience of the token the one login endpoint issues.
 */
async function signInAsCustomer(): Promise<Session> {
  const address = `logout-customer-${run}-${String(++created)}@example.com`;

  const user = await prisma.user.create({
    data: {
      email: address,
      passwordHash: await passwords.hash(PASSWORD),
      firstName: 'Logout',
      lastName: 'Customer',
      roles: { create: { roleId } },
    },
    select: { id: true },
  });

  await prisma.customer.create({
    data: {
      firstName: 'Logout',
      lastName: 'Customer',
      email: address,
      userId: user.id,
    },
  });

  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: address, password: PASSWORD }),
  });

  const body = (await response.json()) as { data: { accessToken: string; audience: string } };

  // The premise of the tests below: this really is a portal token.
  assert.equal(body.data.audience, 'crm-portal');

  return {
    userId: user.id,
    accessToken: body.data.accessToken,
    refreshToken:
      /crm_refresh_token=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '',
  };
}

test('a customer can sign out, and the session and cookie really end', async () => {
  /**
   * The bug this pins down.
   *
   * `/auth/logout` sat behind the staff-audience strategy, so a portal token
   * was refused with a 401. The client clears its own state regardless, so the
   * sign-out **looked** like it worked — while the session stayed alive and the
   * refresh cookie stayed on the browser. The next page load exchanged that
   * cookie for a fresh token and signed the customer straight back in, which
   * reads exactly like the application having cached the old user.
   */
  const session = await signInAsCustomer();

  const response = await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      cookie: `${REFRESH_COOKIE}=${session.refreshToken}`,
    },
  });

  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie') ?? '', /crm_refresh_token=;/);

  assert.equal(
    await prisma.session.count({ where: { userId: session.userId, revokedAt: null } }),
    0,
  );
});

test('and the cookie cannot then be traded for a new session', async () => {
  const session = await signInAsCustomer();

  await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      cookie: `${REFRESH_COOKIE}=${session.refreshToken}`,
    },
  });

  // The half that produced the symptom: a surviving cookie plus the
  // boot-time restore is what signed the customer back in.
  const refreshed = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `${REFRESH_COOKIE}=${session.refreshToken}` },
  });

  assert.equal(refreshed.status, 401);
});

test('signing out everywhere works for a customer too', async () => {
  const session = await signInAsCustomer();

  const response = await fetch(`${baseUrl}/auth/logout-all`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      cookie: `${REFRESH_COOKIE}=${session.refreshToken}`,
    },
  });

  assert.equal(response.status, 204);
  assert.equal(
    await prisma.session.count({ where: { userId: session.userId, revokedAt: null } }),
    0,
  );
});

test('signing out is still authenticated — an anonymous attempt is 401', async () => {
  // The guard on these routes is applied with `@Public()`, which takes them off
  // the global one. This is the test standing between that pairing and an open
  // endpoint that would let anyone end anybody’s session.
  for (const path of ['/auth/logout', '/auth/logout-all']) {
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST' });

    assert.equal(response.status, 401, path);
  }
});

test('a staff token still signs out, unchanged', async () => {
  const session = await signIn();

  assert.equal(await logout(session), 204);
});

test('a token with no jti is refused, since nothing could ever revoke it', async () => {
  const { JwtService } = await import('@nestjs/jwt');
  const jwt = app.get(JwtService);

  const noJti = await jwt.signAsync(
    { roles: [], sid: '01923456-89ab-7cde-8f01-2345678900bb' },
    {
      subject: '01923456-89ab-7cde-8f01-2345678900aa',
      audience: 'crm-staff',
      issuer: 'crm-test',
      expiresIn: 900,
    },
  );

  assert.equal(await callProtected(noJti), 401);
});
