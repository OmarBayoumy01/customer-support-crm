# Story 15 — Enforce permissions with backend guards

- **Story:** US-22 · **Phase:** P02 · **Layer:** Backend · **Priority:** Must have
- **Depends on:** US-13 · **Commit:** `7448596`

> Written after implementation. Decisions are in `00-overview.md`.

## Target paths

| Action     | Path                                                        |
| ---------- | ----------------------------------------------------------- |
| **create** | `backend/src/permissions/require-permission.decorator.ts`    |
| **create** | `backend/src/permissions/permissions.guard.ts`               |
| **create** | `backend/src/permissions/permissions-guard.test.ts`          |
| **modify** | `backend/src/permissions/permissions.module.ts` — provide and export the guard |
| **modify** | `backend/src/auth/auth.module.ts` — register it as the **second** `APP_GUARD` |
| **modify** | `backend/src/permissions/index.ts`                           |

No new dependencies.

## The shape

```ts
@Get('assign')
@RequirePermission('ticket:assign')
assign() { … }
```

The guard reads the metadata, and a route without it passes — this guard answers "may they
do *this particular thing*", while "are they anyone at all" is `JwtAuthGuard`'s job and is
already settled by the time this runs.

**Scope is not the guard's business.** It cannot be: the guard does not know what is being
queried. A route that lists records composes `ticketScopeWhere(scopes, context)` into its
own `where`, which is what AC3 requires.

## How each criterion is proved

| AC  | Tests                                                                            |
| --- | -------------------------------------------------------------------------------- |
| AC1 | A holder passes; a user lacking the permission gets **403**, not 500 and not silence; a user with no roles at all is refused. |
| AC2 | An agent's `ASSIGNED` scope resolves to a filter that cannot reach another agent's queue. Widening the role to `TEAM` widens the filter, with no redeploy. |
| AC3 | The resolved `where` is **not `{}`** and contains the user's id — so it is a WHERE clause, not a post-fetch filter. |
| AC4 | Unauthenticated calls are refused before permissions are considered, including on a route that requires no particular permission. |
| AC5 | The denial log line names the user, the missing permission, and the endpoint. |

## The most dangerous line in the feature

A user with **no** grant must resolve to an impossible filter, never `{}` — Prisma reads an
empty `where` as *every row*. There is a test asserting the difference, and it is the one to
keep if the rest are ever trimmed.

## Deviations

- **AC2 and AC3 are proved against the resolved filter, not a live endpoint**, because no
  ticket routes exist yet. When they land, the assertions should be repeated against them.
- The AC5 assertion goes through Nest's logger rather than patching `process.stdout`. Where
  the line lands depends on which sink is installed; the criterion is about its content.
- **This suite owns its roles and does not run the seed.** The first version did, and
  because `node --test` runs files concurrently and the seed replaces every system role's
  grants in a transaction, it broke `permissions.test.ts` rather than itself.

## Verification

```
npm run test --workspace @crm/backend    # 11 tests here
```
