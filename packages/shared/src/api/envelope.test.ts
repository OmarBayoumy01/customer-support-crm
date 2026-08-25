import assert from 'node:assert/strict';
import { test } from 'node:test';

import { z } from 'zod';

import {
  ApiErrorSchema,
  apiPaginatedSchema,
  apiSuccessSchema,
  buildPaginationMeta,
} from './envelope.js';
import { MAX_PAGE_SIZE, PaginationQuerySchema, toSkipTake } from './pagination.js';

test('the success envelope types its payload', () => {
  const schema = apiSuccessSchema(z.object({ id: z.string() }));
  const parsed = schema.parse({ data: { id: 'abc' } });

  assert.equal(parsed.data.id, 'abc');
});

test('the paginated envelope requires both halves', () => {
  const schema = apiPaginatedSchema(z.object({ id: z.string() }));

  assert.throws(() => schema.parse({ data: [{ id: 'a' }] }), { name: 'ZodError' });
});

test('an error envelope round-trips', () => {
  const parsed = ApiErrorSchema.parse({
    error: {
      statusCode: 422,
      code: 'VALIDATION_FAILED',
      message: 'nope',
      details: [{ path: 'name', message: 'too short' }],
      requestId: 'abc',
      timestamp: '2026-08-26T10:00:00.000Z',
    },
  });

  assert.equal(parsed.error.details?.[0]?.path, 'name');
});

test('an unknown error code is rejected', () => {
  assert.throws(
    () =>
      ApiErrorSchema.parse({
        error: {
          statusCode: 500,
          code: 'KABOOM',
          message: 'x',
          requestId: 'a',
          timestamp: '2026-08-26T10:00:00.000Z',
        },
      }),
    { name: 'ZodError' },
  );
});

test('pagination metadata is derived consistently', () => {
  assert.deepEqual(buildPaginationMeta({ page: 2, pageSize: 10, total: 53 }), {
    page: 2,
    pageSize: 10,
    total: 53,
    totalPages: 6,
    hasNext: true,
    hasPrevious: true,
  });
});

test('the last page reports no next', () => {
  const meta = buildPaginationMeta({ page: 6, pageSize: 10, total: 53 });
  assert.equal(meta.hasNext, false);
  assert.equal(meta.hasPrevious, true);
});

test('an empty result set is not a page you can go back from', () => {
  const meta = buildPaginationMeta({ page: 1, pageSize: 25, total: 0 });
  assert.deepEqual(meta, {
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrevious: false,
  });
});

test('pagination query coerces strings and applies defaults', () => {
  assert.deepEqual(PaginationQuerySchema.parse({}), { page: 1, pageSize: 25 });
  assert.deepEqual(PaginationQuerySchema.parse({ page: '3', pageSize: '10' }), {
    page: 3,
    pageSize: 10,
  });
});

test('pageSize is clamped, not rejected', () => {
  assert.equal(PaginationQuerySchema.parse({ pageSize: '9999' }).pageSize, MAX_PAGE_SIZE);
});

test('a zero or negative page is rejected outright', () => {
  assert.equal(PaginationQuerySchema.safeParse({ page: '0' }).success, false);
  assert.equal(PaginationQuerySchema.safeParse({ page: '-2' }).success, false);
});

test('skip and take are derived from a 1-based page', () => {
  assert.deepEqual(toSkipTake({ page: 1, pageSize: 25 }), { skip: 0, take: 25 });
  assert.deepEqual(toSkipTake({ page: 3, pageSize: 10 }), { skip: 20, take: 10 });
});
