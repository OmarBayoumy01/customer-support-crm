/**
 * AC2 — migrations are committed files that apply cleanly to an empty database.
 *
 * Reads `process.env` directly: these tests shell out to the Prisma CLI and
 * have to hand it a connection string. That is tooling, not application
 * configuration, so `TypedConfigService` is not the right route —
 * `eslint.config.js` exempts test files accordingly.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { after, test } from 'node:test';

import { Client } from 'pg';

import { runPrismaCli } from '../testing/prisma-cli.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = path.join(backendRoot, 'prisma', 'migrations');

// A distinct database per run, so a leftover from a failed run cannot make a
// later run pass. Derived from the pid rather than a random name so a stray
// database is traceable to the process that made it.
const throwawayName = `crm_migrate_check_${String(process.pid)}`;

function adminUrl(): string {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}

function throwawayUrl(): string {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  url.pathname = `/${throwawayName}`;
  return url.toString();
}

async function withAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl(), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

after(async () => {
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${throwawayName}" WITH (FORCE)`);
  });
});

test('AC2 — at least one migration is committed to the repository as a file', () => {
  const entries = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  assert.ok(entries.length > 0, 'prisma/migrations should contain at least one migration');

  for (const entry of entries) {
    const sql = readFileSync(path.join(migrationsDir, entry, 'migration.sql'), 'utf8');
    assert.ok(sql.trim().length > 0, `${entry}/migration.sql should not be empty`);
  }
});

test('AC2 — every migration applies cleanly to an empty database', async () => {
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${throwawayName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${throwawayName}"`);
  });

  // Throws on a non-zero exit, which is the assertion: `migrate deploy` must
  // succeed against a database that has never seen a migration.
  runPrismaCli(['migrate', 'deploy'], {
    cwd: backendRoot,
    databaseUrl: throwawayUrl(),
    stdio: 'pipe',
  });

  const client = new Client({ connectionString: throwawayUrl(), connectionTimeoutMillis: 5_000 });
  await client.connect();

  try {
    const applied = await client.query<{ migration_name: string; finished_at: Date | null }>(
      'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at',
    );

    assert.ok(applied.rows.length > 0, 'the migrations table should record what was applied');
    for (const row of applied.rows) {
      assert.notEqual(
        row.finished_at,
        null,
        `${row.migration_name} recorded a start but never finished`,
      );
    }

    const tables = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = tables.rows.map((row) => row.table_name);

    // The point is that replaying the committed migrations from empty produces
    // the schema the application expects — not merely that `migrate deploy`
    // exited zero. Ticket and Message are the two the platform cannot work
    // without, and Message carries `isInternal`.
    for (const expected of ['Ticket', 'Message', 'Customer', 'User']) {
      assert.ok(
        names.includes(expected),
        `expected ${expected} among the created tables, got: ${names.join(', ')}`,
      );
    }

    // US-5's temporary probe was dropped by US-6's migration. Replaying the
    // whole history must end at that same place, or the migration chain and the
    // schema have diverged.
    assert.ok(!names.includes('MigrationProbe'), 'MigrationProbe should have been dropped');

    const isInternal = await client.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'Message' AND column_name = 'isInternal'`,
    );

    assert.equal(isInternal.rowCount, 1, 'Message.isInternal must exist — it is non-negotiable');
    assert.equal(isInternal.rows[0]?.is_nullable, 'NO', 'isInternal must not be nullable');
  } finally {
    await client.end();
  }
});
