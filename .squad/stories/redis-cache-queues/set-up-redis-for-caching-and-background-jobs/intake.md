# Story intake

- Source of truth: Notion "User Stories" database, ref **US-10**.

## Feature

- **Feature name (display):** Redis, Cache & Queues
- **Feature slug:** `redis-cache-queues`

## Tracker (metadata only)

- **Work item id:** `US-10` · Phase `P01 Foundation` · Layer `Backend` · Priority `Must have` · Release `MVP`
- **Depends on:** US-4 (done)

## Title

```
Set up Redis for caching and background jobs
```

## Description

```
As a developer
I want Redis available for caching, sessions, and background jobs
So that later features such as SLA timers and rate limiting have the infrastructure they need.
```

## Acceptance criteria

```
AC1 — Connection
  Given Redis is running, When the app starts,
  Then it connects and the health endpoint reports Redis as up.

AC2 — Cache abstraction
  Given a service wants to cache, When it uses the cache module,
  Then it can get, set with TTL, and invalidate by key without touching the
  Redis client directly.

AC3 — Job queue
  Given a background job is enqueued, When a worker picks it up,
  Then it executes, and a failed job retries with backoff before landing in a
  dead-letter queue.

AC4 — Graceful degradation
  Given Redis is unavailable, When a cached read is attempted,
  Then the app falls back to the database and logs a warning rather than
  returning an error to the user.
```

## Technical notes from the story

- BullMQ for queues; used later by SLA timers (US-58) and notification fan-out (US-51)

## Out of scope

- Specific jobs, which are defined in their own stories.

## Repository state at intake

US-3 through US-9 are done and committed.

**US-5 designed the health endpoint for this story.** `HealthService` builds a
`dependencies` map and derives the overall status from it, with a `critical` flag per
dependency — the comment in `health.module.ts` says in as many words that US-10 adds Redis
as one more entry rather than changing the DTO. Do that; do not reshape it.

`PrismaModule` is the pattern to follow: `@Global()`, one connection per process, a service
that connects in `onModuleInit` and closes in `onModuleDestroy`. **Note the lesson US-5 and
US-9 both learned the hard way: make shutdown idempotent.** `app.close()` gets called twice
in tests and a SIGTERM can arrive during an in-flight close.

## Decisions this story has to make

- **Is Redis critical?** The database is, so a database outage makes `/health` report
  `down`. If Redis is also critical, a cache blip takes the service out of a load balancer
  — which AC4 says explicitly should not happen. Decide and encode it.
- **One Redis connection or two?** BullMQ requires `maxRetriesPerRequest: null` for its
  blocking reads. A cache wants the opposite — fail fast so the caller can fall back.
- **How AC4 gets tested without breaking every other suite.** Stopping the shared container
  would break suites running in parallel.
- **What "falls back to the database" means when no feature caches anything yet.** The
  mechanism has to be real and testable even though nothing uses it.
