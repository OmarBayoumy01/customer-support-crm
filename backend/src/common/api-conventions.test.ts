import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ApiErrorSchema, buildPaginationMeta, PaginationQuerySchema } from '@crm/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import { ApiException } from './errors/api.exception.js';
import { NoEnvelope } from './decorators/no-envelope.decorator.js';
import { CommonModule } from './common.module.js';
import { REQUEST_ID_HEADER } from './request-context/request-id.middleware.js';
import { createZodDto } from './validation/create-zod-dto.js';

// --- A controller that exists only to exercise the conventions --------------

const CreateThingSchema = z.object({
  name: z.string().min(3),
  quantity: z.coerce.number().int().positive(),
  nested: z.object({ flag: z.boolean() }).optional(),
});

class CreateThingDto extends createZodDto(CreateThingSchema) {}
class ListQueryDto extends createZodDto(PaginationQuerySchema) {}

@Controller('conventions')
class ConventionsController {
  @Get('single')
  single(): { id: string; name: string } {
    return { id: 'abc', name: 'A thing' };
  }

  @Get('list')
  list(@Query() query: ListQueryDto): unknown {
    const total = 53;
    return {
      data: [{ id: '1' }, { id: '2' }],
      pagination: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
    };
  }

  @Post('things')
  @HttpCode(200)
  create(@Body() body: CreateThingDto): unknown {
    return { received: body };
  }

  @Get('not-found')
  notFound(): never {
    throw ApiException.notFound('The thing');
  }

  @Get('nest-not-found')
  nestNotFound(): never {
    throw new NotFoundException('Nest said no');
  }

  @Get('boom')
  boom(): never {
    throw new Error('a very internal failure at /var/secret/path with SELECT * FROM "User"');
  }

  @Get('raw')
  @NoEnvelope()
  raw(): { plain: boolean } {
    return { plain: true };
  }

  @Get('echo/:id')
  echo(@Param('id') id: string): { id: string } {
    return { id };
  }
}

@Module({ imports: [CommonModule], controllers: [ConventionsController] })
class ConventionsTestModule {}

let app: INestApplication;
let baseUrl: string;

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [ConventionsTestModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// AC1 — success envelope
// ---------------------------------------------------------------------------

test('AC1 — a single resource comes back wrapped in { data }', async () => {
  const response = await fetch(`${baseUrl}/conventions/single`);
  const body = (await response.json()) as { data?: { id: string; name: string } };

  assert.equal(response.status, 200);
  assert.deepEqual(body, { data: { id: 'abc', name: 'A thing' } });
});

test('AC1 — a list carries pagination metadata and is not double-wrapped', async () => {
  const response = await fetch(`${baseUrl}/conventions/list?page=2&pageSize=10`);
  const body = (await response.json()) as {
    data: unknown[];
    pagination: Record<string, unknown>;
  };

  assert.equal(body.data.length, 2);
  assert.deepEqual(body.pagination, {
    page: 2,
    pageSize: 10,
    total: 53,
    totalPages: 6,
    hasNext: true,
    hasPrevious: true,
  });
  assert.ok(!('data' in (body.data as unknown as object)), 'the payload must not be nested twice');
});

test('AC1 — pagination defaults apply when the query omits them', async () => {
  const response = await fetch(`${baseUrl}/conventions/list`);
  const body = (await response.json()) as { pagination: { page: number; pageSize: number } };

  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.pageSize, 25);
});

test('AC1 — an oversized pageSize is clamped rather than rejected', async () => {
  const response = await fetch(`${baseUrl}/conventions/list?pageSize=5000`);
  const body = (await response.json()) as { pagination: { pageSize: number } };

  assert.equal(response.status, 200);
  assert.equal(body.pagination.pageSize, 100);
});

test('AC1 — @NoEnvelope opts a route out', async () => {
  const response = await fetch(`${baseUrl}/conventions/raw`);
  assert.deepEqual(await response.json(), { plain: true });
});

// ---------------------------------------------------------------------------
// AC3 — validation runs before controller logic
// ---------------------------------------------------------------------------

test('AC3 — an invalid body is rejected with 422 and per-field details', async () => {
  const response = await fetch(`${baseUrl}/conventions/things`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'no', quantity: -1 }),
  });

  assert.equal(response.status, 422);

  const body = ApiErrorSchema.parse(await response.json());

  assert.equal(body.error.code, 'VALIDATION_FAILED');
  assert.equal(body.error.statusCode, 422);

  const paths = (body.error.details ?? []).map((detail) => detail.path);
  assert.ok(paths.includes('name'), `expected a name error, got ${paths.join(', ')}`);
  assert.ok(paths.includes('quantity'), `expected a quantity error, got ${paths.join(', ')}`);
});

test('AC3 — a nested field reports a dotted path the frontend can map back', async () => {
  const response = await fetch(`${baseUrl}/conventions/things`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'valid', quantity: 1, nested: { flag: 'not a boolean' } }),
  });

  const body = ApiErrorSchema.parse(await response.json());
  const paths = (body.error.details ?? []).map((detail) => detail.path);

  assert.ok(paths.includes('nested.flag'), `expected nested.flag, got ${paths.join(', ')}`);
});

test('AC3 — the controller never runs when validation fails', async () => {
  // If the pipe let this through, the handler would echo it back with 200.
  const response = await fetch(`${baseUrl}/conventions/things`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  });

  assert.equal(response.status, 422);
  const body = (await response.json()) as { received?: unknown };
  assert.equal(body.received, undefined);
});

test('AC3 — a valid body reaches the controller coerced, not just checked', async () => {
  const response = await fetch(`${baseUrl}/conventions/things`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'valid name', quantity: '7' }),
  });

  assert.equal(response.status, 200);

  const body = (await response.json()) as { data: { received: { quantity: unknown } } };
  assert.equal(
    body.data.received.quantity,
    7,
    'the string "7" should arrive at the controller as a number',
  );
});

// ---------------------------------------------------------------------------
// AC2 — error shape
// ---------------------------------------------------------------------------

test('AC2 — an ApiException carries its own code and status', async () => {
  const response = await fetch(`${baseUrl}/conventions/not-found`);

  assert.equal(response.status, 404);

  const body = ApiErrorSchema.parse(await response.json());
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.match(body.error.message, /was not found/);
  assert.equal(body.error.details, undefined, 'a non-validation error carries no field details');
});

test("AC2 — Nest's own exceptions are mapped onto the same shape", async () => {
  const response = await fetch(`${baseUrl}/conventions/nest-not-found`);

  assert.equal(response.status, 404);

  const body = ApiErrorSchema.parse(await response.json());
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(body.error.message, 'Nest said no');
});

test('AC2 — a 404 from an unknown route uses the envelope too', async () => {
  const response = await fetch(`${baseUrl}/no-such-route-at-all`);

  assert.equal(response.status, 404);

  // Nest raises its own NotFoundException for an unmatched route, so this
  // proves the filter catches what the framework throws, not only what we do.
  const body = ApiErrorSchema.parse(await response.json());
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.ok(body.error.requestId.length > 0);
});

// ---------------------------------------------------------------------------
// AC4 — nothing internal leaks
// ---------------------------------------------------------------------------

test('AC4 — an unhandled exception exposes no stack, path, or SQL', async () => {
  const response = await fetch(`${baseUrl}/conventions/boom`);

  assert.equal(response.status, 500);

  const raw = await response.text();

  assert.doesNotMatch(raw, /var\/secret\/path/, 'a filesystem path leaked to the client');
  assert.doesNotMatch(raw, /SELECT \* FROM/i, 'SQL leaked to the client');
  assert.doesNotMatch(raw, /\bat .*\.js:\d+/, 'a stack frame leaked to the client');

  const body = ApiErrorSchema.parse(JSON.parse(raw));
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(body.error.message, 'Something went wrong on our side.');
});

// ---------------------------------------------------------------------------
// AC5 — correlation
// ---------------------------------------------------------------------------

test('AC5 — every response carries a request id header', async () => {
  const response = await fetch(`${baseUrl}/conventions/single`);
  const id = response.headers.get(REQUEST_ID_HEADER);

  assert.ok(id !== null && id.length > 0, 'x-request-id should be set on every response');
});

test('AC5 — two requests get different ids', async () => {
  const first = await fetch(`${baseUrl}/conventions/single`);
  const second = await fetch(`${baseUrl}/conventions/single`);

  assert.notEqual(first.headers.get(REQUEST_ID_HEADER), second.headers.get(REQUEST_ID_HEADER));
});

test('AC5 — an inbound request id is honoured so a trace survives', async () => {
  const response = await fetch(`${baseUrl}/conventions/single`, {
    headers: { [REQUEST_ID_HEADER]: 'trace-from-the-gateway' },
  });

  assert.equal(response.headers.get(REQUEST_ID_HEADER), 'trace-from-the-gateway');
});

test('AC5 — a hostile inbound request id is stripped, not echoed', async () => {
  const response = await fetch(`${baseUrl}/conventions/single`, {
    headers: { [REQUEST_ID_HEADER]: 'abc<script>alert(1)</script>' },
  });

  const echoed = response.headers.get(REQUEST_ID_HEADER) ?? '';

  assert.doesNotMatch(echoed, /[<>()]/, 'the header must not echo markup back');
  assert.equal(echoed, 'abcscriptalert1script');
});

test('AC5 — the error body carries the same request id as the header', async () => {
  const response = await fetch(`${baseUrl}/conventions/not-found`, {
    headers: { [REQUEST_ID_HEADER]: 'quoted-by-the-user' },
  });

  const body = ApiErrorSchema.parse(await response.json());

  assert.equal(body.error.requestId, 'quoted-by-the-user');
  assert.equal(response.headers.get(REQUEST_ID_HEADER), 'quoted-by-the-user');
});
