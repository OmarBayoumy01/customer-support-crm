# roles-permissions — plan overview

Entry point for the **roles-permissions** feature. First story of **P02 Auth & Access**.

## Stories

| NN  | File                                            | Title                               | Tracker id | Depends on |
| --- | ----------------------------------------------- | ----------------------------------- | ---------- | ---------- |
| 11  | `11-story-model-roles-and-granular-permissions.md` | Model roles and granular permissions | US-13      | US-6       |

## Two conflicts with US-6, resolved by the human before any code was written

US-13's technical notes contradicted the schema US-6 shipped. Both were raised rather than
silently reinterpreted, and both were decided:

1. **Scope enum — the story wins.** `PermissionScope` migrated from US-6's
   `OWN | DEPARTMENT | BRANCH | ALL` to the story's `ALL | TEAM | ASSIGNED | OWN`.
   `TEAM` is `DEPARTMENT` under the story's word, and **`ASSIGNED` was a genuine gap** —
   a ticket assigned to an agent is not one that agent raised, and AC3 is written entirely
   about that distinction. `BRANCH` is dropped; it returns with the story that needs it.
2. **Roles per user — US-6's schema wins.** The story's note says "plus `roleId` on User",
   meaning one role each. The `UserRole` join table stays instead: it is already built and
   migrated, it records who granted a role and when (P14 will want that), nothing in the
   acceptance criteria requires exactly one, and a manager who also works tickets is a real
   situation in a helpdesk.

A third, smaller conflict needed no asking: **permission keys are `resource:action`**, with
a colon, per AC2's own examples. US-6's comments had used dots.

## Decisions

1. **The key list lives in `@crm/shared`.** US-23 gates the UI on the same strings US-22
   enforces, so they are defined once. The backend catalogue's descriptions are a `Record`
   keyed by that type — **adding a permission without describing it is a compile error**,
   and the two lists cannot drift.
2. **`resource` and `action` are split from the key**, never typed twice, so the three
   columns cannot disagree.
3. **Effective permissions keep every scope, not the "broadest".** A user holding
   `ticket:view` at `ASSIGNED` from one role and `OWN` from another sees both sets. There
   is no real ordering between `ASSIGNED` and `OWN`, so ranking them would silently drop
   access; the scopes are collected and the query ORs them.
4. **A missing grant returns `{ id: { in: [] } }`, never `{}`.** This is the single most
   dangerous line in the feature: an empty Prisma `where` matches *every row*, so a bug
   that reaches for "no filter" when it means "no access" would hand out the whole table.
   Same for `TEAM` when the user has no department. There is a test asserting the
   difference.
5. **Redis caches resolved permissions, invalidated explicitly on change.** The 300-second
   TTL is a safety net for a missed invalidation, not the mechanism — AC4 says *immediately*.
   `CacheService` degrades to a miss when Redis is down, so an outage makes this slower and
   never wrong.
6. **Unknown permission keys are rejected, not dropped.** A role created with a typo that
   quietly grants less than intended is a security bug that surfaces months later as a
   support ticket.
7. **The seed is idempotent, and replaces system-role grants wholesale.** The catalogue is
   the source of truth for what a system role may do, so tightening a permission in code
   must actually tighten it in the database. Custom roles are never touched.

## The rule, expressed as a permission

`message:view_internal` exists, and **the Customer role is never granted it**. There is a
test that fails if anyone adds it — checked against both the definition and the seeded
database rows. This is the first enforcement point for the project's first non-negotiable
rule, and it now exists before any endpoint that could leak through it.

## Status — 2026-08-26

**11 / US-13 — executed. Notion status `In review`.**

`npm run verify` green: **187 tests** (22 shared, 165 backend), up from 159.

Seeded: 34 permissions; administrator 34 grants, manager 24, agent 18, customer 5.

### Deviation worth recording

**`tsBuildInfoFile` moved into `dist/`** for `backend` and `packages/shared`. Under Compose,
`dist/` is a container-local volume while the source is a bind mount — so the container's
watcher and a host `tsc` were both writing `backend/tsconfig.tsbuildinfo` and overwriting
each other's state. The host build reported success while its own `dist/` was missing the
new files. Build info belongs with build output; this is now true and the two cannot
interfere.

## What the next stories inherit

- **US-14 (sign in)** — `PermissionsService.effectivePermissionsFor()` is what the login
  response should carry, and the guard should call `RequestContextService.setUserId()`.
- **US-19 (invite staff)** — `RolesService.setUserRoles()` and `assignRole()` already
  invalidate the cache.
- **US-22 (backend guards)** — this is the model layer; the guard reads
  `scopesFor(userId, key)` and composes `ticketScopeWhere` into its query. Resources beyond
  tickets need their own scope resolver; `scope.ts` implements ticket only, because AC3
  names only tickets and a speculative generic registry would be guessing.
- **US-23 (UI gating)** — import `PERMISSION_KEYS` and `EffectivePermissions` from
  `@crm/shared`. Gate on the same strings the server enforces.
- **US-115 (admin UI for roles)** — `RolesService` is the operation set it will call.
