# Story intake

- Source of truth: Notion "User Stories", ref **US-23**.
- Page: https://app.notion.com/p/3c69e083852381b58d0bcdb089127d18

> **Reconstructed after implementation (2026-08-26).** A record, not a gate.

## Feature

- **Feature name:** Authorisation · **slug:** `authorisation`

## Tracker

- `US-23` · Phase `P02 Auth & Access` · Layer `Frontend` · Priority `Must have` · MVP
- **Depends on:** US-22 · **Design File:** `28-states-loading-empty-error.md` (does not exist)

## Description

```
As a signed-in user
I want the interface to show only what my role permits
So that I am not offered actions that will fail.
```

## Acceptance criteria, in brief

AC1 an unauthenticated visitor is redirected to login with the destination preserved ·
AC2 navigation gating, hidden or locked · AC3 action gating rather than failing on click ·
AC4 a restricted URL shows a permission-denied screen · AC5 the permission set arrives with
the session, cached in memory, refreshed on role change.

## Repository state at intake

US-14 ships `EffectivePermissions` in the login response and US-15 re-resolves it on
refresh, so AC5 is largely already true. `RequireAuth` records the attempted path but
`useLogin` ignores it. The session lives in `AuthContext`, initialised from `null`.

## Conflicts and gaps to raise

1. **`AuthProvider` initialises from `null`.** A silent refresh completing before it mounts
   publishes to nobody, and the app renders signed out while holding a live session.
2. **A hook cannot be called conditionally**, so `cond && usePermission(key)` is not
   available for nav items that require no permission.

## Notes

- Nothing here is a security boundary. US-22 is. The purpose is narrower: do not offer
  someone a button that will answer 403.
- A denied screen must not name a permission key — that is a sentence for a developer and
  it hands anyone probing the app the vocabulary of its internals.
