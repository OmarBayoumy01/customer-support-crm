/**
 * US-15 — silent refresh, and the two things that make it safe.
 *
 * AC2 (rotation), AC3 (replay revokes the family), AC5 (expiry). AC1 and AC4
 * are client behaviour and are tested in the frontend suite.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/index.js';
import { REFRESH_COOKIE } from './cookies.js';
import { PasswordService } from './password.service.js';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let passwords: PasswordService;

const run = `${String(process.pid)}-${String(Math.floor(performance.now()))}`;
const PASSWORD = 'correct-horse-battery-staple';

let created = 0;
let roleId: string;

function cookieFrom(setCookie: string | null): string {
  return /crm_refresh_token=([^;]+)/.exec(setCookie ?? '')?.[1] ?? '';
}

async function signIn(): Promise<{ userId: string; refreshToken: string }> {
  created += 1;
  const email = `refresh-${run}-${String(created)}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await passwords.hash(PASSWORD),
      firstName: 'Refresh',
      lastName: 'User',
      roles: { create: { roleId } },
    },
    select: { id: true },
  });

  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });

  return { userId: user.id, refreshToken: cookieFrom(response.headers.get('set-cookie')) };
}

async function refresh(token: string): Promise<{ status: number; nextToken: string }> {
  const response = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `${REFRESH_COOKIE}=${token}` },
  });

  return { status: response.status, nextToken: cookieFrom(response.headers.get('set-cookie')) };
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

  const role = await prisma.role.create({
    data: { key: `refresh-test-${run}`, nameEn: 'Refresh Test', nameAr: 'تحديث', isSystem: false },
    select: { id: true },
  });

  roleId = role.id;
});

after(async () => {
  await app.close();
});

test('AC2 — refreshing issues a new token and retires the old one', async () => {
  const { refreshToken } = await signIn();

  const first = await refresh(refreshToken);

  assert.equal(first.status, 200);
  assert.ok(first.nextToken.length > 0);
  assert.notEqual(first.nextToken, refreshToken, 'the token must rotate, not be reissued');

  // The new one works.
  assert.equal((await refresh(first.nextToken)).status, 200);
});

test('AC2 — the retired token cannot be used again', async () => {
  const { refreshToken } = await signIn();

  await refresh(refreshToken);

  // Second use of the *original* token. This is the property that makes a
  // stolen refresh token useful exactly once.
  assert.equal((await refresh(refreshToken)).status, 401);
});

test('AC3 — replaying a retired token revokes the whole family', async () => {
  const { userId, refreshToken } = await signIn();

  const second = await refresh(refreshToken);
  const third = await refresh(second.nextToken);

  assert.equal(third.status, 200);

  // Now replay the first one. Someone holding a copy of an old token is the
  // case this is designed for — there is no way to tell them from a confused
  // client, so the safe reading wins.
  assert.equal((await refresh(refreshToken)).status, 401);

  // The currently-valid token is dead too, which is the point of "family".
  assert.equal((await refresh(third.nextToken)).status, 401);

  const live = await prisma.session.count({ where: { userId, revokedAt: null } });
  assert.equal(live, 0, 'every session in the family should be revoked');
});

test('AC3 — the replay is recorded as a possible theft', async () => {
  const { userId, refreshToken } = await signIn();

  await refresh(refreshToken);
  await refresh(refreshToken);

  const audits = await prisma.auditLog.findMany({
    where: { actorUserId: userId, entityType: 'Session' },
    select: { after: true },
  });

  assert.ok(audits.length >= 1);
  assert.match(JSON.stringify(audits[0]?.after), /replay/i);
});

test('AC5 — an expired refresh token is rejected', async () => {
  const { userId, refreshToken } = await signIn();

  await prisma.session.updateMany({
    where: { userId },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });

  assert.equal((await refresh(refreshToken)).status, 401);
});

test('a refresh for a deactivated account is refused and kills the family', async () => {
  const { userId, refreshToken } = await signIn();

  await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

  assert.equal((await refresh(refreshToken)).status, 401);
  assert.equal(await prisma.session.count({ where: { userId, revokedAt: null } }), 0);
});

test('every rejection gives the same message, whatever the reason', async () => {
  const missing = await fetch(`${baseUrl}/auth/refresh`, { method: 'POST' });
  const nonsense = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `${REFRESH_COOKIE}=not-a-real-token` },
  });

  const bodyOf = async (response: Response): Promise<string> =>
    ((await response.json()) as { error: { message: string } }).error.message;

  assert.equal(missing.status, 401);
  assert.equal(nonsense.status, 401);
  // Telling a holder of a stolen token *why* it failed would tell them whether
  // the theft has been noticed.
  assert.equal(await bodyOf(missing), await bodyOf(nonsense));
});

test('refreshing picks up a role change without a new sign-in', async () => {
  const { userId, refreshToken } = await signIn();

  const extra = await prisma.role.create({
    data: {
      key: `refresh-extra-${run}`,
      nameEn: 'Extra',
      nameAr: 'إضافي',
      isSystem: false,
    },
    select: { id: true },
  });

  await prisma.userRole.create({ data: { userId, roleId: extra.id } });

  const response = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `${REFRESH_COOKIE}=${refreshToken}` },
  });

  const body = (await response.json()) as { data: { user: { roles: string[] } } };

  assert.equal(body.data.user.roles.length, 2);
});
