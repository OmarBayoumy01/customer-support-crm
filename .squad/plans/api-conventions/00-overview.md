# api-conventions — plan overview

Entry point for the **api-conventions** feature.

## Stories

| NN  | File                                                                     | Title                                                | Tracker id | Depends on |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------------- | ---------- | ---------- |
| 05  | `05-story-establish-api-conventions-validation-and-error-handling.md`     | Establish API conventions, validation, error handling | US-7       | US-4       |

## Decisions

1. **Zod, not class-validator.** The story offers either; Zod is already the stack's
   validator and already shared with the frontend, so adding class-validator would mean two
   validation libraries and two definitions of the same shape.
2. **`createZodDto` bridges Zod to Nest's global pipe.** Nest hands a global pipe the
   declared *class* of a parameter, which is why validation in this ecosystem is
   class-based. Wrapping a schema in a class is what makes AC3's "global validation pipe"
   literally true instead of every route remembering to attach its own. ~20 lines, no new
   dependency, and US-8 reads the same static to generate OpenAPI — so the documented shape
   and the enforced shape cannot drift.
3. **`/health` is enveloped like everything else.** AC1 says "any successful request", and
   an exception would be the first crack in the convention. `@NoEnvelope()` exists for the
   cases where a response shape genuinely is not ours — file downloads, provider webhooks.
4. **Globals are registered as `APP_*` providers in `CommonModule`, not via
   `app.useGlobalPipes()`.** The filter needs `RequestContextService` and the interceptor
   needs `Reflector`; globals registered on the app instance are built outside the DI
   container and cannot have dependencies.
5. **Correlation uses `AsyncLocalStorage`, not a request-scoped provider.** Request scoping
   re-instantiates the whole dependency subtree per request — a heavy price for one string,
   and it does not reach code outside the DI graph.
6. **AC5 is satisfied by replacing the app logger**, so every `Logger` call anywhere picks
   up the id without remembering to. **US-9 replaces `ContextLogger` with structured JSON
   logging and should read the same `RequestContextService`** — the context plumbing is
   deliberately separate from the formatting for that reason.
7. **Prisma error codes are mapped in the filter**: P2002 and P2003 to 409, P2025 to 404,
   anything else to 500. The client messages are generic on purpose — Prisma's own text
   names tables and columns, which AC4 forbids putting on the wire. It goes to the log.

## Status — 2026-08-26

**05 / US-7 — executed. Notion status `In review`.**

`npm run verify` green: **91 tests** (22 shared, 69 backend).

### Deviations from plan

- **`/health`'s tests and the response shape changed.** Enveloping health was the right
  call for consistency but it is a breaking change to a shape US-5 shipped, so it is called
  out here rather than buried: `GET /health` now returns `{ data: { status, service,
  timestamp, dependencies } }`. The phase exit criterion still holds — the endpoint reports
  database state — but anything reading it must unwrap first.
- **`codeForStatus` became a `Map` rather than a `switch`.** `HttpException.getStatus()`
  returns a plain `number`, and comparing that against `HttpStatus` enum members trips
  `no-unsafe-enum-comparison`.

## What the next stories inherit

- **US-8** (Swagger) — `createZodDto` exposes `zodSchema` as a static; generate the OpenAPI
  schema from it so documentation and validation share one source. The envelope and error
  shapes should be documented as the standard responses.
- **US-9** (logging) — replace `ContextLogger` with structured JSON, reading
  `RequestContextService` for the id. Do not introduce a second correlation mechanism.
- **P02 onwards** — throw `ApiException` rather than Nest's built-ins, so the frontend gets
  a real error code instead of one inferred from the HTTP status.
