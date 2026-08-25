import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';

/**
 * AC2 end to end.
 *
 * Spawns the real built entry point with a bad environment rather than
 * monkey-patching `process.exit`. That proves the two things the AC actually
 * claims — a non-zero exit code, and a message naming the offending variable —
 * instead of proving that a stub was called.
 */
const entryPoint = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

function runWith(env: Record<string, string>): { code: number; stderr: string } {
  try {
    execFileSync(process.execPath, [entryPoint], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 20_000,
    });
    return { code: 0, stderr: '' };
  } catch (error) {
    const err = error as { status?: number; stderr?: string };
    return { code: err.status ?? -1, stderr: err.stderr ?? '' };
  }
}

test('a malformed PORT exits non-zero and names PORT (AC2)', () => {
  const { code, stderr } = runWith({ PORT: 'nope' });
  assert.equal(code, 1);
  assert.match(stderr, /Config validation failed:/);
  assert.match(stderr, /PORT/);
});

test('a NODE_ENV outside the enum exits non-zero and names NODE_ENV (AC2)', () => {
  const { code, stderr } = runWith({ NODE_ENV: 'prod' });
  assert.equal(code, 1);
  assert.match(stderr, /NODE_ENV/);
});

test('the failure message is not a raw stack trace', () => {
  const { stderr } = runWith({ PORT: '70000' });
  assert.ok(!stderr.includes('at Object.'), 'stderr should not contain stack frames');
  assert.ok(!stderr.includes('ZodError'), 'stderr should not leak the raw Zod error');
});
