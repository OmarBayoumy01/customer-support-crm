/**
 * Brings the test database into a known state before the suite runs.
 *
 * Creates the database if it does not exist, then applies every committed
 * migration with `prisma migrate deploy`. This is what makes the story's
 * "separate test database; migrations run in CI against a throwaway instance"
 * true, and US-12 calls this same script.
 *
 * This runs before Nest exists, so it reads `process.env` and writes to the
 * console directly rather than going through `TypedConfigService` and the Nest
 * logger. `eslint.config.js` exempts `src/testing/**` for exactly that reason.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { Client } from 'pg';

import { runPrismaCli } from './prisma-cli.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function fail(message: string): never {
  console.error(`\nCould not prepare the test database.\n${message}\n`);
  console.error('Start one with:');
  console.error('  npm run db:up          --workspace @crm/backend');
  console.error('  npm run db:create-test --workspace @crm/backend\n');
  process.exit(1);
}

/**
 * Splits a connection string into the database name and a URL pointing at the
 * `postgres` maintenance database on the same server — you cannot issue
 * `CREATE DATABASE` while connected to the database being created.
 */
function splitConnectionString(raw: string): { databaseName: string; adminUrl: string } {
  const url = new URL(raw);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (databaseName === '') {
    fail(`DATABASE_URL has no database name: ${raw}`);
  }

  const adminUrl = new URL(raw);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';

  return { databaseName, adminUrl: adminUrl.toString() };
}

async function ensureDatabaseExists(databaseName: string, adminUrl: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 5_000 });

  try {
    await client.connect();
  } catch (error: unknown) {
    fail(error instanceof Error ? error.message : String(error));
  }

  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);

    if (existing.rowCount === 0) {
      // Identifiers cannot be parameterised. The name comes from DATABASE_URL,
      // which is developer- or CI-supplied configuration rather than user
      // input, and it is quoted so an unusual name cannot break the statement.
      await client.query(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
      console.log(`Created test database "${databaseName}".`);
    }
  } finally {
    await client.end();
  }
}

function applyMigrations(databaseUrl: string): void {
  try {
    runPrismaCli(['migrate', 'deploy'], {
      cwd: backendRoot,
      databaseUrl,
      stdio: 'inherit',
    });
  } catch (error: unknown) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];

  if (databaseUrl === undefined || databaseUrl === '') {
    fail('DATABASE_URL is not set. Tests load it from backend/.env.test.');
  }

  const { databaseName, adminUrl } = splitConnectionString(databaseUrl);

  await ensureDatabaseExists(databaseName, adminUrl);
  applyMigrations(databaseUrl);
}

await main();
