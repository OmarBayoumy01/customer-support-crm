# Story intake

- Source of truth: Notion "User Stories" database, ref **US-13**. First story of P02.

## Feature

- **Feature name (display):** Roles & Permissions
- **Feature slug:** `roles-permissions`

## Tracker (metadata only)

- **Work item id:** `US-13` · Phase `P02 Auth & Access` · Layer `Backend` · Priority `Must have` · Release `MVP`
- **Depends on:** US-6 (done)

## Title

```
Model roles and granular permissions
```

## Description

```
As an administrator
I want roles and granular permissions modelled in the database
So that access rules live in data rather than scattered `if` statements across the codebase.
```

## Acceptance criteria

```
AC1 — Four seeded roles
  Given a fresh installation, When seeding runs, Then Administrator, Manager, Agent,
  and Customer roles exist with sensible default permissions.

AC2 — Permission granularity
  Given the permission table, When I inspect it, Then permissions are expressed as
  resource plus action (for example ticket:assign, user:manage, report:view).

AC3 — Scoped permissions
  Given an agent with ticket:view, When the scope is assigned,
  Then the permission resolves only to tickets assigned to that agent, not all tickets.

AC4 — Role assignment
  Given a user, When their role changes, Then their effective permissions change
  immediately on their next request without a redeploy.

AC5 — Custom roles
  Given an administrator, When they create a new role, Then they can select any
  combination of permissions and assign users to it.
```

## Technical notes from the story

- Tables: Role, Permission, RolePermission, plus `roleId` on User
- Scope enum: ALL / TEAM / ASSIGNED / OWN
- Cache resolved permission sets in Redis, invalidated on role change

## Out of scope

- The admin UI for editing roles (US-115).

## Repository state at intake

Phase P01 is complete. US-6 already built `Role`, `Permission`, `RolePermission`,
`UserRole`, and a `PermissionScope` enum. US-10 built `CacheService`, which degrades to a
miss when Redis is down rather than throwing.

**No seed data exists anywhere yet** — P01 closed with the platform booting with no roles
and no permissions, so nobody can do anything. AC1 is where that gets fixed.

## Conflicts with the existing schema — these must be raised, not reinterpreted

CLAUDE.md: never silently reinterpret a story. Three things disagree with what US-6 built,
and the first two change the schema:

1. **Scope enum.** The story says `ALL / TEAM / ASSIGNED / OWN`. US-6 built
   `OWN / DEPARTMENT / BRANCH / ALL`. `ASSIGNED` has no equivalent, and AC3 is written
   entirely about it.
2. **Roles per user.** The note says `roleId` on User — one role each. US-6 built a
   many-to-many `UserRole` join that also records who granted the role and when.
3. **Key format.** AC2's examples use a colon (`ticket:assign`); US-6's comments used dots.

## Notes

- US-23 will gate the UI on the same permission strings US-22 enforces, so the vocabulary
  belongs in `packages/shared` — as a contract, never as enforcement. Everything in that
  package is code the browser can read.
- The project's first non-negotiable rule has a permission-level form here: whatever
  permission covers internal notes must never be granted to the Customer role.
- The second rule bears directly on AC3: scoped permissions are applied **in the database
  query**, never by fetching everything and filtering afterwards.
