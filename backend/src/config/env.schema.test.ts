import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EnvSchema, formatEnvIssues, validateEnv } from './env.schema.js';

test('applies defaults when nothing is supplied', () => {
  const parsed = EnvSchema.parse({});
  assert.equal(parsed.NODE_ENV, 'development');
  assert.equal(parsed.PORT, 3000);
  assert.equal(parsed.HOST, '0.0.0.0');
});

test('coerces a numeric string PORT', () => {
  assert.equal(EnvSchema.parse({ PORT: '8080' }).PORT, 8080);
});

test('rejects a non-numeric PORT and names the variable (AC2)', () => {
  const result = EnvSchema.safeParse({ PORT: 'nope' });
  assert.equal(result.success, false);
  assert.ok(result.success === false);
  assert.match(formatEnvIssues(result.error), /^Config validation failed:/);
  assert.match(formatEnvIssues(result.error), /PORT/);
});

test('rejects a PORT above the valid range', () => {
  const result = EnvSchema.safeParse({ PORT: '70000' });
  assert.equal(result.success, false);
});

test('rejects a PORT of zero', () => {
  assert.equal(EnvSchema.safeParse({ PORT: '0' }).success, false);
});

test('rejects a NODE_ENV outside the enum and names it', () => {
  const result = EnvSchema.safeParse({ NODE_ENV: 'prod' });
  assert.ok(result.success === false);
  assert.match(formatEnvIssues(result.error), /NODE_ENV/);
});

test('rejects an empty HOST', () => {
  assert.equal(EnvSchema.safeParse({ HOST: '' }).success, false);
});

test('validateEnv returns the parsed value on success', () => {
  assert.equal(validateEnv({ PORT: '4321' }).PORT, 4321);
});
