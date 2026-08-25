import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

/**
 * The Prisma 7 CLI no longer loads `.env` by itself. Node 24 has
 * `process.loadEnvFile()` built in, so `dotenv` is not a dependency here.
 *
 * `loadEnvFile` throws ENOENT when the file is absent, hence the guard, and it
 * leaves an already-set variable alone — so a real `DATABASE_URL` from CI or a
 * container wins over the file, which is the precedence we want.
 */
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/**
 * `prisma generate` never touches the database, and it runs on `postinstall`
 * from a clean clone where no `DATABASE_URL` exists yet. Using Prisma's `env()`
 * helper here would make that fail with `PrismaConfigEnvError`, so the fallback
 * keeps generation working while making any migrate command that reaches it
 * fail loudly and legibly:
 *
 *   Error: P1001: Can't reach database server at `127.0.0.1:1`
 */
const url = process.env['DATABASE_URL'] ?? 'postgresql://unset:unset@127.0.0.1:1/unset';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
});
