# 09 — Containerise local development with Docker Compose

- **Story:** US-11 · **Phase:** P01 Foundation · **Layer:** Infrastructure · **Priority:** Must have
- **Depends on:** US-3 (done)

Decisions, and the three-round fight with hot reload, are in `00-overview.md`.

## Target paths

| Action     | Path                                                          |
| ---------- | ------------------------------------------------------------- |
| **create** | `docker-compose.yml` — root, per CLAUDE.md's routing rule       |
| **create** | `.env.example` — root; configures the containers               |
| **create** | `.dockerignore`                                                |
| **create** | `infrastructure/docker/backend.dev.Dockerfile`                 |
| **create** | `infrastructure/docker/backend-dev-entrypoint.sh`              |
| **create** | `infrastructure/docker/frontend.dev.Dockerfile`                |
| **create** | `infrastructure/docker/frontend-dev-entrypoint.sh`             |
| **create** | `infrastructure/docker/postgres-init/01-create-test-database.sh` |
| **modify** | `frontend/vite.config.ts` — `host: true`, opt-in polling       |
| **modify** | `backend/package.json` — add `dev:build`, `dev:build:poll`; **delete** the five `db:*` / `redis:*` scripts |
| **modify** | `README.md` — AC4                                              |

## Services

| Service    | Image               | Host port | Notes                                          |
| ---------- | ------------------- | --------- | ---------------------------------------------- |
| `postgres` | `postgres:18-alpine` | 5432      | Named volume; init script creates `crm_test`   |
| `redis`    | `redis:8-alpine`     | 6379      | `--appendonly yes`, so queued jobs survive     |
| `backend`  | built, dev only      | 3000      | Waits for both to be *healthy*                 |
| `frontend` | built, dev only      | 5173      | Vite with polling                              |

Images and credentials match what US-5 and US-10 used, as both stories required.

## Volume strategy

This is the part that is easy to get subtly wrong.

```yaml
- ./:/app # the source, live — this is hot reload
- /app/node_modules # anonymous: keep the image's install
- /app/backend/node_modules #   … and the nested ones
- /app/frontend/node_modules
- /app/packages/shared/node_modules
- /app/backend/dist # anonymous: compiled output OFF the bind mount
- /app/packages/shared/dist #   so inotify actually fires on it
```

Without the `node_modules` entries, a host that has never run `npm install` gives a
container with no dependencies. Without the `dist` entries, `node --watch` never restarts —
see `00-overview.md`.

## How each criterion is proved

Every one of these was **run**, not reasoned about.

| AC  | Verification                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------ |
| AC1 | `docker compose down -v` then `up -d`; all four services reach *healthy*; `/health`, `/api/docs`, and the frontend all return 200; `/health` reports database and redis up. |
| AC2 | Edit `backend/src/health/health.service.ts` in the running stack → the response changes in ~18s with no rebuild. Edit `frontend/src/App.tsx` → Vite serves the new module in ~4s. Both reverted afterwards. |
| AC3 | Insert a row, `restart postgres` → survives. `down` then `up` → survives. `crm_test` present, created by the init script. |
| AC4 | README rewritten: Docker-first quickstart, URL table, host-development path, and a troubleshooting section written from the failures actually encountered. |

## Verification

```
docker compose up -d --wait
curl http://localhost:3000/health
```

Then, on the host, against the same services:

```
npm run verify
```

Green as of 2026-08-26: 22 shared tests, 137 backend tests.
