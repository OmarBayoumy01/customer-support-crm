# 06 — Generate OpenAPI documentation with Swagger

- **Story:** US-8 · **Phase:** P01 Foundation · **Layer:** Backend · **Priority:** Should have
- **Depends on:** US-7 (done)

Decisions and their reasoning are in `00-overview.md`. **Read the AC3 note there before
marking this story done** — that criterion is only partly provable in Phase 1.

## Target paths

| Action     | Path                                          |
| ---------- | --------------------------------------------- |
| **create** | `backend/src/openapi/zod-to-openapi.ts`        |
| **create** | `backend/src/openapi/api-zod.decorators.ts`    |
| **create** | `backend/src/openapi/swagger.ts`               |
| **create** | `backend/src/openapi/index.ts`                 |
| **create** | `backend/src/openapi/openapi.test.ts`          |
| **modify** | `backend/src/index.ts` — mount before `listen` |
| **modify** | `backend/src/health/health.controller.ts` — tags and response |
| **modify** | `backend/src/config/env.schema.ts` — four Swagger variables |
| **modify** | `backend/.env.example`, `backend/README.md`    |

New dependency: **`@nestjs/swagger@11.4.7`**, named by the story's own technical notes.
Its `class-validator` / `class-transformer` peers are only needed by the CLI plugin, which
is not used.

## Configuration

| Variable                        | Default    | Effect                                          |
| ------------------------------- | ---------- | ----------------------------------------------- |
| `SWAGGER_PATH`                  | `api/docs` | Where the UI mounts. No leading slash.          |
| `SWAGGER_ENABLED_IN_PRODUCTION` | `false`    | Production only; ignored elsewhere.             |
| `SWAGGER_USER` / `SWAGGER_PASSWORD` | unset  | Required for production docs to serve at all.   |

The rule, in one sentence: **outside production the docs are always on and unprotected; in
production they are off unless explicitly enabled *and* credentialled, and enabling without
credentials refuses rather than serving openly.**

## How each criterion is proved

| AC  | Tests                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------- |
| AC1 | Fetches `/api/docs` from a running app and asserts the UI is served; fetches `/api/docs-json` and asserts `/health` and both demo routes are listed, each carrying the operation tag that groups it in the UI. |
| AC2 | Asserts a documented request body names its required fields with the right types; query parameters render individually; the documented response shows the `{ data }` wrapper; `ApiError`, `PaginationMeta`, and `HealthStatus` are registered as components; and the error `code` is enumerated. The converter is also unit-tested directly, including that it **throws** on an unsupported node. |
| AC3 | Bearer scheme declared; a decorated route carries the security requirement; a request with a token succeeds and one without is refused. **Against a stand-in guard — see `00-overview.md`.** |
| AC4 | `decideSwagger` is a pure function, tested across all four cases: non-production on; production off by default; production enabled without credentials **refuses**; production enabled with credentials serves behind basic auth. |

## Verification

```
npm run verify
npm run dev --workspace @crm/backend   # then open http://localhost:3000/api/docs
```

Green as of 2026-08-26: 22 shared tests, 91 backend tests.
