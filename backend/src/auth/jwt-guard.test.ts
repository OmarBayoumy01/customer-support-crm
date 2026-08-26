/**
 * US-14 — the global guard.
 *
 * The property under test is not "a valid token works". It is that a route
 * nobody thought about is closed, which is the project's second non-negotiable
 * rule in its cheapest form.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { RequestContextService } from '../common/index.js';
import { CurrentUser, type CurrentUserPayload } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { TokenService } from './token.service.js';

/**
 * A controller that says nothing about authentication at all — exactly the
 * situation a future story lands in when someone forgets the decorator.
 */
@Controller('guard-fixture')
class GuardFixtureController {
  constructor(private readonly requestContext: RequestContextService) {}

  @Get('protected')
  protectedRoute(@CurrentUser() user: CurrentUserPayload | undefined): {
    userId: string | undefined;
    contextUserId: string | undefined;
  } {
    return { userId: user?.userId, contextUserId: this.requestContext.userId() };
  }

  @Get('open')
  @Public()
  openRoute(): { ok: boolean } {
    return { ok: true };
  }
}

let app: INestApplication;
let baseUrl: string;
let tokens: TokenService;

const USER_ID = '01923456-89ab-7cde-8f01-2345678900aa';
const SESSION_ID = '01923456-89ab-7cde-8f01-2345678900bb';

interface ErrorBody {
  error?: { code: string; statusCode: number; requestId: string };
  data?: unknown;
}

async function get(path: string, token?: string): Promise<{ status: number; body: ErrorBody }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as ErrorBody };
}

before(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [GuardFixtureController],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  tokens = app.get(TokenService);
});

after(async () => {
  await app.close();
});

test('a controller that says nothing about auth is protected by default', async () => {
  const { status, body } = await get('/guard-fixture/protected');

  assert.equal(status, 401);
  assert.equal(body.error?.code, 'UNAUTHENTICATED');
});

test('a missing token comes back in the standard error envelope, not a bare Nest 401', async () => {
  const { body } = await get('/guard-fixture/protected');

  // A client that has to special-case the shape of auth failures is a client
  // that will get it wrong.
  assert.equal(body.error?.statusCode, 401);
  assert.ok((body.error?.requestId ?? '').length > 0);
});

test('a valid token is accepted and identifies the user', async () => {
  const token = await tokens.signAccessToken({
    userId: USER_ID,
    roles: ['agent'],
    sessionId: SESSION_ID,
    audience: 'crm-staff',
  });

  const { status, body } = await get('/guard-fixture/protected', token);
  const data = body.data as { userId: string; contextUserId: string };

  assert.equal(status, 200);
  assert.equal(data.userId, USER_ID);
});

test('the strategy calls setUserId, so every log line for the request names the user', async () => {
  const token = await tokens.signAccessToken({
    userId: USER_ID,
    roles: ['agent'],
    sessionId: SESSION_ID,
    audience: 'crm-staff',
  });

  const { body } = await get('/guard-fixture/protected', token);
  const data = body.data as { contextUserId: string };

  // This is the promise `RequestContextService.setUserId`'s doc comment made in
  // US-9 and left for P02 to keep.
  assert.equal(data.contextUserId, USER_ID);
});

test('a garbled token is refused', async () => {
  const { status, body } = await get('/guard-fixture/protected', 'not.a.token');

  assert.equal(status, 401);
  assert.equal(body.error?.code, 'UNAUTHENTICATED');
});

test('a token signed by someone else is refused', async () => {
  // Header and payload that look right, signature that is not.
  const forged = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: USER_ID, roles: ['administrator'] })).toString('base64url'),
    'a-signature-made-up-entirely',
  ].join('.');

  const { status } = await get('/guard-fixture/protected', forged);

  assert.equal(status, 401);
});

test('a portal token cannot open a staff route', async () => {
  const portalToken = await tokens.signAccessToken({
    userId: USER_ID,
    roles: ['customer'],
    sessionId: SESSION_ID,
    audience: 'crm-portal',
  });

  // US-21 issues these. Without the audience check they would be accepted here
  // with whatever roles they carry.
  const { status } = await get('/guard-fixture/protected', portalToken);

  assert.equal(status, 401);
});

test('an expired token is refused, with no grace period', async () => {
  // Signed directly rather than through TokenService, which always uses the
  // configured fifteen minutes.
  const { JwtService } = await import('@nestjs/jwt');
  const jwt = app.get(JwtService);

  const expired = await jwt.signAsync(
    { roles: ['agent'], sid: SESSION_ID },
    { subject: USER_ID, audience: 'crm-staff', issuer: 'crm-test', expiresIn: -10 },
  );

  const { status } = await get('/guard-fixture/protected', expired);

  assert.equal(status, 401);
});

test('a @Public() route still answers without a token', async () => {
  const { status, body } = await get('/guard-fixture/open');

  assert.equal(status, 200);
  assert.deepEqual(body.data, { ok: true });
});

test('/health still answers without a token', async () => {
  // A health check that needs a credential cannot tell a monitoring system
  // whether the service is down or the credential expired.
  const { status } = await get('/health');

  assert.equal(status, 200);
});
