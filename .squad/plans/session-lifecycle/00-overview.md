# session-lifecycle — plan overview

Entry point for the **session-lifecycle** feature: the second and third stories of
**P02 Auth & Access**, covering everything that happens to a session after it is issued.

> **Written after implementation.** Both stories were built, reviewed and committed before
> these files existed. They are an accurate record of what was decided and why, but they
> were not the gate CLAUDE.md describes. Treated as documentation debt, repaid.

## Stories

| NN  | File                                                | Title                              | Tracker id | Depends on | Commit    |
| --- | --------------------------------------------------- | ---------------------------------- | ---------- | ---------- | --------- |
| 13  | `13-story-refresh-the-session-token-silently.md`    | Refresh the session token silently | US-15      | US-14      | `bcf63b6` |
| 14  | `14-story-sign-out-and-revoke-sessions.md`          | Sign out and revoke sessions       | US-16      | US-15      | `453ef54` |

## Decisions

1. **Families live in Postgres, not Redis.** US-15's technical note says Redis. A family is
   durable state that must survive a cache restart — a revocation that evaporates is not a
   revocation. Redis is still used, for US-16's denylist, where a TTL is the mechanism
   rather than an accident.
2. **Refresh rotates.** Every refresh retires the token it was given. That is what makes
   AC3 possible at all: once a token can only be used once, a second use is evidence rather
   than ambiguity.
3. **A replay revokes the whole family.** The benign reading is a client that retried; the
   one worth designing against is that the token was copied, and the server cannot tell
   them apart. It costs the real user one sign-in and costs a thief everything.
4. **Every refresh rejection returns one message.** Expired, revoked, replayed or never
   existed — the client's move is the same, and saying which would tell the holder of a
   stolen token whether the theft had been noticed.
5. **Revocation is two mechanisms, because the criteria are two shapes.** By `jti` for
   "this token is finished" (AC2); by user-before-a-timestamp for "everything issued to
   this person is finished" (AC3, AC4).
6. **Comparison is in milliseconds**, via an `iatMs` claim beside the standard `iat`. A test
   caught the alternative: with second resolution, revoking a user's tokens and signing them
   straight back in locked them out of their own account for up to a second.
7. **Redis failing here fails closed.** Deliberately unlike the login throttle, and
   deliberately at odds with P01's "Redis degrades, never takes the service down". **Still
   awaiting the human's confirmation** — see the note in `token-revocation.service.ts`.

## What the next stories inherit

- **US-19 (invite staff)** — `PasswordService` and `SessionService` are exported from
  `AuthModule`.
- **US-21 (portal sign-in)** — `Session.audience` already distinguishes the two doors.
- **Anything that changes a role or deactivates a user** must call
  `TokenRevocationService.revokeUserTokens()`, or the change will not take effect until the
  access token expires. `RolesService` already does.
- **A boot-time silent refresh is not wired.** The machinery is complete — `publishSession`,
  a store-initialised provider — but nothing calls `/auth/refresh` on load, so a page
  refresh still returns to `/login`.

## Not built

**US-15 AC3's audit row for a Redis outage window.** No `AuditAction` enum value honestly
describes "the throttle could not be consulted", and adding one is a migration for a log
line. The loud half — a `warn` per unenforced request plus a `degradations()` counter — is
there. Revisit with whatever story next touches that enum.
