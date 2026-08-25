# Story intake

- Source of truth: Notion "User Stories" database, ref **US-9**.

## Feature

- **Feature name (display):** Structured Logging
- **Feature slug:** `structured-logging`

## Tracker (metadata only)

- **Work item id:** `US-9` · Phase `P01 Foundation` · Layer `Backend` · Priority `Must have` · Release `MVP`
- **Depends on:** US-7 (done)

## Title

```
Add structured logging and request tracing
```

## Description

```
As a developer
I want structured logging with request correlation
So that I can trace one user's failing request across the whole system.
```

## Acceptance criteria

```
AC1 — Structured output
  Given any log line, When it is written,
  Then it is JSON with timestamp, level, message, request ID, and user ID where known.

AC2 — Request lifecycle
  Given an HTTP request, When it completes,
  Then method, path, status, and duration are logged at info level.

AC3 — Sensitive data redaction
  Given a request containing a password, token, or authorization header,
  When it is logged, Then those values are redacted rather than written in clear text.

AC4 — Level control
  Given an environment variable, When I change the log level,
  Then verbosity changes without a code change.
```

## Technical notes from the story

- Pino via `nestjs-pino`; AsyncLocalStorage for request context

## Out of scope

- Log shipping and alerting infrastructure.

## Repository state at intake

US-3 through US-8 are done and committed.

**US-7 already built the correlation half of this story.** `RequestContextService` wraps
`AsyncLocalStorage` and is populated by `RequestIdMiddleware`; `ContextLogger` replaces
Nest's logger so every line carries the request id. US-7's own notes say this story should
**replace `ContextLogger`'s formatting and keep reading the same context**, not introduce a
second correlation mechanism.

`ContextLogger` is scaffolding this story supersedes — delete it rather than leaving two
loggers in the tree.

## Decisions this story has to make

- **Whether to add Pino.** The story's technical note names `nestjs-pino`, which means
  three dependencies (`pino`, `pino-http`, `nestjs-pino`) outside the approved stack.
  CLAUDE.md says ask before adding one. If the answer is no, the alternative has to be
  genuinely adequate rather than a token gesture — and if it is not, say so.
- **Where the request-lifecycle line is written.** An interceptor only sees requests that
  reached a handler; unmatched routes, validation rejections, and anything the exception
  filter handles would be missing from the access log.
- **What "user ID where known" means before P02 exists.** There is no authentication yet,
  so nothing sets a user id. The mechanism still has to be there and testable.
