# Story 14 — Sign out and revoke sessions

- **Story:** US-16 · **Phase:** P02 · **Layer:** Full-stack · **Priority:** Must have
- **Depends on:** US-15 · **Commit:** `453ef54`

> Written after implementation. Decisions and their reasoning are in `00-overview.md`.

## Target paths

| Action     | Path                                                                 |
| ---------- | -------------------------------------------------------------------- |
| **create** | `backend/src/auth/token-revocation.service.ts` — the denylist         |
| **create** | `backend/src/auth/token-revocation.module.ts` — `@Global()`, to break a cycle |
| **create** | `backend/src/auth/logout.test.ts`                                     |
| **create** | `frontend/src/features/auth/use-logout.ts`                            |
| **modify** | `packages/shared/src/auth/tokens.ts` — `jti`, `iatMs`                 |
| **modify** | `backend/src/auth/token.service.ts` — sign with `jwtid` and `iatMs`   |
| **modify** | `backend/src/auth/jwt.strategy.ts` — check revocation                 |
| **modify** | `backend/src/auth/auth.controller.ts` — `logout`, `logout-all`        |
| **modify** | `backend/src/permissions/roles.service.ts` — revoke on role change    |
| **modify** | `backend/src/app.module.ts` — register the global module first        |

## The shape

A signed JWT cannot be recalled, so revocation is a Redis denylist the strategy consults on
every authenticated request — one `MGET`, no database read:

- `auth:denied-jti:<jti>` — one token, TTL set to that token's own remaining life, so the
  entry disappears exactly when the token would have expired anyway.
- `auth:revoked-before:<userId>` — a millisecond timestamp; any token issued at or before it
  is refused. TTL is the access-token lifetime, after which every surviving token was
  necessarily issued later.

A token with **no `jti`** is refused rather than trusted — it cannot be revoked, so it
cannot be honoured.

## How each criterion is proved

| AC  | Tests                                                                                |
| --- | ------------------------------------------------------------------------------------ |
| AC1 | Logout answers 204, clears the cookie, and leaves zero live sessions.                |
| AC2 | The presented access token is refused **immediately** at a protected route, not in fifteen minutes; the refresh token is dead too, so the session cannot be resurrected. And: signing out on one device leaves another device working — revocation is by session, not by user. |
| AC3 | Sign out everywhere kills both devices and every session row.                        |
| AC4 | `RolesService.assignRole` makes the in-hand token answer 401 on the next request — and the user can immediately sign in again, which is the case that broke first. |

## Deviations

- **`TokenRevocationService` lives in its own `@Global()` module.** `RolesService` needs it
  and lives in `PermissionsModule`, which `AuthModule` already depends on through
  `PermissionsService`. Exporting it from `AuthModule` would have made the two circular.
- **`iatMs` added beside the standard `iat`.** A test caught the alternative: one-second
  resolution locked a user out of their own account for up to a second after every role
  change, because the fresh token was caught by the cutoff meant for the old one.
- **Fails closed on a Redis error.** See decision 7 in `00-overview.md` — this is the one
  item on this feature still awaiting the human's confirmation.

## Verification

```
npm run test --workspace @crm/backend    # 8 tests here
```
