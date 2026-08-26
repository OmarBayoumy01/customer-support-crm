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

/**
 * Required since US-14, and for a sharper reason than the two above: a signing
 * key with a default is a signing key every attacker already has.
 */
const JWT_ACCESS_SECRET = 'test-only-access-secret-0123456789abcdefghijklmnop';
const JWT_REFRESH_SECRET = 'test-only-refresh-secret-0123456789abcdefghijklmnop';

const REQUIRED = { DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET };

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
  const result = EnvSchema.safeParse({ DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET });
  assert.ok(result.success === false);
  assert.match(formatEnvIssues(result.error), /REDIS_URL/);
});

// --- Authentication (US-14) ------------------------------------------------

test('rejects a missing JWT_ACCESS_SECRET and names it', () => {
  const result = EnvSchema.safeParse({ DATABASE_URL, REDIS_URL, JWT_REFRESH_SECRET });
  assert.ok(result.success === false);
  assert.match(formatEnvIssues(result.error), /JWT_ACCESS_SECRET/);
});

test('rejects a missing JWT_REFRESH_SECRET and names it', () => {
  const result = EnvSchema.safeParse({ DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET });
  assert.ok(result.success === false);
  assert.match(formatEnvIssues(result.error), /JWT_REFRESH_SECRET/);
});

test('rejects a JWT secret that is too short to be worth signing with', () => {
  const result = EnvSchema.safeParse({ ...REQUIRED, JWT_ACCESS_SECRET: 'too-short' });
  assert.ok(result.success === false);
  assert.match(formatEnvIssues(result.error), /at least 32 characters/);
});

test('neither JWT secret has a default — the service must not boot without one', () => {
  // The whole point: a default here would be a shared secret published in the
  // repository, and every token the platform ever issued would be forgeable.
  const parsed = EnvSchema.parse({ ...REQUIRED });
  assert.equal(parsed.JWT_ACCESS_SECRET, JWT_ACCESS_SECRET);
  assert.equal(parsed.JWT_REFRESH_SECRET, JWT_REFRESH_SECRET);
});

test('applies the authentication defaults, including AC6 fifteen minutes', () => {
  const parsed = EnvSchema.parse({ ...REQUIRED });

  assert.equal(parsed.JWT_ACCESS_TTL_SECONDS, 900);
  assert.equal(parsed.JWT_REFRESH_TTL_SECONDS, 2_592_000);
  assert.equal(parsed.JWT_ISSUER, 'crm');
  assert.equal(parsed.ARGON2_MEMORY_COST, 19_456);
  assert.equal(parsed.ARGON2_TIME_COST, 2);
  assert.equal(parsed.ARGON2_PARALLELISM, 1);
  assert.equal(parsed.LOGIN_MAX_ATTEMPTS_PER_EMAIL, 5);
  assert.equal(parsed.LOGIN_MAX_ATTEMPTS_PER_IP, 20);
  assert.equal(parsed.LOGIN_THROTTLE_WINDOW_SECONDS, 900);
});

test('COOKIE_SECURE defaults to false and reads the string spellings', () => {
  // Off by default only so a developer on plain http://localhost receives the
  // cookie at all. `z.coerce.boolean()` would make the string "false" true,
  // which is exactly the bug BooleanFromString exists to avoid.
  assert.equal(EnvSchema.parse({ ...REQUIRED }).COOKIE_SECURE, false);
  assert.equal(EnvSchema.parse({ ...REQUIRED, COOKIE_SECURE: 'false' }).COOKIE_SECURE, false);
  assert.equal(EnvSchema.parse({ ...REQUIRED, COOKIE_SECURE: 'true' }).COOKIE_SECURE, true);
});

test('SEED_PASSWORD is optional, and short ones are refused', () => {
  assert.equal(EnvSchema.parse({ ...REQUIRED }).SEED_PASSWORD, undefined);
  assert.equal(EnvSchema.safeParse({ ...REQUIRED, SEED_PASSWORD: 'short' }).success, false);
  assert.equal(
    EnvSchema.parse({ ...REQUIRED, SEED_PASSWORD: 'DevPassw0rd!' }).SEED_PASSWORD,
    'DevPassw0rd!',
  );
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
