# docker-compose — plan overview

Entry point for the **docker-compose** feature.

## Stories

| NN  | File                                                             | Title                                             | Tracker id | Depends on |
| --- | ---------------------------------------------------------------- | ------------------------------------------------- | ---------- | ---------- |
| 09  | `09-story-containerise-local-development-with-docker-compose.md`  | Containerise local development with Docker Compose | US-11      | US-3       |

## Decisions

1. **`docker-compose.yml` at the root, Dockerfiles and entrypoints in
   `infrastructure/docker/`.** CLAUDE.md's routing rule, and also where
   `docker compose` looks without being told.
2. **Entrypoints are shell scripts, not long `command:` lines.** Each step —
   generate the client, migrate, build, watch, run — gets a comment saying why it is
   there and in that order.
3. **`depends_on: condition: service_healthy`, not `service_started`.** The backend runs
   migrations immediately, and a Postgres that has accepted a TCP connection is not
   necessarily one that will accept a query.
4. **The test database is created by a Postgres init script**, replacing `db:create-test`.
   Init scripts run once, when the data directory is empty, so this does not fight the
   named volume AC3 depends on.
5. **Two `.env` files, deliberately.** The root one configures the containers; `backend/.env`
   configures the backend when run directly on the host. They cannot be merged, because a
   container reaches Postgres at `postgres:5432` and the host reaches it at
   `localhost:5432`. Every root value has a working default, so `docker compose up` works
   with no `.env` at all.
6. **The five `db:*` / `redis:*` scripts are deleted**, as US-5 and US-10 both said they
   should be. Compose is the one way to start the services.

## The hot-reload problem, which took three attempts

AC2 looked trivial and was not. Three separate things had to be true, and each was found by
watching the thing fail:

1. **`tsc --watch` never fired.** A bind mount from a Windows host does not deliver
   filesystem events into a Linux container, so an inotify-based watcher sits there seeing
   nothing. Fixed with `--watchFile priorityPollingInterval --watchDirectory
   dynamicPriorityPolling`, in a separate `dev:build:poll` script so host development does
   not pay the CPU cost. Vite needed the same treatment via `server.watch.usePolling`,
   switched on by `VITE_USE_POLLING` so it stays off on the host.
2. **`node --watch` still never restarted**, even once tsc was rebuilding correctly —
   because `dist/` was also on the bind mount, so writes propagated to the host but fired
   no event inside the container. Fixed by making `/app/backend/dist` and
   `/app/packages/shared/dist` anonymous volumes: tsc writes to a real Linux filesystem,
   and inotify works again.
3. **The forced initial build.** With `dist/` container-local and empty, but
   `.tsbuildinfo` arriving from the host bind mount claiming everything was already built,
   `tsc -b` skipped `@crm/shared` — and the backend then failed to compile against a
   package whose declarations were never emitted. The entrypoint runs `tsc -b backend
   --force` once at startup.

Measured after the fixes: a backend edit is live in about 18 seconds (poll, recompile,
restart); a frontend edit in about 4.

## Status — 2026-08-26

**09 / US-11 — executed. Notion status `In review`.**

Verified by running it, not by reading it:

- **AC1** — `docker compose up -d` from a clean state brings all four services to
  *healthy*. `/health` 200, `/api/docs` 200, frontend 200. `/health` reports both
  `database` and `redis` as up.
- **AC2** — edited `health.service.ts` in the running stack and watched the response
  change with no rebuild; edited `App.tsx` and watched Vite serve the new module. Both
  edits then reverted.
- **AC3** — wrote a row, `docker compose restart postgres`, still there; `docker compose
  down` then `up`, still there. The `crm_test` database exists, created by the init script.
- **AC4** — the README now opens with "you need Docker Desktop, and nothing else", the
  three commands, a table of URLs, a host-development section, and a troubleshooting list
  built from the failures actually hit while writing this.

`npm run verify` also passes on the host against the Compose services: 159 tests.

### Deviation worth noting

**Postgres 18 changed its data path.** The image now stores data in a major-version
subdirectory so `pg_upgrade --link` works without crossing a mount boundary, and mounting
the traditional `/var/lib/postgresql/data` makes the container refuse to start. The volume
mounts `/var/lib/postgresql` instead. This would have been invisible on Postgres 17.

## What US-12 inherits

- CI needs Postgres and Redis service containers matching these images, or the suite fails.
  Nothing skips.
- `docker compose up -d --wait` is the natural smoke test for a pipeline.
- The dev images are **not** production images. P15 owns those, and should not extend these.
