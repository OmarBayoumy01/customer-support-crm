# Story intake

- Source of truth: Notion "User Stories" database, ref **US-12**.

## Feature

- **Feature name (display):** CI Pipeline
- **Feature slug:** `ci-pipeline`

## Tracker (metadata only)

- **Work item id:** `US-12` · Phase `P01 Foundation` · Layer `Infrastructure` · Priority `Must have` · Release `MVP`
- **Depends on:** US-3 (done)

## Title

```
Build the CI pipeline
```

## Description

```
As a developer
I want CI to lint, type-check, test, and build on every pull request
So that broken code never reaches the main branch.
```

## Acceptance criteria

```
AC1 — Pipeline triggers
  Given a pull request, When it is opened or updated,
  Then the pipeline runs automatically and reports status on the PR.

AC2 — Full check suite
  Given the pipeline runs, When it executes,
  Then it lints, type-checks, runs unit and integration tests, and builds both applications.

AC3 — Database-backed tests
  Given integration tests need a database, When CI runs,
  Then a disposable Postgres service is provisioned and migrated.

AC4 — Merge protection
  Given a failing pipeline, When someone attempts to merge, Then the merge is blocked.

AC5 — Caching
  Given repeated runs, When dependencies are unchanged,
  Then they are restored from cache to keep the pipeline under ten minutes.
```

## Technical notes from the story

- GitHub Actions; matrix only if you support multiple Node versions

## Out of scope

- Deployment steps (P15 — deployment).

## Repository state at intake

US-3 through US-11 are done and committed. `origin` is
`https://github.com/OmarBayoumy01/customer-support-crm.git`; the default branch is
`master`. There is no `.github/` directory yet.

- **One command already does most of AC2:** `npm run verify` is typecheck → lint →
  format:check → test. The frontend's `vite build` is the one thing it does not cover.
- **The test suite requires a real Postgres and a real Redis.** Nothing mocks them and
  nothing skips when they are absent — deliberately, from US-5 and US-10.
- **`backend/src/testing/prepare-test-db.js` creates the test database and applies every
  migration.** It runs as part of `npm test`, so AC3 needs a service container and a
  `DATABASE_URL`, not a bespoke migration step.
- Node version lives in `.nvmrc` (24.15.0). The lockfile is at the root; `npm ci` is the
  correct install.
- US-11 left `docker-compose.yml` and executable entrypoint scripts in
  `infrastructure/docker/`.

## The honest problem with AC4

**Branch protection is a GitHub repository setting, not a file.** Nothing committed here
can make a merge blocked; it takes an admin turning on required status checks once. The
plan must say so plainly and leave exact instructions, rather than implying a workflow file
satisfies it.

Similarly, **AC1 and AC5 can only be observed on GitHub** — a pipeline that has never run
has neither reported a status nor restored a cache. Local verification can go as far as
linting the workflow and proving every step it runs passes; it cannot go further.
