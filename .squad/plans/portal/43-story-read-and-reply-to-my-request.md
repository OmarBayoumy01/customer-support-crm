# US-85 — Read and reply to my request

- **Feature:** `portal`
- **Story:** [Read and reply to my request](https://app.notion.com/p/3c69e08385238101af5ceb810c21655f)
- **Phase / Layer / Release:** P10 Customer Portal · Frontend · MVP · Must have
- **Depends on:** US-82 ✅
- **Intake:** `.squad/stories/portal/read-and-reply-to-my-request/intake.md`
- **MVP position:** 24 of 28

**This closes the loop.** After it, the whole journey runs: a customer raises a request, an
agent works it, the customer reads the answer and replies, and the reply reopens a resolved
request through the rule US-47 built and left waiting for a caller.

## The story

> **As a** customer **I want** to read and reply to my request thread **So that** I can
> continue the conversation with support.

| AC | Requirement |
| -- | ----------- |
| **AC1** | My messages and support's appear as a **simple two-sided thread with timestamps**. |
| **AC2** | Internal notes are **absent entirely**, and **no internal attachment is listed or downloadable**. |
| **AC3** | A support reply shows a **first name and avatar only**, not full staff details. |
| **AC4** | The header shows a **Received → In Progress → Resolved** indicator **replacing SLA timers**. |
| **AC5** | The composer offers a plain text area, an **attachment button**, and Send — **no mode switcher, no canned replies**. |
| **AC6** | A status change reads as **plain language**, such as *"Your request was assigned to a support agent"*. |

## What already exists

- **`GET /portal/tickets/:id`** — the conversation, `isInternal: false` in the `where`,
  attachments selected **through the message**, ownership in the same query, and the count
  taken from the filtered set. AC2 is already built and has the rule #1 regression test.
- **`authorName` is a first name for staff** — AC3's limit, already in the contract.
- **No SLA anywhere in the portal contract** — AC4's "replacing SLA timers" is already true by
  omission; what is missing is the indicator itself.
- **`TicketsService.onCustomerReply`** — US-47's reopen rule. Built, tested, and **called by
  nothing**. This story is its first caller.

## The reopen rule — verified, not reinvented

Read from `backend/src/tickets/tickets.service.ts` as it stands:

```
RESOLVED  →  OPEN, escalatedAt untouched, resolvedAt cleared,
             reopenCount + 1, REOPENED history with actorUserId: null,
             clock restarted via onStatusChange('RESOLVED', 'OPEN')

anything else  →  returns early, changes nothing
```

**That is the transition, and this story uses it exactly.** `CLOSED` deliberately does not
auto-reopen — US-47 recorded that decision, and US-90 owns what a customer may do to a closed
request. No new state, no new transition, no change to `TICKET_TRANSITIONS`.

### One consequence of that rule, and one interpretation

**A reply to a `CLOSED` request is refused with 422**, and the composer is not rendered for a
closed request.

This is not a new lifecycle rule — nothing transitions and nothing is added to the state
machine. It is the portal declining to accept a message that would go nowhere: a closed ticket
is in no open queue, so a reply that left it closed would be a black hole with a success
toast. Refusing says so plainly. **Flagged as an interpretation**, and US-90 is the story that
gives a customer a way back in.

**A reply to a `PENDING_CUSTOMER` request does not move it to `OPEN`.** `onCustomerReply`
handles `RESOLVED` and nothing else, so the request keeps reading "Waiting on you" after the
customer has in fact replied. That looks wrong on the screen and it is arguably a gap in
US-47's rule — but adding `PENDING_CUSTOMER → OPEN` here would be inventing a lifecycle rule
in a story that was told not to. **Reported as a finding, behaviour left as US-47 defined it.**

## Approach

### The reply endpoint

`POST /portal/tickets/:id/messages`, body `{ body }` **and nothing else**.

Three values the server sets and the body cannot influence:

| Field | Value | Why |
| ----- | ----- | --- |
| `isInternal` | **hardcoded `false`** | Not defaulted, not read from the body. A customer-authored internal note is a contradiction, and the flag that the whole of rule #1 hangs on must not be reachable from the portal. |
| `senderType` | `CUSTOMER` | What it is. |
| `authorCustomerId` | the resolved customer | AC's attribution, from the token. |

Ownership is in the same query that finds the ticket, so there is no window between checking
and writing. `lastCustomerReplyAt` is set — the column has existed since US-6 and nothing has
written it; it is denormalisation, not a lifecycle rule.

Then `tickets.onCustomerReply(id)`, unchanged.

### AC6 — plain-language events, as a narrow allowlist

This is the one place the story pushes against US-82's "no internal history", so the shape
matters.

**Not the history feed.** A new `PortalEventSchema` of `{ id, kind, createdAt }`, where `kind`
is one of a closed set the client renders into a sentence:

```
received · assigned · in_progress · waiting_on_you · resolved · closed · reopened
```

What that deliberately does **not** carry: no actor name (AC3 limits identity, and the story's
own example sentence names nobody), no `fromValue`/`toValue`, no field name, no internal status
string, and no event the customer has no business seeing.

Derived server-side from `TicketHistory` with an allowlist, not a denylist:

- `CREATED` → `received`
- `ASSIGNED` → `assigned`
- `REOPENED` → `reopened`
- `CLOSED` → `closed`
- `STATUS_CHANGED` → mapped **through `PORTAL_STATUS`**, and emitted only when the *portal*
  status actually changed. So `OPEN → PENDING_INTERNAL` produces nothing (both are "In
  Progress"), and `→ ESCALATED` produces nothing at all.
- **everything else is dropped**: `PRIORITY_CHANGED`, `CATEGORY_CHANGED`,
  `DEPARTMENT_CHANGED`, `ESCALATED`, `SLA_BREACHED`, `UNASSIGNED`.

The sentences live in the client's i18n, so the API sends a kind and never prose to translate.

### AC4 — the progress indicator

Three steps, derived in the client from the portal status it already has:

| Portal status | Step |
| ------------- | ---- |
| `OPEN` | Received |
| `IN_PROGRESS`, `WAITING_ON_YOU` | In Progress |
| `RESOLVED`, `CLOSED` | Resolved |

No new field. And no SLA timer to replace, because the portal contract has never carried one —
AC4's second half is satisfied by an absence that already exists.

### AC1, AC3, AC5 — the screen

`/portal/requests/:id`. A two-sided thread: the customer's messages on the inline-end side,
support's on the inline-start, each with a timestamp — `ms`/`me` and `self-start`/`self-end`,
so Arabic mirrors without a directional class. Support messages carry an `Avatar` with the
first initial and the first name; nothing else about the agent exists in the payload to leak.

The composer is a `Textarea` and a Send button. **No mode switcher** — the staff composer's
internal-note tab is exactly what AC5 forbids here, and there is no `isInternal` in the
request contract for one to toggle.

**AC5's attachment button is not built.** Object storage is US-51, deferred; a button that
cannot upload is worse than none, the same call US-86 made. Flagged.

US-84's cards become links now that there is somewhere to go.

## Files

| Path | What |
| ---- | ---- |
| `packages/shared/src/dto/portal.ts` | `PortalEventSchema`, `events` on the detail, `PortalReplySchema`. |
| `backend/src/portal/portal.service.ts` | `events()`, `reply()`. |
| `backend/src/portal/portal.controller.ts` | `POST /portal/tickets/:id/messages`. |
| `backend/src/portal/dto/portal.dto.ts` | `PortalReplyDto`. |
| `backend/src/portal/portal-reply.test.ts` | **New.** Reply, attribution, reopen, boundary. |
| `frontend/src/features/portal/portal-request-page.tsx` | **New.** Thread, progress, composer. |
| `frontend/src/features/portal/portal-request.test.tsx` | **New.** AC1, AC3, AC4, AC5, AC6. |
| `frontend/src/features/portal/use-portal.ts` | `usePortalRequest`, `usePortalReply`. |
| `frontend/src/features/portal/portal-requests.tsx` | The cards become links. |
| `frontend/src/app/router.tsx` | `/portal/requests/:id`. |
| `frontend/src/i18n/locales/{en,ar}.json` | `portal.request.*`, both languages. |

No migration. No new dependency. No change to the guard, the audience, the throttle, or
`TICKET_TRANSITIONS`.

## Tests

Backend (`portal-reply.test.ts`), against the serialised response and the rows:

1. A customer replies; the row is `senderType: CUSTOMER`, `isInternal: false`,
   `authorCustomerId` the caller's customer.
2. **`isInternal: true` in the body cannot make an internal note** — the field does not exist
   in the contract, and the stored row is still `false`.
3. Replying to **somebody else's** request is 404.
4. A reply to a `RESOLVED` request **reopens it**: status `OPEN`, `reopenCount` incremented,
   `resolvedAt` cleared, a `REOPENED` entry with **no actor** — US-47's rule, through the
   portal.
5. A reply to an `OPEN` request changes the status not at all.
6. A reply to a `CLOSED` request is **422**, and no message is written.
7. The reply appears in the customer's own thread, and the internal note on the same ticket
   still does not — the rule #1 assertion, on the write path.
8. Unauthenticated is 401; a staff token is 401.
9. The reply response carries no internal fields.
10. AC6 — the events list contains `received` and `assigned`, and **not** the priority change,
    the category change or the escalation that also happened on the ticket.
11. AC6 — `OPEN → PENDING_INTERNAL` emits no event, because the portal status did not change.

Frontend (`portal-request.test.tsx`):

12. AC1 — both sides of the thread render with timestamps.
13. AC2 — an internal note in a fixture is never rendered (defence in depth on the client).
14. AC3 — a support message shows a first name and an avatar, and no surname or email.
15. AC4 — the three-step indicator marks the right step, and no SLA wording appears.
16. AC5 — a textarea and Send, and **no** mode switcher or canned-reply control.
17. AC6 — an event renders as a sentence, not as an event name.
18. Sending posts the body and clears the composer; a failure keeps the text.
19. A closed request renders the thread with no composer.
20. Arabic renders with no physical-direction classes.

## Acceptance criteria — verification

| AC | Result | Depends on |
| -- | ------ | ---------- |
| AC1 | ✅ a two-sided thread — the customer's messages on the inline end, support's on the inline start, each with a name and a timestamp, interleaved with the events in time order. | — |
| AC2 | ✅ an internal note **and an attachment on it** stay invisible through the read *and* through the reply response, asserted against the serialised JSON. The count comes from the filtered query, so it cannot betray what was filtered. | — |
| AC3 | ✅ a first name and an avatar initial. The surname and the email address are asserted absent from the whole payload. | — |
| AC4 | ✅ Received → In Progress → Resolved, derived from the portal status, with a tick on reached steps rather than colour alone. **No SLA wording anywhere** — asserted, and true because the portal contract has never carried one. | — |
| AC5 | ⚠️ **the text area and Send are there; the attachment button is not.** Object storage is US-51, deferred. No mode switcher and no canned replies, asserted by absence. | US-51 |
| AC6 | ✅ events read as sentences — "We received your request", "Your request was assigned to a support agent" — from a **kind** the API sends, with the prose in the client's translations. | — |

**Verified.** Backend `portal-reply.test.js` **18 pass, 0 fail** (new), and the three earlier
portal suites **44 pass** unchanged. Frontend: all four portal suites **49 pass**
(`portal-request.test.tsx` 15 new). Typecheck clean across all three workspaces; ESLint clean;
Prettier clean. No new dependency, no migration.

## US-47's reopen rule — used exactly as written

Read from the source before implementing, and called for the first time:

- **`RESOLVED` → `OPEN`**, `resolvedAt` cleared, `reopenCount` incremented, a `REOPENED` entry
  with **`actorUserId: null`**, and the clock restarted through `onStatusChange`. All five
  asserted through the portal endpoint.
- **`OPEN` → unchanged**, `reopenCount` still 0. Asserted.
- **`CLOSED` → not reopened**, per US-47's own recorded decision.

**No new state, no new transition, no change to `TICKET_TRANSITIONS`.**

## The identity, and the flag rule #1 hangs on

`customerId` comes from `scopeFor` — the portal token — and the ticket is found by
`{ id, customerId }` in one query, so there is no window between checking and writing.

Three values the server sets on the message and the body cannot influence:
`isInternal` is **hardcoded `false`** (not defaulted, and absent from `PortalReplySchema`),
`senderType` is `CUSTOMER`, and `authorCustomerId` is the resolved customer. Tests post
`isInternal: true`, `senderType: 'AGENT'` and `customerId: <another customer>` in one body and
assert the stored row is unaffected by all three.

## AC6 without undoing AC2

The one place this story pushes against US-82's "no internal history", so it is an allowlist
returning a **kind**, never an entry:

- `CREATED` → received · `ASSIGNED` → assigned · `REOPENED` → reopened · `CLOSED` → closed
- `STATUS_CHANGED` mapped **through `PORTAL_STATUS`**, emitted only when the *customer-facing*
  status moved — so `OPEN → PENDING_INTERNAL` produces nothing, both being "In Progress"
- everything else dropped: priority, category, department, escalation, SLA breach, unassignment

A test plants six entries — two visible, four not — and asserts the events are exactly
`['received', 'assigned']`, that no internal event name or value appears in the payload, and
that the event objects carry no `actorName`, `field`, `fromValue` or `toValue`.

## Deviations and interpretations

**1. A reply to a `CLOSED` request is refused (422), and no composer is rendered.** Not a new
lifecycle rule — nothing transitions. US-47 declines to reopen a closed request, so a reply
would sit in a ticket that is in no open queue: a message nobody is coming for, acknowledged
with a success toast. Refusing says so instead. **US-90 owns the customer's route back in.**

**2. A reply does not clear `WAITING_ON_YOU` — reported, not fixed.** `onCustomerReply` handles
`RESOLVED` and nothing else, so a request in `PENDING_CUSTOMER` still reads "Waiting on you"
after the customer has replied. That looks wrong on the screen and is arguably a gap in US-47's
rule, but adding `PENDING_CUSTOMER → OPEN` would be inventing a lifecycle rule. **Behaviour
left exactly as US-47 defined it; flagged for whoever owns that rule.**

**3. `lastCustomerReplyAt` is now written.** A column US-6 added that nothing had ever set.
Denormalisation for "waiting on us versus waiting on them", not a lifecycle rule.

**4. US-84's cards became links**, now that there is somewhere to go.

## Flagged

- **AC5's attachment button** — unmet. Needs US-51 object storage, deferred.
- **A reply to a `CLOSED` request is refused** — an interpretation, since US-47 declines to
  reopen one and US-90 owns the customer's route back in.
- **A reply does not clear `WAITING_ON_YOU`** — a gap in US-47's `onCustomerReply`, reported
  rather than fixed here, because fixing it means adding a lifecycle rule.
- **Rating (US-88) and reopen-on-demand (US-90)** stay out.
