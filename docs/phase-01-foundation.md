# Phase 01 — Foundation

**Status: complete.** All ten stories (US-3 → US-12) implemented, committed, and set to
`In review` in Notion. Two exit criteria remain open and are named honestly in
[What is not done](#what-is-not-done).

Phase 1 built nothing a user can see. Its whole purpose was this:

> A new developer clones the repository, runs one command, and gets a working stack with
> documented APIs and a green CI pipeline.

That is now true, with one caveat about CI noted below.

---

## Contents

- [At a glance](#at-a-glance)
- [What exists now](#what-exists-now)
- [The life of a request](#the-life-of-a-request)
- [The stack, and what is pinned](#the-stack-and-what-is-pinned)
- [Story by story](#story-by-story)
- [The domain schema](#the-domain-schema)
- [Conventions you have to know](#conventions-you-have-to-know)
- [Traps found the hard way](#traps-found-the-hard-way)
- [What is not done](#what-is-not-done)
- [What Phase 2 inherits](#what-phase-2-inherits)
- [Running and verifying it](#running-and-verifying-it)

---

## At a glance

| Ref       | Story                                  | Layer          | What it left behind                                         |
| --------- | -------------------------------------- | -------------- | ----------------------------------------------------------- |
| **US-3**  | Monorepo and shared tooling            | Infrastructure | npm workspaces, root-only ESLint/Prettier/tsconfig, Husky   |
| **US-4**  | NestJS bootstrap with typed config     | Backend        | Zod env schema, `TypedConfigService`, `no-process-env` rule |
| **US-5**  | PostgreSQL with Prisma and migrations  | Backend        | `PrismaService` owning a `pg.Pool`, migration workflow      |
| **US-6**  | Core domain schema                     | Backend        | 16 entities, 11 enums, 58 indexes, soft-delete extension    |
| **US-7**  | API conventions, validation, errors    | Backend        | Response envelope, `ApiException`, Zod pipe, request ids    |
| **US-8**  | OpenAPI documentation                  | Backend        | `/api/docs`, generated from the validating schemas          |
| **US-9**  | Structured logging and request tracing | Backend        | JSON logs, redaction, access log, `LOG_LEVEL`               |
| **US-10** | Redis for caching and background jobs  | Backend        | `CacheService`, `QueueService`, graceful degradation        |
| **US-11** | Docker Compose for local development   | Infrastructure | `docker compose up`, hot reload, persistent volumes         |
| **US-12** | CI pipeline                            | Infrastructure | GitHub Actions: lint, type-check, test, build               |

**By the numbers:** 10 commits · 119 files changed · ~15,500 lines added · 54 backend
source files · 16 test files · **159 tests** (22 shared, 137 backend) · 2 migrations ·
17 environment variables · 18 database tables.

Every acceptance criterion has a named test, except the four called out in
[What is not done](#what-is-not-done).

---

## What exists now

```
customer-support-crm/
├── docker-compose.yml          the whole stack, one command
├── .github/workflows/ci.yml    lint, type-check, test, build
├── backend/
│   ├── prisma/                 schema.prisma + committed migrations
│   └── src/
│       ├── common/             API conventions, request context, logging
│       ├── config/             Zod env schema, TypedConfigService
│       ├── generated/          Prisma client (generated, gitignored)
│       ├── health/             GET /health
│       ├── openapi/            Swagger + the Zod → OpenAPI converter
│       ├── prisma/             PrismaService, soft-delete extension
│       ├── redis/              RedisService, CacheService, QueueService
│       └── testing/            test-database preparation, Prisma CLI wrapper
├── frontend/                   React + Vite scaffold (real work is P03)
├── packages/shared/            DTOs and Zod schemas used by both sides
└── infrastructure/docker/      dev images, entrypoints, postgres init
```

Three rules shaped this layout and are worth stating outright:

1. **Domain modules are not scaffolded ahead of use.** There is no empty `tickets/` or
   `auth/` directory. Each is created by the story that owns its behaviour. Empty modules
   hide which parts of the system actually exist.
2. **`packages/shared` carries DTOs and schemas only** — no auth logic, no enforcement of
   any kind. Everything in it is code the browser can read.
3. **The server is the security boundary.** Nothing in Phase 1 enforces a permission yet,
   but the schema is shaped so that scoped permissions can be applied _in the query_
   rather than by filtering after fetching — see [PermissionScope](#the-domain-schema).

---

## The life of a request

Understanding this one path explains most of the backend.

```
HTTP request
  │
  ├─ RequestIdMiddleware ......... mints or honours x-request-id,
  │                                opens the AsyncLocalStorage context
  ├─ RequestLoggingMiddleware .... hooks response 'finish' for the access log
  │
  ├─ ZodValidationPipe ........... validates @Body/@Query/@Param against the
  │                                DTO's Zod schema — 422 with field paths on
  │                                failure, and the controller never runs
  │
  ├─ Controller → Service → PrismaService / CacheService
  │
  ├─ ResponseEnvelopeInterceptor . wraps the result in { data: ... }
  │
  └─ AllExceptionsFilter ......... anything thrown becomes
                                   { error: { statusCode, code, message,
                                              details?, requestId, timestamp } }
```

Every log line written anywhere inside that path carries the request id, because the
application logger reads the same async context. On the way out, the id is in the response
header **and** in the error body — the second one because it is what a user reads out over
the phone, and it has to survive being screenshotted.

---

## The stack, and what is pinned

| Piece      | Version      | Note                                                                  |
| ---------- | ------------ | --------------------------------------------------------------------- |
| Node       | `24.15.0`    | From `.nvmrc`; one place to change it                                 |
| NestJS     | `11.2.3`     |                                                                       |
| Prisma     | **`7.10.0`** | **Not `latest`** — see below                                          |
| PostgreSQL | `18-alpine`  |                                                                       |
| Redis      | `8-alpine`   |                                                                       |
| BullMQ     | `5.65.0`     | Named by US-10's own technical notes                                  |
| ioredis    | `5.9.0`      |                                                                       |
| Zod        | `3.25.x`     | The only validator. class-validator is **not** installed              |
| TypeScript | `5.9.3`      | Strict, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |

### Three dependency decisions that went against the story notes

CLAUDE.md says to ask before adding a dependency outside the approved stack. Three stories
suggested one anyway, and each was declined with reasoning. **All three are cheap to
reverse**, and each is contained to one file — that containment was part of the decision.

| Story     | Suggested            | Decision                 | Why                                                                                                                                                                              |
| --------- | -------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **US-8**  | `zod-to-json-schema` | Hand-written converter   | Outside the stack, and a hand-written one can be **strict** — it throws on a shape it does not know rather than emitting `{}`. A guess is what the frontend then builds against. |
| **US-9**  | `nestjs-pino`        | Hand-written JSON logger | Three dependencies for what at this size is a `JSON.stringify` and a level check. **This is the one most worth overruling.**                                                     |
| **US-10** | BullMQ + ioredis     | **Accepted**             | Named explicitly by the story, and Prisma 7 makes `pg` mandatory anyway.                                                                                                         |

### Why Prisma is pinned to 7.10.0

`npm view prisma version` currently returns `8.0.0-rc.10` — the `latest` dist-tag points at
a **release candidate**. `7.10.0` is the newest stable. Two things about Prisma 7 are
load-bearing and easy to break:

- **It requires a driver adapter.** The Rust query engine is gone; `@prisma/adapter-pg` and
  `pg` are mandatory, and `PrismaService` owns the connection pool as a result.
- **`importFileExtension = "js"` in the generator block is not optional here.** Prisma's
  default emits `.ts` import specifiers, which `tsc` copies verbatim into `dist/` and Node
  then cannot resolve. Removing it breaks the build at runtime, not at compile time.

---

## Story by story

### US-3 — Monorepo and shared tooling

npm workspaces (`packages/*`, `backend`, `frontend`), one lockfile at the root, root-only
ESLint 9 flat config and Prettier, `tsconfig.base.json` with project references, Husky with
lint-staged and commitlint.

**`tsc -b --noEmit` does not work here** — composite referenced projects reject it
(`TS6310`). So `typecheck` and `build` are the same command. `tsc -b` is incremental, so
building _is_ the type-check.

`import/no-extraneous-dependencies` is an error: npm hoists, so a workspace can import a
package it never declared and still compile — until the _other_ workspace that pulled it in
drops it. That rule is the countermeasure.

### US-4 — NestJS bootstrap with typed configuration

A Zod `EnvSchema` is the single source of truth for the environment. `validateEnv` prints
one readable line per offending variable and **exits** rather than throwing — a stack trace
is not a clear message. Configuration is read through `TypedConfigService`, never
`process.env`; `no-process-env` is an ESLint error everywhere in `backend/` except the
config module itself and a few clearly-marked tooling paths.

Env file precedence is `NODE_ENV`-driven: `.env.<env>.local` → `.env.<env>` → `.env.local`
(skipped under `test`) → `.env`.

### US-5 — PostgreSQL with Prisma and migrations

`PrismaService` extends `PrismaClient`, constructs the `pg.Pool`, and closes it in
`onModuleDestroy`. **`$disconnect()` alone is not enough on Prisma 7** — after it resolves,
the pool still holds every connection. There is a test that fails without the `pool.end()`.

Left behind for US-6: a deliberately temporary `MigrationProbe` model, so the migration
workflow had a schema change to prove itself against. US-6 dropped it, and that drop was a
second free proof that migrations handle evolution and not just creation.

### US-6 — Core domain schema

The highest-stakes story in the phase. Reviewed in full before a single migration was
written, per CLAUDE.md. See [The domain schema](#the-domain-schema).

### US-7 — API conventions, validation, and error handling

One success envelope, one error envelope, one validation pipe, one exception filter, one
request id. All registered as `APP_*` providers in `CommonModule` rather than via
`app.useGlobalPipes()`, because they need injection and app-level globals are built outside
the DI container.

`createZodDto` wraps a Zod schema in a class, because Nest hands a global pipe the declared
_class_ of a parameter — which is why validation in this ecosystem is class-based. That
bridge is what makes "a global validation pipe, before controller logic runs" literally
true rather than something each route opts into.

**Breaking change:** `/health` is now enveloped as `{ data: { … } }`. AC1 said "any
successful request", and an exception there would have been the first crack in the
convention. `@NoEnvelope()` exists for responses whose shape genuinely is not ours.

### US-8 — OpenAPI documentation

`/api/docs` and `/api/docs-json`, generated from the same Zod schemas that validate
requests — `ApiZodBody`, `ApiZodQuery`, and `ApiZodResponse` read `zodSchema` off the DTO.
One definition, so documentation cannot drift from enforcement.

**Production safety fails closed.** Docs are off in production unless explicitly enabled
_and_ credentialled; enabling without credentials refuses to serve rather than falling back
to public docs. The rule is a pure function, so all four cases are tested without setting
`NODE_ENV=production` on a live process.

### US-9 — Structured logging and request tracing

One JSON object per line: errors and warnings to stderr, everything else to stdout.
`LOG_LEVEL` controls verbosity, defaulting to `info` in production and `debug` elsewhere —
a developer who has to set an environment variable to see what happened will not set it.

The access log hangs off `response.on('finish')`, **not** an interceptor, because an
interceptor only sees requests that reached a handler. A 404 on an unmatched route, a
request the validation pipe rejected, and one the exception filter handled are all still
requests someone needs to find.

### US-10 — Redis for caching and background jobs

`CacheService` (`get` / `set` / `delete` / `deleteByPrefix` / `wrap`) and `QueueService`
(BullMQ, with retries, backoff, and a dead-letter queue). **Nothing outside `src/redis/`
touches the client** — if you need a command the abstraction lacks, add a method there.

**Redis is deliberately not critical.** An outage makes `/health` report `degraded`, not
`down`, and does not stop the service booting. A cache blip must not take a service out of
a load balancer while it is still perfectly able to serve from the database.

### US-11 — Docker Compose

`docker compose up` starts Postgres, Redis, the API, and the frontend; creates the
databases; applies migrations; and waits for each service to be _healthy_ before starting
what depends on it. The five `db:*` / `redis:*` npm scripts US-5 and US-10 left behind were
deleted, as both stories said they should be.

Hot reload took three rounds to actually work — see
[Traps found the hard way](#traps-found-the-hard-way).

### US-12 — CI pipeline

Two jobs on every pull request and every push to `master`. `verify` runs `npm ci`, lint,
format check, type-check, the full suite against real Postgres and Redis service
containers, then both builds — as **separate steps**, so a red run names its own cause in
the GitHub UI. `compose` validates `docker-compose.yml` and checks the entrypoint scripts
still carry their executable bit.

---

## The domain schema

18 tables (16 named entities plus two explicit join tables), 11 PostgreSQL enum types, 58
indexes, 36 foreign keys.

```
User ──< UserRole >── Role ──< RolePermission >── Permission
 │                                    │
 │                                    └── scope: OWN | DEPARTMENT | BRANCH | ALL
 │
 ├── Customer (optional 1:1 — a portal login)
 │
Branch ──< Department ──< Category
                │            │
                └────────────┴──< Ticket ──< Message ──< Attachment
                                    │  │
                                    │  ├──< TicketHistory
                                    │  └──< Task, Notification
                                    └── SlaPolicy

KnowledgeArticle    AuditLog     (independent)
```

### The nine decisions, in brief

1. **One `User` table for every authenticated principal.** A portal customer has both a
   `User` row (credentials) and a `Customer` row (the CRM record), linked by an optional
   `Customer.userId`. Auth gets built once in P02, not twice.
2. **Permission scope lives on the role↔permission grant.** `ticket.read` means `OWN` for
   an agent and `DEPARTMENT` for a manager. This is the mechanism behind the project rule
   that scoped permissions are applied _in the query_.
3. **`Attachment` hangs off `Message`, never `Ticket` directly.** Visibility is decided in
   exactly one place, so a file on an internal note is internal _by construction_ rather
   than by someone remembering to check.
4. **Bilingual, two ways.** Short labels get `nameEn` / `nameAr` column pairs. Knowledge
   articles get one row per locale tied by `translationGroupId`, because bodies are long,
   are published independently, and the Arabic version often lags.
5. **SLA state is denormalised onto `Ticket`.** The SLA sweep and the agent queue sorted by
   time remaining are hot paths that must hit an index on `Ticket`.
6. **Prisma default table naming** (`"Ticket"`, not `ticket`). Simpler, but every
   hand-written SQL query in P11 will need double quotes forever. **Reversible as a rename
   migration until production data exists — worth revisiting before the first deploy.**
7. **`uuid(7)` primary keys**, time-sortable so index locality holds, plus `Ticket.number`
   as a Postgres sequence for the human-facing "#1043".
8. **`TicketHistory` and `AuditLog` are separate, both append-only.** No `updatedAt`, no
   `deletedAt` — an audit trail you can edit is not an audit trail.
9. **Delete behaviour**: `Ticket.customer` is `Restrict`; children cascade; every optional
   reference is `SetNull`.

### `Message.isInternal` — the non-negotiable rule

```prisma
isInternal Boolean @default(false)
```

`NOT NULL`, defaulting to `false`. A message whose visibility is unknown must fall on the
safe side, and a nullable flag would make `isInternal != true` and `isInternal = false`
disagree — a trap closed at the schema. There is an index on
`(ticketId, isInternal, createdAt)` so the portal's filtered read stays on an index instead
of scanning the thread.

**The filter belongs in the API layer's query, never in the UI.** Phase 1 ships no
customer-facing endpoint, so the regression test CLAUDE.md requires arrives with the first
one — P10, or earlier if a ticket endpoint exposes messages first.

### Soft delete

Prisma has no built-in soft delete, and asking forty later stories to remember
`where: { deletedAt: null }` fails the first time someone forgets — silently, by showing a
deleted customer to an agent. So:

```ts
prisma.notDeleted.ticket.findMany(); // live rows — the normal case
prisma.ticket.findMany(); // everything, including deleted
```

Two documented limits: `findUnique` is not filtered (Prisma only accepts unique fields in
its `where`), and nested relation reads are not filtered.

---

## Conventions you have to know

**Responses.** Success is `{ data: … }`; lists add `pagination`. Failure is always
`{ error: { statusCode, code, message, details?, requestId, timestamp } }`. `page` is
1-based. `pageSize` is clamped to 100 rather than rejected.

**Errors.** Throw `ApiException`, not Nest's built-ins, so the client gets a real
machine-readable `code` instead of one inferred from the HTTP status. Never leak internals:
the filter turns anything unrecognised into a generic 500 and logs the detail. Prisma's
messages name tables and columns, and are treated as internal.

**Validation.** Define a Zod schema, wrap it with `createZodDto`, type the parameter with
it. The global pipe does the rest — and the same schema documents the endpoint.

**Logging.** Prefer `StructuredLogger.emit(level, message, fields)` over interpolating
values into a string: fields are redacted structurally, strings only by pattern.

**Tests.** `node:test` plus `@nestjs/testing`, run against built output in `dist/`. There
is no Jest, no Vitest, no supertest. **The suite needs Postgres and Redis running and
nothing skips when they are absent** — it fails loudly and names the command to fix it.

---

## Traps found the hard way

These are the things that cost real time. They are written down so they cost nobody else.

| Trap                                                           | What happens                                                                              | Fix                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Prisma 7 emits `.ts` import specifiers**                     | `tsc` copies them into `dist/`; Node throws `ERR_MODULE_NOT_FOUND` at runtime             | `importFileExtension = "js"` in the generator block                     |
| **`$disconnect()` does not close the pg pool**                 | Connections leak server-side after shutdown                                               | `PrismaService` calls `pool.end()` too                                  |
| **Shutting down twice throws**                                 | `pool.end()` and ioredis both raise on a second call; `app.close()` fails                 | Guards in both, plus a `try`/`catch` — shutdown is not a place to throw |
| **`TypedConfigModule` was not `@Global()`**                    | Its docblock promised it was; nothing had exercised the claim until US-5                  | Added the decorator                                                     |
| **`x-api-key` was not redacted**                               | An API key in a header would have been written to the access log in clear text            | Key matching now strips separators before comparing                     |
| **`z.coerce.boolean()` on env vars**                           | The string `"false"` coerces to `true`                                                    | An explicit `'true' \| 'false' \| '1' \| '0'` enum with a transform     |
| **Windows bind mounts deliver no inotify events**              | `tsc --watch` and Vite sit there seeing nothing; hot reload silently does not work        | Polling watchers, opt-in so host development does not pay the CPU cost  |
| **`dist/` on the bind mount**                                  | `tsc` rebuilds correctly but `node --watch` never restarts                                | `dist/` is a container-local anonymous volume                           |
| **`.tsbuildinfo` from the host vs an empty container `dist/`** | `tsc -b` trusts it, skips `@crm/shared`, and the backend fails to compile                 | The entrypoint runs `tsc -b backend --force` once at startup            |
| **Postgres 18 changed its data path**                          | Mounting `/var/lib/postgresql/data` makes the container refuse to start                   | Mount `/var/lib/postgresql`. Invisible on Postgres 17                   |
| **Entrypoint scripts committed as `100644`**                   | Nothing broke — the Dockerfiles `chmod +x` — but the postgres-init script had no such net | CI now checks the bit; `git update-index --chmod=+x` fixed it           |

---

## What is not done

Four things. None of them is hidden, and none should be marked done without action.

### 1. CI has never run — the phase's last exit criterion

Nothing has been pushed to `origin`
(`github.com/OmarBayoumy01/customer-support-crm`). The pipeline is valid (`actionlint`
reports no problems) and **every step it runs passes locally**, including the frontend's
`vite build` that the type-check does not cover. But "CI is green on a pull request" needs a
real run.

**To close it:** push, open a pull request, confirm the run is green.

### 2. Branch protection — US-12's AC4

**Not satisfiable by a file in this repository.** Required status checks are a GitHub
repository setting; it takes an admin enabling them once. Until then the pipeline reports
and nothing enforces.

**To close it:** the exact `gh api` call is in
[`infrastructure/README.md`](../infrastructure/README.md). Note the `contexts` are job
**display names** — renaming a job in `ci.yml` silently unhooks the protection.

### 3. US-8's AC3 is only partly proved

"Given a protected endpoint … supply a bearer token and call it successfully." There are no
protected endpoints until P02. What _is_ proved: the bearer scheme is declared, a decorated
route carries the security requirement, a request with a token reaches the handler and one
without is refused, and the token persists across reloads in the docs UI. **The guard in
that test is a stand-in.** Re-check when auth lands.

### 4. The internal-notes regression test

CLAUDE.md requires an explicit regression test that an internal note never reaches a
customer. The schema supports it and the index is in place, but **Phase 1 ships no
customer-facing endpoint to test against.** It arrives with the first one.

---

## What Phase 2 inherits

**P02 — Auth & Access** builds directly on this. Concretely:

- **`User.passwordHash` is a plain column.** Hashing, lockout, and token revocation are
  auth's job, not the schema's.
- **Call `RequestContextService.setUserId()` from the authentication guard.** Every
  subsequent log line for that request then carries the user, which is what US-9's "user ID
  where known" means.
- **Decorate protected routes with `@ApiBearerAuth(BEARER_AUTH_NAME)`** — the scheme is
  already declared — and revisit US-8's AC3 above.
- **Apply scoped permissions in the query.** `RolePermission.scope` is
  `OWN | DEPARTMENT | BRANCH | ALL`; a guard reads the scope and the query adds the
  matching `WHERE`. Filtering after fetching everything is never correct.
- **Throw `ApiException`**, so `UNAUTHENTICATED` and `FORBIDDEN` reach the frontend as
  codes rather than bare status numbers.

Also waiting on later phases:

- **Seed data (US-12's out-of-scope, in practice P02's problem):** the platform boots with
  no roles, no permissions, and no `SlaPolicy` rows — so nobody can do anything.
- **P08 (SLA):** `SlaPolicy.businessHoursOnly` and `Branch.timezone` are the flags the
  calendar will read. `QueueService.registerWorker` is where the timer job goes.
- **P11 (reports):** revisit the PascalCase table naming decision **before** production
  data exists.
- **P15:** the Compose images are development-only and should not be extended into
  production ones. Log shipping needs no application change — JSON on stdout is what a
  collector expects.

---

## Running and verifying it

```bash
docker compose up            # Docker Desktop is the only prerequisite
```

| What              | Where                          |
| ----------------- | ------------------------------ |
| Frontend          | http://localhost:5173          |
| API               | http://localhost:3000          |
| Health            | http://localhost:3000/health   |
| API documentation | http://localhost:3000/api/docs |

To work on the host instead, with the data services still in Docker:

```bash
nvm use
npm install
docker compose up -d postgres redis
cp backend/.env.example backend/.env
npm run migrate:deploy --workspace @crm/backend
npm run verify           # type-check, lint, format check, 159 tests
```

### Exit criteria, as measured

Run against a wiped state (`docker compose down -v`) on 2026-08-26:

| Criterion                                                             | Result                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| `docker compose up` gives a working stack from a clean clone          | ✅ four services healthy in ~55s                             |
| `/health` reports database and Redis as up                            | ✅ `ok` — database 2 ms, redis 1 ms                          |
| `/api/docs` lists endpoints with documented schemas                   | ✅ 200; `ApiError`, `PaginationMeta`, `HealthStatus`, bearer |
| CI is green on a pull request                                         | ⚠️ **not run — nothing pushed**                              |
| Prisma schema covers every core entity, `Message.isInternal` in place | ✅ 18 tables, 11 enums; `boolean NOT NULL DEFAULT false`     |

---

## Where the rest of the detail lives

- **Story text and acceptance criteria** — the Notion _User Stories_ database. It is the
  source of truth; this document does not restate it.
- **Per-story plans, decisions, and deviations** — `.squad/plans/<feature>/`. Each feature's
  `00-overview.md` records what was decided and why, what deviated during execution, and
  what the next story inherits.
- **Story intakes** — `.squad/stories/<feature>/`, the input each plan was written from.
- **How to work in the backend day to day** — [`backend/README.md`](../backend/README.md).
- **CI and branch protection** — [`infrastructure/README.md`](../infrastructure/README.md).
