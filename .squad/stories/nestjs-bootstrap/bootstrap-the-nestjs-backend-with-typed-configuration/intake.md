# Story intake

- Source of truth: Notion "User Stories" database, ref **US-4**.

---

## Feature

- **Feature name (display):** NestJS Bootstrap
- **Feature slug (folder under `plans/`):** `nestjs-bootstrap`

## Tracker (metadata only)

- **Tracker type:** `none` (stories live in Notion)
- **Work item id:** `US-4`
- **Status:** Ready
- **Labels:** Phase `P01 Foundation` · Layer `Backend` · Persona `Developer` · Priority `Must have` · Release `MVP`

---

## Title

```
Bootstrap the NestJS backend with typed configuration
```

---

## Description

```
As a developer
I want a NestJS application with validated environment configuration
So that the service fails fast on misconfiguration instead of at runtime in production.
```

---

## Acceptance criteria

```
AC1 — App boots
  Given valid environment variables
  When I start the backend
  Then the app listens on the configured port and exposes a health endpoint.

AC2 — Config validation
  Given a missing or malformed required variable
  When the app starts
  Then it exits with a clear message naming the offending variable.

AC3 — Typed config access
  Given a service needs a config value
  When it injects ConfigService
  Then the value is strongly typed, never read from `process.env` directly.

AC4 — Environment separation
  Given local, staging, and production
  When the app runs in each
  Then it loads the correct configuration without code changes.

Every acceptance criterion must be covered by a test or an executable check. If an AC
cannot be tested, say so in the plan rather than marking it done.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. | |

---

## Current state of the repository — US-3 is DONE

This is not a greenfield story. US-3 (`.squad/plans/monorepo-foundation/`) landed and every
path below exists and is committed. Read the real files rather than assuming.

- **npm workspaces monorepo.** Root `package.json` declares `workspaces: ["packages/*",
  "backend", "frontend"]`. `npm install` runs from the root only. There is one lockfile.
- **`backend/`** is a bare TypeScript scaffold: `backend/package.json` (name `@crm/backend`,
  `"type": "module"`, deps `@crm/shared` and `zod`, devDep `@types/node`),
  `backend/tsconfig.json`, and `backend/src/index.ts` — a placeholder that imports
  `HealthStatus` from `@crm/shared`, parses it, and logs it. **US-4 replaces
  `backend/src/index.ts` with the real NestJS bootstrap.**
- **`packages/shared/`** exports `HealthStatusSchema` and `HealthStatus` from
  `packages/shared/src/dto/health.ts`. The DTO is
  `{ status: 'ok' | 'degraded' | 'down', service: string, timestamp: ISO string }`.
  **Reuse it for the health endpoint** rather than defining a second health shape.
- **TypeScript:** composite projects with references. `tsconfig.base.json` at the root owns
  strictness (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noUnusedLocals`, `noUnusedParameters`). `backend/tsconfig.json` extends it and sets
  `module`/`moduleResolution` to **NodeNext** with `composite: true`, `outDir: ./dist`,
  `rootDir: ./src`, and a reference to `../packages/shared`.
- **`tsc -b --noEmit` does not work here** — composite referenced projects may not disable
  emit (TS6310, verified). `npm run typecheck` and `npm run build` are both `tsc -b`.
- **ESLint 9 flat config** at the root only (`eslint.config.js`), type-checked rules on.
  `import/no-extraneous-dependencies` is **error** — every workspace declares its own
  direct dependencies. `@typescript-eslint/no-explicit-any` is **error**.
  `@typescript-eslint/no-floating-promises` is **error**.
- **Prettier** at the root only. `npm run verify` = typecheck → lint → format:check → test.
- **Tests** run on `node:test` from the standard library. `packages/shared` runs them
  against built output (`tsc -b && node --test "dist/**/*.test.js"`). **There is no test
  runner installed.** NestJS conventionally ships Jest — see "Open decision" below.
- **Git hooks** (Husky v9): `pre-commit` runs `npx lint-staged` then `npm run typecheck`;
  `commit-msg` runs commitlint with conventional commits. `.gitattributes` forces LF.

---

## Environment constraints — read before writing verification steps

The development machine has **no Docker, no PostgreSQL, and no Redis**. Verified: `docker`,
`psql`, and `redis-server` are all absent; only WSL is present.

This directly affects AC1. The story's technical notes say `/health` should return
**database and Redis connectivity** — but Prisma/Postgres arrive in **US-5** and Redis in
**US-10**, and neither service can run on this machine today.

The plan must handle this explicitly rather than pretending otherwise:

- `/health` must work **now**, with no database and no Redis, and must be structured so
  US-5 and US-10 can each register a dependency check into it without redesigning it.
- Do not add a Postgres or Redis health check in this story. Do not add `@nestjs/terminus`
  wired to indicators that cannot run.
- Any AC or verification step that would need a live service must be marked as **not
  verifiable in this story** and deferred to the story that introduces the service.

---

## Approved stack — do not substitute or extend without asking

Backend: Node.js, NestJS, TypeScript, PostgreSQL, Prisma, Redis, Socket.IO, JWT.
Frontend and infrastructure lists exist too but are irrelevant here.

`@nestjs/config` and the Nest platform packages are implied by "NestJS" and are fine.
**Anything else is a new dependency and must be flagged in the plan, not silently added.**

## Open decision the plan must state, not assume

`@nestjs/config` supports Joi out of the box; the story says "a Zod or Joi validation
schema". **Zod is already in the stack and already used in `packages/shared`.** Prefer Zod
and avoid adding Joi. If the plan disagrees, it must say why in one sentence.

Similarly: **no test runner is installed.** If the plan needs one to test AC1–AC4, it must
name it as a dependency decision to be approved, and provide a fallback using `node:test`
that proves as much as possible without it.

---

## Dependencies

- **Blocked by:** US-3 (done).
- **Unblocks:** US-5 (Prisma), US-7 (API conventions), US-9 (logging), US-10 (Redis).
- US-7 establishes the API response and error conventions. This story creates the app that
  US-7 will configure globally — keep `main.ts` and the root module small and obvious so
  US-7 has clean seams (a global pipe, a global filter, a global interceptor) to hook into.

## Extra notes

- Working agreement: prefer boring, explicit code over clever abstractions. This codebase
  will be maintained by people who did not write it.
- Definition of done for every story: all ACs met and covered by tests; TypeScript strict,
  no `any` without a written justification; lint and format pass; no secrets, keys, or
  credentials committed; errors handled and logged, never swallowed.
- Two non-negotiable project rules. Neither is exercised by this story directly, but the
  structure created here must not make them harder later:
  1. Internal notes must never reach a customer — filtered at the API layer.
  2. The server is the security boundary — every permission enforced again in a backend
     guard, scoped permissions applied in the database query.
- The story's technical notes list modules: `auth`, `users`, `customers`, `tickets`, `sla`,
  `notifications`. Creating six empty modules that do nothing is scaffolding nobody asked
  for and each belongs to its own later phase. The plan should decide deliberately: either
  create the directory structure with a one-line justification, or note that modules are
  created by the stories that need them. Say which, and why.
- `.env` and `.env.*` are already gitignored; `!.env.example` is allowed. Commit an
  `.env.example`, never a real `.env`.

## Technical hints

- `@nestjs/config` with a **Zod** validation schema (see open decision above).
- Config must be consumed through a typed accessor. `ConfigService` with a generic type
  parameter, or a `registerAs`-style namespaced config, or a small typed facade — the plan
  picks one and applies it consistently. Reading `process.env` outside the config module
  must be prevented, ideally by lint (`no-process-env`), not just convention.
- AC4 (environment separation) needs a concrete mechanism: `NODE_ENV`-driven env file
  selection via `envFilePath`, with documented precedence. State the precedence order.
- AC2 requires the process to **exit** with a message naming the offending variable. Zod's
  error output must be formatted into something readable, not dumped as a raw stack.
- Windows: all scripts must work there.

## Out of scope

- Cloud secrets management (Phase P15 — deployment).
- Prisma, PostgreSQL (US-5), the domain schema (US-6), Redis (US-10).
- Global validation pipe, error filter, and response envelope conventions (US-7) — create
  the seams, do not fill them.
- Swagger/OpenAPI (US-8).
- Structured logging and request tracing (US-9) — use Nest's built-in logger for now.
- Docker (US-11) and CI (US-12).
- Any authentication or authorisation logic (Phase P02).
