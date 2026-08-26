# authorisation — plan overview

Entry point for the **authorisation** feature: enforcing what a user may do, on the server
(US-22) and reflecting it in the interface (US-23).

> **Written after implementation.** Both stories were built and committed before these
> files existed. A record, not the gate CLAUDE.md describes.

## Stories

| NN  | File                                                     | Title                                   | Tracker id | Depends on | Commit    |
| --- | -------------------------------------------------------- | --------------------------------------- | ---------- | ---------- | --------- |
| 15  | `15-story-enforce-permissions-with-backend-guards.md`    | Enforce permissions with backend guards | US-22      | US-13      | `7448596` |
| 16  | `16-story-gate-the-interface-by-permission.md`           | Gate the interface by permission        | US-23      | US-22      | `c2cce8b` |

## The rule these two stories exist to express

**The server is the security boundary.** US-22 is the boundary; US-23 is a convenience so
users are not offered actions that will fail. Every file in US-23 says so in its own
comment, because the moment somebody forgets, a permission check moves into the browser and
stops being one.

## Decisions

1. **`PermissionsGuard` is registered in `AuthModule`, not `PermissionsModule`.** Nest runs
   global guards in registration order and `PermissionsModule` is imported first — putting
   it there would authorise before authenticating.
2. **The guard answers 403, never 404.** Hiding existence behind a 404 is a reasonable
   pattern but it belongs to a handler that has actually looked something up. A guard that
   has queried nothing cannot honestly claim a record is missing.
3. **A route with no `@RequirePermission` still requires authentication.** Authorisation for
   such a route is "be signed in", stated by omission. Deny-by-default is US-14's global
   guard and is untouched here.
4. **The permission key is typed.** A typo is a compile error rather than a guard that
   silently denies everyone, which presents as a broken feature rather than a security bug.
5. **Navigation items are locked, not hidden.** Both are allowed by AC2; visible-but-locked
   is the better default because an agent who can see Administration exists knows what to
   ask for, whereas a hidden item makes the product look as though it has no such feature.
6. **A restricted URL renders a screen, not a redirect** — and names no permission key.
7. **An unauthenticated visitor to a restricted route is sent to sign in, not told they lack
   access.** They might well hold the permission; until we know who they are, "denied" is a
   guess.

## What the next stories inherit

- `@RequirePermission('key')` on any controller method is the whole API.
- **Scoped resources need their own scope resolver.** `scope.ts` implements tickets only,
  because US-13's AC3 named tickets and a speculative generic registry would be guessing.
- `usePermission(key)`, `usePermissionScopes(key)` and `<RequirePermission>` for the UI.
- **US-32 and the states story** should reuse `PermissionDenied` rather than inventing a
  second denied screen.
