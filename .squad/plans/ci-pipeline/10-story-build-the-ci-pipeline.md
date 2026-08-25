# 10 — Build the CI pipeline

- **Story:** US-12 · **Phase:** P01 Foundation · **Layer:** Infrastructure · **Priority:** Must have
- **Depends on:** US-3 (done)

Decisions are in `00-overview.md`. **Read the AC4 section there before marking this
done** — that criterion needs an admin, not a file.

## Target paths

| Action     | Path                                | Why                                              |
| ---------- | ----------------------------------- | ------------------------------------------------ |
| **create** | `.github/workflows/ci.yml`           | Root-level config, per CLAUDE.md's routing rule  |
| **modify** | `infrastructure/README.md`           | CI description and the branch-protection recipe  |
| **chmod**  | `infrastructure/docker/*.sh`         | Tracked as `100644`; the new check caught it     |

No new dependencies. No application code changes.

## The pipeline

**`verify`** — Ubuntu, Node from `.nvmrc`, npm cache keyed on `package-lock.json`.

```
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test                                  # unit + integration, real services
npm run build --workspace @crm/backend
npm run build --workspace @crm/frontend   # vite build — not covered by typecheck
```

Services: `postgres:18-alpine` and `redis:8-alpine`, both with health options so no step
starts against a database that is listening but not ready.

**`compose`** — `docker compose config --quiet`, plus a check that every entrypoint script
is executable, with an `::error file=` annotation naming the fix.

## How each criterion is proved

| AC  | Status                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------- |
| AC2 | **Proved.** Every step run locally against real services: 159 tests, both builds, lint, format, type-check. |
| AC3 | **Proved.** `prepare-test-db.js` creates `crm_test` and applies every migration; it is what `npm test` runs, and it is what a developer runs. |
| AC1 | **Not provable locally.** A pipeline that has never run has reported no status. `actionlint` confirms the workflow is valid and its triggers are `pull_request` and `push: [master]`. |
| AC5 | **Not provable locally.** A cache cannot be restored on a first run. `actions/setup-node` with `cache: npm` is the mechanism; the 15-minute job timeout sits above AC5's ten-minute bar so a slow run fails loudly rather than hanging. |
| AC4 | **Not met by this repository, by nature.** Branch protection is a GitHub setting. `infrastructure/README.md` has the exact `gh api` call and the check names. Someone with admin rights has to run it. |

## Verification

```
docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:latest   # clean
npm run verify                                                            # 159 tests
npm run build --workspace @crm/frontend                                   # vite build
docker compose config --quiet
```

Then, on GitHub: push, open a pull request, confirm the run is green, and apply branch
protection.
