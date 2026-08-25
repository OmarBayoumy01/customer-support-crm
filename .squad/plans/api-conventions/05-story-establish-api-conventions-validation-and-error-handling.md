# 05 — Establish API conventions, validation, and error handling

- **Story:** US-7 · **Phase:** P01 Foundation · **Layer:** Backend · **Priority:** Must have
- **Depends on:** US-4 (done)

Decisions and their reasoning are in `00-overview.md`.

## Target paths

**`packages/shared/`** — both sides consume these contracts, so they live here rather than
being defined twice:

| Action     | Path                                     |
| ---------- | ---------------------------------------- |
| **create** | `src/api/error-codes.ts`                 |
| **create** | `src/api/envelope.ts`                    |
| **create** | `src/api/pagination.ts`                  |
| **create** | `src/api/envelope.test.ts`               |
| **modify** | `src/index.ts`                           |

**`backend/src/common/`** — the machinery that applies them:

| Action     | Path                                              |
| ---------- | ------------------------------------------------- |
| **create** | `common.module.ts` — registers every global        |
| **create** | `errors/api.exception.ts`                          |
| **create** | `validation/create-zod-dto.ts`                     |
| **create** | `validation/zod-validation.pipe.ts`                |
| **create** | `filters/all-exceptions.filter.ts`                 |
| **create** | `interceptors/response-envelope.interceptor.ts`    |
| **create** | `decorators/no-envelope.decorator.ts`              |
| **create** | `request-context/request-context.service.ts`       |
| **create** | `request-context/request-id.middleware.ts`         |
| **create** | `logging/context-logger.ts`                        |
| **create** | `api-conventions.test.ts`                          |
| **create** | `index.ts`                                         |
| **modify** | `../app.module.ts`, `../index.ts`                  |
| **modify** | `../health/health.controller.test.ts` — now enveloped |

## The contracts

**Success, single:** `{ data: T }`
**Success, list:** `{ data: T[], pagination: { page, pageSize, total, totalPages, hasNext, hasPrevious } }`
**Error, always:** `{ error: { statusCode, code, message, details?, requestId, timestamp } }`

`page` is 1-based — it is a user-facing number that ends up in a URL and in a "page 3 of
12" label. `pageSize` is clamped to 100 rather than rejected: a client asking for 500 rows
gets 100 and a correct `pagination` block, which is friendlier than a 422 and just as safe.

`requestId` is in the error body as well as the header, because it is the thing a user
reads out over the phone and it has to survive being screenshotted.

## How each criterion is proved

| AC  | Tests                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| AC1 | A purpose-built controller returns a single resource, a paginated list, and a `@NoEnvelope()` route. Asserts the wrap, that an already-enveloped list is not double-wrapped, that defaults apply, and that an oversized `pageSize` is clamped. |
| AC2 | An `ApiException` keeps its own code; a Nest `NotFoundException` is mapped onto the same shape; an unmatched route — a 404 the framework raises, not us — comes back in the envelope too. Every body is parsed with the shared `ApiErrorSchema`, so the test fails if the backend drifts from the contract. |
| AC3 | An invalid body returns 422 with per-field details; a nested failure reports a dotted path (`nested.flag`) a form library can map back; the controller demonstrably never runs; a valid body arrives **coerced**, so `"7"` reaches the handler as `7`. |
| AC4 | A handler throws an error whose message contains a filesystem path and a SQL statement. The response is asserted to contain no path, no `SELECT`, and no stack frame — matched against the raw text, not the parsed body, so nothing can hide in an unexpected field. |
| AC5 | Every response carries `x-request-id`; two requests differ; an inbound id is honoured so a gateway's trace survives; a hostile inbound id is stripped rather than echoed; the id in the error body matches the header. |

## Verification

```
npm run verify
```

Green as of 2026-08-26: 22 shared tests, 69 backend tests.
