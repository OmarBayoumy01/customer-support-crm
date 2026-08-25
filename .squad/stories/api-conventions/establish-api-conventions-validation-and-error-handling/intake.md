# Story intake

- Source of truth: Notion "User Stories" database, ref **US-7**.

## Feature

- **Feature name (display):** API Conventions
- **Feature slug:** `api-conventions`

## Tracker (metadata only)

- **Work item id:** `US-7` · Phase `P01 Foundation` · Layer `Backend` · Priority `Must have` · Release `MVP`
- **Depends on:** US-4 (done)

## Title

```
Establish API conventions, validation, and error handling
```

## Description

```
As a developer
I want one consistent API response and error format with request validation
So that the frontend handles every endpoint the same way instead of special-casing each one.
```

## Acceptance criteria

```
AC1 — Success envelope
  Given any successful request, When the response returns,
  Then it follows a consistent shape, and list endpoints include pagination metadata.

AC2 — Error shape
  Given any failed request, When the response returns,
  Then it carries an HTTP status, a machine-readable error code, a human message,
  and per-field details where applicable.

AC3 — Validation
  Given a request with an invalid body, When it hits any endpoint,
  Then a global validation pipe rejects it with 422 and field-level errors,
  before controller logic runs.

AC4 — No internal leakage
  Given an unhandled exception, When the error is returned in production,
  Then no stack trace or SQL is exposed to the client, while the full detail is
  logged server-side.

AC5 — Correlation
  Given any request, When it is processed, Then a request ID is generated,
  returned in the response headers, and attached to every related log line.
```

## Technical notes from the story

- Global `ValidationPipe` with class-validator or Zod pipe
- Global exception filter; standard pagination as `page` / `pageSize` / `total`

## Out of scope

- Rate limiting (P15 — security hardening).

## Repository state at intake

US-3 through US-6 are done and committed. NestJS 11, `TypedConfigModule` and `PrismaModule`
are both global. `AppModule` and `index.ts` were deliberately kept small in US-4 **so this
story could attach the global pipe, filter, and interceptor without restructuring** — the
seams are already there.

`packages/shared` carries DTOs and Zod schemas used by both sides. Zod is the validation
library throughout; **class-validator is not installed and must not be added** — the
technical note offers it as an option, not a requirement.

Tests are `node:test` + `@nestjs/testing` against `dist/`, requiring a running database.

## Decisions this story has to make

- **Zod, not class-validator.** Zod is already the stack's validator and already shared
  with the frontend. Nest's global pipe is class-based, so a `createZodDto` bridge is
  needed to make AC3's "global" real rather than per-route.
- **Whether `/health` is enveloped.** AC1 says "any successful request". Consistency argues
  yes; uptime monitors expecting a flat body argue no. If enveloped, US-5's health tests
  and the phase exit criteria wording both need to match.
- **How AC5's "every related log line" is satisfied** without doing US-9's job. US-9 owns
  structured logging; this story owns correlation. Whatever carries the id must be
  something US-9 can read rather than replace.
