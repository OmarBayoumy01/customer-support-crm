# prisma-postgres — plan overview

Entry point for the **prisma-postgres** feature. Stories execute in order by their `NN` prefix.

## Stories

| NN  | File                                                            | Title                                        | Tracker id | Depends on |
| --- | --------------------------------------------------------------- | -------------------------------------------- | ---------- | ---------- |
| 03  | `03-story-connect-postgresql-with-prisma-and-migrations.md`      | Connect PostgreSQL with Prisma and migrations | US-5       | US-4       |

## Status — 2026-08-25

**03 / US-5 — executed. Notion status `In review`.**

`npm run verify` is green end to end: typecheck, lint (no warnings), `prettier --check`,
and 45 tests — 11 in `packages/shared`, 34 in `backend`. Every acceptance criterion has a
named test.

### Deviations from the plan

Six things the plan did not anticipate. All were resolved during execution; none changed
the approach.

1. **`TypedConfigModule` was not `@Global()`.** Its own docblock claimed
   `TypedConfigService` was "injectable anywhere without re-importing", but only Nest's
   `ConfigService` was globalised by `isGlobal: true`. Nothing had exercised the claim
   until `PrismaService` became the first provider in another module to inject it. Fixed by
   adding `@Global()` to `backend/src/config/config.module.ts` — a US-4 file, changed
   because US-4's stated intent was correct and its implementation was not.
2. **A new file, `backend/src/testing/prisma-cli.ts`.** Shelling out to the Prisma CLI has
   no working form on Windows: `execFileSync('npx')` is ENOENT, `'npx.cmd'` is EINVAL
   (Node refuses to spawn `.cmd` without a shell), and `shell: true` is deprecated when
   arguments are passed (DEP0190). The helper resolves Prisma's bin entry from
   `prisma/package.json` and runs it under `process.execPath`. Used by both the test-database
   preparation script and the AC2 migration test.
3. **`pool.end()` throws "Called end on pool more than once".** `onModuleDestroy` now
   guards on `pool.ending || pool.ended`, so a SIGTERM arriving during an in-flight
   `app.close()` is a no-op rather than a crash.
4. **`.env.test` cannot set `PORT=0`.** The schema requires a positive port, and tests call
   `app.listen(0)` themselves, so the variable was dropped from the file.
5. **`frontend/src/App.tsx` had to change.** It constructs a `HealthStatus` literal, so
   adding the required `dependencies` field broke the frontend build. It was not in the
   plan's target paths. This is the shared-DTO drift detection working exactly as the
   file's own comment describes.
6. **ESLint `no-process-env` exceptions were widened** to `backend/prisma.config.ts`,
   `backend/src/testing/**`, and `backend/**/*.test.ts`, instead of scattering inline
   disables across four files. All three run outside the Nest application, where
   `TypedConfigService` does not exist.

### Verified by hand, beyond the suite

- App boots, logs `Connected to PostgreSQL (pool max 10)`, and `/health` returns
  `status: "ok"` with `dependencies.database.status: "up"`.
- With the container stopped, `/health` returns HTTP 200 and `status: "down"`, the error is
  logged, and the process stays up. It recovers to `"ok"` on its own once the container
  restarts — no restart of the app needed.
- Clean-clone path: with no `backend/.env` and `src/generated/` deleted, `postinstall`
  regenerates the client successfully.
- `git check-ignore` confirms `backend/.env` and `backend/src/generated/` are ignored while
  `backend/.env.test` is not.

## Dependency notes

- Blocked by **US-4** (`nestjs-bootstrap`, NN 02) — done. This feature extends that app's
  config schema, health endpoint, and root module rather than replacing anything.
- Extends the shared `HealthStatus` DTO in `packages/shared`, so `frontend/` consumers of
  that type change shape too. Nothing consumes it yet.
- **US-6** (domain schema) builds directly on the schema, migration workflow, and
  `PrismaService` created here, and its first job is to drop the temporary
  `MigrationProbe` model.
- **US-10** (Redis) adds a second entry to the `dependencies` map on `/health`.
- **US-11** (Docker Compose) replaces the `db:*` npm scripts and must keep the image tag,
  database names, and credentials identical.
- **US-12** (CI) calls `dist/testing/prepare-test-db.js` and `prisma migrate deploy`.

## Pinned versions

`prisma` and `@prisma/client` are pinned to **7.10.0**. The `latest` dist-tag currently
points at `8.0.0-rc.10`, a release candidate — do not install `latest`.
