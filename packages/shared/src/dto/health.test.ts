import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DependencyStatusSchema, HealthStatusSchema } from './health.js';

const valid = {
  status: 'ok',
  service: 'backend',
  timestamp: '2026-08-25T18:00:00.000Z',
  dependencies: {
    database: { status: 'up', latencyMs: 3 },
  },
};

test('accepts a well-formed payload', () => {
  const parsed = HealthStatusSchema.parse(valid);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.service, 'backend');
  assert.equal(parsed.dependencies['database']?.status, 'up');
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

test('rejects a missing dependencies map', () => {
  const { dependencies: _omitted, ...withoutDependencies } = valid;
  assert.throws(() => HealthStatusSchema.parse(withoutDependencies), { name: 'ZodError' });
});

test('accepts an empty dependencies map — a service may depend on nothing', () => {
  assert.doesNotThrow(() => HealthStatusSchema.parse({ ...valid, dependencies: {} }));
});

test('accepts more than one dependency, which is how US-10 adds redis', () => {
  const parsed = HealthStatusSchema.parse({
    ...valid,
    status: 'degraded',
    dependencies: {
      database: { status: 'up', latencyMs: 2 },
      redis: { status: 'down', latencyMs: 0, error: 'ECONNREFUSED' },
    },
  });

  assert.equal(parsed.dependencies['redis']?.error, 'ECONNREFUSED');
});

test('rejects a dependency status outside the enum', () => {
  assert.throws(
    () => HealthStatusSchema.parse({ ...valid, dependencies: { database: { status: 'maybe' } } }),
    { name: 'ZodError' },
  );
});

test('rejects a negative latency', () => {
  assert.throws(() => DependencyStatusSchema.parse({ status: 'up', latencyMs: -1 }), {
    name: 'ZodError',
  });
});

test('error is optional on a healthy dependency', () => {
  const parsed = DependencyStatusSchema.parse({ status: 'up', latencyMs: 0 });
  assert.equal(parsed.error, undefined);
});
