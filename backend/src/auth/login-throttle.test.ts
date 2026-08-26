/**
 * US-14, AC5 — repeated failures are throttled, per account and per address.
 *
 * The thresholds are driven from a hand-built config here rather than the
 * environment, so the test states the numbers it is asserting instead of
 * depending on whatever `.env.test` happens to say.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { ApiException } from '../common/index.js';
import { TypedConfigService, type Env } from '../config/index.js';
import { RedisService } from '../redis/index.js';
import { LoginThrottleService } from './login-throttle.service.js';

let app: INestApplication;
let redis: RedisService;

/** Namespaces this run, since the test Redis persists between runs. */
const run = `${String(process.pid)}-${String(Math.floor(performance.now()))}`;

let counter = 0;

/** A fresh address on every call, so no two tests share a counter. */
function uniqueEmail(): string {
  counter += 1;
  return `throttle-${run}-${String(counter)}@example.com`;
}

function uniqueIp(): string {
  counter += 1;
  return `203.0.113.${String(counter % 250)}-${run}`;
}

const MAX_PER_EMAIL = 3;
const MAX_PER_IP = 5;

function throttleWith(redisService: RedisService): LoginThrottleService {
  const config = new TypedConfigService(
    new ConfigService<Env, true>({
      LOGIN_MAX_ATTEMPTS_PER_EMAIL: MAX_PER_EMAIL,
      LOGIN_MAX_ATTEMPTS_PER_IP: MAX_PER_IP,
      LOGIN_THROTTLE_WINDOW_SECONDS: 60,
    }),
  );

  return new LoginThrottleService(redisService, config);
}

let throttle: LoginThrottleService;

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  redis = app.get(RedisService);
  throttle = throttleWith(redis);
});

after(async () => {
  await app.close();
});

test('AC5 — attempts below the threshold are allowed through', async () => {
  const email = uniqueEmail();
  const ip = uniqueIp();

  for (let attempt = 0; attempt < MAX_PER_EMAIL - 1; attempt += 1) {
    await throttle.check(email, ip);
    await throttle.recordFailure(email, ip);
  }

  // Still under the limit, so this must not throw.
  await throttle.check(email, ip);
});

test('AC5 — the account threshold trips, and it answers RATE_LIMITED', async () => {
  const email = uniqueEmail();
  const ip = uniqueIp();

  for (let attempt = 0; attempt < MAX_PER_EMAIL; attempt += 1) {
    await throttle.recordFailure(email, ip);
  }

  await assert.rejects(
    () => throttle.check(email, ip),
    (error: unknown) => {
      assert.ok(error instanceof ApiException);
      assert.equal(error.code, 'RATE_LIMITED');
      assert.equal(error.getStatus(), 429);
      // The message must not name a threshold or a remaining count — that is
      // free intelligence for whoever is guessing.
      assert.ok(!/\d/.test(error.message));
      return true;
    },
  );
});

test('AC5 — the address threshold is counted separately from the account', async () => {
  const ip = uniqueIp();

  // Each attempt uses a *different* email, so the per-account counter never
  // reaches its threshold. Only the per-IP counter can trip here — which is the
  // spray attack the second counter exists to catch.
  for (let attempt = 0; attempt < MAX_PER_IP; attempt += 1) {
    await throttle.recordFailure(uniqueEmail(), ip);
  }

  await assert.rejects(() => throttle.check(uniqueEmail(), ip), ApiException);
});

test('AC5 — one office behind one address does not lock out on account failures alone', async () => {
  const ip = uniqueIp();
  const email = uniqueEmail();

  // Two failures for one account is nowhere near either threshold.
  await throttle.recordFailure(email, ip);
  await throttle.recordFailure(email, ip);

  // A different colleague on the same address is unaffected.
  await throttle.check(uniqueEmail(), ip);
});

test('AC5 — a success clears the counter, so a near-miss does not accumulate', async () => {
  const email = uniqueEmail();
  const ip = uniqueIp();

  await throttle.recordFailure(email, ip);
  await throttle.recordFailure(email, ip);
  await throttle.clear(email, ip);

  // Back to zero: the next failure starts a fresh window rather than tipping
  // the account over on its third mistake of the week.
  await throttle.recordFailure(email, ip);
  await throttle.check(email, ip);
});

test('AC5 — the counter is keyed on the normalised email, so changing case does not reset it', async () => {
  const email = uniqueEmail();
  const ip = uniqueIp();

  for (let attempt = 0; attempt < MAX_PER_EMAIL; attempt += 1) {
    await throttle.recordFailure(email, ip);
  }

  // Same address, shouted. If the key were the raw string this would sail
  // straight past the lockout, and the throttle would be decorative.
  await assert.rejects(() => throttle.check(email.toUpperCase(), ip), ApiException);
  await assert.rejects(() => throttle.check(`  ${email}  `, ip), ApiException);
});

test('AC5 — with Redis unavailable the throttle fails open and says so', async () => {
  // The deliberate trade-off (decision D3): failing closed would lock every
  // agent out of the helpdesk for the length of a Redis outage, which for a
  // support desk running against SLA targets is the worse failure. The
  // requirement is that it is loud, not that it is enforced.
  const offline = throttleWith({
    isReady: () => false,
    client: redis.client,
  } as unknown as RedisService);

  const email = uniqueEmail();
  const ip = uniqueIp();

  const before = offline.degradations();

  // Would be well past the threshold if it were being counted at all.
  for (let attempt = 0; attempt < MAX_PER_IP * 3; attempt += 1) {
    await offline.recordFailure(email, ip);
  }

  await offline.check(email, ip);

  assert.ok(
    offline.degradations() > before,
    'an unenforced throttle must be counted, so the gap is visible rather than silent',
  );
});
