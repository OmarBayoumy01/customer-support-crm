# 07 — Add structured logging and request tracing

- **Story:** US-9 · **Phase:** P01 Foundation · **Layer:** Backend · **Priority:** Must have
- **Depends on:** US-7 (done)

Decisions and their reasoning are in `00-overview.md`.

## Target paths

| Action     | Path                                                    |
| ---------- | ------------------------------------------------------- |
| **create** | `backend/src/common/logging/structured-logger.ts`        |
| **create** | `backend/src/common/logging/redact.ts`                   |
| **create** | `backend/src/common/logging/log-level.ts`                |
| **create** | `backend/src/common/logging/logger.token.ts`             |
| **create** | `backend/src/common/logging/request-logging.middleware.ts` |
| **create** | `backend/src/common/logging/logging.test.ts`             |
| **delete** | `backend/src/common/logging/context-logger.ts` — superseded |
| **modify** | `backend/src/common/common.module.ts` — provide the logger, add the middleware |
| **modify** | `backend/src/common/request-context/request-context.service.ts` — `setUserId` |
| **modify** | `backend/src/common/index.ts`, `backend/src/index.ts`    |
| **modify** | `backend/src/config/env.schema.ts` — `LOG_LEVEL`         |

No new dependencies.

## The output

One JSON object per line. Errors and warnings to stderr, everything else to stdout, so a
container runtime that separates the two keeps doing the right thing.

```json
{
  "timestamp": "2026-08-26T09:15:02.431Z",
  "level": "info",
  "message": "request completed",
  "requestId": "0f3c…",
  "userId": "01J…",
  "method": "GET",
  "path": "/tickets?status=OPEN",
  "statusCode": 200,
  "durationMs": 14.2
}
```

`userId` is present only once something has called `setUserId` — P02's guard. Until then
the field is absent rather than null, because "we do not know" and "nobody" are different
statements.

## How each criterion is proved

| AC  | Tests                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------ |
| AC1 | A line is parsed back from a captured sink and asserted to carry an ISO timestamp, level, message, request id, and Nest's context. A second test proves `userId` is absent before `setUserId` and present after. A third proves a line written outside any request is still valid JSON, with `requestId: "-"`. |
| AC2 | Against a running app: a completed request logs method, path, status, and a numeric duration; the line carries the same request id as the response header; **a failed request is logged too**; and **an unmatched route is logged**, which an interceptor would have missed. |
| AC3 | Secrets are replaced at every level — flat, nested, inside arrays, case-insensitively, and with separators (`x-api-key`). A whole object under a sensitive key is replaced rather than walked into. Cycles yield `[CIRCULAR]` instead of throwing. Errors keep message and stack instead of serialising to `{}`. Headers are redacted while harmless ones survive. Interpolated secrets — bearer tokens, connection strings, `password=…` — are scrubbed from free text. And end to end: **a token in a query string never reaches the access log.** |
| AC4 | The level ordering is unit-tested; the environment-dependent default is tested; and a logger configured at `warn` is shown to actually suppress `info` and `debug`. |

## Verification

```
npm run verify
LOG_LEVEL=error npm run dev --workspace @crm/backend   # observably quieter
```

Green as of 2026-08-26: 22 shared tests, 113 backend tests.
