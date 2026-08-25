import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { HealthStatusSchema } from '@crm/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/index.js';

let app: INestApplication;
let baseUrl: string;

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  await app.init();
  await app.listen(0, '127.0.0.1');

  // getHttpServer() is typed `any` by Nest; narrow it once, here.
  const server = app.getHttpServer() as Server;
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

after(async () => {
  await app.close();
});

test('GET /health returns 200 (AC1)', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
});

test('GET /health body satisfies the shared HealthStatus DTO', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const payload = (await response.json()) as { data: unknown };
  const body: unknown = payload.data;

  // Parsing with the shared schema is the assertion: if the backend ever grows
  // its own health shape, this fails.
  const parsed = HealthStatusSchema.parse(body);

  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.service, 'backend');
  assert.ok(!Number.isNaN(Date.parse(parsed.timestamp)));
});

test('AC1 — the health endpoint reports the database as up', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const parsed = HealthStatusSchema.parse(((await response.json()) as { data: unknown }).data);

  const database = parsed.dependencies['database'];

  assert.ok(database !== undefined, 'the database should appear in the dependencies map');
  assert.equal(database.status, 'up');
  assert.equal(database.error, undefined, 'a healthy dependency should carry no error');
  assert.equal(typeof database.latencyMs, 'number');
  assert.ok(database.latencyMs >= 0);
  assert.equal(parsed.status, 'ok', 'overall status should be ok when every dependency is up');
});

test('an unknown route is a 404, so routing is real and not a catch-all', async () => {
  const response = await fetch(`${baseUrl}/no-such-route`);
  assert.equal(response.status, 404);
});

/**
 * The failure path, in its own application instance so the healthy tests above
 * are unaffected. `$queryRaw` is replaced with one that rejects, which is what
 * a real outage looks like from the service's point of view.
 */
test('AC1 — a database outage is reported, not thrown', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const failingApp = moduleRef.createNestApplication();
  failingApp.enableShutdownHooks();
  await failingApp.init();

  const prisma = failingApp.get(PrismaService);
  const originalQueryRaw = prisma.$queryRaw.bind(prisma);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  (prisma as any).$queryRaw = (): Promise<never> => Promise.reject(new Error('connection refused'));

  try {
    await failingApp.listen(0, '127.0.0.1');
    const server = failingApp.getHttpServer() as Server;
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/health`);

    assert.equal(response.status, 200, 'a down dependency is still a successful report');

    const parsed = HealthStatusSchema.parse(((await response.json()) as { data: unknown }).data);
    const database = parsed.dependencies['database'];

    assert.ok(database !== undefined);
    assert.equal(database.status, 'down');
    assert.match(database.error ?? '', /connection refused/);
    assert.equal(parsed.status, 'down', 'the database is critical, so the service is down');
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    (prisma as any).$queryRaw = originalQueryRaw;
    await failingApp.close();
  }
});
