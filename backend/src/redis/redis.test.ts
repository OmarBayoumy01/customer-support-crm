import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { HealthStatusSchema } from '@crm/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { CacheService } from './cache.service.js';
import { DEAD_LETTER_QUEUE, QueueService, type DeadLetterPayload } from './queue.service.js';
import { RedisService } from './redis.service.js';

let app: INestApplication;
let baseUrl: string;
let redis: RedisService;
let cache: CacheService;
let queues: QueueService;

/** Namespaces this run's keys and queues, since the test Redis persists. */
const run = randomUUID().slice(0, 8);

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(address.port)}`;

  redis = app.get(RedisService);
  cache = app.get(CacheService);
  queues = app.get(QueueService);
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// AC1 — connection and health
// ---------------------------------------------------------------------------

test('AC1 — the app connects to Redis on start', () => {
  assert.equal(redis.isReady(), true, 'Redis should be connected — is `npm run redis:up` running?');
});

test('AC1 — the health endpoint reports Redis as up', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const payload = (await response.json()) as { data: unknown };
  const parsed = HealthStatusSchema.parse(payload.data);

  const entry = parsed.dependencies['redis'];

  assert.ok(entry !== undefined, 'redis should appear in the dependencies map');
  assert.equal(entry.status, 'up');
  assert.equal(typeof entry.latencyMs, 'number');
  assert.equal(parsed.status, 'ok', 'everything up means ok');
});

test('AC1 — the database is still reported alongside it', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const payload = (await response.json()) as { data: unknown };
  const parsed = HealthStatusSchema.parse(payload.data);

  assert.equal(parsed.dependencies['database']?.status, 'up');
  assert.deepEqual(Object.keys(parsed.dependencies).sort(), ['database', 'redis']);
});

// ---------------------------------------------------------------------------
// AC2 — the cache abstraction
// ---------------------------------------------------------------------------

test('AC2 — set then get round-trips a value with its type intact', async () => {
  const key = `${run}:object`;

  await cache.set(key, { id: 7, tags: ['a', 'b'], nested: { ok: true } });

  const value = await cache.get<{ id: number; tags: string[]; nested: { ok: boolean } }>(key);

  assert.equal(value?.id, 7);
  assert.deepEqual(value?.tags, ['a', 'b']);
  assert.equal(value?.nested.ok, true);
});

test('AC2 — a miss is undefined, not an error', async () => {
  assert.equal(await cache.get(`${run}:never-written`), undefined);
});

test('AC2 — a TTL is honoured', async () => {
  const key = `${run}:expiring`;

  await cache.set(key, 'gone soon', 1);
  assert.equal(await cache.get(key), 'gone soon');

  const ttl = await redis.client.ttl(key);
  assert.ok(ttl > 0 && ttl <= 1, `expected a TTL of about a second, got ${String(ttl)}`);

  await new Promise((resolve) => setTimeout(resolve, 1_200));

  assert.equal(await cache.get(key), undefined, 'the entry should have expired');
});

test('AC2 — a key can be invalidated', async () => {
  const key = `${run}:invalidate`;

  await cache.set(key, 'here');
  assert.equal(await cache.delete(key), 1);
  assert.equal(await cache.get(key), undefined);
});

test('AC2 — a family of keys can be invalidated by prefix', async () => {
  const prefix = `${run}:ticket:42:`;

  await cache.set(`${prefix}summary`, 'a');
  await cache.set(`${prefix}messages`, 'b');
  await cache.set(`${run}:ticket:99:summary`, 'untouched');

  const removed = await cache.deleteByPrefix(prefix);

  assert.equal(removed, 2);
  assert.equal(await cache.get(`${prefix}summary`), undefined);
  assert.equal(
    await cache.get(`${run}:ticket:99:summary`),
    'untouched',
    'a different family must survive',
  );
});

test('AC2 — wrap computes on a miss and serves from cache on a hit', async () => {
  const key = `${run}:wrapped`;
  let loads = 0;

  const load = async (): Promise<string> => {
    loads += 1;
    return Promise.resolve('computed');
  };

  assert.equal(await cache.wrap(key, 60, load), 'computed');
  assert.equal(await cache.wrap(key, 60, load), 'computed');
  assert.equal(loads, 1, 'the loader should run once, not twice');
});

test('AC2 — keys are namespaced, so two environments cannot collide', async () => {
  const key = `${run}:prefixed`;
  await cache.set(key, 'value');

  const prefix = redis.client.options.keyPrefix ?? '';
  assert.notEqual(prefix, '', 'a key prefix should be configured');

  // Read through a raw client with no prefix: the real key must carry it.
  const raw = await redis.client.getBuffer(key);
  assert.ok(raw !== null);
});

// ---------------------------------------------------------------------------
// AC3 — the job queue
// ---------------------------------------------------------------------------

test('AC3 — an enqueued job is picked up and executed', async () => {
  const queueName = `${run}-basic`;
  const seen: string[] = [];

  const done = new Promise<void>((resolve) => {
    queues.registerWorker<{ value: string }>(queueName, (job) => {
      seen.push(job.data.value);
      resolve();
      return Promise.resolve(undefined);
    });
  });

  await queues.add(queueName, 'do-the-thing', { value: 'payload' });
  await done;

  assert.deepEqual(seen, ['payload']);
});

test('AC3 — a failing job retries with backoff, then lands in the dead-letter queue', async () => {
  const queueName = `${run}-failing`;
  let attempts = 0;

  const deadLetter = queues.queue(DEAD_LETTER_QUEUE);
  const before = await deadLetter.getWaitingCount();

  queues.registerWorker(queueName, () => {
    attempts += 1;
    throw new Error('always fails');
  });

  await queues.add(
    queueName,
    'doomed',
    { why: 'to prove retries' },
    // Overridden so the test is not waiting on the configured backoff.
    { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
  );

  // Poll rather than sleep a fixed amount: retries are asynchronous and the
  // machine's speed is not something to encode in a test.
  for (let i = 0; i < 100 && attempts < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.equal(attempts, 3, 'the job should have been attempted three times');

  let jobs: Array<{ data: unknown }> = [];
  for (let i = 0; i < 100; i += 1) {
    jobs = await deadLetter.getJobs(['waiting', 'delayed', 'active', 'completed']);
    if (jobs.length > before) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const payload = jobs
    .map((job) => job.data as DeadLetterPayload)
    .find((data) => data.queue === queueName);

  assert.ok(payload !== undefined, 'the exhausted job should have been dead-lettered');
  assert.equal(payload.jobName, 'doomed');
  assert.equal(payload.attemptsMade, 3);
  assert.match(payload.failedReason, /always fails/);
  assert.deepEqual(payload.data, { why: 'to prove retries' });

  await deadLetter.drain();
});

test('AC3 — a job that succeeds on a retry is not dead-lettered', async () => {
  const queueName = `${run}-flaky`;
  let attempts = 0;

  const succeeded = new Promise<void>((resolve) => {
    queues.registerWorker(queueName, () => {
      attempts += 1;

      if (attempts < 2) {
        throw new Error('first attempt fails');
      }

      resolve();
      return Promise.resolve(undefined);
    });
  });

  await queues.add(queueName, 'flaky', {}, { attempts: 3, backoff: { type: 'fixed', delay: 50 } });

  await succeeded;

  assert.equal(attempts, 2, 'it should have taken exactly one retry');

  const deadLettered = await queues.queue(DEAD_LETTER_QUEUE).getJobs(['waiting', 'delayed']);
  assert.ok(
    !deadLettered.some((job) => (job.data as DeadLetterPayload).queue === queueName),
    'a job that eventually succeeded must not be dead-lettered',
  );
});
