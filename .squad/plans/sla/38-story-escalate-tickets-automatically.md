# US-71 — Escalate tickets automatically on SLA thresholds

- **Feature:** `sla`
- **Story:** [Escalate tickets automatically on SLA thresholds](https://app.notion.com/p/3c69e0838523819fad3bdb483debad70)
- **Phase / Layer / Release:** P08 SLA & Automation · Backend · MVP · Must have
- **Depends on:** US-68 (the clock) ✅ · **US-62 (notifications) — deferred**
- **Intake:** `.squad/stories/sla/escalate-tickets-automatically/intake.md`
- **MVP position:** 19 of 28

A short plan. The ladder this story climbs was modelled by US-6 and seeded by US-67, and the
scheduler already exists — so the new code is the reader.

## What already exists

- **`SlaEscalationStep`** — `sequence`, `clock`, `atPercent`, `notify`, `notifyUserId`,
  `changeStatusToEscalated`. US-6 wrote it with the comment "consumed by US-71".
- **The ladder is seeded on every default policy** (`default-policies.ts`), exactly the three
  rungs the criteria describe: 75% → assignee, 90% → department manager, 100% → department
  manager **and** the status moves.
- **`Ticket.escalatedAt` and `Ticket.escalatedToId`** — written by nothing so far.
- **`SlaSweepWorker`** — a BullMQ repeatable job, every minute, scheduled once in Redis so two
  replicas do not both sweep. **This story adds a call inside it and no scheduler of its own.**
- **Retry and dead-lettering** — `QueueService` already applies `QUEUE_MAX_ATTEMPTS`,
  exponential backoff, and a dead-letter write on the final failure. Nothing to add; what this
  story owes that infrastructure is *idempotency*, so a retried sweep is harmless.
- **Automation attribution** — `TicketHistoryService` takes `automationRule` **instead of**
  `actorUserId`, which is AC6 already built.

## What this story is

`SlaEscalationService` in `backend/src/sla/sla-escalation.service.ts`, called by the sweep
worker after `clock.sweep()`.

A service of its own rather than more of `SlaClockService`: that file is the clock arithmetic,
and climbing a configured ladder is a different job with a different failure mode. It also
keeps the sweep readable — the worker does two named things in order.

### Threshold detection is a pure function

```ts
export function elapsedPercent(input: { startedAt: Date; dueAt: Date; now: Date }): number
```

`(now − startedAt) / (dueAt − startedAt)`, as a percentage. The same fraction `slaFor` derives
on read and the same one `SlaTimer` shows, so a rung fires when the ticket already *looks* at
risk to the agent. `now` is a parameter, never a `Date.now()` read inside — the sweep already
takes `now` for the same reason.

Pause is handled for free: US-68 pushes `resolutionDueAt` out by the banked pause, so a
paused ticket's percentage stops climbing without this code knowing pause exists.

### AC5 — idempotency, per rung and not just per ticket

**One history entry per rung, and the existence of that entry is the idempotency key.**

`escalatedAt` alone is not enough: it only marks the rung that changes status, so the 75% and
90% rungs would re-fire every minute for hours, which is exactly the "re-notify repeatedly"
AC5 forbids.

Each rung writes `field: 'escalationStep'`, `toValue: String(sequence)`. The check before
acting is a plain indexed query on `(ticketId, field, toValue)` — not a JSON path filter, and
not a new column. `TicketHistory` is append-only with an index on `(ticketId, createdAt)`, so
this is a cheap existence check against a table that already has to be written anyway.

That is also what makes the job safe to retry: a sweep that fails half way and is retried by
BullMQ re-reads the same rungs and skips the ones already recorded.

### AC3 — the status change, respecting the state machine

Only the rung with `changeStatusToEscalated` moves the ticket, and it moves it through the same
rules a person is held to:

- `canTransition(from, 'ESCALATED')` from `@crm/shared` — the map US-47 introduced. A ticket
  that cannot legally reach `ESCALATED` is skipped and logged, never forced.
- Already `ESCALATED`, or `escalatedAt` already set, is skipped (AC5).
- `RESOLVED` and `CLOSED` are excluded by the query, the same `FINISHED_STATUSES` the sweep
  uses.

**It does not call `TicketsService.changeStatus`.** Two reasons, and the first is decisive:
`TicketsModule` already imports `SlaModule`, so reaching back the other way is a circular
dependency. The second is that `changeStatus` is built around an actor — it resolves the
caller's scope and checks `ticket:escalate` — and an automation has no actor, so it would have
to be given a fake one. `statusTimestamps` has nothing to contribute either: moving to
`ESCALATED` sets no `resolvedAt` or `closedAt`.

What it writes instead: `status`, `escalatedAt`, and `escalatedToId` resolved from the rung's
`notify` target — `ASSIGNEE`, `DEPARTMENT_MANAGER` (from `Department.managerId`), or
`SPECIFIC_USER`. That last field is data, not a notification: it records *who the ticket was
escalated to*, which is what the manager dashboard and any later notification will read.

### AC1 and AC2 — the dependency, not a substitute for it

**US-62 is deferred and there is no notification channel. None is invented here.**

The story's own `Depends on` names US-62, and `.squad/plans/00-mvp-scope.md` cuts all of P07.
So for every rung, including the two whose entire purpose is to notify somebody, this story
implements what it can own:

- a history entry naming the rung and attributed to the rule (AC6), which is what the ticket
  timeline shows;
- a structured log line naming the intended recipient and why they were chosen.

The escalation is therefore **visible** — in the ticket's history, in the queue's `escalated`
view, and in the sidebar counts — but nothing is *sent*. AC1 and AC2 are flagged below as
completing with US-62, which will consume exactly these events.

No notification table, no email stub, no fake integration.

### AC4 — the manager dashboard is US-58

"Tickets Requiring Attention" is a US-58 surface and does not exist. What exists today is the
queue's `escalated` view, which an escalated ticket appears in with no new code. Flagged.

## Files

| Path | What |
| ---- | ---- |
| `backend/src/sla/sla-escalation.service.ts` | **New.** `elapsedPercent`, rung selection, the escalation write. |
| `backend/src/sla/sla-escalation.test.ts` | **New.** Thresholds, escalation, idempotency, the negative cases. |
| `backend/src/sla/sla-sweep.worker.ts` | Calls the new service after the clock sweep. |
| `backend/src/sla/sla.module.ts` | Provides and exports it. |
| `backend/src/sla/index.ts` | Barrel. |

No migration. No new dependency. No new scheduler.

## Tests

`sla-escalation.test.ts`, against the existing Postgres harness:

1. **Threshold detection** — `elapsedPercent` at a fixed clock, and rung selection: 74% fires
   nothing, 75% fires rung 0, 90% fires rungs 0 and 1, past 100% fires all three.
2. **Escalation** — a ticket past its resolution target moves to `ESCALATED`, with
   `escalatedAt` set, `escalatedToId` the department manager, and a history entry carrying the
   rule and **no** actor (AC3, AC6).
3. **Already escalated** — running the pass twice leaves one entry per rung, one `escalatedAt`,
   and the status unchanged (AC5, and the retry-safety the queue architecture needs).
4. **Not breached** — a ticket at 10% of its target is untouched, and no history is written.
5. **Finished tickets** — a `RESOLVED` ticket past its target is not escalated.
6. **The state machine holds** — a ticket already in `ESCALATED` is skipped rather than
   re-written, and no illegal transition is attempted.

Run the new file, then one typecheck, ESLint and Prettier. The tickets suite is untouched by
this story and is not re-run.

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 | ⚠️ **the rung fires and records; nothing is sent.** No notification channel exists. The 75% assignee rung crosses, writes history, and logs the intended recipient. **Completes with US-62.** |
| AC2 | ⚠️ same, for the 90% department-manager rung. **Completes with US-62.** |
| AC3 | ✅ a ticket past its target moves to `ESCALATED`, stamps `escalatedAt`, sets `escalatedToId` to the department manager, and writes a history entry for the automated action. |
| AC4 | ⚠️ "Tickets Requiring Attention" is **US-58** and does not exist. Verified that an escalated ticket is in the state the queue's existing `escalated` view selects on. |
| AC5 | ✅ three consecutive passes leave one entry per rung, one `escalatedAt`, and the status unchanged. A ticket already in `ESCALATED` is skipped. |
| AC6 | ✅ the entry carries `automationRule` and `actorUserId` is null. |

**Verified.** `sla-escalation.test.js` **11 pass, 0 fail** (new). Typecheck clean across all
three workspaces; ESLint and Prettier clean. Nothing else was re-run: this story adds a service
and one call inside the existing worker, and touches no other suite's code.

Threshold detection, escalation, already-escalated, non-breached, finished tickets and the
retry path are each covered; the retry path is the same test as AC5, because idempotency *is*
what the queue's retry contract requires of this job.

## No new infrastructure

- The pass runs inside `SlaSweepWorker`'s existing repeatable job — **no second scheduler**.
- `QueueService` already applies max attempts, exponential backoff and a dead-letter write on
  the final attempt. Nothing was added to it.
- No new dependency, no migration, no new queue.

## A bug the first test run caught

Every positive case failed: nothing escalated at all. The cause was `take: 500` with **no
ordering** — an arbitrary slice of every open ticket in the platform, and in a shared test
database the tickets under test were not in it.

Fixed by ordering on `resolutionDueAt` ascending, which is also the correct production
behaviour: a rung is due on the tickets nearest their deadline or already past it, so soonest
first means the bound always covers the ones that matter. Worth recording because of how it
would have failed in production — silently, on the busiest instances, for exactly the late
tickets the story exists to surface.

## Design notes worth keeping

**Idempotency is per rung, not per ticket.** `escalatedAt` marks only the rung that changes
status, so the 75% and 90% warnings would have re-fired every minute for as long as a ticket
stayed late. Each rung writes `field: 'escalationStep'`, `toValue: <sequence>`, and checks for
that row before acting — an indexed lookup on `(ticketId, field, toValue)`, no JSON path
filter and no new column.

**It does not call `TicketsService.changeStatus`.** `TicketsModule` already imports
`SlaModule`, so the reverse is a circular dependency; and `changeStatus` is built around an
actor whose scope and `ticket:escalate` grant it checks, which an automation would have to
fake. It does obey the same state machine: `canTransition(from, 'ESCALATED')` from
`@crm/shared`, with a warning logged rather than a forced write when the move is illegal.

## Flagged — not met, and not to be quietly closed

- **AC1 (agent notified) and AC2 (manager notified)** — no channel exists; P07 and US-62 are
  deferred by the MVP scope. Each rung records history and logs the intended recipient.
  **Completes with US-62.**
- **AC4 (Tickets Requiring Attention)** — that panel is US-58. Escalated tickets already
  surface in the queue's `escalated` view. **Completes with US-58.**
