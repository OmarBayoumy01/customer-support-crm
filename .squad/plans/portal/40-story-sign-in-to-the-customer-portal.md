# US-21 — Sign in to the customer portal

- **Feature:** `portal`
- **Story:** [Sign in to the customer portal](https://app.notion.com/p/3c69e083852381b9959edda7aebfcc90)
- **Phase / Layer / Release:** P02 Auth & Access · Full-stack · MVP · Must have
- **Depends on:** ~~US-20~~ (registration, deferred) · in practice US-14 and US-82
- **Intake:** `.squad/stories/portal/sign-in-to-the-customer-portal/intake.md`
- **MVP position:** 21 of 28

## The story

> **As a** customer **I want** a simple portal sign-in **So that** I can reach my requests
> without navigating the staff application.

| AC | Requirement |
| -- | ----------- |
| **AC1** | Valid customer credentials land on the **portal home, never the staff dashboard**. |
| **AC2** | A **staff account** on the portal form is refused, with a message pointing to the staff login. |
| **AC3** | Not signed in: the knowledge base is still browsable, but submitting a request prompts sign-in or registration. |
| **AC4** | Someone who tried to open a specific request before signing in lands **on that request**, not on the home page. |

Out of scope per the story: passwordless magic-link login (V2).

## What already exists

Almost all of the machinery. This is a thin layer, as instructed:

- **`AuthService.login(credentials, origin, audience)`** — the audience parameter has been
  there since US-14 and no caller has ever passed `crm-portal`.
- **`LoginPage`** — the form, the shared-schema resolver with translated messages, the
  reveal toggle, the caps-lock hint, and error copy keyed on the **error code**.
- **`useLogin`** — posts, calls `signIn`, and navigates to `location.state.from` if present,
  which is AC4 already built for staff.
- **`RequireAuth`** — carries the attempted path in route state.
- **US-82's portal API and its audience enforcement**, with tests in both directions.

## Approach

### AC2 — one small, deliberate change to the auth service

`AuthService.login` gains an optional `requirePortalAccount` flag, checked **between the
password verification and the session being minted**:

```ts
// step 5.5 — after the password, before anything is created
if (options?.requirePortalAccount === true && !(await this.hasCustomerRecord(user.id))) {
  throw new ApiException('UNPROCESSABLE', STAFF_ACCOUNT_ON_PORTAL);
}
```

Three things about that placement, all load-bearing:

- **After the password check**, for exactly the reason step 5's comment already gives about
  `isActive`: a specific message reachable *before* the password is an account-enumeration
  oracle. Only somebody who has already proved they know the password learns that the
  account is a staff one.
- **Before the session is created**, so a refused portal login does not leave a session row
  and a refresh cookie behind.
- **`UNPROCESSABLE` (422), not `FORBIDDEN`.** The frontend switches on the code, never the
  message, and `FORBIDDEN` already means "this account is deactivated" on the login form.
  Reusing it would make the two indistinguishable to the client. The codebase's own error-code
  documentation reserves `UNPROCESSABLE` for "well-formed and understood, but refused by a
  business rule", which is precisely what this is. **No new error code is added.**

**What makes an account a portal account is the `Customer.userId` link** — the same fact
US-82 uses to scope every portal query. Not a role name: roles are configuration, and the
portal's identity should not be something an administrator can reassign by accident.

`POST /auth/portal/login` is a thin controller method beside the staff one: same body DTO,
same cookie handling, `audience: 'crm-portal'`, `requirePortalAccount: true`.

### AC1 and AC4 — the same hook, parameterised

`useLogin(variant)` where the variant supplies the endpoint and the landing path:

| Variant | Endpoint | Lands on |
| ------- | -------- | -------- |
| `staff` (default) | `/auth/login` | `/dashboard` |
| `portal` | `/auth/portal/login` | `/portal` |

AC4 needs no new code: the hook already prefers `location.state.from`, so a customer who
followed a link to `/portal/requests/abc`, was bounced to the portal login and signed in
arrives at that request. The staff default stays exactly as it is, so US-14's tests are
untouched.

### AC1 — the screen, and why it is the same component

`LoginPage` takes an optional `variant` prop. The form, the validation, the caps-lock hint
and the error mapping are identical for both audiences, and **duplicating two hundred lines
so the heading can differ is how the two drift** — one gets a security fix and the other does
not.

What the variant changes: the copy, the panel's headline, the link to the other login, and one
entry in the error map (`UNPROCESSABLE` → "this looks like a staff account"). The staff route
renders `<LoginPage />` unchanged.

`RequireAuth` likewise takes an optional `loginPath`, defaulting to `/login`, so portal routes
bounce to `/portal/login`.

### Routes

```
/portal/login     public
/portal           RequireAuth loginPath=/portal/login  →  PortalHomePage
```

**`PortalHomePage` is deliberately a landing page and not US-84's list.** It confirms the
customer is signed in, greets them by name, and links onward. US-84 replaces its body with
the real request list; US-86 adds the submit button. Nothing here fetches tickets, because
the screens that do are the next two stories.

## AC3 — mostly unbuildable, and it is not being faked

*"You can still browse the knowledge base, but submitting a request prompts you to sign in or
register."*

Both halves depend on things the MVP scope defers:

- **The knowledge base is all of P09** (US-76 to US-80), cut entirely. There is nothing to
  browse.
- **Registration is US-20**, deferred — portal accounts come from the seed.

What ships: `/portal/login` is public and reachable without a session, and an unauthenticated
visit to `/portal` bounces to it rather than into the staff application. There is no "submit a
request" control to gate, because that is US-86.

**AC3 is flagged as unmet.** No placeholder knowledge base, no fake register link.

## Files

| Path | What |
| ---- | ---- |
| `backend/src/auth/auth.service.ts` | `requirePortalAccount`, checked at step 5.5. |
| `backend/src/auth/auth.controller.ts` | `POST /auth/portal/login`. |
| `backend/src/auth/portal-login.test.ts` | **New.** AC1 and AC2 on the server. |
| `frontend/src/features/auth/use-login.ts` | The variant. |
| `frontend/src/features/auth/login-page.tsx` | The variant's copy and error map. |
| `frontend/src/features/auth/require-auth.tsx` | Optional `loginPath`. |
| `frontend/src/features/portal/portal-home-page.tsx` | **New.** The landing page. |
| `frontend/src/features/portal/portal-login.test.tsx` | **New.** AC1, AC2, AC4, states, routing. |
| `frontend/src/app/router.tsx` | The two portal routes. |
| `frontend/src/i18n/locales/{en,ar}.json` | `portal.*`, both languages. |

No migration. No new dependency. **No change to the audience model, the token contents, the
guards, or US-82's enforcement** — the only auth change is the one AC2 requires.

## Tests

Backend (`portal-login.test.ts`):

1. A customer account signs in and the session's audience is `crm-portal`.
2. The token it returns is accepted by a portal endpoint and **refused by a staff endpoint**.
3. A staff account is refused **422**, and **no session row is created** for it.
4. Wrong password on a staff email returns the generic **401** — the specific message is
   only reachable with the correct password.
5. A deactivated customer still returns **403**, not 422.

Frontend (`portal-login.test.tsx`):

6. Successful sign-in posts to `/auth/portal/login` and lands on `/portal`, never `/dashboard`.
7. Invalid credentials render the generic message; the form stays usable.
8. A 422 renders the "staff account" message with a link to the staff login (AC2).
9. The submit button shows a pending state and is disabled while in flight.
10. `/portal` unauthenticated bounces to `/portal/login`; authenticated renders the home page.
11. AC4 — a preserved destination is honoured over `/portal`.
12. Arabic renders with no physical-direction classes.

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 | ✅ a customer signs in at `/portal/login`, the POST goes to `/auth/portal/login`, the session's audience is `crm-portal`, and the landing page is `/portal`. The staff dashboard is asserted **not** to render. |
| AC2 | ✅ a staff account is refused 422 with a message naming the staff workspace, no session row is created, and the form renders a link to `/login`. The generic 401 still covers a wrong password on the same address. |
| AC3 | ❌ **unmet, and unbuildable.** See below. |
| AC4 | ✅ a preserved destination wins over the portal home — `/portal/requests/abc` is reached after sign-in. |

**Verified.** Backend `portal-login.test.js` **6 pass** (new) and `auth.test.js` **22 pass**
(the file whose service this changed). Frontend `portal-login.test.tsx` **10 pass** (new),
`login-page.test.tsx` + `permission-gating.test.tsx` **33 pass** (the staff paths through the
same hook, guard and page). Typecheck clean across all three workspaces; ESLint clean;
Prettier clean.

## AC3 — unmet, and not faked

*"You can still browse the knowledge base, but submitting a request prompts you to sign in or
register."* Both halves depend on deferred work:

- **The knowledge base is all of P09** (US-76–80), cut entirely by the MVP scope. There is
  nothing to browse.
- **Registration is US-20**, deferred — portal accounts come from the seed.
- There is no submit control to gate; that is **US-86**.

What ships toward it: `/portal/login` is public and reachable with no session, and an
unauthenticated visit to `/portal` bounces to it rather than into the staff application. No
placeholder knowledge base and no fake register link were added.

## The one auth change, and why it is the minimum

`AuthService.login` gained an optional `requirePortalAccount` flag, checked at **step 5.5** —
after the password verification, before the session is minted. Nothing else about the
audience model, the token contents, the guards, or US-82's enforcement moved.

Three properties of that placement, each deliberate:

- **After the password**, for the reason step 5's existing comment gives about `isActive`: a
  specific message reachable *before* the password is an account-enumeration oracle. A test
  asserts that a wrong password on a staff address still returns the generic 401.
- **Before the session**, so a refused portal login leaves no session row and no refresh
  cookie. A test asserts the session count is unchanged.
- **`UNPROCESSABLE` (422), not `FORBIDDEN`.** The client switches on the code, and `FORBIDDEN`
  already means "deactivated" on the login form; reusing it would make the two
  indistinguishable. No error code was added to the enum.

**Portal accounts are identified by the `Customer.userId` link**, the same fact US-82 scopes
every portal query on — not by a role name, because roles are configuration and which door an
account may use should not change when somebody reassigns one.

## One component, two audiences

`LoginPage` took a `variant` prop rather than being copied. The form, the shared-schema
resolver with its translated messages, the caps-lock hint, the reveal control and the error
map are identical for both, and duplicating them is how one gets a fix and the other does not.
The staff route renders `<LoginPage />` unchanged, which is why US-14's own tests still pass
untouched.

Same for `RequireAuth`, which gained an optional `loginPath` defaulting to `/login`.

## Two test-harness notes worth keeping

The first two attempts at the error-state tests failed for reasons that had nothing to do with
the code, and both are traps for the next person:

1. **A decorated plain `Error` is not an `AxiosError`.** The response interceptor checks
   `instanceof`, so a hand-rolled rejection falls through to `INTERNAL_ERROR` and the code
   never reaches the error map — every failure reads as "something went wrong".
2. **`ApiErrorSchema` is parsed, not cast.** An envelope missing `statusCode` or `timestamp`
   is discarded wholesale, with the same symptom. The staff login test has an
   `errorEnvelope()` helper that gets both right; this suite now matches it.

## Not built, deliberately

`/portal` is a **landing page**, not US-84's request list, and it fetches nothing. US-84
replaces its card; US-86 adds the submit control. No customer ticket creation of any kind was
implemented.

## Flagged

- **AC3** — unmet, as above. Completes with P09 (knowledge base) and US-20 (registration).
- **`/portal` is a landing page, not the request list.** US-84 owns the list, US-86 the submit
  control. This story deliberately fetches nothing.
- A portal token pointed at a staff *route* renders an error rather than data, because the
  API refuses it (US-82, AC4). Making the staff routes also role-aware in the client is
  cosmetic and is not in this story.
