import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { HealthStatusSchema } from '@crm/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';

let app: INestApplication;
let baseUrl: string;

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
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
  const body: unknown = await response.json();

  // Parsing with the shared schema is the assertion: if the backend ever grows
  // its own health shape, this fails.
  const parsed = HealthStatusSchema.parse(body);

  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.service, 'backend');
  assert.ok(!Number.isNaN(Date.parse(parsed.timestamp)));
});

test('an unknown route is a 404, so routing is real and not a catch-all', async () => {
  const response = await fetch(`${baseUrl}/no-such-route`);
  assert.equal(response.status, 404);
});
