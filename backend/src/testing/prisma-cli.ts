import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Absolute path to Prisma's CLI entry point.
 *
 * Running it as `node <entry>` rather than shelling out to `npx` is deliberate,
 * and both of the obvious alternatives are dead ends on Windows:
 *
 *   - `execFileSync('npx', …)` fails with ENOENT, because `npx` is `npx.cmd`.
 *   - `execFileSync('npx.cmd', …)` fails with EINVAL — Node refuses to spawn
 *     `.cmd`/`.bat` without a shell, for command-injection reasons.
 *   - `shell: true` works but is deprecated when arguments are passed (DEP0190),
 *     since they are concatenated rather than escaped.
 *
 * Resolving the entry from `prisma/package.json` means no hard-coded path into
 * `node_modules`, so a Prisma upgrade that moves the file cannot break this.
 */
function prismaCliEntry(): string {
  const manifestPath = require.resolve('prisma/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };

  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['prisma'];

  if (relative === undefined) {
    throw new Error(`Could not find the prisma bin entry in ${manifestPath}`);
  }

  return path.join(path.dirname(manifestPath), relative);
}

export interface RunPrismaOptions {
  readonly cwd: string;
  readonly databaseUrl: string;
  /** 'inherit' streams to the terminal; 'pipe' keeps test output quiet. */
  readonly stdio: 'inherit' | 'pipe';
}

/**
 * Runs the Prisma CLI synchronously. Throws on a non-zero exit — callers treat
 * that as the failure signal rather than inspecting a status code.
 */
export function runPrismaCli(args: readonly string[], options: RunPrismaOptions): void {
  execFileSync(process.execPath, [prismaCliEntry(), ...args], {
    cwd: options.cwd,
    env: { ...process.env, DATABASE_URL: options.databaseUrl },
    stdio: options.stdio,
    encoding: 'utf8',
    timeout: 120_000,
  });
}
