# Story 16 — Gate the interface by permission

- **Story:** US-23 · **Phase:** P02 · **Layer:** Frontend · **Priority:** Must have
- **Depends on:** US-22 · **Commit:** `c2cce8b`

> Written after implementation. Decisions are in `00-overview.md`.

## Target paths

| Action     | Path                                                          |
| ---------- | ------------------------------------------------------------- |
| **create** | `frontend/src/features/auth/use-permission.ts`                 |
| **create** | `frontend/src/features/auth/require-permission.tsx` — guard and denied screen |
| **create** | `frontend/src/features/auth/permission-gating.test.tsx`        |
| **modify** | `frontend/src/features/auth/use-login.ts` — return to the intended path |
| **modify** | `frontend/src/features/auth/require-auth.tsx` — keep the query string |
| **modify** | `frontend/src/features/auth/auth-context.tsx` — initialise from the store |
| **modify** | `frontend/src/lib/session-store.ts` — hold the whole session   |
| **modify** | `frontend/src/app/router.tsx`, `frontend/src/test/setup.ts`    |

## The shape

`usePermission(key)` reads the `EffectivePermissions` that arrived with the session. It
accepts `undefined` meaning "requires nothing" — which is what lets callers avoid
`cond && usePermission(key)`, a conditional hook call and not allowed.

`<RequirePermission permission="…">` is a route wrapper rendering `PermissionDenied`
instead of the page. Nested **inside** `RequireAuth`, so the unauthenticated case is
answered first.

## How each criterion is proved

| AC  | Tests                                                                        |
| --- | ---------------------------------------------------------------------------- |
| AC1 | An unauthenticated visitor lands on login, and `/admin?tab=users` survives the round trip intact. |
| AC2 | An agent sees the administration items locked with `aria-disabled`, and no link to click; an administrator gets a real link. The lock is conveyed in **text**, not only by an icon and a colour. |
| AC3 | Same mechanism, asserted through the nav. Control-level gating uses the same hook. |
| AC4 | A restricted URL renders the denied screen, and the permission key **never reaches the DOM**. |
| AC5 | The set published with the session is what the gating reads — no separate fetch. A session with no permissions gates every restricted item off. |

## Deviations

- **`AuthProvider` now initialises from the session store.** A silent refresh completing
  before it mounted was publishing to nobody, and the app rendered signed out while holding
  a live session — which is exactly what US-15's boot-time refresh will do.
- The session store is reset in the global test setup. It is module state, so a test that
  signed in left the next one already authenticated, and assertions passed or failed by
  test order.
- **AC2's tests moved to the sidebar in US-28.** The temporary `AppNav` this story built was
  always P03's to replace.

## Verification

```
npm run test --workspace @crm/frontend
```
