# structured-logging — plan overview

Entry point for the **structured-logging** feature.

## Stories

| NN  | File                                                  | Title                                    | Tracker id | Depends on |
| --- | ----------------------------------------------------- | ---------------------------------------- | ---------- | ---------- |
| 07  | `07-story-add-structured-logging-and-request-tracing.md` | Add structured logging and request tracing | US-9       | US-7       |

## Decisions

1. **No Pino.** The story's note suggests `nestjs-pino`, which is three dependencies
   outside the approved stack — `pino`, `pino-http`, `nestjs-pino` — for something that at
   this size is `JSON.stringify` plus a level check. Everything Pino is genuinely better at
   (async writes, transports, serializer performance) starts to matter at a volume this
   service is nowhere near. **This is the decision most worth overruling**: swapping to Pino
   later touches `structured-logger.ts` and the middleware, and nothing else, because the
   context and redaction are already separate.
2. **The access log hangs off `response.on('finish')`, not an interceptor.** An interceptor
   only sees requests that reached a handler. A 404 on an unmatched route, a request
   rejected by the validation pipe, and one that blew up in the exception filter are all
   still requests someone will want to find — and all three are now tested.
3. **`ContextLogger` was deleted, not left alongside.** US-7 built it as the correlation
   seam and said this story would replace its formatting. Two loggers in a tree is how you
   end up with half the lines in one format.
4. **One logger instance, provided through a token.** `app.useLogger()` in `index.ts` and
   the access-log middleware take the same instance from the container, so there is one
   configured level and one sink rather than two that drift.
5. **Redaction strips separators before matching keys.** Found by a failing test:
   `x-api-key` escaped a list containing `apikey` and `api_key`, because header names
   arrive hyphenated. Now `apiKey`, `api_key`, and `x-api-key` all normalise to the same
   thing.
6. **A whole object under a sensitive key is replaced, not walked into.** Redacting
   `credentials` wholesale is stronger than redacting the fields inside it — nothing under
   that key is serialised at all.
7. **`userId` is the one mutable field on the request context.** P02's guard calls
   `setUserId` after verifying a token; until then every line simply omits it. That is what
   AC1's "where known" means, and it is tested both ways.

## Status — 2026-08-26

**07 / US-9 — executed. Notion status `In review`.**

`npm run verify` green: **135 tests** (22 shared, 113 backend).

### One real defect the tests caught

`x-api-key` was **not** being redacted. The key list held `apikey` and `api_key`, and the
raw header name contains neither. Any client sending an API key in a header would have had
it written to the access log in clear text. Fixed by normalising separators away before
matching, and the case-variants test now covers hyphenated keys.

### Deviations from plan

- **`CommonModule` now imports `TypedConfigModule` explicitly.** The logger factory needs
  `TypedConfigService`, and although that module is `@Global()`, a module that names its
  dependency can be used standalone — which is exactly what US-7's own test module does.
- **`LOG_LEVEL` is optional in the schema** rather than defaulted, so the default can
  depend on `NODE_ENV`: `info` in production, `debug` everywhere else. A developer who has
  to set an environment variable to see what happened will not set it.

## What the next stories inherit

- **P02** — call `RequestContextService.setUserId()` from the authentication guard, and
  every subsequent log line for that request carries the user.
- Application code that wants structured fields should use `StructuredLogger.emit(level,
  message, fields)` rather than interpolating into a string; the fields are redacted, an
  interpolated string is only pattern-scrubbed.
- **P15** — log shipping is out of scope here. JSON on stdout is the format a collector
  expects, so nothing needs to change in the application to ship it.
