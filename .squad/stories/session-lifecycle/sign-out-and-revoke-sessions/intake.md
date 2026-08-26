# Story intake

- Source of truth: Notion "User Stories", ref **US-16**. Full acceptance criteria live there.
- Page: https://app.notion.com/p/3c69e08385238158949df9959559d8aa

> **Reconstructed after implementation (2026-08-26).** A record, not the input a planner
> actually had.

## Feature

- **Feature name:** Session Lifecycle · **slug:** `session-lifecycle`

## Tracker

- `US-16` · Phase `P02 Auth & Access` · Layer `Full-stack` · Priority `Must have` · MVP
- **Depends on:** US-15

## Description

```
As a signed-in user
I want to sign out and end my session everywhere I choose
So that nobody can use my account from a device I no longer control.
```

## Acceptance criteria, in brief

AC1 sign out revokes server-side, clears client-side, returns to login · AC2 a revoked
token is rejected with 401 at any endpoint · AC3 sign out everywhere revokes every refresh
token on the account · AC4 a role change or deactivation invalidates the session rather
than letting it run on with stale permissions.

## Technical notes from the story

- Redis denylist keyed by jti with a TTL matching token lifetime.

## Out of scope

- A session management UI listing active devices (V2).

## Repository state at intake

US-14 left the JWT strategy deliberately stateless: no database read, no revocation check,
with the `sid` claim carried "precisely so US-16 can decide". US-15 added rotation and
families. The access token carries no `jti` yet.

## Conflicts and gaps to raise

1. **AC2 and AC4 are different shapes.** AC2 is "this one token is finished"; AC4 is
   "everything issued to this person is finished". Revoking by session id cannot express
   the second — the server does not know which sessions carry the stale permissions.
2. **`RolesService` lives in `PermissionsModule`**, and `AuthModule` already injects
   `PermissionsService`. Exporting a revocation service from `AuthModule` would make the
   two modules depend on each other.
3. **`iat` has one-second resolution**, which is too coarse for a per-user cutoff: revoking
   and signing straight back in happens inside one second.

## Notes

- Redis failing here is not symmetrical with the login throttle. A throttle that cannot be
  consulted stops catching attacks; a revocation list that cannot be consulted starts
  honouring credentials that were explicitly withdrawn.
