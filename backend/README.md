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
npm run redis:up       --workspace @crm/backend   # start redis:8-alpine as crm-redis
npm run redis:down     --workspace @crm/backend   # stop and remove it

npm run migrate:dev    --workspace @crm/backend   # create a migration from a schema change
npm run migrate:deploy --workspace @crm/backend   # apply committed migrations
npm run migrate:reset  --workspace @crm/backend   # drop and rebuild from scratch
```

> **US-11 replaces the `db:*` and `redis:*` scripts with `docker-compose.yml`.** When it
> does, it must keep the same image tags, database names, credentials, and ports, and these
> five scripts should be deleted rather than left alongside Compose.

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

## API conventions

Established in **US-7** and applied globally — a new endpoint gets all of this for free.

**Success, single:** `{ "data": { ... } }`
**Success, list:** `{ "data": [ ... ], "pagination": { page, pageSize, total, totalPages, hasNext, hasPrevious } }`
**Failure, always:** `{ "error": { statusCode, code, message, details?, requestId, timestamp } }`

- **Validate with Zod.** Wrap a schema with `createZodDto` and type the parameter with it;
  the global pipe does the rest, before your handler runs. Invalid input is a 422 with
  per-field, dot-pathed details.
- **Throw `ApiException`**, not Nest's built-ins, so the client gets a real error `code`
  rather than one guessed from the HTTP status.
- **Never leak internals.** The filter turns anything unrecognised into a generic 500 and
  logs the detail server-side. Prisma's messages name tables and columns and are treated
  as internal.
- **Every request has an id**, echoed in `x-request-id` and included in the error body,
  and every log line during that request carries it.
- `@NoEnvelope()` opts a route out of the wrapper. Reach for it rarely.

## Cache and background jobs

Redis, through two abstractions. **Nothing outside `src/redis/` touches the client
directly** — if you need a command the abstraction lacks, add a method there.

```ts
await cache.get<T>(key); // undefined on a miss OR an outage — callers cannot tell
await cache.set(key, value, ttlSeconds?);
await cache.delete(key);
await cache.deleteByPrefix('ticket:42:'); // SCAN, never KEYS
await cache.wrap(key, ttl, () => loadFromDb()); // read-through

queues.registerWorker('sla-timers', async (job) => {
  /* … */
});
await queues.add('sla-timers', 'check-breach', { ticketId });
```

- **Redis is not a hard dependency.** An unreachable Redis logs a warning, the service
  starts anyway, `/health` reports `degraded` rather than `down`, and every cache operation
  degrades: reads look like misses, writes are no-ops, `wrap` just calls its loader every
  time. A cache blip must not take the service out of a load balancer.
- **Jobs retry with exponential backoff** (`QUEUE_MAX_ATTEMPTS`, `QUEUE_BACKOFF_MS`) and, on
  the final failure, land on the `dead-letter` queue carrying their original data and the
  reason. That last part is ours, not BullMQ's.
- **No jobs are defined in `src/redis/`.** The story that needs one defines it.
- **Two Redis connections, deliberately** — BullMQ needs `maxRetriesPerRequest: null` for
  its blocking reads, and a cache needs the opposite so a command fails fast instead of
  queueing for a reconnect that may never come.

## Logging

One JSON object per line — errors and warnings on stderr, everything else on stdout.

```json
{
  "timestamp": "2026-08-26T09:15:02.431Z",
  "level": "info",
  "message": "request completed",
  "requestId": "0f3c…",
  "method": "GET",
  "path": "/health",
  "statusCode": 200,
  "durationMs": 14.2
}
```

- **`LOG_LEVEL`** sets verbosity without a code change: `error | warn | info | debug |
verbose`. Unset means `info` in production and `debug` everywhere else.
- **Every line carries the request id**, and `userId` once a request is authenticated —
  P02's guard calls `RequestContextService.setUserId()`.
- **Every completed request logs one access line**, including 404s on unmatched routes and
  requests rejected before reaching a handler. It hangs off `response.on('finish')` rather
  than an interceptor for exactly that reason.
- **Secrets are redacted.** Field names matching `password`, `token`, `authorization`,
  `apiKey`, and friends are replaced — nested, in arrays, case-insensitively, and with
  separators stripped so `x-api-key` is caught. Interpolated secrets in message text are
  pattern-scrubbed too. **Prefer `StructuredLogger.emit(level, message, fields)`** over
  interpolating values into a string: fields are redacted structurally, strings only by
  pattern.

There is no Pino. The story that built this suggested `nestjs-pino`, which is three
dependencies outside the approved stack for what is, at this size, a `JSON.stringify` and a
level check — see `.squad/plans/structured-logging/00-overview.md`. Swapping to it later
touches `structured-logger.ts` and the middleware and nothing else.

## API documentation

Swagger UI at **`/api/docs`**, raw OpenAPI at **`/api/docs-json`**.

Request and response schemas are generated from the same Zod schemas that validate them —
`ApiZodBody`, `ApiZodQuery`, and `ApiZodResponse` in `src/openapi/` read `zodSchema` off
the DTO. Documentation therefore cannot drift from enforcement, because there is only one
definition.

`zodToOpenApi` is deliberately **strict**: it throws on a Zod node it does not understand,
so an undocumented shape breaks the build rather than appearing in the docs as `{}`. If you
hit that, add a case rather than working around it.

**In production the docs are off** unless `SWAGGER_ENABLED_IN_PRODUCTION=true` _and_
`SWAGGER_USER` / `SWAGGER_PASSWORD` are both set, in which case they serve behind basic
auth. Enabling without credentials refuses to serve — it does not fall back to public docs.

## Structure

```
src/
├── common/     API conventions, request context, structured logging
├── config/     Env schema, validation, typed accessor
├── generated/  Prisma client — generated, gitignored, do not edit
├── health/     GET /health
├── openapi/    Swagger setup and the Zod → OpenAPI converter
├── prisma/     PrismaService, PrismaModule
├── redis/      RedisService, CacheService, QueueService
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

Reports the process **and** PostgreSQL. Wrapped in the standard `{ data }` envelope since
US-7, carrying the shared `HealthStatus` DTO from
`@crm/shared`:

```json
{
  "data": {
    "status": "ok",
    "service": "backend",
    "timestamp": "2026-08-25T20:00:00.000Z",
    "dependencies": { "database": { "status": "up", "latencyMs": 3 } }
  }
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
