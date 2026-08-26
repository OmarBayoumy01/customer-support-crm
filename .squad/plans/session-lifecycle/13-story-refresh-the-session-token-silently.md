# Story 13 — Refresh the session token silently

- **Story:** US-15 · **Phase:** P02 · **Layer:** Full-stack · **Priority:** Must have
- **Depends on:** US-14 · **Commit:** `bcf63b6`

> Written after implementation. Decisions and their reasoning are in `00-overview.md`.

## Target paths

| Action     | Path                                                              |
| ---------- | ----------------------------------------------------------------- |
| **create** | `backend/src/auth/refresh.service.ts` — rotation and replay detection |
| **create** | `backend/src/auth/refresh.test.ts`                                 |
| **create** | `frontend/src/lib/refresh-client.ts` — the single-flight promise   |
| **create** | `frontend/src/lib/session-store.ts` — the session outside React    |
| **create** | `frontend/src/lib/refresh-client.test.ts`                          |
| **modify** | `backend/prisma/schema.prisma` — `Session.familyId`, `replacedById` |
| **create** | `backend/prisma/migrations/20260826090000_session_family_for_us15/` |
| **modify** | `backend/src/auth/session.service.ts` — `rotate`, `revokeFamily`   |
| **modify** | `backend/src/auth/auth.controller.ts` — `POST /auth/refresh`       |
| **modify** | `backend/src/auth/auth.module.ts` — `cookieParser` as middleware   |
| **modify** | `frontend/src/lib/api-client.ts` — 401 interceptor                 |
| **modify** | `frontend/src/features/auth/auth-context.tsx` — subscribe to refresh |

## The shape

A refresh presents the cookie, the server looks the session up by
`sha256(token)`, and then:

| Row state                      | Answer                                          |
| ------------------------------ | ----------------------------------------------- |
| not found                      | 401, generic                                    |
| `revokedAt` set — **a replay** | revoke the whole `familyId`, audit, 401, generic |
| past `expiresAt`               | revoke the row, 401, generic                    |
| user gone or deactivated       | revoke the family, 401, generic                 |
| otherwise                      | mint a successor in the same family, retire the presented row, issue a new pair |

## How each criterion is proved

| AC  | Tests                                                                                  |
| --- | -------------------------------------------------------------------------------------- |
| AC1 | Frontend. A 401 triggers a refresh and the original request is replayed; the new token is adopted for later calls. |
| AC2 | Backend. Refreshing returns a **different** token, the new one works, and the presented one is refused on second use. |
| AC3 | Backend. Replaying an already-retired token leaves **zero** live sessions for the user, kills the currently-valid token too, and writes an audit row matching `/replay/i`. |
| AC4 | Frontend, and the important one. Five concurrent 401s against a deliberately slow refresh produce **exactly one** `POST /auth/refresh`. More than one would present an already-rotated token and trip AC3 against the real user. |
| AC5 | Backend. An expired row is refused; so is a deactivated account, which takes the family with it. Plus: every rejection returns a byte-identical message. |

## Migration

Hand-written, not generated. `familyId` is required and every environment already has
sessions, so it adds nullable, backfills `familyId = id` (each existing session is the sole
member of its own family, which is truthful — none has ever been rotated), then sets
`NOT NULL`. Generating it offered to drop the table instead.

Rollback: drop the two columns and their indexes. Nothing else references them.

## Deviations

- **Family in Postgres, not Redis** — see decision 1 in `00-overview.md`.
- **`cookieParser` moved from `index.ts` into `AuthModule` as middleware**, so a test app
  cannot forget it and fail in a way that looks like an expired token.
- Two bugs the tests caught before review: the refresh call used its own axios instance and
  so escaped the test's stub, and bailing out of the refresh path skipped the error mapping,
  handing callers a raw `AxiosError` from one branch and an `ApiRequestError` from others.

## Verification

```
docker compose up -d --wait postgres redis
npm run test --workspace @crm/backend     # 8 tests here
npm run test --workspace @crm/frontend    # 8 tests here
```
