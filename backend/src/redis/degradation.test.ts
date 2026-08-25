import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { HealthStatusSchema } from '@crm/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

/**
 * AC4 — everything here runs against a Redis that is **not there**.
 *
 * Pointed at a port nothing listens on rather than stopping the shared
 * container, which would break every other suite running in parallel. It is a
 * truer test anyway: it exercises connect failure, not a clean shutdown.
 *
 * Set before `AppModule` is imported, because `ConfigModule.forRoot` reads the
 * environment when the module is compiled and `process.env` takes precedence
 * over `.env.test`. Node's test runner gives each file its own process, so this
 * cannot leak into another suite.
 */
process.env['REDIS_URL'] = 'redis://127.0.0.1:6399/0';
// Short, so the suite is not waiting five seconds to prove a connection fails.
process.env['REDIS_CONNECT_TIMEOUT_MS'] = '300';

const { AppModule } = await import('../app.module.js');
const { CacheService } = await import('./cache.service.js');
const { RedisService } = await import('./redis.service.js');

type CacheServiceType = InstanceType<typeof CacheService>;
type RedisServiceType = InstanceType<typeof RedisService>;

let app: INestApplication;
let baseUrl: string;
let cache: CacheServiceType;
let redis: RedisServiceType;

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
  app.enableShutdownHooks();

  // The point of AC4: this must not throw, even though Redis is unreachable.
  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(address.port)}`;

  cache = app.get(CacheService);
  redis = app.get(RedisService);
});

after(async () => {
  await app.close();
});

test('AC4 — the app starts even though Redis is unreachable', () => {
  assert.equal(redis.isReady(), false, 'the fixture is wrong if Redis is actually up');
  assert.ok(baseUrl.length > 0, 'the app should still be listening');
});

test('AC4 — a cached read falls back instead of erroring', async () => {
  const before = cache.degradations();

  const value = await cache.get('anything');

  assert.equal(value, undefined, 'a degraded read looks exactly like a miss');
  assert.ok(cache.degradations() > before, 'the degradation should have been recorded');
});

test('AC4 — a cache write is a no-op rather than a failure', async () => {
  await assert.doesNotReject(() => cache.set('anything', { a: 1 }));
  await assert.doesNotReject(() => cache.delete('anything'));
  await assert.doesNotReject(() => cache.deleteByPrefix('anything:'));
});

test('AC4 — wrap still returns the loaded value, every time', async () => {
  let loads = 0;

  const load = async (): Promise<string> => {
    loads += 1;
    return Promise.resolve('from the database');
  };

  assert.equal(await cache.wrap('key', 60, load), 'from the database');
  assert.equal(await cache.wrap('key', 60, load), 'from the database');

  // Without a cache there is nothing to hit, so the loader runs each time —
  // slower, but correct, which is the whole bargain of graceful degradation.
  assert.equal(loads, 2);
});

test('AC4 — the service is degraded, not down, when only Redis is missing', async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);

  const payload = (await response.json()) as { data: unknown };
  const parsed = HealthStatusSchema.parse(payload.data);

  assert.equal(parsed.dependencies['redis']?.status, 'down');
  assert.equal(parsed.dependencies['database']?.status, 'up');
  assert.equal(
    parsed.status,
    'degraded',
    'Redis is not critical — a cache outage must not take the service out of a load balancer',
  );
});

test('AC4 — a real request still succeeds with no cache behind it', async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200, 'the API keeps serving');
});
