# 11 — Model roles and granular permissions

- **Story:** US-13 · **Phase:** P02 Auth & Access · **Layer:** Backend · **Priority:** Must have
- **Depends on:** US-6 (done)

Decisions, and the two conflicts with US-6 the human resolved first, are in `00-overview.md`.

## Target paths

| Action     | Path                                                    |
| ---------- | ------------------------------------------------------- |
| **create** | `packages/shared/src/auth/permissions.ts` — the shared vocabulary |
| **create** | `backend/src/permissions/permission-catalogue.ts` — descriptions and role defaults |
| **create** | `backend/src/permissions/scope.ts` — scope → Prisma `where` |
| **create** | `backend/src/permissions/permissions.service.ts` — resolution and caching |
| **create** | `backend/src/permissions/roles.service.ts` — custom roles, assignment |
| **create** | `backend/src/permissions/permissions.module.ts`, `index.ts` |
| **create** | `backend/src/permissions/permissions.test.ts`, `scope.test.ts` |
| **create** | `backend/src/seed/seed.ts` |
| **modify** | `backend/prisma/schema.prisma` — `PermissionScope` values |
| **create** | `backend/prisma/migrations/<ts>_permission_scope_from_us13/` |
| **modify** | `backend/src/app.module.ts`, `backend/package.json`, `packages/shared/src/index.ts` |
| **modify** | `backend/tsconfig.json`, `packages/shared/tsconfig.json` — `tsBuildInfoFile` |

No new dependencies.

## The shape

**34 permissions**, each `resource:action`. Resources: ticket, message, customer, user,
role, department, branch, category, sla, task, article, report, audit.

**Four seeded roles**, and the scopes are the interesting part — the same `ticket:view`
means something different to each:

| Role          | `ticket:view` | Grants |
| ------------- | ------------- | ------ |
| Administrator | `ALL`         | 34     |
| Manager       | `TEAM`        | 24     |
| Agent         | `ASSIGNED`    | 18     |
| Customer      | `OWN`         | 5      |

## How each criterion is proved

| AC  | Tests                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------- |
| AC1 | The suite **runs the seed itself** rather than assuming someone did, then asserts all four roles exist, are marked `isSystem`, carry both an English and an Arabic name, and hold exactly the grants their definitions declare. Running the seed twice changes no rows. Plus: **the Customer role holds no internal-note permission**, checked against both the definition and the database. |
| AC2 | Every stored permission satisfies `key === resource + ':' + action` — so the three columns cannot disagree — and has a description. The story's own examples (`ticket:assign`, `user:manage`, `report:view`) exist. The catalogue and the shared key list are asserted identical. |
| AC3 | The worked example, end to end: an agent with `ticket:view` at `ASSIGNED` sees their own ticket, **not** another agent's, and **not** an unassigned one in the same department. Switching the same user to Manager widens the same query to the whole department. A user with no grant gets **zero rows, not all rows**. `scope.test.ts` covers the fragment builder directly, including the fail-closed cases. |
| AC4 | Assign a role, resolve (and cache), change the role, resolve again — the new permissions are there with no redeploy and no TTL wait. Editing a *role's* permissions invalidates every holder. Two roles granting the same permission keep both scopes. |
| AC5 | A custom role is created with an arbitrary combination, read back with `isSystem: false`, users assigned and removed. A typo'd permission key is **rejected**, not quietly narrowed. A duplicate role key is rejected. |

## Verification

```
docker compose up -d --wait
npm run verify
npm run db:seed --workspace @crm/backend   # idempotent; safe to re-run
```

Green as of 2026-08-26: 22 shared tests, 165 backend tests.
