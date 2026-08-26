# Story intake

- Source of truth: Notion "User Stories" database, ref **US-14**. Second story of P02.
- Page: https://app.notion.com/p/3c69e083852381e2b689fc4116309b1f

## Feature

- **Feature name (display):** Staff Login
- **Feature slug:** `staff-login`

## Tracker (metadata only)

- **Work item id:** `US-14` · Phase `P02 Auth & Access` · Layer `Full-stack` · Priority `Must have` · Release `MVP`
- **Persona:** Support Agent · **Screen:** Login · **Design File:** `03-login.md` (does not exist — see below)
- **Depends on:** US-13 (Done)

## Title

```
Sign in to the staff workspace
```

## Description

```
As a support agent
I want to sign in with my email and password and receive a session
So that I can access the CRM and the system knows who I am on every request.
```

## Acceptance criteria

```
AC1 — Successful login
  Given valid credentials for an active staff account
  When I submit the login form
  Then I receive an access token and a refresh token, and land on the dashboard.

AC2 — Invalid credentials
  Given a wrong email or password
  When I submit
  Then I see one generic message that does not reveal whether the email exists.

AC3 — Inactive account
  Given a deactivated staff account
  When I submit correct credentials
  Then login is refused with a message telling me to contact an administrator.

AC4 — Password storage
  Given any stored password
  When I inspect the database
  Then it is a bcrypt or argon2 hash, never reversible.

AC5 — Brute force protection
  Given repeated failed attempts for one account or IP
  When the threshold is exceeded
  Then further attempts are throttled and the lockout is logged.

AC6 — Token contents
  Given a decoded access token
  When I inspect its claims
  Then it carries user ID, role, and audience, and expires in 15 minutes.
```

## Technical notes from the story

- Passport JWT strategy; refresh token stored httpOnly, SameSite strict
- Rate limiting backed by Redis (US-10)

## Out of scope

- Two-factor (US-24) and SSO.

## Repository state at intake

Phase P01 is complete; US-13 is done and marked `Done` in Notion.

**Backend — what exists and will be built on:**

- `backend/src/permissions/` — `PermissionsService.effectivePermissionsFor(userId)`,
  `.can()`, `.scopesFor()`, `.ticketScopeFor()`, Redis-cached, invalidated on role change.
- `backend/src/common/` — global Zod validation pipe (`ZodValidationPipe`,
  `createZodDto`), `AllExceptionsFilter`, `ResponseEnvelopeInterceptor`, `ApiException`
  with `statusForCode()`, `@NoEnvelope()` decorator.
- `backend/src/common/request-context/RequestContextService` — has `setUserId()`, whose
  doc comment already says *"P02's guard calls `setUserId` after verifying the token"*.
  Wiring it is part of this story.
- `backend/src/redis/CacheService` — `get` / `set` / `delete` / `deleteByPrefix` / `wrap`.
  Degrades to a miss when Redis is down rather than throwing.
- `backend/src/config/env.schema.ts` — the only file allowed to read `process.env`
  (`no-process-env` ESLint rule). Every new variable is declared there.
- `backend/src/openapi/` — `api-zod.decorators.ts` and `zod-to-openapi.ts`; endpoints are
  documented from their Zod schemas.

**Prisma schema — `User` already carries everything login needs:** `email` (unique),
`passwordHash`, `isActive`, `lastLoginAt`, `locale`, `roles: UserRole[]`, soft delete via
`deletedAt`. `AuditAction` already has `LOGIN`, `LOGIN_FAILED`, `LOGOUT`. `AuditLog` has
`actorUserId`, `action`, `entityType`, `entityId`, `ipAddress`, `userAgent`, and an
explicit warning that password hashes must never be written to it.

**Backend test runner is `node:test`, not Vitest** — `node --test "dist/**/*.test.js"`
after `tsc -b`, with `prepare-test-db.js` first. 187 tests currently green.

**Frontend is effectively empty.** `frontend/src/` is only `App.tsx` and `main.tsx`.
There is no Tailwind, no shadcn/ui, no React Router, no TanStack Query, no React Hook
Form, no i18next, and **no test runner of any kind**.

## Decisions the human has already made

- **`03-login.md` does not exist** anywhere in the repo, and neither do the other 30
  screen-level prompt files the Notion parent page refers to. This was raised on
  2026-08-26. **The human's decision (2026-08-26): build the full stack now with a
  minimal login UI**, accepting that P03 Design System & Shell will revisit the styling.
  Do not block on the design file; do not invent an elaborate visual language either.

## Conflicts and gaps that must be raised, not reinterpreted

1. **AC6 says the token carries "role", singular.** US-13 established that users hold
   **many** roles via the `UserRole` join, and the human chose that deliberately over the
   single `roleId` US-13's own technical note suggested. A singular claim cannot represent
   the model. Proposal: emit `roles: string[]` (role keys). This satisfies the intent of
   AC6 — the token identifies what the user is — while matching the schema. Flag it;
   do not silently pick one.

2. **No `Session` / `RefreshToken` model exists.** US-6 modelled no token storage at all.
   AC1 requires issuing a refresh token, and **US-16 ("Sign out and revoke sessions")
   cannot be built without a server-side record to revoke**. This story therefore has to
   add a table and a migration. Designing it here rather than in US-16 is correct, but it
   is a schema change and needs to be reviewed as one.

3. **`RATE_LIMITED` in `packages/shared/src/api/error-codes.ts` is documented as
   "Reserved for P15; nothing raises it yet."** AC5 makes this story the first raiser.
   The comment needs updating, and `statusForCode()` must map it to 429.

4. **New dependencies are required.** CLAUDE.md says ask before adding anything not in the
   stack list:
   - **Hashing (AC4).** The AC names bcrypt or argon2 specifically. Node has no built-in
     for either. Proposal: `argon2` — memory-hard, the current OWASP first choice, and it
     avoids bcrypt's 72-byte truncation. Needs approval.
   - **Passport JWT (story's own technical note).** `@nestjs/jwt`, `@nestjs/passport`,
     `passport`, `passport-jwt`. JWT is in the stack list; these are its implementation.
   - **Cookies.** `cookie-parser` for the httpOnly refresh cookie.
   - **Frontend test runner.** The approved stack names no testing library at all, and the
     frontend has none. Every AC has to be covered by tests. Proposal: Vitest plus
     `@testing-library/react` in `frontend/` only — Vitest because it shares Vite's
     config, leaving the backend on `node:test` untouched. Needs approval.
   - Frontend runtime deps (`tailwindcss`, `react-router`, `@tanstack/react-query`,
     `react-hook-form`, `@hookform/resolvers`, `i18next`, `react-i18next`) are all
     already in CLAUDE.md's approved stack — no approval needed, but P03 owns the design
     system, so keep the styling deliberately thin.

## Notes

- **Non-negotiable rule 2 — the server is the security boundary.** The login endpoint and
  the JWT guard are the first place this is load-bearing. Frontend route guarding added
  here is convenience only; nothing may depend on it.
- **AC2's generic message is a security property, not copy.** Wrong email, wrong password,
  and soft-deleted user must be indistinguishable — same code, same message, and the same
  response time, so a hash comparison must still run when the user is not found.
  Note the tension with AC3: a deactivated account gets a *specific* message. That is the
  story's explicit instruction, and it does leak that the account exists. Implement AC3 as
  written and flag the trade-off rather than resolving it unilaterally.
- **AC5 has two independent keys**: per-account and per-IP. Both belong in Redis via
  `CacheService`, and `CacheService` degrades to a miss when Redis is down — which means
  throttling silently fails open. Decide and state what happens in that case.
- The lockout must be **logged** (AC5) — `AuditLog` with `LOGIN_FAILED`, plus the
  structured logger. Never log the submitted password or the hash.
- `effectivePermissionsFor()` belongs in the login response so the frontend can gate the
  UI without a second round trip; US-22 and US-23 consume the same vocabulary.
- Shared DTOs (login request/response, token payload) go in `packages/shared/`, per
  CLAUDE.md's rule for Full-stack stories. Anything in that package is readable by the
  browser — contract only, never enforcement, and never a secret.
- The UI must be bilingual EN/AR with logical CSS properties from the first component, and
  must have loading, empty, and error states — those are in the definition of done
  regardless of how thin the styling is.
