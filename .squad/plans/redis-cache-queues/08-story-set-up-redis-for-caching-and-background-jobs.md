# 08 — Set up Redis for caching and background jobs

- **Story:** US-10 · **Phase:** P01 Foundation · **Layer:** Backend · **Priority:** Must have
- **Depends on:** US-4 (done)

Decisions and their reasoning are in `00-overview.md`.

## Target paths

| Action     | Path                                              |
| ---------- | ------------------------------------------------- |
| **create** | `backend/src/redis/redis.service.ts`               |
| **create** | `backend/src/redis/cache.service.ts`               |
| **create** | `backend/src/redis/queue.service.ts`               |
| **create** | `backend/src/redis/redis.module.ts`, `index.ts`    |
| **create** | `backend/src/redis/redis.test.ts`                  |
| **create** | `backend/src/redis/degradation.test.ts`            |
| **modify** | `backend/src/health/health.service.ts` — add the redis probe |
| **modify** | `backend/src/app.module.ts`, `backend/src/config/env.schema.ts` |
| **modify** | `backend/package.json` — `redis:up` / `redis:down` |
| **modify** | `backend/.env.example`, `.env.test`, `README.md`   |

New dependencies: **`ioredis@5.9.0`** (the client Redis needs and BullMQ already depends on)
and **`bullmq@5.65.0`**, named by the story's own technical notes.

## Configuration

| Variable                   | Default              | Effect                                |
| -------------------------- | -------------------- | ------------------------------------- |
| `REDIS_URL`                | required             | `redis://` or `rediss://`             |
| `REDIS_KEY_PREFIX`         | `crm:`               | Namespaces every key                  |
| `REDIS_CONNECT_TIMEOUT_MS` | `5000`               | Dial timeout                          |
| `CACHE_TTL_SECONDS`        | `300`                | Default lifetime when none is given   |
| `QUEUE_MAX_ATTEMPTS`       | `3` (max 20)         | Tries before dead-lettering           |
| `QUEUE_BACKOFF_MS`         | `1000`               | Exponential backoff base              |

`REDIS_URL` is required but **not** fatal: an unreachable Redis logs a warning, the service
starts, and `/health` reports it down. `QUEUE_MAX_ATTEMPTS` is bounded so a job cannot retry
forever.

## The cache surface

```ts
await cache.get<T>(key);                       // undefined on miss OR outage
await cache.set(key, value, ttlSeconds?);
await cache.delete(key);
await cache.deleteByPrefix('ticket:42:');      // SCAN, never KEYS
await cache.wrap(key, ttl, () => loadFromDb()); // read-through
```

Nothing outside `redis/` touches the client for caching. If you find yourself injecting
`RedisService` to run a command, the abstraction is missing a method — add it there.

## How each criterion is proved

| AC  | Tests                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------ |
| AC1 | The app connects on start; `/health` reports `redis: up` with a latency; database and redis both appear and the overall status is `ok`. |
| AC2 | Round-trips an object with nested arrays; a miss is `undefined`; a TTL is set on the key **and** the entry actually expires; a key is invalidated; a prefix invalidates a family while a sibling family survives; `wrap` runs its loader once across two calls; keys carry the configured prefix. |
| AC3 | An enqueued job is executed by a worker. A permanently failing job is attempted exactly three times and then appears on the `dead-letter` queue carrying its original data, attempt count, and failure reason. A job that fails once and then succeeds is **not** dead-lettered. |
| AC4 | Against a Redis that is not there: the app still starts; a read returns `undefined` and records a degradation; writes and invalidations are no-ops rather than rejections; `wrap` returns the loaded value every time (slower, correct); `/health` reports `degraded` — not `down` — with `redis: down` and `database: up`; and a real request still succeeds. |

## Verification

```
npm run db:up    --workspace @crm/backend
npm run redis:up --workspace @crm/backend
npm run verify
```

Green as of 2026-08-26: 22 shared tests, 137 backend tests.
