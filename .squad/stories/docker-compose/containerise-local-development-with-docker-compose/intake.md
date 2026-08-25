# Story intake

- Source of truth: Notion "User Stories" database, ref **US-11**.

## Feature

- **Feature name (display):** Docker Compose
- **Feature slug:** `docker-compose`

## Tracker (metadata only)

- **Work item id:** `US-11` · Phase `P01 Foundation` · Layer `Infrastructure` · Priority `Must have` · Release `MVP`
- **Depends on:** US-3 (done)

## Title

```
Containerise local development with Docker Compose
```

## Description

```
As a developer
I want the whole stack to run locally with one command
So that a new team member is productive on day one rather than day three.
```

## Acceptance criteria

```
AC1 — One command up
  Given a fresh machine with Docker installed, When I run the compose command,
  Then Postgres, Redis, the backend, and the frontend all start and are reachable.

AC2 — Hot reload
  Given the stack is running, When I edit backend or frontend source,
  Then the change is picked up without rebuilding the image.

AC3 — Data persistence
  Given I stop and restart the stack, When it comes back up,
  Then database contents survive via a named volume.

AC4 — Documented setup
  Given the repository README, When a new developer follows it,
  Then they reach a running application without asking anyone for help.
```

## Technical notes from the story

- `docker-compose.yml` plus `.env.example` with every required variable listed

## Out of scope

- Production container images and deployment (P15 — deployment).

## Repository state at intake

US-3 through US-10 are done and committed. The stack is Postgres 18, Redis 8, a NestJS
backend, and a Vite frontend, in an npm workspaces monorepo with one lockfile.

**US-5 and US-10 left five npm scripts this story is meant to replace**: `db:up`,
`db:create-test`, `db:down`, `redis:up`, `redis:down`, each wrapping a `docker run`. Both
stories say in their notes that Compose should take over and that the scripts should be
**deleted, not left alongside** — and that the image tags, database names, credentials, and
ports must match what they used: `postgres:18-alpine`, `redis:8-alpine`, databases `crm`
and `crm_test`, user `crm`, ports 5432 and 6379.

The backend test suite requires both services running and no test skips when they are
absent.

## Routing

CLAUDE.md: infrastructure output goes to `infrastructure/`, **except** root-level config
such as `docker-compose.yml`, which stays at the repository root.

## What the plan has to work out

- **How hot reload actually works through a bind mount.** The backend compiles TypeScript
  to `dist/` and runs the built output; the frontend runs Vite. Both watch files. The
  development machine is Windows.
- **How `node_modules` survives a source mount.** Mounting the repository over `/app`
  hides whatever the image installed there.
- **How the Prisma client gets generated**, given it is gitignored and lands inside the
  mounted source tree.
- **Where the test database comes from**, now that `db:create-test` is going away.
- **Whether `.env` at the root conflicts with `backend/.env`.** They cannot hold the same
  values: a container reaches Postgres at `postgres:5432`, the host reaches it at
  `localhost:5432`.
