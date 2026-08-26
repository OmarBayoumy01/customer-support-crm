# Story intake

- Source of truth: Notion "User Stories", ref **US-22**.
- Page: https://app.notion.com/p/3c69e083852381788c73f94bdda4e709

> **Reconstructed after implementation (2026-08-26).** A record, not a gate.

## Feature

- **Feature name:** Authorisation · **slug:** `authorisation`

## Tracker

- `US-22` · Phase `P02 Auth & Access` · Layer `Backend` · Priority `Must have` · MVP
- **Depends on:** US-13

## Description

```
As a developer
I want permission checks enforced by guards on every protected endpoint
So that authorisation cannot be bypassed by calling the API directly.
```

## Acceptance criteria, in brief

AC1 a decorated method rejects a user lacking the permission with 403 · AC2 a scoped
permission does not reach another agent's records · AC3 scope is applied in the database
query, never after fetching · AC4 endpoints are protected unless deliberately opened ·
AC5 denials are logged with user, endpoint and timestamp.

## Repository state at intake

US-13 built `PermissionsService.can()`, `.scopesFor()` and `ticketScopeWhere()`. US-14
registered `JwtAuthGuard` globally with a `@Public()` opt-out, which already satisfies AC4.
`PermissionsModule` is `@Global()` and is imported **before** `AuthModule` in `AppModule`.

## Conflicts and gaps to raise

1. **Guard ordering.** Nest runs global guards in registration order. Registering the
   permissions guard inside `PermissionsModule` would run the authorisation check before
   anyone had been authenticated.
2. **AC2 offers "403 or 404".** A guard that has queried nothing cannot honestly claim a
   record is missing, so it answers 403; hiding existence behind a 404 belongs to a handler
   that has actually looked.
3. **No ticket endpoints exist yet**, so AC2 and AC3 have to be proved against the resolved
   `where` fragment and the schema rather than against a live list route.

## Notes

- This is the project's second non-negotiable rule under test. The most dangerous possible
  bug is a missing grant resolving to `{}`, which Prisma reads as *every row*.
