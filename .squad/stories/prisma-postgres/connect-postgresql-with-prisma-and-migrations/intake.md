# Story intake

- Source of truth: Notion "User Stories" database, ref **US-5**.

---

## Feature

- **Feature name (display):** Prisma & PostgreSQL
- **Feature slug (folder under `plans/`):** `prisma-postgres`

## Tracker (metadata only)

- **Tracker type:** `none` (stories live in Notion)
- **Work item id:** `US-5`
- **Status:** In progress
- **Labels:** Phase `P01 Foundation` · Layer `Backend` · Persona `Developer` · Priority `Must have` · Release `MVP`

---

## Title

```
Connect PostgreSQL with Prisma and migrations
```

---

## Description

```
As a developer
I want PostgreSQL wired up through Prisma with a migration workflow
So that schema changes are versioned and reproducible across environments.
```

---

## Acceptance criteria

```
AC1 — Connection
  Given the database is running
  When the app starts
  Then Prisma connects and the health endpoint reports the database as up.

AC2 — Migrations
  Given a schema change
  When I generate a migration
  Then it is committed as a file and applies cleanly to an empty database.

AC3 — Type generation
  Given the Prisma schema
  When the client is generated
  Then model types are available to the backend with full type safety.

AC4 — Connection pooling
  Given concurrent requests
  When the app is under load
  Then connections are pooled and released rather than leaked.

Every acceptance criterion must be covered by a test or an executable check. If an AC
cannot be tested, say so in the plan rather than marking it done.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. | |

---

## Current state of the repository — US-3 and US-4 are DONE

Not greenfield. Every path below exists and is committed. Read the real files rather than
assuming.

- **npm workspaces monorepo.** Root `package.json` declares `workspaces: ["packages/*",
  "backend", "frontend"]`. One lockfile, `npm install` from the root only.
  Node `24.15.0`, npm `11.12.1`, `"type": "module"` everywhere.
- **`backend/`** is a working NestJS 11 app:
  - `backend/src/index.ts` — bootstrap, reads `PORT`/`HOST` through `TypedConfigService`,
    `app.listen()`, catches and logs bootstrap failures then `process.exit(1)`.
  - `backend/src/app.module.ts` — `@Module({ imports: [TypedConfigModule, HealthModule] })`.
    Deliberately minimal; domain modules are NOT scaffolded ahead of use.
  - `backend/src/config/` — `env.schema.ts` (Zod `EnvSchema` with `NODE_ENV`, `PORT`,
    `HOST`; `validateEnv` prints `formatEnvIssues()` and calls `process.exit(1)`),
    `config.module.ts` (`ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath,
    validate })`), `typed-config.service.ts` (`TypedConfigService.get<K extends keyof Env>`),
    `env-files.ts` (`envFilePathsForNodeEnv`), `index.ts` (barrel).
  - `backend/src/health/` — `HealthController` (`@Get()` on `@Controller('health')`)
    returns `HealthStatusSchema.parse({ status, service, timestamp })`. `HealthModule`
    carries a comment saying **US-5 registers a PostgreSQL check here** and US-10 a Redis
    check, and that `status` becomes `'degraded'`/`'down'` accordingly.
  - `backend/.env.example` is committed and documents every variable in `EnvSchema`.
- **`packages/shared/`** exports `HealthStatusSchema` / `HealthStatus`:
  `{ status: 'ok' | 'degraded' | 'down', service: string, timestamp: ISO datetime }`.
  The health endpoint parses its own response through this schema on the way out, and
  `health.controller.test.ts` asserts against it.
- **TypeScript:** composite projects with references. `tsconfig.base.json` owns strictness
  (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`,
  `noUnusedParameters`, `isolatedModules`, `declaration`). `backend/tsconfig.json` extends
  it: `module`/`moduleResolution` **NodeNext**, `composite: true`, `outDir: ./dist`,
  `rootDir: ./src`, `emitDecoratorMetadata`, `experimentalDecorators`, reference to
  `../packages/shared`.
- **`tsc -b --noEmit` does not work here** (TS6310, verified). `npm run typecheck` and
  `npm run build` are both `tsc -b`. Backend imports use **explicit `.js` extensions**.
- **ESLint 9 flat config**, root only. `import/no-extraneous-dependencies`,
  `import/no-unresolved`, `@typescript-eslint/no-explicit-any`,
  `@typescript-eslint/no-floating-promises`, `no-empty` — all **error**.
  `no-process-env` is **error** in `backend/**` except `backend/src/config/**`.
  Ignores: `**/dist/**`, `**/build/**`, `**/node_modules/**`, `**/coverage/**`,
  `**/.vite/**`, `**/.tsbuild/**`, `.squad/**`.
- **Tests** run on `node:test` + `@nestjs/testing` against **built output**:
  `backend` test script is `tsc -b && node --test "dist/**/*.test.js"`. Node 24's built-in
  `fetch` does the HTTP assertions. **There is no Jest, no Vitest, no supertest, and none
  may be added** — this was decided in US-4.
- `npm run verify` = typecheck -> lint -> format:check -> test.
- **Git hooks** (Husky v9): `pre-commit` = `npx lint-staged` + `npm run typecheck`;
  `commit-msg` = commitlint conventional. `.gitattributes` forces LF.
- `.gitignore` ignores `.env` and `.env.*` with a single exception, `!.env.example`.

---

## Environment — verified on this machine today

- **Docker Desktop is installed and the engine is running.** `docker version` reports
  server `29.7.2`; `docker run --rm hello-world` succeeds. This is new — US-3 and US-4 were
  planned when no Docker existed.
- `docker manifest inspect` confirms both `postgres:18-alpine` and `postgres:17-alpine`
  resolve.
- There is still **no native `psql` client and no local PostgreSQL service**. Any database
  must come from a container.
- There is **no `docker-compose.yml` anywhere in the repo yet** — US-11 owns it.
  `infrastructure/` contains only a `README.md`.

---

## Approved stack — do not substitute or extend without asking

Backend: Node.js · NestJS · TypeScript · PostgreSQL · Prisma · Redis · Socket.IO · JWT.

`@nestjs/*` platform packages are implied by "NestJS" and are fine.
**Anything else is a new dependency and must be flagged in the plan, not silently added.**

---

## Verified facts about Prisma that the plan MUST NOT get wrong

Checked against npm and the Prisma docs on 2026-08-25. These change the shape of this
story compared to any Prisma 5/6 knowledge:

1. **`npm view prisma version` returns `8.0.0-rc.10`.** The `latest` dist-tag currently
   points at a **release candidate**. Do not install `latest`. The newest stable is
   **`7.10.0`** (dist-tag `prev`). Pin `prisma@7.10.0` and `@prisma/client@7.10.0` exactly,
   the way every other dependency in this repo is pinned.
2. **Prisma 7 is ESM-only** and expects `"type": "module"`. `backend/package.json` already
   is. This is a fit, not a problem.
3. **Prisma 7 requires a driver adapter.** The Rust query engine no longer opens the
   connection. For PostgreSQL that means `@prisma/adapter-pg` plus `pg`, and
   `new PrismaClient({ adapter })`. Without an adapter the client throws
   *"Using engine type 'client' requires either 'adapter' or 'accelerateUrl'"*.
   **These are new dependencies. Flag them explicitly for approval in the plan** — they are
   Prisma's own required transport for the already-approved "PostgreSQL + Prisma", not a
   substitution, but the working agreement says ask.
4. **The generator changed.** `prisma-client-js` is deprecated; use
   `generator client { provider = "prisma-client" }` and `output` is now **required** — it
   no longer defaults to `node_modules/.prisma`. The client is imported from the generated
   path, not from `@prisma/client`.
5. **`prisma.config.ts` replaces the old config surface, and the CLI no longer auto-loads
   `.env`.** The docs tell you to `import 'dotenv/config'`. **Node 24 has
   `process.loadEnvFile()` built in** — prefer that and avoid adding `dotenv`. If it does
   not work with the Prisma CLI's TS config loader, say so and propose `dotenv` as a flagged
   dependency rather than silently adding it.
6. Because the adapter is now `pg`, **AC4 is about the `pg.Pool`**, not about a Prisma
   internal. Pool size, acquisition, and release are all observable and therefore testable.

---

## Open decisions the plan must state, not assume

**D1 — What model exists, given US-6 owns the domain schema.**
`prisma migrate dev` against an empty schema produces no migration, so AC2 ("it is
committed as a file and applies cleanly to an empty database") and AC3 ("model types are
available with full type safety") cannot be demonstrated with zero models. But US-6 is the
domain schema and CLAUDE.md flags it as the highest-stakes story in the phase, to be
reviewed in full before migrations are written. The plan must pick one and justify it in a
sentence:

- (a) a single deliberately temporary probe model, dropped by US-6's first migration —
  which makes the drop itself a second proof that the migration workflow works; or
- (b) land the plumbing only, and mark AC2 and AC3 as **not verifiable in this story**,
  deferred to US-6.

State which, and what US-6 inherits.

**D2 — How a developer gets a PostgreSQL instance, without pre-empting US-11.**
US-11 owns `docker-compose.yml` and Phase 1's exit criterion is `docker compose up`.
Adding compose now takes work from US-11. Propose the smallest thing that lets AC1–AC4 be
tested today and that US-11 can absorb rather than undo. Name the image tag and say that
US-11 must match it.

**D3 — The test database, given `.env.*` is gitignored.**
Technical notes require a separate test database. `backend/.env.test` cannot be committed
under the current `.gitignore`. Either add a narrow `!.env.test` exception (it would hold
only throwaway localhost credentials, no secret), or have the test setup supply the URL
another way. Pick one; if it is the `.gitignore` exception, say plainly that the file must
never gain a real credential.

**D4 — Where the generated client goes and how it survives `tsc -b` and ESLint.**
`output` is required. Anything under `backend/src/` is compiled by `tsc -b` and linted by
the root ESLint config. Generated code will not have been written to satisfy
`noUnusedLocals`, `exactOptionalPropertyTypes`, or `no-explicit-any`. State the output path,
the ESLint ignore entry, and the fallback if the generated client does not typecheck under
this repo's strictness.

**D5 — The health payload shape.**
Phase 1's exit criteria say `/health` must report **database and Redis as up**, but the
shared `HealthStatus` DTO has no place to put per-dependency state, and `HealthModule`'s
comment asserts the shape would not change. It has to change. Propose the extension to
`packages/shared` — keyed object or array, what a single entry contains — and make it
shaped so US-10 adds Redis by registering one more entry, not by editing the DTO again.
Whatever is chosen, `HealthModule`'s now-stale comment must be corrected in this story.

---

## Dependencies

- **Blocked by:** US-4 (done).
- **Unblocks:** US-6 (domain schema), and everything in later phases that touches data.
- US-6 will write the real schema. Leave it a clean, obvious place to do that: one
  `schema.prisma`, one migrations directory, one `PrismaService`, and no cleverness.
- US-10 adds Redis to the same health endpoint. US-11 adds compose. US-12 runs migrations
  in CI against a throwaway instance — the commands this story creates are what CI will
  call, so they must be non-interactive and Windows-safe.

---

## Technical hints from the story

- `PrismaService` with an `onModuleDestroy` disconnect.
- Separate test database; migrations run in CI against a throwaway instance.

## Extra notes

- Working agreement: prefer boring, explicit code over clever abstractions. This codebase
  will be maintained by people who did not write it.
- Definition of done for every story: all ACs met **and covered by tests**; TypeScript
  strict, no `any` without a written justification; lint and format pass; no secrets, keys,
  or credentials committed; errors handled and logged, never swallowed.
- Two non-negotiable project rules. Neither is exercised directly here, but this story
  chooses how data is reached, so it must not make either harder:
  1. Internal notes must never reach a customer — filtered at the API layer.
  2. **The server is the security boundary — scoped permissions are applied in the database
     query, never by filtering after fetching everything.** That is a direct constraint on
     how `PrismaService` is exposed later: query-level scoping must stay possible.
- Windows is the development machine. Every script must work in PowerShell as well as
  bash — no POSIX-only shell in npm scripts, no `NODE_ENV=x cmd` prefixes.
- Commit `.env.example` updates alongside any new variable in `EnvSchema`; that pairing is
  documented in the file itself.

## Out of scope

- **The domain schema itself (US-6)** — entities, relations, enums, indexes,
  `Message.isInternal`. Not this story.
- Seed data beyond whatever is strictly needed to prove a migration applies.
- Redis (US-10).
- Global validation pipe, error filter, response envelope (US-7).
- Swagger/OpenAPI (US-8).
- Structured logging and request tracing (US-9) — Nest's built-in logger for now.
- `docker-compose.yml` for the full stack (US-11) and the CI pipeline (US-12).
- Query performance work, read replicas, PgBouncer, Prisma Accelerate.
- Any authentication or authorisation logic (Phase P02).
