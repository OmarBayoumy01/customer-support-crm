import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EnvSchema, formatEnvIssues, validateEnv } from './env.schema.js';

/**
 * `DATABASE_URL` has no default — a service that cannot reach its database must
 * not boot — so every "happy path" parse has to supply one.
 */
const DATABASE_URL = 'postgresql://crm:crm_local_dev@127.0.0.1:5432/crm?schema=public';

/** Required alongside it since US-10. Bundled so each case names only what it tests. */
const REDIS_URL = 'redis://127.0.0.1:6379/0';
const REQUIRED = { DATABASE_URL, REDIS_URL };

test('applies defaults when only the required variables are supplied', () => {
  const parsed = EnvSchema.parse({ ...REQUIRED });
  assert.equal(parsed.NODE_ENV, 'development');
  assert.equal(parsed.PORT, 3000);
  assert.equal(parsed.HOST, '0.0.0.0');
  assert.equal(parsed.DATABASE_POOL_SIZE, 10);
  assert.equal(parsed.DATABASE_CONNECTION_TIMEOUT_MS, 5000);
});

test('coerces a numeric string PORT', () => {
  assert.equal(EnvSchema.parse({ ...REQUIRED, PORT: '8080' }).PORT, 8080);
});

test('rejects a non-numeric PORT and names the variable (AC2)', () => {
  const result = EnvSchema.safeParse({ ...REQUIRED, PORT: 'nope' });
  assert.equal(result.success, false);
  assert.ok(result.success === false);
  assert.match(formatEnvIssues(result.error), /^Config validation failed:/);
  assert.match(formatEnvIssues(result.error), /PORT/);
});

test('rejects a PORT above the valid range', () => {
  const result = EnvSchema.safeParse({ ...REQUIRED, PORT: '70000' });
  assert.equal(result.success, false);
});

test('rejects a PORT of zero', () => {
  assert.equal(EnvSchema.safeParse({ ...REQUIRED, PORT: '0' }).success, false);
});

test('rejects a NODE_ENV outside the enum and names it', () => {
  const result = EnvSchema.safeParse({ ...REQUIRED, NODE_ENV: 'prod' });
  assert.ok(result.success === false);
  assert.match(formatEnvIssues(result.error), /NODE_ENV/);
});

test('rejects an empty HOST', () => {
  assert.equal(EnvSchema.safeParse({ ...REQUIRED, HOST: '' }).success, false);
});

test('validateEnv returns the parsed value on success', () => {
  assert.equal(validateEnv({ ...REQUIRED, PORT: '4321' }).PORT, 4321);
});

test('rejects a missing DATABASE_URL and names it', () => {
  const result = EnvSchema.safeParse({});
  assert.ok(result.success === false);
  assert.match(formatEnvIssues(result.error), /DATABASE_URL/);
});

test('rejects an empty DATABASE_URL', () => {
  assert.equal(EnvSchema.safeParse({ ...REQUIRED, DATABASE_URL: '' }).success, false);
});

test('rejects a DATABASE_URL for a different database engine', () => {
  const result = EnvSchema.safeParse({
    ...REQUIRED,
    DATABASE_URL: 'mysql://user:pass@127.0.0.1:3306/crm',
  });
  assert.ok(result.success === false);
  assert.match(formatEnvIssues(result.error), /postgresql/);
});

test('accepts the postgres:// scheme as well as postgresql://', () => {
  assert.equal(
    EnvSchema.safeParse({ ...REQUIRED, DATABASE_URL: 'postgres://crm:pw@127.0.0.1:5432/crm' })
      .success,
    true,
  );
});

test('coerces and bounds DATABASE_POOL_SIZE', () => {
  assert.equal(EnvSchema.parse({ ...REQUIRED, DATABASE_POOL_SIZE: '25' }).DATABASE_POOL_SIZE, 25);
  assert.equal(EnvSchema.safeParse({ ...REQUIRED, DATABASE_POOL_SIZE: '0' }).success, false);
  assert.equal(EnvSchema.safeParse({ ...REQUIRED, DATABASE_POOL_SIZE: '101' }).success, false);
});

test('rejects a non-positive DATABASE_CONNECTION_TIMEOUT_MS', () => {
  assert.equal(
    EnvSchema.safeParse({ ...REQUIRED, DATABASE_CONNECTION_TIMEOUT_MS: '-1' }).success,
    false,
  );
});

test('rejects a missing REDIS_URL and names it', () => {
  const result = EnvSchema.safeParse({ DATABASE_URL });
  assert.ok(result.success === false);
  assert.match(formatEnvIssues(result.error), /REDIS_URL/);
});

test('rejects a REDIS_URL that is not a redis scheme', () => {
  const result = EnvSchema.safeParse({ ...REQUIRED, REDIS_URL: 'http://127.0.0.1:6379' });
  assert.ok(result.success === false);
  assert.match(formatEnvIssues(result.error), /redis/);
});

test('accepts the TLS rediss:// scheme', () => {
  assert.equal(
    EnvSchema.safeParse({ ...REQUIRED, REDIS_URL: 'rediss://cache.internal:6380' }).success,
    true,
  );
});

test('applies the Redis and queue defaults', () => {
  const parsed = EnvSchema.parse({ ...REQUIRED });
  assert.equal(parsed.REDIS_KEY_PREFIX, 'crm:');
  assert.equal(parsed.CACHE_TTL_SECONDS, 300);
  assert.equal(parsed.QUEUE_MAX_ATTEMPTS, 3);
  assert.equal(parsed.QUEUE_BACKOFF_MS, 1000);
});

test('bounds QUEUE_MAX_ATTEMPTS, so a job cannot retry forever', () => {
  assert.equal(EnvSchema.safeParse({ ...REQUIRED, QUEUE_MAX_ATTEMPTS: '0' }).success, false);
  assert.equal(EnvSchema.safeParse({ ...REQUIRED, QUEUE_MAX_ATTEMPTS: '21' }).success, false);
});
