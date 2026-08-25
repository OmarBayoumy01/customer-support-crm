# `@crm/backend`

NestJS API for the Customer Support CRM.

## Running it

```
cp .env.example .env          # from this directory
npm run build --workspace @crm/backend
npm run dev   --workspace @crm/backend
```

`GET /health` then answers on `http://localhost:3000/health`.

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

Only `.env.example` is committed. `.env` and `.env.*` are gitignored.

## Structure

```
src/
├── config/     Env schema, validation, typed accessor
├── health/     GET /health
├── app.module.ts
└── index.ts    Bootstrap
```

`AppModule` and `index.ts` are deliberately small so **US-7** can attach the global
validation pipe, exception filter, and response interceptor without restructuring.

**Domain modules are not scaffolded ahead of use.** `auth`, `users`, `customers`,
`tickets`, `sla`, and `notifications` are each created by the story that owns their
behaviour. Empty modules hide which parts of the system actually exist.

## Health endpoint

Reports only that the process is up. It does **not** yet check the database or Redis —
those services arrive in **US-5** and **US-10**, and each registers its own check into
`HealthModule` at that point. The response shape will not change: it is already the shared
`HealthStatus` DTO from `@crm/shared`.

## Tests

```
npm run test --workspace @crm/backend
```

`node:test` from the standard library plus `@nestjs/testing` for the DI container. HTTP
assertions use Node's built-in `fetch` against `app.listen(0)`. There is no Vitest, Jest,
or supertest — that was a deliberate choice to avoid dependencies outside the approved
stack.

Tests compile to `dist/` first and run against the built output, matching `packages/shared`.
