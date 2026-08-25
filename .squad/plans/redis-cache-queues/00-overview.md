# redis-cache-queues — plan overview

Entry point for the **redis-cache-queues** feature.

## Stories

| NN  | File                                                       | Title                                       | Tracker id | Depends on |
| --- | ---------------------------------------------------------- | ------------------------------------------- | ---------- | ---------- |
| 08  | `08-story-set-up-redis-for-caching-and-background-jobs.md`  | Set up Redis for caching and background jobs | US-10      | US-4       |

## Decisions

1. **Redis is not critical; the database is.** A Redis outage makes `/health` report
   `degraded`, not `down`. That distinction is the whole point of AC4 — a cache blip must
   not take the service out of a load balancer while it is still perfectly able to serve
   from the database.
2. **An unreachable Redis does not stop the service booting.** `RedisService.onModuleInit`
   logs and continues. Making Redis a hard startup dependency would contradict AC4 in the
   one situation where it matters most.
3. **Two connections, deliberately.** BullMQ requires `maxRetriesPerRequest: null` for its
   blocking reads; a cache wants the opposite — `enableOfflineQueue: false` and one retry,
   so a command issued while disconnected fails in a millisecond instead of queueing for a
   reconnect that may never come. A cache read that hangs for thirty seconds is worse than
   one that fails instantly and falls through.
4. **Every `CacheService` method degrades rather than throws.** `get` returns `undefined`
   on failure, which is deliberately indistinguishable from a miss — callers should not
   have to branch on cache health. A `degradations()` counter makes the fallback assertable
   in a test rather than inferred from a log line.
5. **`deleteByPrefix` uses `SCAN`, never `KEYS`.** `KEYS` blocks the Redis server for the
   duration of the scan, which on a production keyspace is an outage.
6. **The dead-letter queue is ours, not BullMQ's.** BullMQ retries with backoff on its own;
   what it does not do is put an exhausted job somewhere a human will find it. The `failed`
   handler checks whether this was the final attempt and writes the job, its data, and the
   reason onto a `dead-letter` queue with `attempts: 1` — the terminus.
7. **No jobs are defined here**, per the story's own out-of-scope. The story that needs one
   calls `registerWorker`.
8. **AC4 is tested against a port nothing listens on**, set before `AppModule` is imported,
   rather than by stopping the shared container — which would break every suite running in
   parallel. It is a truer test anyway: it exercises connect failure, not a clean shutdown.

## Status — 2026-08-26

**08 / US-10 — executed. Notion status `In review`.**

`npm run verify` green: **159 tests** (22 shared, 137 backend).

### Deviations from plan

- **`RedisService.onModuleDestroy` needed both a guard and a `try`/`catch`.** The guard
  alone was not enough: ioredis still raised "Connection is closed" when the socket went
  away between the status check and the call. Shutdown is not a place to throw, so the
  error is logged and swallowed. `QueueService` got a `closed` flag for the same reason.
  This is the third story to hit idempotent-shutdown — it is a pattern worth remembering,
  not a one-off.
- **`env.schema.test.ts` was restructured** around a `REQUIRED` fixture. Adding a second
  mandatory variable made every happy-path case name both, which buried what each test was
  actually about.
- **The `redis:up` / `redis:down` scripts mirror `db:up` / `db:down`.** US-11 replaces both
  pairs with Compose and must keep `redis:8-alpine` and the same port.

## What the next stories inherit

- **US-11** — Compose needs a `redis` service on 6379 alongside Postgres, and should delete
  the four `db:*` / `redis:*` scripts rather than leave them beside it.
- **US-12** — CI needs a Redis service container, or the whole Redis suite fails. It cannot
  be skipped: no test in this feature skips when Redis is absent, by design.
- **US-51 (notification fan-out) and US-58 (SLA timers)** — call
  `queues.registerWorker(name, processor)` and `queues.add(...)`. Retries, backoff, and
  dead-lettering are already handled; define the job, not the plumbing.
- **P15 (rate limiting)** — `RedisService.client` is there, but prefer adding a method to
  `CacheService` over reaching around it.
