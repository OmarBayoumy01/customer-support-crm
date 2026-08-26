# Story intake

- Source of truth: Notion "User Stories", ref **US-15**. Full acceptance criteria live there.
- Page: https://app.notion.com/p/3c69e083852381d4b6f4ffd010da3211

> **Reconstructed after implementation (2026-08-26).** This intake was written from the
> Notion story and the shipped code, not before it. It is a record, not the input a
> planner actually had.

## Feature

- **Feature name:** Session Lifecycle · **slug:** `session-lifecycle`

## Tracker

- `US-15` · Phase `P02 Auth & Access` · Layer `Full-stack` · Priority `Must have` · MVP
- **Depends on:** US-14

## Description

```
As a signed-in user
I want my session to renew silently
So that I am not thrown out mid-reply while working a ticket.
```

## Acceptance criteria, in brief

AC1 silent refresh and retry · AC2 rotation invalidates the old token · AC3 reuse of a
retired token revokes the whole family and is logged as possible theft · AC4 concurrent
401s cause exactly one refresh · AC5 an expired refresh token returns the user to login.

## Technical notes from the story

- Refresh token family tracked in Redis with a jti; axios or fetch interceptor with a
  single-flight refresh promise.

## Out of scope

- Remembering an in-progress draft across a forced logout.

## Repository state at intake

US-14 shipped `Session` (id, userId, refreshTokenHash, audience, expiresAt, revokedAt,
ipAddress, userAgent). No family, no successor pointer. `TokenService.hashRefreshToken` is
static and already used for lookup. The frontend API client is axios with a response
interceptor mapping failures onto `ApiRequestError`.

## Conflicts to raise, not reinterpret

1. **The story says the family is tracked in Redis.** The shipped design puts it in
   Postgres on `Session.familyId` instead. A family is durable state that outlives a cache
   and has to survive a Redis restart — a revocation that evaporates is not a revocation.
   Redis is still used, but for US-16's denylist, where a TTL is the right mechanism.
2. **`familyId` is required and every environment already has sessions**, so the migration
   cannot be generated: it has to add nullable, backfill, then tighten.

## Notes

- AC4 is not an optimisation. Because refresh **rotates**, a second concurrent refresh
  presents a token the first already retired, which the server correctly reads as a replay
  under AC3 — so naive per-request refresh signs the user out.
- Every rejection must return the same message. Telling the holder of a stolen token *why*
  it failed tells them whether the theft has been noticed.
