# US-47 — Change ticket status through valid transitions

- **Feature:** `tickets`
- **Story:** [Change ticket status through valid transitions](https://app.notion.com/p/3c69e0838523817fb81de8253dc35631)
- **Phase / Layer / Release:** P05 Ticket Management · Full-stack · MVP · Must have
- **Depends on:** US-45 (the workspace) — done
- **Intake:** `.squad/stories/tickets/change-ticket-status/intake.md`
- **MVP position:** 17 of 28

---

## What is already built, and what is genuinely new

Worth separating before the approach, because it is lopsided:

- **AC4's SLA half is done.** US-68 wrote `SlaClockService.onStatusChange(id, from, to)` —
  it pauses the resolution clock on `PENDING_CUSTOMER`, stops it on `RESOLVED` / `CLOSED`,
  and adds the banked pause back on resume. **It has never been called.** This story is its
  first caller.
- **AC6 is mostly a matter of restraint.** `STATUS_PRESENTATION` and `StatusBadge` (US-26)
  are already the single renderer, used by the queue and the header. AC6 is satisfied by
  adding no second label and no second colour.
- **`TicketEventType` already has `REOPENED`, `CLOSED` and `ESCALATED`**, and nothing writes
  any of them — the same gap US-48 found with `UNASSIGNED`.
- **`resolvedAt`, `closedAt` and `reopenCount`** are read by the detail payload and written
  by nothing.

What is new: **the transition map**, which does not exist anywhere, and the endpoint that
enforces it.

## Approach

### AC2 — one transition map, in `packages/shared`

`TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]>` goes in
`packages/shared/src/dto/ticket.ts`.

AC2 asks for two things that must not disagree — *"only transitions valid from that state are
offered, and invalid ones are rejected server-side too"*. Two lists would drift, and the
failure mode is the worst kind: the UI offers a move the server refuses, so the agent sees a
red toast for doing what the screen invited. One exported constant, imported by the control
and by the service.

The map:

| From | To |
| ---- | -- |
| `NEW` | `OPEN`, `PENDING_CUSTOMER`, `PENDING_INTERNAL`, `ESCALATED`, `RESOLVED`, `CLOSED` |
| `OPEN` | `PENDING_CUSTOMER`, `PENDING_INTERNAL`, `ESCALATED`, `RESOLVED`, `CLOSED` |
| `PENDING_CUSTOMER` | `OPEN`, `PENDING_INTERNAL`, `ESCALATED`, `RESOLVED`, `CLOSED` |
| `PENDING_INTERNAL` | `OPEN`, `PENDING_CUSTOMER`, `ESCALATED`, `RESOLVED`, `CLOSED` |
| `ESCALATED` | `OPEN`, `PENDING_CUSTOMER`, `PENDING_INTERNAL`, `RESOLVED`, `CLOSED` |
| `RESOLVED` | `OPEN`, `CLOSED` |
| `CLOSED` | `OPEN` |

Three decisions inside that table:

- **`NEW` is never a target.** It means "nobody has looked at this yet", which stops being
  true the moment somebody does. A ticket cannot become un-triaged.
- **`NEW → CLOSED` is allowed** without passing through `RESOLVED`. Spam and duplicates are
  closed, not resolved, and forcing them through `RESOLVED` would put them in the resolution
  statistics as work done.
- **`CLOSED → OPEN` is allowed** for staff. A ticket closed by mistake has to be undoable,
  and the alternative is an agent raising a duplicate to correct the record. The *customer*
  reopening a closed ticket is US-90 and stays deferred.

AC1 wants all seven **offered** in the control. The control lists all seven and disables the
ones the map does not permit from the current status, rather than hiding them — the same
choice US-48 made for unavailable agents, and for the same reason: an agent who cannot see
`RESOLVED` from `NEW` learns nothing, while one who sees it greyed learns the shape of the
lifecycle. The current status is shown as selected and is never a target of itself.

### AC2 — `PATCH /tickets/:id/status`, beside `/assignee`

The route US-40's comment has been promising: *"moving a ticket through its lifecycle is
US-47's transition endpoint, which validates that the move is legal"*. `PATCH /tickets/:id`
already refuses `status` and has a test saying so.

**The guard is `ticket:update`, and two targets need more than the guard can express.** The
catalogue already distinguishes them:

- `ticket:close` — "Resolve or close a ticket" → required for `RESOLVED` and `CLOSED`
- `ticket:escalate` — "Escalate a ticket" → required for `ESCALATED`

Both are checked **in the service**, not by a second guard.

This is deliberately *not* what I did for assignment last story, so the difference is worth
being explicit about. There, the whole action needed a permission the route did not require,
so the route was wrong. Here every status change requires `ticket:update` — that is a floor a
guard states declaratively — and two particular destinations require an additional grant.
That is a property of the transition, so it belongs in the state machine with the rest of the
transition rules. Splitting `/resolve` and `/escalate` into endpoints of their own would
scatter one state machine across three doors, which is the thing US-40 warned about.

An agent who lacks the extra grant is refused **403**, and the frontend disables those
options rather than offering them.

### AC3 — warned, not prevented

*"I am warned before confirming, to prevent silent closures."*

**The server does not refuse this, and that is the criterion read as written.** "Warned
before confirming" is a confirmation step, and resolving without a reply on the ticket is
sometimes exactly right: an agent who fixed it on the phone, or a duplicate. A server that
refused would make those cases impossible and would push agents into writing a hollow "as
discussed" reply to get past it — which produces the silent closure the criterion is trying
to prevent, with a sentence stapled on.

So: `ConfirmDialog` (US-27) opens when the target is `RESOLVED` and the ticket carries no
customer-facing agent reply. Every other transition saves immediately.

**How the screen knows.** `firstRespondedAt` is added to `TicketSlaSchema` and the detail
payload. US-68 already sets that column on the first customer-facing agent reply — internal
notes deliberately excluded — so it is exactly the fact AC3 needs, and it does not require
counting messages in the client or a new field with its own rules. Null means no reply has
gone out.

### AC4 — the side effects, all in one transaction-shaped method

`TicketsService.changeStatus` does, in order: validate the transition, validate the extra
permission, write the status with its timestamps, tell the clock, write history.

**Timestamps.** `resolvedAt` on entering `RESOLVED`, `closedAt` on entering `CLOSED`, both
cleared on a move back out to `OPEN`, and `reopenCount` incremented when the ticket leaves
`RESOLVED` or `CLOSED` for `OPEN`. Nothing writes these today, and P11's reports are the
reason they exist.

**The clock** is `clock.onStatusChange(id, from, to)` — already written, already tested by
US-68's own suite. This story adds the call and a test that the observable effect happens
through the endpoint, rather than re-testing the arithmetic.

**History** gets the event type the change actually is, which means the three unused enum
values start being written:

| Transition | Event |
| ---------- | ----- |
| → `RESOLVED` | `STATUS_CHANGED` — the enum has no `RESOLVED`, which US-50 flagged |
| → `CLOSED` | `CLOSED` |
| → `ESCALATED` | `ESCALATED` |
| `RESOLVED`/`CLOSED` → `OPEN` | `REOPENED` |
| anything else | `STATUS_CHANGED` |

`fromValue` / `toValue` carry the statuses, which are already legible, so no US-48 label is
needed. The mapping goes beside `eventFor` in `ticket-history.service.ts` — one place decides
what an event is called.

### AC5 — the rule, without its trigger

*"Given a customer replies to a Resolved ticket…"* — **nothing in the codebase writes a
customer message.** `addMessage` is the staff composer and hardcodes `senderType: 'AGENT'`;
the portal reply endpoint is US-85, in wave 4.

So this story builds the rule as `TicketsService.onCustomerReply(ticketId)` — reopens a
`RESOLVED` ticket to `OPEN`, increments `reopenCount`, clears `resolvedAt`, restarts the clock
through the same `onStatusChange`, and writes a `REOPENED` entry attributed to no actor
because no member of staff did it — and tests it directly.

This is the same shape as US-1's AC5: the rule is written and tested here, and US-85 supplies
the caller. The alternative — waiting for wave 4 — would mean the reopen logic is written by
the portal story, which is the wrong owner for a lifecycle rule.

`CLOSED` deliberately does **not** auto-reopen on a customer reply. A closed ticket is a
finished conversation, and US-90 is the story that decides what a customer may do to one.

**"and the assigned agent is notified"** has no channel — P07 is deferred, exactly as for
US-48 AC1. The reopen appears in the agent's queue and sidebar badge, and a log line records
it. Flagged below.

### AC6 — no second renderer

`StatusBadge` and `STATUS_PRESENTATION` stay the only source of a status's label, icon and
colour. The new control reads its options from the same map, so a status added later appears
everywhere at once. The test asserts the control's option label for each status equals the
badge's — a real assertion rather than a promise, because "consistent everywhere" is
otherwise the kind of criterion that quietly rots.

Status is already communicated by **text plus icon**, never colour alone, which the
definition of done requires and `DomainBadge` already does.

---

## Files

| Path | What |
| ---- | ---- |
| `packages/shared/src/dto/ticket.ts` | `TICKET_TRANSITIONS`, `canTransition()`, `ChangeTicketStatusSchema`; `firstRespondedAt` on `TicketSlaSchema`. |
| `packages/shared/src/index.ts` | Exports. |
| `backend/src/tickets/dto/ticket.dto.ts` | `ChangeTicketStatusDto`. |
| `backend/src/tickets/tickets.service.ts` | `changeStatus`, `onCustomerReply`, `firstRespondedAt` in the SLA mapping. |
| `backend/src/tickets/tickets.controller.ts` | `PATCH /tickets/:id/status`. |
| `backend/src/tickets/ticket-history.service.ts` | The status event mapping, beside `eventFor`. |
| `backend/src/tickets/tickets.test.ts` | AC1–AC6 on the server. |
| `frontend/src/features/tickets/ticket-status.tsx` | **New.** The control, with AC3's dialog. |
| `frontend/src/features/tickets/ticket-status.test.tsx` | **New.** AC1, AC2, AC3, AC6. |
| `frontend/src/features/tickets/ticket-header.tsx` | The last read-only pill becomes a control. |
| `frontend/src/i18n/locales/{en,ar}.json` | `ticket.status.*` additions, both languages. |

No migration. No new dependency.

## Shapes

```ts
// packages/shared/src/dto/ticket.ts
export const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  NEW: ['OPEN', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  OPEN: ['PENDING_CUSTOMER', 'PENDING_INTERNAL', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  PENDING_CUSTOMER: ['OPEN', 'PENDING_INTERNAL', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  PENDING_INTERNAL: ['OPEN', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  ESCALATED: ['OPEN', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'CLOSED'],
  CLOSED: ['OPEN'],
};

/** The permission a destination needs on top of `ticket:update`. */
export const STATUS_PERMISSION: Partial<Record<TicketStatus, PermissionKey>> = {
  RESOLVED: 'ticket:close',
  CLOSED: 'ticket:close',
  ESCALATED: 'ticket:escalate',
};

export const ChangeTicketStatusSchema = z.object({ status: TicketStatusSchema });
```

## Test plan

Backend (`tickets.test.ts`, the existing Postgres harness):

1. A legal transition saves and answers the updated ticket.
2. An illegal one (`RESOLVED → PENDING_CUSTOMER`) is refused 422 and nothing moves.
3. `NEW` is never accepted as a target.
4. Re-sending the current status is a no-op and records nothing.
5. `PATCH /tickets/:id` still refuses `status` (the existing test, still passing).
6. Resolving without `ticket:close` is 403; with it, 200.
7. Escalating without `ticket:escalate` is 403.
8. → `PENDING_CUSTOMER` sets `slaPausedAt`; moving back to `OPEN` clears it and pushes
   `resolutionDueAt` out by the paused interval (AC4, through the endpoint).
9. → `RESOLVED` sets `resolvedAt`; → `CLOSED` sets `closedAt`.
10. `RESOLVED → OPEN` increments `reopenCount`, clears `resolvedAt`, writes `REOPENED`.
11. → `CLOSED` writes `CLOSED`; → `ESCALATED` writes `ESCALATED`; an ordinary move writes
    `STATUS_CHANGED`.
12. `onCustomerReply` on a `RESOLVED` ticket reopens it with a `REOPENED` entry and **no
    actor** (AC5's rule, without its trigger).
13. `onCustomerReply` on an `OPEN` ticket changes nothing, and on a `CLOSED` one changes
    nothing.
14. `firstRespondedAt` is null until a customer-facing reply, and set after one — the fact
    AC3 depends on.

Frontend (`ticket-status.test.tsx`):

15. All seven statuses appear in the control (AC1).
16. Only the map's targets are selectable; the rest are disabled, and the reason is in words
    (AC2).
17. Options needing a permission the user lacks are disabled (AC2, the frontend half).
18. Resolving a ticket with `firstRespondedAt: null` opens the confirmation; confirming sends
    the PATCH, dismissing sends nothing (AC3).
19. Resolving a ticket that *has* a reply sends immediately, with no dialog (AC3).
20. Each option's label matches `STATUS_PRESENTATION` (AC6).
21. Arabic renders with no physical-direction classes.

Per the cost budget: the two touched workspaces only, then one typecheck and one lint.

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 | ✅ all seven statuses are listed and named from `STATUS_PRESENTATION`. |
| AC2 | ✅ legal moves save; `RESOLVED → PENDING_CUSTOMER` is 422 with nothing moved; `NEW` is never a target; re-sending the current status records nothing. The control disables what the shared map forbids and says why in words. |
| AC3 | ✅ the confirmation opens only when `firstRespondedAt` is null, sends nothing until confirmed, and is skipped entirely once a reply exists. **Warned, not prevented** — see the approach. |
| AC4 | ✅ `PENDING_CUSTOMER` sets `slaPausedAt`; returning to `OPEN` clears it and pushes the deadline out; `resolvedAt` / `closedAt` are written; reopening clears them and increments `reopenCount`; `CLOSED`, `ESCALATED` and `REOPENED` are now written as their own event types. |
| AC5 | ⚠️ **the rule is built and verified; its trigger does not exist.** `onCustomerReply` reopens a `RESOLVED` ticket with a `REOPENED` entry and no actor, and leaves `OPEN` and `CLOSED` alone. Nothing calls it until US-85. The notification has no channel. Both flagged. |
| AC6 | ✅ one label per status, from the single presentation map the queue badge already reads. Verified for every surface that exists; there are no notifications or reports yet. |

**Verified.** Backend `tickets.test.js` **71 pass, 0 fail** (12 new). Frontend
`ticket-status.test.tsx` **8 pass**. Typecheck clean across all three workspaces; ESLint and
Prettier clean.

Per the cost budget this run was deliberately narrow: the one backend suite and the one new
frontend file, rather than every workspace. `ticket-history.test.ts` was not re-run — nothing
in it changed, and `statusEventFor` has no caller inside it.

## A fixture bug the first run caught

Seven tests failed on the first run, all of them touching `RESOLVED` or `CLOSED`. The cause
was the test harness's manager role, which grants `ticket:view`, `create`, `update` and
`assign` and **not** `ticket:close` — so the new permission check refused it, correctly.

Worth recording because of what it demonstrates: the gate works, and the fixture had drifted
from the real catalogue, where a manager holds `ticket:close` and `ticket:escalate`. The
fixture was corrected rather than the check loosened.

## Deviation from the plan

The plan listed 21 tests; 20 were written and one was dropped. **"Escalating without
`ticket:escalate` is 403"** is not covered on the server: the mechanism is identical to the
`ticket:close` check that *is* covered, through the same `STATUS_PERMISSION` lookup and the
same three lines, so a second test asserts the table has two rows rather than asserting new
behaviour. The frontend disables both. Said plainly rather than counted as done.

## Flagged — not met, and not to be quietly closed

- **AC5's trigger** — the rule is built and tested; nothing writes a customer message until
  US-85 (wave 4) calls `onCustomerReply`. The criterion completes there.
- **AC5, "the assigned agent is notified"** — no notification channel; P07 deferred. Logged,
  and visible in the queue and sidebar badge. Completes with US-62.
- **AC6's "notification, or report"** — there are no notifications and no reports yet (P07
  and P11 both out of the slice). The claim is verified for every surface that exists: queue,
  workspace header, and this control.

## What the next stories inherit

- **US-71** escalates by moving a ticket to `ESCALATED`, and should call `changeStatus` so it
  gets the transition check, the timestamps and the history entry rather than writing the
  column directly. It attributes to an automation rule instead of an actor, which
  `TicketHistoryService` already supports.
- **US-85** calls `onCustomerReply` after inserting the customer's message, which completes
  AC5.
- **US-90** (portal reopen, deferred) decides what a customer may do to a `CLOSED` ticket;
  this story deliberately leaves that transition to staff only.
- **US-55 / US-58** count by status, and `resolvedAt` / `closedAt` / `reopenCount` start
  carrying real values from here.
