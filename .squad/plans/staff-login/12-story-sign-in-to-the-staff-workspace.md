# Story 12 — Sign in to the staff workspace

- **Story:** US-14 · **Phase:** P02 Auth & Access · **Layer:** Full-stack · **Priority:** Must have · **Release:** MVP
- **Depends on:** US-13 (Done) · **Screen:** Login · **Design File:** `03-login.md` — **does not exist**

Open decisions the human must confirm before execution are in `00-overview.md`, and are
repeated as a checklist at the end of this file. **Four of them change what gets built.**

---

## Prerequisites

- **Story 11 (US-13) completed** — [`../roles-permissions/11-story-model-roles-and-granular-permissions.md`](../roles-permissions/11-story-model-roles-and-granular-permissions.md).
  `PermissionsService.effectivePermissionsFor()` is what the login response carries.
- Story 05 (US-7) API conventions, Story 07 (US-9) structured logging, Story 08 (US-10)
  Redis — all complete and depended on directly.
- `docker compose up -d --wait` must give a working Postgres and Redis before any test run.

---

## Story Goal

A support agent signs in with email and password and gets a session the rest of the
platform can trust:

1. A **15-minute access token** (JWT) carrying who they are and what they may do.
2. A **refresh token** in an httpOnly, SameSite=Strict cookie, backed by a **server-side
   session row** that a later story can revoke.
3. **Every authenticated request identifies its user** — the JWT guard calls
   `RequestContextService.setUserId()`, so every log line for the request carries it.
4. A **login screen** and a placeholder dashboard behind a route guard.

**Not in scope:** two-factor (US-24), SSO, silent refresh (US-15), sign-out and revocation
(US-16), password reset (US-17/US-18), portal registration and portal login (US-20/US-21),
the permission guard on business endpoints (US-22), UI permission gating (US-23).

**Explicitly accepted for this story:** the access token is held **in memory only**, so a
browser refresh returns the user to the login screen. That is the correct security posture
— a token in `localStorage` is readable by any XSS — and **US-15, the very next story, is
what closes the gap.** Do not add `localStorage` persistence to work around it.

---

## Context — Read These Files First

1. `backend/src/permissions/permissions.service.ts` — `effectivePermissionsFor(userId)`
   (~line 34) and its Redis caching. The login response calls this, and it is already
   cached, so calling it on every login is cheap.
2. `backend/src/permissions/index.ts` — the exact export surface. Import from here, never
   from the individual files.
3. `backend/src/common/errors/api.exception.ts` — `ApiException`, `statusForCode()`, and
   the `STATUS_BY_CODE` map (~lines 5–17). **`RATE_LIMITED` already maps to 429**; no
   change is needed there. `ApiException` has static helpers for `notFound`, `conflict`,
   `forbidden`, `unprocessable` — but **not** for `UNAUTHENTICATED` or `RATE_LIMITED`.
   Use the constructor, or add helpers alongside the existing ones.
4. `backend/src/common/request-context/request-context.service.ts` — `setUserId()` at
   ~line 56. Its doc comment already names this story: *"P02's guard calls `setUserId`
   after verifying the token"*. This is where that promise is kept.
5. `backend/src/common/validation/create-zod-dto.ts` and `zod-validation.pipe.ts` — how a
   Zod schema becomes a DTO class the global pipe validates. Match this exactly; do not
   introduce `class-validator`.
6. `backend/src/common/interceptors/response-envelope.interceptor.ts` and
   `backend/src/common/decorators/no-envelope.decorator.ts` — every response is wrapped in
   `{ data: … }` unless `@NoEnvelope()`. **The login response is enveloped like everything
   else.**
7. `backend/src/config/env.schema.ts` — the whole file. Every new variable goes here, and
   the `no-process-env` ESLint rule means nothing else may read `process.env`. Copy the
   commenting style: each variable says *why* it exists, not just what it is.
8. `backend/src/redis/redis.service.ts` — exposes `readonly client: Redis` (ioredis) at
   ~line 27 and `isReady()` at ~line 102. **`CacheService` has no atomic counter**, so the
   throttle uses `RedisService.client` directly for `INCR` + `EXPIRE`.
9. `backend/src/redis/cache.service.ts` — read the degradation contract: it returns a miss
   when Redis is down rather than throwing. The throttle must make the same failure mode a
   deliberate, logged decision (see **Decision D3**).
10. `backend/src/health/health.controller.ts` — `@Controller('health')`, ~line 9. **There
    is no global route prefix and no versioning** (`backend/src/index.ts` sets neither), so
    the new endpoint is `POST /auth/login`, not `/api/v1/auth/login`.
11. `backend/prisma/schema.prisma` — the `User` model (~lines 165–210) and `AuditLog`
    (~lines 785–815). Note `User.passwordHash`, `User.isActive`, `User.lastLoginAt`,
    `User.deletedAt`, and that `AuditAction` already has `LOGIN`, `LOGIN_FAILED`, `LOGOUT`.
    Note also AuditLog's comment: *"Secrets and password hashes must never be written here."*
12. `backend/src/prisma/soft-delete.extension.ts` — the `notDeleted` extension. Understand
    whether a `deletedAt` user is filtered automatically before writing the lookup, because
    AC2 depends on a deleted user being indistinguishable from a missing one.
13. `backend/src/seed/seed.ts` — the whole file, for the idempotent-upsert style. **It
    creates no users at all**, which means there is currently no account anyone can log in
    with. See **Decision D4**.
14. `backend/src/openapi/api-zod.decorators.ts` — how endpoints are documented from Zod.
15. `packages/shared/src/index.ts` and `packages/shared/src/auth/permissions.ts` — the
    export barrel and the existing auth vocabulary. New auth DTOs sit beside them.
16. `backend/package.json` — the test script: `tsc -b`, then `prepare-test-db.js`, then
    `node --test "dist/**/*.test.js"`. **The backend is on `node:test`, not Vitest.**
    Match `backend/src/permissions/permissions.test.ts` for test style.

---

## Decisions to confirm before execution

**These four change what gets built. Do not start until they are answered.**

### D1 — AC6 says "role", singular. The schema says many.

US-13 deliberately kept the `UserRole` join, so a user holds a set of roles. A singular
claim cannot represent that.

**Proposal: the token carries `roles: string[]`** (role keys — `"agent"`, `"manager"`).
This meets AC6's intent (the token says what the user is) and matches the schema. The
alternative — picking a "primary" role — invents a concept US-13 does not have.

### D2 — A `Session` table has to be added, and that is a schema change.

Nothing in US-6 models tokens. AC1 requires issuing a refresh token, and **US-16 cannot
revoke anything without a server-side row**. Proposed model, added to `schema.prisma`:

```prisma
/// One issued refresh token. The access token is stateless; this is the part
/// that can be revoked, which is what US-16 needs and why it is a table rather
/// than a claim.
model Session {
  id     String @id @default(uuid(7))
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// SHA-256 of the refresh token, never the token. A leaked database backup
  /// must not hand out live sessions. SHA-256 rather than argon2 on purpose:
  /// this is a 256-bit random value, not a human-chosen password, so there is
  /// nothing to brute-force and a slow hash would only tax every refresh.
  refreshTokenHash String @unique

  /// The audience the session was opened for — staff or portal. A portal
  /// refresh token must never mint a staff access token.
  audience String

  expiresAt DateTime
  revokedAt DateTime?

  ipAddress String?
  userAgent String?

  createdAt  DateTime @default(now())
  lastUsedAt DateTime @default(now())

  @@index([userId, revokedAt])
  @@index([expiresAt])
}
```

Plus `sessions Session[]` on `User`. **Present this for approval before the migration is
written** — same rule the phase applied to US-6.

### D3 — What happens to throttling when Redis is down.

`CacheService` degrades to a miss, so a naive implementation **fails open** and AC5 stops
being enforced silently.

**Proposal: fail open, loudly.** Log at `warn` on every request where the throttle could
not be consulted, and write one `AuditLog` entry per outage window. Rationale: the
alternative locks every agent out of the helpdesk during a Redis outage, which for a
support desk running against SLA targets is the worse failure. `/health` already reports
Redis down.

**This is a security trade-off and it is the human's call, not the executor's.**

### D4 — There is no account to log in with.

`seed.ts` creates permissions and roles, **no users**. AC1 is untestable by hand without
one.

**Proposal:** the seed creates four dev users (administrator, manager, agent, customer),
password taken from `SEED_PASSWORD`, and **refuses to run that part when
`NODE_ENV === 'production'`**. Automated tests create their own users and do not depend on
the seed.

### D5 — New dependencies (CLAUDE.md requires asking)

| Package | Where | Why |
| ------- | ----- | --- |
| `argon2` | backend | AC4 names bcrypt or argon2; Node has neither built in. argon2id is memory-hard and avoids bcrypt's 72-byte truncation. |
| `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `@types/passport-jwt` | backend | The story's own technical note says "Passport JWT strategy". JWT is in the approved stack. |
| `cookie-parser`, `@types/cookie-parser` | backend | Reading the httpOnly refresh cookie the story asks for. |
| `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom` | frontend | **The approved stack names no test library, and the frontend has none.** Every AC must be covered by tests. Vitest shares Vite's config; the backend stays on `node:test`, untouched. |
| `tailwindcss`, `@tailwindcss/vite`, `react-router`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `i18next`, `react-i18next` | frontend | Already in CLAUDE.md's approved stack — listed for completeness, not for approval. |

---

## Target paths

| Action | Path |
| ------ | ---- |
| **create** | `packages/shared/src/auth/tokens.ts` — access-token claims, audiences |
| **create** | `packages/shared/src/auth/login.ts` — login request / response DTOs |
| **modify** | `packages/shared/src/index.ts` — export the above |
| **modify** | `packages/shared/src/api/error-codes.ts` — `RATE_LIMITED` is no longer "reserved for P15" |
| **modify** | `backend/prisma/schema.prisma` — `Session` model, `User.sessions` |
| **create** | `backend/prisma/migrations/<ts>_session_for_us14/migration.sql` |
| **create** | `backend/src/auth/auth.module.ts`, `index.ts` |
| **create** | `backend/src/auth/auth.controller.ts` — `POST /auth/login` |
| **create** | `backend/src/auth/auth.service.ts` — the login flow |
| **create** | `backend/src/auth/password.service.ts` — argon2id hash / verify |
| **create** | `backend/src/auth/token.service.ts` — mint access JWT, mint + hash refresh token |
| **create** | `backend/src/auth/session.service.ts` — create / look up / expire session rows |
| **create** | `backend/src/auth/login-throttle.service.ts` — AC5, Redis `INCR` |
| **create** | `backend/src/auth/jwt.strategy.ts` — passport-jwt, calls `setUserId()` |
| **create** | `backend/src/auth/jwt-auth.guard.ts` — global, with `@Public()` opt-out |
| **create** | `backend/src/auth/decorators/public.decorator.ts`, `current-user.decorator.ts` |
| **create** | `backend/src/auth/dto/login.dto.ts` — `createZodDto` wrappers |
| **create** | `backend/src/auth/cookies.ts` — one place that knows the cookie's flags |
| **create** | `backend/src/auth/auth.test.ts`, `password.test.ts`, `token.test.ts`, `login-throttle.test.ts`, `jwt-guard.test.ts` |
| **modify** | `backend/src/app.module.ts` — register `AuthModule` |
| **modify** | `backend/src/index.ts` — `cookieParser()` middleware |
| **modify** | `backend/src/health/health.controller.ts` — `@Public()` |
| **modify** | `backend/src/config/env.schema.ts` — JWT, argon2, throttle, cookie variables |
| **modify** | `backend/.env.example`, `docker-compose.yml` — the new variables |
| **modify** | `backend/src/seed/seed.ts` — dev users (D4) |
| **modify** | `backend/package.json` — argon2, passport, jwt, cookie-parser |
| **create** | `frontend/src/lib/api-client.ts` — envelope-aware fetch wrapper |
| **create** | `frontend/src/features/auth/auth-context.tsx` — in-memory token |
| **create** | `frontend/src/features/auth/use-login.ts` — TanStack Query mutation |
| **create** | `frontend/src/features/auth/login-page.tsx` — the form |
| **create** | `frontend/src/features/auth/require-auth.tsx` — route guard |
| **create** | `frontend/src/features/dashboard/dashboard-page.tsx` — placeholder |
| **create** | `frontend/src/app/router.tsx`, `frontend/src/app/providers.tsx` |
| **create** | `frontend/src/i18n/index.ts`, `locales/en.json`, `locales/ar.json` |
| **create** | `frontend/src/styles/index.css` — Tailwind entry |
| **create** | `frontend/src/features/auth/login-page.test.tsx`, `auth-context.test.tsx` |
| **create** | `frontend/vitest.config.ts`, `frontend/src/test/setup.ts` |
| **modify** | `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/vite.config.ts`, `frontend/package.json`, `frontend/tsconfig.json` |

**Nothing at the repository root** except the `docker-compose.yml` environment additions.

---

## Backend Tasks

### 1 — Shared contracts

**Create file: `packages/shared/src/auth/tokens.ts`**

```ts
/**
 * Which front door a token was issued for. The claim only means something
 * because there is more than one: a portal refresh token (US-21) must never
 * mint a staff access token, and the audience check is what stops it.
 */
export const TOKEN_AUDIENCES = ['crm-staff', 'crm-portal'] as const;
export type TokenAudience = (typeof TOKEN_AUDIENCES)[number];

/**
 * The claims carried by an access token (AC6). This is a *contract*, not
 * enforcement — the browser can read it, so nothing secret goes in and the
 * server re-verifies every claim on every request.
 */
export const AccessTokenClaimsSchema = z.object({
  /** The user id. AC6's "user ID". */
  sub: z.string().uuid(),
  /**
   * Role keys. AC6 says "role", singular; US-13 gives users many roles, so this
   * is the plural form of the same idea — see D1 in the plan.
   */
  roles: z.array(z.string().min(1)),
  /** AC6's "audience". */
  aud: z.enum(TOKEN_AUDIENCES),
  iss: z.string().min(1),
  /** The session this token belongs to, so US-16 can revoke it. */
  sid: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});
```

**Create file: `packages/shared/src/auth/login.ts`** — `LoginRequestSchema` (email
lowercased and trimmed, password `min(1)` only — **never** state the password policy on
the login form, that belongs to US-18's reset form) and `LoginResponseSchema`:

```ts
export const LoginResponseSchema = z.object({
  accessToken: z.string().min(1),
  /** Seconds. Lets the client schedule US-15's silent refresh. */
  expiresIn: z.number().int().positive(),
  user: AuthenticatedUserSchema,   // id, email, firstName, lastName, locale, roles
  /** So the UI can gate itself without a second round trip — US-23. */
  permissions: EffectivePermissionsSchema,
});
```

The refresh token is **not** in the body. It is only ever a `Set-Cookie`.

**File: `packages/shared/src/api/error-codes.ts`** — replace the `RATE_LIMITED` comment
*"Reserved for P15; nothing raises it yet"* with a note that the login throttle raises it.

### 2 — Password hashing (AC4)

**Create file: `backend/src/auth/password.service.ts`**

argon2id, parameters from config, defaults at the OWASP minimum: `memoryCost` 19456 KiB,
`timeCost` 2, `parallelism` 1.

Two methods, and the second one is the interesting one:

```ts
async hash(plain: string): Promise<string>
async verify(hash: string, plain: string): Promise<boolean>

/**
 * Burns the same work as a real verification against a hash of a fixed dummy
 * value. Called when the email does not exist, so that "no such user" and
 * "wrong password" take the same time — AC2 is about not leaking which, and a
 * timing difference leaks it just as surely as a different message would.
 */
async verifyDummy(): Promise<void>
```

The dummy hash is computed **once at module init**, not per call.

### 3 — Tokens and sessions

**Create file: `backend/src/auth/token.service.ts`**

- `signAccessToken({ sub, roles, sid, audience })` → HS256, `expiresIn` from
  `JWT_ACCESS_TTL_SECONDS` (**default 900 — AC6 says 15 minutes**), `issuer` and `audience`
  set from config.
- `mintRefreshToken()` → 32 bytes from `crypto.randomBytes`, base64url. Returns the plain
  token **and** its SHA-256 hash. The plain value is returned to the caller exactly once.

**Create file: `backend/src/auth/session.service.ts`** — `create()` writes the row with the
hash, audience, expiry (`JWT_REFRESH_TTL_SECONDS`, default 30 days), IP and user agent.
Also a `deleteExpired()` for a later cleanup job; **do not schedule it in this story**,
just leave it callable and say so in a comment.

**Create file: `backend/src/auth/cookies.ts`** — the single place that knows the cookie's
flags, so US-15 and US-16 cannot set them differently:

```ts
export const REFRESH_COOKIE = 'crm_refresh_token';

// SameSite=Strict and httpOnly are the story's own technical note. `secure` is
// off only outside production, because a dev on plain http would otherwise
// never receive the cookie at all. Path is scoped to /auth so the cookie is not
// sent on every API call — it is needed by refresh and logout, nowhere else.
```

### 4 — Brute-force throttle (AC5)

**Create file: `backend/src/auth/login-throttle.service.ts`**

Two independent counters via `RedisService.client` (`INCR` then `EXPIRE` on first
increment — `CacheService` has no atomic counter):

- `auth:fail:email:<sha256(lowercased email)>` — threshold `LOGIN_MAX_ATTEMPTS_PER_EMAIL`,
  default 5. **The email is hashed** so Redis keys hold no PII.
- `auth:fail:ip:<ip>` — threshold `LOGIN_MAX_ATTEMPTS_PER_IP`, default 20, because one
  office behind one NAT is one IP.

Window and lockout both `LOGIN_THROTTLE_WINDOW_SECONDS`, default 900.

`check()` runs **before** any database work and throws
`new ApiException('RATE_LIMITED', …)` → 429. `recordFailure()` increments both.
`clear()` deletes both on success, so a user who mistypes twice then succeeds is not
still counting down.

Per **D3**, wrap every Redis call so a failure logs at `warn` and returns "not throttled"
rather than throwing.

### 5 — The login flow

**Create file: `backend/src/auth/auth.service.ts`** — order matters, and each step maps to
an AC:

1. `throttle.check(email, ip)` — AC5, before anything else.
2. Look up the user by lowercased email, **including soft-deleted**, selecting only the
   columns needed. Confirm against `soft-delete.extension.ts` whether the default client
   filters `deletedAt`; a deleted user must take the **same** path as a missing one.
3. **Not found, or soft-deleted:** `await password.verifyDummy()`, record the failure,
   throw the generic error — AC2.
4. **Found:** `password.verify()`. On mismatch, record the failure and throw **the same
   generic error, same code, same message** — AC2.
5. **`isActive === false`:** throw the *specific* "contact an administrator" message —
   AC3. Note the trade-off in a comment: this deliberately reveals the account exists, and
   it is what the story asks for. **Do not quietly make it generic.**
6. Success: `throttle.clear()`, resolve roles, `permissionsService.effectivePermissionsFor(user.id)`,
   create the session, sign the access token, update `lastLoginAt`, write `AuditLog` with
   `LOGIN`.
7. Every failure path writes `AuditLog` with `LOGIN_FAILED` and, when the throttle trips, a
   log line at `warn` naming the lockout — AC5's "the lockout is logged".

**Never** log or audit the submitted password, the stored hash, or the refresh token.

**Create file: `backend/src/auth/auth.controller.ts`** — `@Controller('auth')`,
`@Public()`, `POST login`, `@HttpCode(200)`. Sets the refresh cookie via
`@Res({ passthrough: true })` and returns the body; the envelope interceptor wraps it.
Document it with the `api-zod.decorators.ts` helpers, including the 401, 403 and 429
responses.

### 6 — The guard, and identifying the user on every request

**Create file: `backend/src/auth/jwt.strategy.ts`** — `passport-jwt`, bearer from header,
`audience` and `issuer` verified. In `validate()`, call
`requestContext.setUserId(payload.sub)` — this is what the `RequestContextService` comment
has been waiting for.

**Do not** hit the database or check session revocation here. That is a per-request query
US-16 will decide on; the `sid` claim is already there for it. Say so in a comment.

**Create file: `backend/src/auth/jwt-auth.guard.ts`** — registered **globally** as an
`APP_GUARD` in `AuthModule`, with a `@Public()` decorator to opt out. Global-and-opt-out,
not opt-in: a new endpoint that forgets its decorator must fail closed. Missing or invalid
token → `ApiException('UNAUTHENTICATED', …)` so the error envelope stays consistent.

**File: `backend/src/health/health.controller.ts`** — add `@Public()`. Check
`backend/src/openapi/swagger.ts` too: the docs route must still serve.

### 7 — Configuration

**File: `backend/src/config/env.schema.ts`** — add, each with a comment in the file's
existing style:

`JWT_ACCESS_SECRET` (min 32 chars, **no default**), `JWT_REFRESH_SECRET` (min 32, no
default), `JWT_ISSUER` (default `crm`), `JWT_ACCESS_TTL_SECONDS` (default **900**),
`JWT_REFRESH_TTL_SECONDS` (default 2592000), `ARGON2_MEMORY_COST` (19456),
`ARGON2_TIME_COST` (2), `ARGON2_PARALLELISM` (1), `LOGIN_MAX_ATTEMPTS_PER_EMAIL` (5),
`LOGIN_MAX_ATTEMPTS_PER_IP` (20), `LOGIN_THROTTLE_WINDOW_SECONDS` (900),
`COOKIE_SECURE` (BooleanFromString, default `'false'`), `SEED_PASSWORD` (optional).

The two secrets have **no default on purpose** — same fail-fast stance as `DATABASE_URL`.
A JWT secret with a default is a JWT secret an attacker knows. Add both to
`backend/.env.example` and `docker-compose.yml` with obvious dev-only values, and
`SEED_PASSWORD` alongside them. **No real secret is committed.**

---

## Frontend Tasks

Deliberately thin. **P03 owns the design system**; this is a working screen, not a visual
statement. Build it so P03 restyles it without rewriting it: semantic markup, tokens
through Tailwind, no hand-tuned pixel values scattered through components.

### 8 — Stack setup

Tailwind v4 via `@tailwindcss/vite` in `frontend/vite.config.ts`. Vitest with `jsdom` and
`frontend/src/test/setup.ts`. Add `"test": "vitest run"` to `frontend/package.json` so the
root `npm run test --workspaces` picks it up. Proxy `/auth` and `/health` to the backend in
the Vite dev server so the cookie is same-origin in development.

### 9 — Providers, i18n, routing

`frontend/src/app/providers.tsx` — `QueryClientProvider`, `I18nextProvider`,
`BrowserRouter`, `AuthProvider`.

`frontend/src/i18n/index.ts` — `en` and `ar`, and on language change set **both**
`document.documentElement.lang` and `dir`. Every string in this story goes in
`locales/en.json` and `locales/ar.json`. **No hardcoded user-facing strings in components.**

`frontend/src/app/router.tsx` — `/login` public; `/dashboard` wrapped in `RequireAuth`;
`/` redirects to whichever applies.

### 10 — The API client

`frontend/src/lib/api-client.ts` — `credentials: 'include'` (the refresh cookie),
unwraps `{ data }`, and on a non-2xx **throws a typed error carrying the `code` from the
error envelope**. The login form switches on `code`, not on message text, so re-wording a
message never breaks the UI.

### 11 — Auth state

`frontend/src/features/auth/auth-context.tsx` — access token, user, and permissions in
React state. **In memory only. Not `localStorage`, not `sessionStorage`.** Put the reason
in a comment, and name US-15 as what makes refresh-survival work.

`use-login.ts` — a TanStack Query mutation; on success store the session and
`navigate('/dashboard')` (AC1's "land on the dashboard").

### 12 — The login screen

`login-page.tsx` — React Hook Form + Zod against the **shared** `LoginRequestSchema`.

- **Loading:** submit disabled, spinner, `aria-busy`. Definition of done.
- **Error:** one `role="alert"` region. `UNAUTHENTICATED` → the generic message (AC2);
  `FORBIDDEN` → the "contact an administrator" message (AC3); `RATE_LIMITED` → the
  throttled message (AC5). All three from the i18n bundle.
- **Empty:** field-level validation messages from the resolver.
- **RTL:** CSS **logical properties only** — `ms-*`/`me-*`/`ps-*`/`pe-*`, `text-start`.
  **No `left`/`right`, no `ml-*`/`mr-*`.** A language toggle is the cheapest way to make
  this reviewable, so include one.
- **Keyboard:** labels tied to inputs, visible `focus-visible` ring, sensible tab order.
- Never render an error that distinguishes "no such email" from "wrong password".

`dashboard-page.tsx` — a placeholder that greets the user by name and lists their role
keys. It exists to prove AC1's redirect and nothing more. Say that in a comment so nobody
mistakes it for the real dashboard.

---

## Edge Cases & Failure Modes

- **Email case and whitespace** — `"  Agent@Example.COM "` must find `agent@example.com`.
  Normalised in `LoginRequestSchema` (`packages/shared/src/auth/login.ts`) so client and
  server normalise identically, and the throttle key is built from the normalised value —
  otherwise varying the capitalisation resets the counter.
- **Unknown email** — `verifyDummy()` in `auth.service.ts` step 3. Without it the response
  returns in ~1 ms instead of ~50 ms and the timing alone enumerates accounts.
- **Soft-deleted user** — must be indistinguishable from unknown. Verify against
  `soft-delete.extension.ts`; if the default client already filters `deletedAt`, the
  "unknown" path covers it — assert that in a test rather than assuming it.
- **Inactive user with the *wrong* password** — order matters: password is checked
  **before** `isActive`, so a wrong password on a disabled account returns the generic
  error, not the "contact an administrator" one. Otherwise AC3's message becomes an
  account-enumeration oracle for anyone guessing.
- **Redis down** — throttle fails open, logs at `warn`, one audit entry per window (D3).
  `/health` already reports Redis down.
- **Concurrent logins by the same user** — each gets its own `Session` row. Nothing is
  invalidated; concurrent sessions are legitimate (laptop and phone). US-16 decides how to
  list and revoke them.
- **Refresh token collision** — `refreshTokenHash` is `@unique`; 256 bits of randomness
  makes this effectively impossible, and the constraint turns "impossible" into "loud".
- **Clock skew** — `passport-jwt` gets no `clockTolerance`. State it: a token is valid for
  15 minutes and not a second more.
- **Missing `Authorization` header on a protected route** — `UNAUTHENTICATED`/401 through
  the standard envelope, never a bare Nest 401.
- **A new endpoint with no decorator** — fails closed, because the guard is global.
  There is a test for this.
- **`X-Forwarded-For` and the IP throttle** — behind a proxy every request looks like one
  IP. Read the IP in one helper, note that `trust proxy` is a deployment concern for P15,
  and **do not** silently trust the header.
- **Very long password input** — argon2 has no bcrypt-style truncation, but cap the field
  at 512 characters in the schema so a megabyte of input is not hashed.
- **Browser refresh after login** — returns to `/login`. Expected for this story; US-15
  closes it. Do not paper over it.

---

## Test Plan

Backend tests are `node:test` under `backend/src/**/*.test.ts`, matching
`backend/src/permissions/permissions.test.ts`. Frontend tests are Vitest +
Testing Library. **187 tests are green today; nothing may regress.**

**Backend — unit**

1. `backend/src/auth/password.test.ts` — a hash starts `$argon2id$`; the plaintext never
   appears in it; `verify` accepts the right password and rejects the wrong one; two hashes
   of the same password differ (salted). **AC4.**
2. `backend/src/auth/token.test.ts` — decoded claims carry `sub`, `roles`, `aud`, `iss`,
   `sid`; `exp - iat === 900`; a token signed with a different secret is rejected; a token
   with `aud: 'crm-portal'` is rejected by the staff strategy. **AC6, D1.**
3. `backend/src/auth/login-throttle.test.ts` — under the threshold passes; the threshold
   trips `RATE_LIMITED`; email and IP counters are independent; success clears the counter;
   the key varies with email case only after normalisation; **with Redis unavailable it
   returns not-throttled and logs a warning** (D3).

**Backend — integration** (`backend/src/auth/auth.test.ts`, real Postgres via
`prepare-test-db.ts`, users created by the test)

4. Valid credentials → 200, envelope carries `accessToken`, `expiresIn: 900`, `user`,
   `permissions`; a `Set-Cookie` for `crm_refresh_token` with `HttpOnly` and
   `SameSite=Strict`; a `Session` row exists whose `refreshTokenHash` **is not** the cookie
   value; `lastLoginAt` updated; an `AuditLog` row with `LOGIN`. **AC1.**
5. Unknown email and wrong password produce **byte-identical** bodies apart from
   `requestId` and `timestamp`, and both are 401 `UNAUTHENTICATED`. **AC2.** *This is the
   regression test for the AC2 security property — name it so.*
6. A soft-deleted user is indistinguishable from an unknown one. **AC2.**
7. `isActive: false` with the correct password → 403 `FORBIDDEN`, the administrator
   message. **AC3.**
8. `isActive: false` with the **wrong** password → the generic 401, not the AC3 message.
   **AC3 + AC2, the enumeration oracle.**
9. Six failures then a correct password → 429 `RATE_LIMITED`; an `AuditLog`
   `LOGIN_FAILED` row exists; the lockout is logged. **AC5.**
10. The response body **never** contains `passwordHash`, and no `AuditLog.before`/`after`
    contains it either. **AC4.**
11. `backend/src/auth/jwt-guard.test.ts` — a protected route with no header → 401 in the
    standard envelope; with a valid token → 200; with an expired token → 401; **a
    controller with no `@Public()` is protected by default**; `/health` still answers
    without a token.
12. `backend/src/prisma/domain-schema.test.ts` — extend for the `Session` model and its
    indexes, matching how that file already checks the others.

**Frontend**

13. `login-page.test.tsx` — renders labelled email and password fields; empty submit shows
    validation and does not call the API; a successful submit navigates to `/dashboard`
    (AC1); `UNAUTHENTICATED` renders the generic message and **not** anything naming the
    email (AC2); `FORBIDDEN` renders the administrator message (AC3); `RATE_LIMITED`
    renders the throttled message (AC5); the submit control is disabled and `aria-busy`
    while in flight.
14. `login-page.test.tsx` — RTL: switching to Arabic sets `dir="rtl"` on the document and
    renders the Arabic strings.
15. `auth-context.test.tsx` — the token is **not** written to `localStorage` or
    `sessionStorage` after a successful login. *An explicit assertion, so nobody "fixes"
    the refresh behaviour by persisting it.*
16. `require-auth.test.tsx` — an unauthenticated visit to `/dashboard` redirects to
    `/login`.

---

## Migration / Rollback

One migration, `<ts>_session_for_us14`: creates `Session` with its two indexes and the
unique constraint, and the foreign key to `User` with `ON DELETE CASCADE`. **Additive
only** — no existing table is altered, no column dropped, nothing backfilled.

- **Rollback:** `DROP TABLE "Session";`. Nothing else references it, so the previous
  release runs unchanged against the new schema.
- **Half-applied state:** if the table exists but the code is old, the table is simply
  unused. If the code is new and the table is missing, login fails at session creation with
  a Prisma error — **after** the password check, so no credential is leaked by the failure.
  Deploy the migration first; it is safe against the old code.
- Present the model for approval (**D2**) before generating the migration.

---

## Verification Steps

1. **Stack up:** `docker compose up -d --wait` in the repository root.
2. **Migration:** `npm run migrate:dev --workspace @crm/backend` — review the generated SQL
   before committing it.
3. **Seed:** `npm run db:seed --workspace @crm/backend` — still idempotent, now also
   creating the dev users (D4).
4. **Backend builds and tests:** `npm run verify` in the repository root — typecheck, lint,
   format check, then all workspaces' tests. **187 tests were green before this story; the
   count must go up, and none may go red.**
5. **Frontend runs:** `npm run dev --workspace @crm/frontend`, open `/login`, sign in as
   the seeded agent, confirm the redirect to `/dashboard`.
6. **Manual — AC2:** submit an unknown email, then a known email with a wrong password.
   Confirm the messages are identical.
7. **Manual — AC3:** set a user `isActive: false`, sign in, confirm the administrator
   message.
8. **Manual — AC5:** submit six wrong passwords, confirm the 429 and the log line.
9. **Manual — AC6:** paste the access token into a decoder, confirm `sub`, `roles`, `aud`,
   and `exp - iat === 900`.
10. **Manual — AC4:** `docker compose exec postgres psql -U crm -c 'select "passwordHash" from "User" limit 1;'`
    and confirm the `$argon2id$` prefix.
11. **Manual — RTL:** switch to Arabic, confirm the form mirrors and nothing is clipped.
12. **Regression:** `/health` and `/api/docs` still answer **without** a token.

---

## Done Criteria

- [ ] **AC1** — valid credentials return an access token and set a refresh cookie backed by a `Session` row; the UI lands on `/dashboard`. Tests 4, 13.
- [ ] **AC2** — unknown email and wrong password are indistinguishable in body, status, and timing. Tests 5, 6, 13.
- [ ] **AC3** — a deactivated account is refused with the administrator message, and only when the password was correct. Tests 7, 8, 13.
- [ ] **AC4** — passwords are argon2id; no hash appears in any response or audit row. Tests 1, 10, verification 10.
- [ ] **AC5** — per-email and per-IP throttles trip, are logged, and are audited. Tests 3, 9.
- [ ] **AC6** — claims carry user id, roles, and audience, and expire in exactly 900 seconds. Test 2.
- [ ] The JWT guard is global and fail-closed; `RequestContextService.setUserId()` is called on every authenticated request. Test 11.
- [ ] TypeScript strict, no `any` without written justification; `npm run verify` green.
- [ ] No secret committed; both JWT secrets have no default and fail fast when unset.
- [ ] Login screen: loading, empty, and error states; keyboard accessible with visible focus; Arabic RTL correct with logical properties only; every string from the i18n bundle. Tests 13, 14.
- [ ] Access token is in memory only; test 15 asserts it.
- [ ] `RATE_LIMITED`'s "reserved for P15" comment is updated.
- [ ] Notion US-14 set to `In review` — **not** `Done`.

**STOP HERE. Report to the user and wait for confirmation before proceeding to Story 13 (US-15).**
