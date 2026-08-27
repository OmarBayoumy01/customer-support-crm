# portal — plan overview

Entry point for the **customer portal**. Five of the twenty-eight stories in
[`../00-mvp-scope.md`](../00-mvp-scope.md) live here — US-21, US-82, US-86, US-84, US-85 —
and together they close the loop: a customer raises a request and sees the answer.

## Stories

| NN  | File | Title | Tracker id | Depends on |
| --- | ---- | ----- | ---------- | ---------- |
| 39  | `39-story-customer-scoped-portal-api.md` | Build the customer-scoped portal API | US-82 | US-40 |
| 40  | `40-story-sign-in-to-the-customer-portal.md` | Sign in to the customer portal | US-21 | US-14, US-82 |
| 41  | `41-story-submit-a-support-request.md` | Submit a support request | US-86 | US-82 |
| 42  | `42-story-track-my-requests.md` | Track my requests in the portal | US-84 | US-82 |
| 43  | `43-story-read-and-reply-to-my-request.md` | Read and reply to my request | US-85 | US-82, US-47 |

## Why this feature exists as its own module

**The portal is a separate API surface, not a flag on the staff one.** A shared controller
deciding what to serialise from a boolean is one `if` away from serving an internal note to
a customer, and that is the failure the project's first non-negotiable rule exists to
prevent.

So `backend/src/portal/` has its own controller, its own passport strategy pinned to the
`crm-portal` audience, its own allowlist DTOs in `packages/shared/src/dto/portal.ts`, and
its own rate limit. Nothing in it is a variation on a staff endpoint.

## The rule, and the five places it is enforced

Non-negotiable rule #1 — *an internal note must never reach a customer* — is enforced in the
query and in the contract, never in the client:

1. **Messages** — `isInternal: false` in the `where`.
2. **Counts** — the same `where`, so a total cannot disclose what the list omitted.
3. **Attachments** — selected through the message, because `Attachment` has no `isInternal`
   of its own and the staff detail selects them off the ticket.
4. **History** — absent from the contract entirely; there is nothing to filter.
5. **The contract** — hand-written allowlists, never `omit`s of the staff DTO. An omit list
   is a denylist that does not know about the next field somebody adds.

`backend/src/portal/portal.test.ts` opens with the regression test the rule demands, asserted
against the serialised JSON.

## Locked decisions

- **Ownership is not the `OWN` permission scope.** US-13's scope produces the right clause,
  but a permission scope is *configuration* — an administrator who granted a customer-facing
  role `ticket:view` at `ALL` would silently widen the portal to every ticket in the
  platform. The portal resolves `Customer.userId → customerId` from the authenticated token
  and filters on it unconditionally. No linked customer means 403, never "no filter".
- **`@Public()` and `@UseGuards(PortalAuthGuard)` are a pair.** The global `JwtAuthGuard` is
  pinned to `crm-staff`, so a portal route needs `@Public()` to reach its own guard — and
  `@Public()` alone would leave it open to the internet. The 401 test is what stands between
  a refactor and an open endpoint.
- **Somebody else's request answers 404**, not 403. A 403 confirms it exists.
- **One Redis, no throttling library.** The counter must be shared across replicas to mean
  anything, and it fails open like the login throttle — a portal returning 429 to everyone
  through a Redis outage is the worse failure.

## What the next stories inherit

- **US-86** ✅ added `POST /portal/tickets` and `GET /portal/categories`, both through the
  same `scopeFor` — so the write inherits the guard, the audience, the throttle and the
  scope. Its request schema has no `customerId`, `channel`, `departmentId`, `tags` or
  `status`: a contract with nothing to disagree about beats a check that the body matches
  the token.
- **US-84** ✅ is the list screen. It added `q`, `createdFrom` and `createdTo` to the list
  query — and nothing else, because AC2 says only search, status and date and the contract
  is how that becomes true. `q` searches the subject and number, never message bodies.
- **US-85** ✅ closed the loop. It added a customer reply, an event allowlist for AC6 that
  returns a *kind* rather than a history entry, and the first caller for US-47's
  `onCustomerReply` — which reopens a resolved request and deliberately not a closed one.
- **The portal feature is complete for the MVP.** What remains behind it: US-88 rating,
  US-90 customer reopen, US-83 a separate portal home, US-51 attachments, all deferred.
- **US-21** ✅ built the sign-in over this boundary: `POST /auth/portal/login` issues the
  `crm-portal` token, and a staff account is refused 422 because it has no linked
  `Customer` row — the same fact this API scopes on.
