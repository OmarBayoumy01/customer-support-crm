# staff-login — plan overview

Entry point for the **staff-login** feature. Second story of **P02 Auth & Access**, and the
first story in the project that produces a user-facing screen.

## Stories

| NN  | File                                         | Title                          | Tracker id | Depends on |
| --- | -------------------------------------------- | ------------------------------ | ---------- | ---------- |
| 12  | `12-story-sign-in-to-the-staff-workspace.md` | Sign in to the staff workspace | US-14      | US-13      |

## Status — 2026-08-26

**Executed.** All five decisions below were approved as proposed and implemented as
written.

- **Backend: 226 tests** (was 165). New: `password.test.ts`, `token.test.ts`,
  `login-throttle.test.ts`, `auth.test.ts`, `jwt-guard.test.ts`, plus additions to
  `domain-schema.test.ts` and `env.schema.test.ts`.
- **Frontend: 21 tests** (was 0, and there was no test runner).
- **Shared: 22 tests**, unchanged.
- Typecheck and lint clean. Migration `20260826073817_session_for_us14` applied — additive
  only, one new table.

### Deviations from the plan, and why

1. **axios replaced `fetch` in the API client, and shadcn/ui was installed** — asked for by
   the human mid-execution. **axios is not in CLAUDE.md's approved stack**; shadcn/ui is.
   The client is now one `axios` instance with a response interceptor that turns every
   rejection into an `ApiRequestError` carrying the envelope's `code`, so a new feature
   cannot forget the mapping. `login-page.test.tsx` swaps axios's *adapter* rather than
   mocking `fetch`, which means the interceptor itself is under test.

2. **D3's "one audit entry per outage window" was not implemented.** The throttle logs at
   `warn` on every unenforced request and exposes `degradations()`, which the test asserts
   against — but no `AuditAction` value honestly describes "the throttle could not be
   consulted", and adding one is a schema change and a migration for a log line. The loud
   part of "fail open, loudly" is there; the audit row is not. Raise it with US-16, which
   touches `AuditAction` anyway.

3. **US-8's OpenAPI fixture controller is now `@Public()`.** The global guard would
   otherwise 401 it before its own stub `BearerGuard` ran. The stub was kept rather than
   swapped for the real guard: those tests are about **documentation generation**, and
   wiring real token verification into them would make them fail whenever US-14's signing
   changes — which is not what they are watching.

4. **Vitest was scoped to `src/`.** Its default pattern also collected the compiled
   `.test.js` files `tsc -b` emits into `.tsbuild/`, so every frontend test ran twice, the
   second time against the previous build. A stale copy of a test passing is worse than
   not running it.

5. **shadcn's generated `@/…` imports are rewritten to relative ones.**
   `eslint-import-resolver-typescript` v4 does not read `paths` out of this project's
   config — verified directly, not inferred — so `import/no-unresolved` failed on every
   generated file. Rewriting four import lines beat disabling a rule that is otherwise
   working. `src/components/ui/README.md` documents the two steps for the next person who
   runs `shadcn add`.

6. **`npm audit` reports three pre-existing highs** in `prisma → @prisma/config →
   deepmerge-ts`. Not introduced here, and the only offered fix is a major downgrade of
   Prisma. `react-router` and `vitest` were each installed at a patched version.

### One thing the reviewer should look at

`.env`, `.env.example`, `.env.test` and `docker-compose.yml` all carry **obviously
dev-only** JWT secrets. The schema refuses to boot without both, and refuses either under
32 characters — but a deployed environment must supply its own, and set `COOKIE_SECURE`
to true.

## The five open decisions

### D1 — AC6 says "role", singular; US-13 gave users many

US-13's human decision kept the `UserRole` join, so a user holds a set of roles. A singular
claim cannot represent that. **Proposal: `roles: string[]` in the token.** Picking a
"primary" role instead would invent a concept US-13 does not have.

### D2 — A `Session` table has to be added

US-6 modelled no token storage at all. AC1 requires issuing a refresh token, and **US-16
("Sign out and revoke sessions") cannot revoke anything without a server-side row.** So the
table is designed here rather than in US-16, where it would be a retrofit.

The refresh token is stored **hashed** (SHA-256), never in the clear — a leaked backup must
not hand out live sessions. SHA-256 rather than argon2 because the value is 256 bits of
randomness, not a human-chosen password: there is nothing to brute-force, and a slow hash
would only tax every refresh. The model carries an `audience` so a portal refresh token can
never mint a staff access token.

**This is a schema change and wants the same treatment US-6 got — approve the model before
the migration is written.**

### D3 — What throttling does when Redis is down

`CacheService` degrades to a miss, so the naive implementation **fails open and stops
enforcing AC5 silently**.

**Proposal: fail open, loudly** — `warn` on every unenforced request, one audit entry per
outage window. The alternative locks every agent out of the helpdesk during a Redis
outage, which for a support desk running against SLA targets is the worse failure.

**This is a security trade-off, and it is the human's call.**

### D4 — There is currently no account anyone can log in with

`seed.ts` creates permissions and roles and **no users**. AC1 is untestable by hand.
**Proposal:** seed four dev users from `SEED_PASSWORD`, refused when
`NODE_ENV === 'production'`. Automated tests create their own users and never depend on the
seed.

### D5 — New dependencies

`argon2` (AC4 names bcrypt or argon2; Node has neither), the Passport JWT set (the story's
own technical note), `cookie-parser`, and — the one worth pausing on — **a frontend test
runner.** CLAUDE.md's approved stack names no testing library at all and the frontend has
none, yet every AC must be covered by tests. Proposal: Vitest + Testing Library in
`frontend/` only, leaving the backend's `node:test` untouched.

## Decisions already made, and their reasons

1. **The generic-message rule in AC2 is a timing property, not a copy property.** Unknown
   email, wrong password, and soft-deleted user return the same status, the same code, and
   the same message — and the service hashes against a dummy value when the user is not
   found, so they take the same time too. A 1 ms response is as good an account oracle as a
   different message.

2. **The password is checked before `isActive`.** AC3 asks for a *specific* message on a
   deactivated account, which does reveal the account exists. Checking the password first
   confines that leak to someone who already knows the password. Checking `isActive` first
   would turn AC3's message into a free enumeration oracle for anyone guessing emails. The
   trade-off is the story's, not ours — it is implemented as written and flagged, not
   quietly made generic.

3. **The JWT guard is global with a `@Public()` opt-out, not opt-in.** A new endpoint that
   forgets its decorator must fail closed. This is the project's second non-negotiable rule
   — the server is the security boundary — in its cheapest form.

4. **The access token lives in memory only.** Not `localStorage`, which any XSS can read.
   The cost is that a browser refresh returns to the login screen; **US-15, the very next
   story, is exactly what closes that.** There is a test asserting the token is not
   persisted, so nobody "fixes" the refresh behaviour by reintroducing the vulnerability.

5. **The refresh token never appears in a response body** — only as an httpOnly,
   SameSite=Strict cookie, scoped to `/auth` so it is not sent on every API call. One
   module owns the cookie's flags so US-15 and US-16 cannot set them differently.

6. **The throttle has two independent counters**, per-email and per-IP, because one office
   behind one NAT is one IP and a single counter would either lock out a floor of agents or
   fail to stop a targeted attack. The email counter is keyed on a **hash** of the
   normalised email, so Redis holds no PII.

7. **The login response carries `effectivePermissionsFor()`.** US-23 gates the UI on the
   same strings US-22 enforces; shipping them with the session saves a round trip and keeps
   one vocabulary. It is a convenience, never enforcement.

## The design-file gap, and what was decided about it

`03-login.md` — the story's named design file — **does not exist in this repository**, and
neither do the other 30 screen-level prompt files the Notion parent page describes. Raised
on 2026-08-26.

**The human's decision: build the full stack now with a minimal login UI**, accepting that
**P03 Design System & Shell** will revisit the styling. So this story stands up Tailwind,
React Router, TanStack Query, React Hook Form, and i18next — and then deliberately
under-designs the screen. Semantic markup, no hand-tuned pixel values, every string in the
i18n bundle, so P03 restyles it without rewriting it.

Note the phase order this exposes: **P02's frontend work precedes P03**, so the login
screen is built before the design system exists. That is the phase order as written, not a
mistake, but it is a choice and it was flagged.

## What the next stories inherit

- **US-15 (silent refresh)** — `Session.refreshTokenHash` and the `crm_refresh_token`
  cookie are already in place; `cookies.ts` owns the flags. `expiresIn` is in the login
  response so the client can schedule the refresh. Rotation is US-15's to design.
- **US-16 (sign out, revoke sessions)** — `Session.revokedAt` exists and the access token
  carries `sid`. **The strategy deliberately does not check revocation per request** —
  that is a per-request query US-16 must decide on, and the claim is there for it.
- **US-17 / US-18 (password reset)** — `PasswordService` is the hashing surface; the login
  form states no password policy, so the reset form owns it.
- **US-19 (invite staff)** — the same `PasswordService`, plus `SessionService` for
  activation.
- **US-21 (portal login)** — `TOKEN_AUDIENCES` already has `crm-portal`, and `Session`
  carries the audience, so a portal token can never be used against the staff API.
- **US-22 (backend guards)** — `JwtAuthGuard` is the authentication half; US-22 adds the
  authorisation half on top of `PermissionsService.scopesFor()`.
- **US-23 (UI gating)** — the login response already carries `EffectivePermissions` from
  `@crm/shared`.
- **P15 (hardening)** — `trust proxy` and `X-Forwarded-For` are noted but not configured;
  `SessionService.deleteExpired()` exists but is not scheduled.
