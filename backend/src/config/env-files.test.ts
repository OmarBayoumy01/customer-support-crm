import assert from 'node:assert/strict';
import { test } from 'node:test';

import { envFilePathsForNodeEnv } from './env-files.js';

test('development precedence: most specific file first', () => {
  assert.deepEqual(envFilePathsForNodeEnv('development'), [
    '.env.development.local',
    '.env.development',
    '.env.local',
    '.env',
  ]);
});

test('staging and production follow the same shape (AC4)', () => {
  assert.deepEqual(envFilePathsForNodeEnv('staging'), [
    '.env.staging.local',
    '.env.staging',
    '.env.local',
    '.env',
  ]);
  assert.deepEqual(envFilePathsForNodeEnv('production'), [
    '.env.production.local',
    '.env.production',
    '.env.local',
    '.env',
  ]);
});

test('test environment skips .env.local so runs are reproducible across machines', () => {
  const paths = envFilePathsForNodeEnv('test');
  assert.deepEqual(paths, ['.env.test.local', '.env.test', '.env']);
  assert.ok(!paths.includes('.env.local'));
});

test('undefined NODE_ENV falls back to development', () => {
  assert.deepEqual(envFilePathsForNodeEnv(undefined), envFilePathsForNodeEnv('development'));
});
