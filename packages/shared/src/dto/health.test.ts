import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HealthStatusSchema } from './health.js';

const valid = {
  status: 'ok',
  service: 'backend',
  timestamp: '2026-08-25T18:00:00.000Z',
};

test('accepts a well-formed payload', () => {
  const parsed = HealthStatusSchema.parse(valid);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.service, 'backend');
});

test('rejects a missing service', () => {
  const { service: _omitted, ...withoutService } = valid;
  assert.throws(() => HealthStatusSchema.parse(withoutService), { name: 'ZodError' });
});

test('rejects an empty service', () => {
  assert.throws(() => HealthStatusSchema.parse({ ...valid, service: '' }), { name: 'ZodError' });
});

test('rejects a status outside the enum', () => {
  assert.throws(() => HealthStatusSchema.parse({ ...valid, status: 'fine' }), { name: 'ZodError' });
});

test('rejects a non-ISO timestamp', () => {
  assert.throws(() => HealthStatusSchema.parse({ ...valid, timestamp: '25 Aug 2026' }), {
    name: 'ZodError',
  });
});
