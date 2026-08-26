/**
 * US-14, AC6 — a decoded access token carries user id, role, and audience, and
 * expires in fifteen minutes.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { ACCESS_TOKEN_TTL_SECONDS, AccessTokenClaimsSchema } from '@crm/shared';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { TypedConfigService } from '../config/index.js';
import { TokenService } from './token.service.js';

let app: INestApplication;
let tokens: TokenService;
let jwt: JwtService;
let config: TypedConfigService;

const USER_ID = '01923456-89ab-7cde-8f01-234567890abc';
const SESSION_ID = '01923456-89ab-7cde-8f01-234567890def';

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  tokens = app.get(TokenService);
  jwt = app.get(JwtService);
  config = app.get(TypedConfigService);
});

after(async () => {
  await app.close();
});

async function signStaffToken(roles: string[] = ['agent']): Promise<string> {
  return tokens.signAccessToken({
    userId: USER_ID,
    roles,
    sessionId: SESSION_ID,
    audience: 'crm-staff',
  });
}

test('AC6 — the claims carry user id, roles, audience, and issuer', async () => {
  const token = await signStaffToken(['agent', 'manager']);

  const claims = AccessTokenClaimsSchema.parse(jwt.decode(token));

  assert.equal(claims.sub, USER_ID);
  assert.deepEqual(claims.roles, ['agent', 'manager']);
  assert.equal(claims.aud, 'crm-staff');
  assert.equal(claims.iss, config.get('JWT_ISSUER'));
  // Carried for US-16's revocation, unused today.
  assert.equal(claims.sid, SESSION_ID);
});

test('AC6 — roles is plural, and survives a user holding several', async () => {
  // US-13 gave users many roles. AC6 says "role" singular; a singular claim
  // cannot represent the model, so the token carries the set. This test is what
  // stops someone "simplifying" it back to one.
  const token = await signStaffToken(['administrator', 'manager', 'agent']);
  const claims = AccessTokenClaimsSchema.parse(jwt.decode(token));

  assert.equal(claims.roles.length, 3);
});

test('AC6 — the token expires exactly fifteen minutes after it was issued', async () => {
  const token = await signStaffToken();
  const claims = AccessTokenClaimsSchema.parse(jwt.decode(token));

  assert.equal(claims.exp - claims.iat, ACCESS_TOKEN_TTL_SECONDS);
  assert.equal(ACCESS_TOKEN_TTL_SECONDS, 900);
});

test('AC6 — a token signed with a different secret does not verify', async () => {
  const token = await signStaffToken();

  await assert.rejects(
    () => jwt.verifyAsync(token, { secret: 'a-completely-different-secret-of-adequate-length' }),
    /invalid signature/i,
  );
});

test('AC6 — a portal token is rejected when a staff token is required', async () => {
  const portalToken = await tokens.signAccessToken({
    userId: USER_ID,
    roles: ['customer'],
    sessionId: SESSION_ID,
    audience: 'crm-portal',
  });

  // This is the check `JwtStrategy` performs. US-21 adds the portal door; until
  // the audience is verified, a portal credential would open the staff one.
  await assert.rejects(
    () =>
      jwt.verifyAsync(portalToken, {
        secret: config.get('JWT_ACCESS_SECRET'),
        audience: 'crm-staff',
      }),
    /audience invalid/i,
  );
});

test('a refresh token is opaque, high-entropy, and stored only as a hash', () => {
  const minted = tokens.mintRefreshToken();

  // base64url of 32 bytes — no padding, url-safe alphabet.
  assert.match(minted.plain, /^[A-Za-z0-9_-]{43}$/);
  // SHA-256, hex.
  assert.match(minted.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(minted.plain, minted.hash);
  assert.equal(TokenService.hashRefreshToken(minted.plain), minted.hash);
});

test('two refresh tokens minted in a row are different', () => {
  const first = tokens.mintRefreshToken();
  const second = tokens.mintRefreshToken();

  assert.notEqual(first.plain, second.plain);
  assert.notEqual(first.hash, second.hash);
});
