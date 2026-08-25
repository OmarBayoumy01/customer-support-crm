# 03 — Connect PostgreSQL with Prisma and migrations

- **Story:** US-5 (Notion "User Stories" database)
- **Phase:** P01 Foundation · **Layer:** Backend · **Priority:** Must have · **Release:** MVP
- **Depends on:** US-4 (done)
- **Feature folder:** `.squad/plans/prisma-postgres/`

> Execute this plan top to bottom. It is the executing session's entire context — every
> path, command, and snippet below was verified against a real Prisma 7.10.0 install and a
> real PostgreSQL 18 container on 2026-08-25. Do not substitute versions or "modernise" the
> generator options; the exact combination below is load-bearing and the reasons are given.

---

## 1. What this story does and does not do

**Does:** installs Prisma 7 against PostgreSQL, creates `PrismaService` with pooled
connections and correct shutdown, adds a real database check to `GET /health`, and
establishes the migration workflow with a first committed migration.

**Does not:** model the domain. Entities, relations, enums, indexes, and
`Message.isInternal` all belong to **US-6**. This story deliberately ships exactly one
throwaway model so the migration workflow has something to prove itself against — see
decision **D1**.

---

## 2. Decisions — read before writing code

### D1 — One temporary `MigrationProbe` model, dropped by US-6

`prisma migrate dev` against a schema with zero models produces no migration file, so AC2
("it is committed as a file and applies cleanly to an empty database") and AC3 ("model
types are available to the backend with full type safety") would both be unverifiable.

**Decision:** add a single model, `MigrationProbe`, marked in the schema as temporary.
**US-6's first migration drops it.** That drop is not waste — it is a second, free proof
that the migration workflow handles schema evolution, not just initial creation.

`MigrationProbe` is never referenced by application code. Only tests touch it.

### D2 — PostgreSQL comes from a named container via npm scripts, not Compose

US-11 owns `docker-compose.yml`, and Phase 1's exit criterion is `docker compose up`.
Adding Compose now takes work from US-11.

**Decision:** three npm scripts in `backend/package.json` that wrap `docker run` /
`docker exec` / `docker rm`. Image **`postgres:18-alpine`** (verified to resolve).
**US-11 must use the same image tag, the same database names, and the same credentials**, and
should delete these scripts when Compose lands. This is written into `backend/README.md`.

### D3 — `backend/.env.test` is committed via a narrow `.gitignore` exception

Technical notes require a separate test database, and tests must run from a clean clone.

**Decision:** add `!backend/.env.test` to `.gitignore`. The file holds a localhost-only
connection string with throwaway credentials and **nothing else, ever**. A comment in both
`.gitignore` and the file itself says so. Real environments supply `DATABASE_URL` as a real
environment variable, which wins over the file (verified: `process.loadEnvFile()` and
`@nestjs/config` both leave an already-set `process.env` value alone).

### D4 — Generated client goes in `backend/src/generated/prisma`, gitignored, regenerated on install

`output` is mandatory in Prisma 7. Verified facts that decide this:

- Generated files begin with `// @ts-nocheck` and `/* eslint-disable */`, so they pass this
  repo's strict TypeScript and ESLint **as-is**. No tsconfig carve-out is needed.
- **By default the generated code imports with `.ts` specifiers** (`from './enums.ts'`).
  `tsc` emits those verbatim, and Node then throws
  `ERR_MODULE_NOT_FOUND … dist/generated/prisma/internal/class.ts` at runtime. This repo
  compiles to `dist/` and runs the built output, so the default is **broken here**.
  **`importFileExtension = "js"` is the fix and is not optional.** Verified end to end.
- The client is **not committed**; `postinstall` regenerates it. `prisma generate` does not
  touch the database, and the config in §4.3 keeps it working with no `DATABASE_URL` set,
  so a clean clone builds with `npm install && npm run build`.

### D5 — `HealthStatus` gains a `dependencies` map

Phase 1's exit criteria require `/health` to report the database and Redis as up. The
current DTO has nowhere to put that. The shape must change, and
`backend/src/health/health.module.ts` currently carries a comment claiming it would not —
**that comment is now wrong and this story corrects it.**

**Decision:** add `dependencies: Record<string, DependencyStatus>` to the shared DTO. US-10
adds Redis by adding one entry, not by editing the DTO again. Aggregation: a **critical**
dependency down ⇒ overall `down`; a non-critical one down ⇒ `degraded`. The database is
critical.

No indicator-registry abstraction. `HealthService` injects `PrismaService` directly and
builds the map; US-10 injects its Redis client into the same service. Boring and explicit
beats a plugin system for two dependencies.

### D6 — New dependencies, flagged for approval

Prisma 7 removed the Rust query engine: the client **cannot connect without a driver
adapter**. These are Prisma's own required transport for the already-approved
"PostgreSQL + Prisma", not a substitution — but the working agreement says ask.

| Package              | Version  | Where       | Why                                              |
| -------------------- | -------- | ----------- | ------------------------------------------------ |
| `@prisma/client`     | `7.10.0` | dependency  | The client itself                                |
| `@prisma/adapter-pg` | `7.10.0` | dependency  | Required driver adapter for PostgreSQL           |
| `pg`                 | `8.23.0` | dependency  | The actual driver, and the connection pool (AC4) |
| `prisma`             | `7.10.0` | devDependency | CLI: migrate, generate                         |
| `@types/pg`          | `8.23.1` | devDependency | `pg` ships no types                            |

**Pin `7.10.0` exactly — do not install `latest`.** `npm view prisma version` currently
returns `8.0.0-rc.10`; the `latest` dist-tag points at a release candidate. `7.10.0` is the
newest stable (dist-tag `prev`).

`dotenv` is **not** added — Node 24's built-in `process.loadEnvFile()` covers it.

---

## 3. Target paths

| Action     | Path                                              |
| ---------- | ------------------------------------------------- |
| **create** | `backend/prisma/schema.prisma`                     |
| **create** | `backend/prisma.config.ts`                         |
| **create** | `backend/prisma/migrations/<timestamp>_init/migration.sql` (generated, committed) |
| **create** | `backend/src/prisma/prisma.service.ts`             |
| **create** | `backend/src/prisma/prisma.module.ts`              |
| **create** | `backend/src/prisma/index.ts`                      |
| **create** | `backend/src/prisma/prisma.service.test.ts`        |
| **create** | `backend/src/prisma/migrations.test.ts`            |
| **create** | `backend/src/health/health.service.ts`             |
| **create** | `backend/src/testing/prepare-test-db.ts`           |
| **create** | `backend/.env.test`                                |
| **modify** | `backend/src/health/health.controller.ts`          |
| **modify** | `backend/src/health/health.module.ts`              |
| **modify** | `backend/src/health/health.controller.test.ts`     |
| **modify** | `backend/src/config/env.schema.ts`                 |
| **modify** | `backend/src/config/env.schema.test.ts`            |
| **modify** | `backend/src/app.module.ts`                        |
| **modify** | `backend/package.json`                             |
| **modify** | `backend/.env.example`                             |
| **modify** | `backend/README.md`                                |
| **modify** | `packages/shared/src/dto/health.ts`                |
| **modify** | `packages/shared/src/dto/health.test.ts`           |
| **modify** | `packages/shared/src/index.ts`                     |
| **modify** | `package.json` (root — `postinstall` only)         |
| **modify** | `.gitignore`                                       |
| **modify** | `.prettierignore`                                  |
| **modify** | `eslint.config.js`                                 |

Nothing is written to the repository root except the two config files already listed, and
nothing to `frontend/` or `infrastructure/`.

---

## 4. Implementation

### 4.1 Install

Run from the **repository root** (single lockfile, npm workspaces):

```
npm install --workspace @crm/backend @prisma/client@7.10.0 @prisma/adapter-pg@7.10.0 pg@8.23.0
npm install --workspace @crm/backend --save-dev prisma@7.10.0 @types/pg@8.23.1
```

Then normalise the versions in `backend/package.json` to exact pins (no `^`), matching how
every other dependency in this repo is written.

### 4.2 `backend/prisma/schema.prisma`

```prisma
// Datasource URL lives in prisma.config.ts, NOT here. Prisma 7 rejects a `url`
// in this block with P1012.
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  moduleFormat        = "esm"
  // Without this the generated code imports './enums.ts'. tsc emits that
  // specifier verbatim and Node cannot resolve it from dist/ at runtime.
  // Do not remove. See plan D4.
  importFileExtension = "js"
}

datasource db {
  provider = "postgresql"
}

/// TEMPORARY — owned by US-5, dropped by US-6.
///
/// Exists only so the migration workflow has a schema change to prove itself
/// against (AC2) and so generated model types can be asserted (AC3). No
/// application code references it. US-6's first migration drops this table.
model MigrationProbe {
  id        String   @id @default(uuid())
  note      String
  createdAt DateTime @default(now())
}
```

### 4.3 `backend/prisma.config.ts`

```ts
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
 * from a clean clone where no `DATABASE_URL` exists yet. Using `env()` here
 * would make that fail with `PrismaConfigEnvError` (verified), so the fallback
 * keeps generation working while making any migrate command that reaches it
 * fail loudly and legibly: `P1001: Can't reach database server at 127.0.0.1:1`.
 */
const url = process.env['DATABASE_URL'] ?? 'postgresql://unset:unset@127.0.0.1:1/unset';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
});
```

This file sits in `backend/`, is not under `src/`, and so is linted by the
`**/*.config.ts` block in `eslint.config.js` (type-checking disabled there). No tsconfig
change is needed.

### 4.4 `backend/src/config/env.schema.ts` — add three variables

Add to `EnvSchema`, keeping the existing style and comments:

```ts
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'must be a postgresql:// connection string',
    ),
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
```

`DATABASE_URL` has **no default** — a service that cannot reach its database must not boot.
That is the same fail-fast stance US-4 established.

**This breaks an existing test.** `backend/src/config/env.schema.test.ts` contains
`EnvSchema.parse({})` asserting success. Update it to pass a valid `DATABASE_URL`, and add:

- defaults applied for `DATABASE_POOL_SIZE` (10) and `DATABASE_CONNECTION_TIMEOUT_MS` (5000)
- a missing `DATABASE_URL` fails and `formatEnvIssues` names `DATABASE_URL`
- a non-postgres URL (`mysql://…`) fails

`backend/src/config/env-exit.test.ts` needs no change — all three cases there fail
validation before anything connects, and the child process inherits `DATABASE_URL` from the
test process.

### 4.5 `backend/src/prisma/prisma.service.ts`

```ts
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { TypedConfigService } from '../config/index.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * The single seam between the application and PostgreSQL.
 *
 * Prisma 7 removed the Rust query engine: the client no longer opens
 * connections itself and requires a driver adapter. That is why the `pg.Pool`
 * is constructed here and owned here — it is the pool, and it is ours to close.
 *
 * Extending PrismaClient keeps `prisma.someModel.findMany(...)` available at the
 * call site, which matters for the project rule that scoped permissions are
 * applied in the query rather than by filtering after fetching.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor(config: TypedConfigService) {
    const pool = new Pool({
      connectionString: config.get('DATABASE_URL'),
      max: config.get('DATABASE_POOL_SIZE'),
      connectionTimeoutMillis: config.get('DATABASE_CONNECTION_TIMEOUT_MS'),
    });

    super({ adapter: new PrismaPg(pool) });

    this.pool = pool;

    // A pool error with no listener is an unhandled 'error' event, which takes
    // the process down. Log it instead; pg discards the broken client itself.
    this.pool.on('error', (error: Error) => {
      this.logger.error(`Idle client error: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(`Connected (pool max ${String(this.pool.options.max)})`);
  }

  /**
   * `$disconnect()` alone is NOT enough on Prisma 7 — verified: after it
   * resolves the pg pool still holds every open connection. The pool is ours,
   * so we end it, or the process leaks server-side connections (AC4).
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end();
  }

  /** Pool telemetry, for the health endpoint and for the AC4 test. */
  poolStats(): { total: number; idle: number; waiting: number } {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }
}
```

If `super()` before `this.pool` assignment causes a TypeScript ordering complaint, keep the
shape above — `pool` is created as a local first precisely so `super()` can receive the
adapter. Do not switch to a non-null assertion.

### 4.6 `backend/src/prisma/prisma.module.ts`

```ts
import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

/**
 * Global so feature modules inject `PrismaService` without re-importing this
 * module in every one of them. There is exactly one database connection pool
 * per process and no reason for a second.
 */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

`backend/src/prisma/index.ts` is a barrel exporting `PrismaModule` and `PrismaService`,
matching `src/config/index.ts`.

Register `PrismaModule` in `backend/src/app.module.ts` before `HealthModule`.

Also add to `backend/src/index.ts`, after `NestFactory.create(...)`:

```ts
  // Nest does not run onModuleDestroy on SIGINT/SIGTERM unless asked. Without
  // this the pool is never closed on Ctrl-C or on container stop.
  app.enableShutdownHooks();
```

### 4.7 Health check — AC1

**`packages/shared/src/dto/health.ts`** — extend the DTO:

```ts
export const DependencyStatusSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
});

export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;

export const HealthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  service: z.string().min(1),
  timestamp: z.string().datetime(),
  /**
   * Keyed by dependency name — `database` here, `redis` from US-10. A new
   * dependency is a new entry, not a new field.
   */
  dependencies: z.record(z.string(), DependencyStatusSchema),
});
```

Export `DependencyStatusSchema` and `DependencyStatus` from `packages/shared/src/index.ts`.

`exactOptionalPropertyTypes` is on: build the `error` property conditionally with a spread
(`...(message === undefined ? {} : { error: message })`), never assign `undefined` to it.

**`backend/src/health/health.service.ts`** — new:

- injects `PrismaService`
- `checkDatabase()`: times `await this.prisma.$queryRaw\`SELECT 1\``, returns
  `{ status: 'up', latencyMs }`, or on a thrown error logs it and returns
  `{ status: 'down', latencyMs, error: <message> }` — logged, never swallowed
- `check()`: builds `dependencies`, derives overall `status` (database is **critical**, so
  down ⇒ `'down'`), returns `HealthStatusSchema.parse({...})` so the endpoint still cannot
  drift from the shared DTO

**`health.controller.ts`**: delegate to `HealthService`, `async`, return its result.
Keep `@Controller('health')` / `@Get()` and the "parse on the way out" comment.

**`health.module.ts`**: add `HealthService` to `providers`, and **rewrite the stale
comment** — it currently claims the response shape will not change. Say instead that the
database check landed in US-5, that `dependencies` is the extension point, and that US-10
adds `redis` as one more entry and one more injected client.

### 4.8 Local database — AC2 plumbing

Add to `backend/package.json` scripts (all Windows- and bash-safe; no shell operators
inside a single script, no `VAR=x cmd` prefixes):

```json
"prisma:generate": "prisma generate",
"db:up": "docker run -d --name crm-postgres -e POSTGRES_USER=crm -e POSTGRES_PASSWORD=crm_local_dev -e POSTGRES_DB=crm -p 5432:5432 postgres:18-alpine",
"db:create-test": "docker exec crm-postgres createdb -U crm crm_test",
"db:down": "docker rm -f crm-postgres",
"migrate:dev": "prisma migrate dev",
"migrate:deploy": "prisma migrate deploy",
"migrate:reset": "prisma migrate reset --force"
```

`createdb` avoids quoting a SQL string inside JSON inside two different shells.

Add to the **root** `package.json`:

```json
"postinstall": "npm run prisma:generate --workspace @crm/backend"
```

Create the first migration once, and commit the generated SQL:

```
npm run db:up   --workspace @crm/backend
npm run db:create-test --workspace @crm/backend
cd backend
cp .env.example .env      # then set DATABASE_URL
npx prisma migrate dev --name init
```

`prisma migrate dev` has **no `--skip-generate` flag in Prisma 7** — do not pass it.

### 4.9 Test database wiring

**`backend/.env.test`** (committed — see D3):

```
# Committed on purpose: localhost-only, throwaway credentials for the test
# database. NEVER put a real credential in this file.
NODE_ENV=test
DATABASE_URL=postgresql://crm:crm_local_dev@127.0.0.1:5432/crm_test?schema=public
PORT=0
```

**`.gitignore`** — add below the existing `!.env.example`:

```
# Committed deliberately: localhost-only throwaway test credentials. See backend/.env.test.
!backend/.env.test
```

Also add `backend/src/generated/` to `.gitignore` (regenerated by `postinstall`),
`**/generated/**` to the `ignores` array in `eslint.config.js`, and `backend/src/generated`
to `.prettierignore`. The generated files already carry `@ts-nocheck` and
`/* eslint-disable */`, so this is belt-and-braces, not a workaround.

**`backend/src/testing/prepare-test-db.ts`** — runs before the suite:

1. reads `DATABASE_URL`, parses out the database name
2. connects to the `postgres` maintenance database on the same host with `pg`
3. `CREATE DATABASE <name>` if absent (ignore "already exists")
4. runs `prisma migrate deploy` against it via `execFileSync`, inheriting stdio
5. on failure, prints a message naming `npm run db:up --workspace @crm/backend` and exits 1

This is what makes "migrations run in CI against a throwaway instance" true, and US-12 calls
the same script.

Update the backend `test` script to:

```json
"test": "tsc -b && node --env-file-if-exists=.env.test dist/testing/prepare-test-db.js && node --env-file-if-exists=.env.test --test \"dist/**/*.test.js\""
```

`--env-file-if-exists` (Node 24) does not fail when the file is absent, so CI can supply a
real `DATABASE_URL` as an environment variable instead.

### 4.10 `backend/.env.example` and `README.md`

Add `DATABASE_URL`, `DATABASE_POOL_SIZE`, `DATABASE_CONNECTION_TIMEOUT_MS` with the same
commented style as the existing entries. In `README.md`: a "Database" section covering the
`db:*` and `migrate:*` scripts, the note that **US-11 replaces these scripts with Compose
and must keep the image tag, database names, and credentials identical**, that
`src/generated/` is generated and not committed, and a correction to the "Health endpoint"
section, which currently says the response shape will not change.

---

## 5. Tests — one per acceptance criterion

All tests run on `node:test` + `@nestjs/testing` against `dist/`. No new test dependency.

| AC  | File                                       | What it asserts                                                                                                                                                    |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC1 | `backend/src/health/health.controller.test.ts` | Boot `AppModule`, `GET /health` → 200; body parses as `HealthStatusSchema`; `dependencies.database.status === 'up'`; `latencyMs` is a non-negative number; overall `status === 'ok'`. |
| AC1 | `backend/src/health/health.controller.test.ts` | Degraded path: stub `PrismaService.$queryRaw` to reject via `overrideProvider`; assert `dependencies.database.status === 'down'`, overall `status === 'down'`, and that the endpoint still returns a valid DTO rather than throwing. |
| AC2 | `backend/src/prisma/migrations.test.ts`    | Create a uniquely-named empty database, run `prisma migrate deploy` against it with `execFileSync`, assert exit 0, assert `_prisma_migrations` contains the `init` row with `finished_at` set and `MigrationProbe` exists in `information_schema.tables`, then drop the database. |
| AC2 | `backend/src/prisma/migrations.test.ts`    | `prisma/migrations/` contains at least one committed `migration.sql` — the file is in the repo, not only in the database.                                            |
| AC3 | `backend/src/prisma/prisma.service.test.ts` | Create and read back a `MigrationProbe`; assert `typeof row.id === 'string'` and `row.createdAt instanceof Date`. Include a `// @ts-expect-error` line asserting an unknown field on the create input is a compile error — that is what makes AC3 a real check rather than a runtime one. |
| AC4 | `backend/src/prisma/prisma.service.test.ts` | Fire 25 concurrent `count()` calls with `DATABASE_POOL_SIZE` set low; assert all resolve, `poolStats().total <= DATABASE_POOL_SIZE`, and `waiting === 0` once settled. |
| AC4 | `backend/src/prisma/prisma.service.test.ts` | After `app.close()`, assert `poolStats().total === 0` — connections are released, not leaked. Verified in the spike: `$disconnect()` alone leaves them open, so this test genuinely fails without the `pool.end()` in `onModuleDestroy`. |

Every one of these needs a running database. That is correct and intended: on a machine
with no Docker, `npm run verify` fails loudly rather than silently skipping. No test is
written to `skip` when the database is absent.

---

## 6. Verification — run in order, all must pass

```
npm install
npm run db:up          --workspace @crm/backend
npm run db:create-test --workspace @crm/backend
npm run verify
```

Then confirm by hand:

```
npm run dev --workspace @crm/backend
curl http://localhost:3000/health
```

Expect `status: "ok"` and `dependencies.database.status: "up"`. Stop the container with
`npm run db:down --workspace @crm/backend`, restart the app, and confirm `/health` reports
`database` as `down` with overall `status: "down"` — and that the process logs the error
rather than crashing.

`npm run verify` is typecheck → lint → format:check → test, all four.

---

## 7. What US-6 inherits

- `backend/prisma/schema.prisma` with the generator and datasource blocks settled. **Add
  models; do not touch the generator options** — `importFileExtension = "js"` is required
  for the build to run.
- **First job: drop `MigrationProbe`** and remove `backend/src/prisma/migrations.test.ts`'s
  reference to it, replacing it with a real entity. The drop migration is itself the proof
  that schema evolution works.
- `PrismaService` is global; inject it and query. Scoped permissions go in the query.
- The migration workflow, the test database, and the health check all exist — US-6 adds
  schema only.

---

## 8. Risks

| Risk                                                                        | Mitigation                                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Someone regenerates without `importFileExtension = "js"`                     | Comment in the schema; the build breaks immediately and loudly at runtime, not silently.                       |
| `postinstall` runs `prisma generate` on every install, slowing installs      | Measured at ~20–35 ms. Acceptable.                                                                              |
| Prisma 8 ships during the project                                            | Versions are pinned exactly. Upgrading is a deliberate story, not a drift.                                     |
| `.env.test` gains a real credential later                                    | Warned in the file, in `.gitignore`, and in `README.md`. Consider a CI grep in US-12.                          |
| Tests now require Docker, so `npm run verify` fails without it               | Intended and stated. Phase 1's exit criteria already require a working `docker compose up`.                    |
