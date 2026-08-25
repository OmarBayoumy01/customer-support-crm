# Infrastructure

| Path                          | What it is                                                         |
| ----------------------------- | ------------------------------------------------------------------ |
| `docker/`                     | Development images and entrypoints for the Compose stack           |
| `docker/postgres-init/`       | Runs once on an empty data directory; creates the test database    |
| `../docker-compose.yml`       | The stack itself — root-level, because that is where Compose looks |
| `../.github/workflows/ci.yml` | The pipeline                                                       |

Deployment manifests and production images arrive in **P15**. The images here are
development-only and should not be extended into production ones — they contain no
application source by design, and install dev dependencies.

---

## CI

`.github/workflows/ci.yml` runs on every pull request and on every push to `master`.

**`verify` job** — lint, format check, type-check, test, build backend, build frontend.
Each is a separate step so a red run names its own cause in the GitHub UI.

Tests run against **real** Postgres 18 and Redis 8 service containers. Nothing is mocked
and nothing skips itself when a service is missing: `prepare-test-db.js` creates `crm_test`
and applies every committed migration first — the same script a developer runs locally, so
CI cannot drift from what they see.

**`compose` job** — validates `docker-compose.yml` and checks the entrypoint scripts still
carry their executable bit. A broken compose file fails no test but costs the next person
their morning.

Dependencies are cached by `actions/setup-node` on the `package-lock.json` hash, and the
Node version comes from `.nvmrc` so there is one place to change it.

---

## Branch protection — a manual step

**AC4 of US-12 — "a failing pipeline blocks the merge" — cannot be satisfied by a file in
this repository.** Required status checks are a GitHub _repository setting_, not
configuration under version control, so it has to be turned on once by someone with admin
rights. Until that happens the pipeline reports its result and nothing enforces it.

Either use the UI — **Settings → Branches → Add branch ruleset** — or the CLI:

```bash
gh api -X PUT repos/OmarBayoumy01/customer-support-crm/branches/master/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Lint, type-check, test, build",
      "Compose file is valid"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

The `contexts` are the **job display names** from the workflow, not the job ids. If those
names change in `ci.yml`, this has to change with them or the protection silently stops
matching anything.

`"strict": true` means a branch must be up to date with `master` before merging — it is
what stops two individually-green PRs from combining into a red `master`.

Confirm it took:

```bash
gh api repos/OmarBayoumy01/customer-support-crm/branches/master/protection \
  --jq '.required_status_checks.contexts'
```
