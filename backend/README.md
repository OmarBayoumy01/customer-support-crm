# `@crm/backend`

NestJS API for the Customer Support CRM.

## Running it

```
cp .env.example .env                       # from this directory
npm run db:up          --workspace @crm/backend
npm run db:create-test --workspace @crm/backend
npm run migrate:deploy --workspace @crm/backend
npm run build          --workspace @crm/backend
npm run dev            --workspace @crm/backend
```

`GET /health` then answers on `http://localhost:3000/health`, reporting the database as
up.

If you change `backend/package.json`, re-run `npm install` **from the repository root** —
this is an npm workspaces monorepo with a single lockfile.

## Configuration

Every variable the service reads is declared in `src/config/env.schema.ts` and mirrored in
`.env.example`. Add one in both places or not at all.

Configuration is validated with Zod at startup. A missing or malformed variable prints
`Config validation failed:` with one line per offending variable and exits non-zero — the
service never boots into a half-configured state.

**Read configuration through `TypedConfigService`, never `process.env`.** Keys are
constrained to the schema, so a typo is a compile error. ESLint enforces this: `no-process-env`
is an error everywhere in `backend/` except `src/config/`.

### Env file precedence

Driven by `NODE_ENV`, highest priority first — see `src/config/env-files.ts`:

1. `.env.<NODE_ENV>.local` — machine-specific, never committed
2. `.env.<NODE_ENV>` — per-environment
3. `.env.local` — machine-specific, all environments (**skipped when `NODE_ENV=test`**)
4. `.env` — defaults

Switching environments changes which files load and nothing else. No code changes.

`.env` and `.env.*` are gitignored, with exactly two exceptions: `.env.example`, and
`.env.test`, which is committed so the suite runs from a clean clone. **`.env.test` holds
localhost-only throwaway credentials and must never gain a real one.**

## Database

PostgreSQL through Prisma 7. `prisma/schema.prisma` is the schema, `prisma/migrations/`
holds the committed migration history.

```
npm run db:up          --workspace @crm/backend   # start postgres:18-alpine as crm-postgres
npm run db:create-test --workspace @crm/backend   # create the crm_test database
npm run db:down        --workspace @crm/backend   # stop and remove the container

npm run migrate:dev    --workspace @crm/backend   # create a migration from a schema change
npm run migrate:deploy --workspace @crm/backend   # apply committed migrations
npm run migrate:reset  --workspace @crm/backend   # drop and rebuild from scratch
```

> **US-11 replaces the `db:*` scripts with `docker-compose.yml`.** When it does, it must
> keep the same image tag, database names, and credentials, and these three scripts should
> be deleted rather than left alongside Compose.

Notes that will bite if you miss them:

- **The generated client is not committed.** `src/generated/prisma/` is produced by
  `prisma generate`, which the root `postinstall` runs after every `npm install`.
- **`importFileExtension = "js"` in `schema.prisma` is load-bearing.** Prisma's default
  emits `.ts` import specifiers, which `tsc` copies verbatim into `dist/` and Node then
  cannot resolve. Do not remove it.
- **The connection URL lives in `prisma.config.ts`, not in `schema.prisma`.** Prisma 7
  rejects a `url` in the datasource block.
- **Prisma 7 needs a driver adapter.** `PrismaService` owns the `pg.Pool` and closes it in
  `onModuleDestroy` — `$disconnect()` alone leaves connections open.

## Structure

```
src/
├── config/     Env schema, validation, typed accessor
├── generated/  Prisma client — generated, gitignored, do not edit
├── health/     GET /health
├── prisma/     PrismaService, PrismaModule
├── testing/    Test-database preparation and Prisma CLI wrapper
├── app.module.ts
└── index.ts    Bootstrap
```

`AppModule` and `index.ts` are deliberately small so **US-7** can attach the global
validation pipe, exception filter, and response interceptor without restructuring.

**Domain modules are not scaffolded ahead of use.** `auth`, `users`, `customers`,
`tickets`, `sla`, and `notifications` are each created by the story that owns their
behaviour. Empty modules hide which parts of the system actually exist.

## Health endpoint

Reports the process **and** PostgreSQL, as the shared `HealthStatus` DTO from
`@crm/shared`:

```json
{
  "status": "ok",
  "service": "backend",
  "timestamp": "2026-08-25T20:00:00.000Z",
  "dependencies": { "database": { "status": "up", "latencyMs": 3 } }
}
```

Always HTTP 200, even when a dependency is down — the caller asked for a report, and the
report is in the body. `status` is derived: a **critical** dependency down makes the
service `down`, a non-critical one makes it `degraded`. The database is critical.

**US-10 adds Redis** as one more entry in `dependencies`, with `critical: false`. That is
why `dependencies` is a keyed map: a new dependency is a new entry, not a new field.

(An earlier version of this section said the response shape would never change. It changed
in US-5 — the flat DTO had nowhere to report per-dependency state, which the phase exit
criteria require.)

## Tests

```
npm run test --workspace @crm/backend
```

`node:test` from the standard library plus `@nestjs/testing` for the DI container. HTTP
assertions use Node's built-in `fetch` against `app.listen(0)`. There is no Vitest, Jest,
or supertest — that was a deliberate choice to avoid dependencies outside the approved
stack.

Tests compile to `dist/` first and run against the built output, matching `packages/shared`.

**The suite needs a running database.** `npm run test` first runs
`dist/testing/prepare-test-db.js`, which creates `crm_test` if it is missing and applies
every committed migration to it. No test skips itself when the database is absent — the run
fails loudly instead, and tells you which two commands to run. US-12 calls the same script
against a throwaway CI instance.
