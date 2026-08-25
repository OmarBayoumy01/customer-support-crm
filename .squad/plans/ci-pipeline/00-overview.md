# ci-pipeline — plan overview

Entry point for the **ci-pipeline** feature.

## Stories

| NN  | File                              | Title                 | Tracker id | Depends on |
| --- | --------------------------------- | --------------------- | ---------- | ---------- |
| 10  | `10-story-build-the-ci-pipeline.md` | Build the CI pipeline | US-12      | US-3       |

## Decisions

1. **Separate steps, not one `npm run verify`.** The commands are identical either way, but
   when a run goes red the step name in the GitHub UI is the diagnosis. A single "verify"
   step means opening the log to learn whether it was a lint rule or a failing test.
2. **Real Postgres and Redis service containers, with health options.** Not mocks, because
   the suite does not mock them; and `--health-cmd`, because a Postgres that is listening
   is not necessarily one that will accept a query. The same lesson US-11 learned.
3. **`prepare-test-db.js` does the migrating**, rather than a bespoke CI step. It is the
   same script a developer runs locally, so CI cannot drift from what they see.
4. **`npm ci`, not `npm install`.** It installs exactly the lockfile and fails when
   `package.json` and the lock have drifted — which is a thing worth failing on.
5. **Node version from `.nvmrc`**, so there is one place to change it. No matrix: the story
   says matrix only if multiple versions are supported, and only one is.
6. **`concurrency` cancels superseded PR runs but never master runs.** A second push makes
   the first run irrelevant; on master each commit's result is a record worth keeping.
7. **A second, cheap `compose` job** validating `docker-compose.yml` and the executable bit
   on the entrypoints. A broken compose file fails no test but costs the next person their
   morning — and the executable bit is exactly the kind of thing a Windows contributor
   drops without noticing.

## AC4 cannot be satisfied by this repository, and saying so is the point

**Branch protection is a GitHub repository setting, not configuration under version
control.** No file committed here can block a merge; it takes someone with admin rights
turning on required status checks once.

`infrastructure/README.md` carries the exact `gh api` call, the UI path, and the check
names to use — including the warning that the `contexts` are the job **display names**, so
renaming a job in `ci.yml` silently unhooks the protection.

**Until an admin runs that, AC4 is not met.** The pipeline reports; nothing enforces.
Marking this story done without that step would be marking a criterion done because a file
exists that gestures at it.

## Status — 2026-08-26

**10 / US-12 — executed. Notion status `In review`.**

### What was actually verified, and what was not

Verified locally:

- **The workflow is valid.** `actionlint` reports no problems.
- **Every step it runs passes.** Lint, format check, type-check, the full 159-test suite
  against real Postgres and Redis, the backend build, and — newly exercised here — the
  frontend's `vite build`, which the type-check does not cover.
- **The `compose` job's checks pass**: `docker compose config --quiet` is clean, and the
  three entrypoint scripts now carry their executable bit in git. They did **not** before:
  they were committed `100644`, and the check found it. The Dockerfiles `chmod +x` after
  copying, so nothing was broken — but the postgres-init script had no such safety net.

**Not verified, because it cannot be locally:** AC1 (a pipeline reporting status on a real
PR), AC5 (a cache being restored on a second run), and AC4 (a blocked merge). These need a
push, a pull request, and an admin. The phase exit criterion "CI is green on a pull
request" is in the same position.

## What comes next

- **P15** adds deployment. It should be a separate workflow keyed on a tag or a release,
  not more jobs bolted onto this one — CI and CD failing together is how a red test blocks
  a rollback.
- If the suite grows past ten minutes (AC5's bar), split `verify` into parallel jobs
  sharing the `setup-node` cache rather than raising the timeout.
