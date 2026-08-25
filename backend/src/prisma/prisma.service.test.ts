import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { PrismaService } from './prisma.service.js';

let app: INestApplication;
let prisma: PrismaService;

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();

  // Shutdown hooks are what make onModuleDestroy run on app.close(), which is
  // what the pool-release test below actually exercises.
  app.enableShutdownHooks();
  await app.init();

  prisma = app.get(PrismaService);
});

after(async () => {
  // The last test closes the app itself, so this is usually the second close.
  // That is deliberate: it means a failure earlier in the file still tears the
  // pool down instead of hanging the runner — and it is also the assertion that
  // PrismaService.onModuleDestroy is idempotent, since pg throws "Called end on
  // pool more than once" if the guard there is ever removed.
  await app.close();
});

test('AC3 — generated model types are available and correctly typed', async () => {
  const created = await prisma.migrationProbe.create({ data: { note: 'type-generation' } });

  assert.equal(typeof created.id, 'string');
  assert.equal(created.note, 'type-generation');
  assert.ok(created.createdAt instanceof Date, 'createdAt should be a Date, not a string');

  const found = await prisma.migrationProbe.findUnique({ where: { id: created.id } });
  assert.equal(found?.note, 'type-generation');

  await prisma.migrationProbe.delete({ where: { id: created.id } });
});

test('AC3 — an unknown field on the create input is a compile error', () => {
  // The assertion here is `@ts-expect-error` itself: if the generated types
  // ever stop constraining the input, this file fails to compile and
  // `npm run test` (which runs `tsc -b` first) fails. That is what makes AC3 a
  // real type-safety check rather than a runtime one.
  //
  // Never awaited or executed — building the promise is enough for the compiler.
  const build = (): unknown =>
    // @ts-expect-error `nope` is not a field on MigrationProbe
    prisma.migrationProbe.create({ data: { note: 'x', nope: true } });

  assert.equal(typeof build, 'function');
});

test('AC4 — concurrent queries are pooled, never exceeding the configured size', async () => {
  const poolSize = prisma.poolSize();
  assert.ok(poolSize > 0, 'pool size should be configured');

  const results = await Promise.all(
    Array.from({ length: 25 }, () => prisma.migrationProbe.count()),
  );

  assert.equal(results.length, 25);
  assert.equal(new Set(results).size, 1, 'every concurrent count should agree');

  const stats = prisma.poolStats();
  assert.ok(
    stats.total <= poolSize,
    `pool held ${String(stats.total)} connections, above the configured max of ${String(poolSize)}`,
  );
  assert.equal(stats.waiting, 0, 'no request should still be waiting once all have resolved');
});

test('AC4 — connections are released rather than leaked, and are reused', async () => {
  const before = prisma.poolStats();

  await Promise.all(Array.from({ length: 25 }, () => prisma.migrationProbe.count()));

  const after = prisma.poolStats();

  assert.equal(
    after.idle,
    after.total,
    'every connection should be back to idle once the queries have resolved',
  );
  assert.ok(
    after.total <= Math.max(before.total, prisma.poolSize()),
    'a second burst should reuse the pool rather than growing it',
  );
});

test('AC4 — shutting the app down closes the pool', async () => {
  assert.ok(prisma.poolStats().total > 0, 'the pool should hold connections before shutdown');

  await app.close();

  // $disconnect() alone leaves these open on Prisma 7 — this is the assertion
  // that keeps the pool.end() in PrismaService.onModuleDestroy honest.
  assert.equal(prisma.poolStats().total, 0, 'the pool should hold no connections after close');
});
