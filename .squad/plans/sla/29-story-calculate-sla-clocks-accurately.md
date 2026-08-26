# US-68 — Calculate SLA clocks accurately

- **Feature:** `sla`
- **Story:** [Calculate SLA clocks accurately](https://app.notion.com/p/3c69e0838523810a969ed02368688be3)
- **Phase / Layer / Release:** P08 SLA & Automation · Backend · MVP · Must have
- **Depends on:** US-67 (policies) and US-10 (Redis and BullMQ) — both done
- **Intake:** `.squad/stories/sla/calculate-sla-clocks-accurately/intake.md`
- **MVP position:** 10 of 28 — the last of wave 1

---

## AC2 is not being built, and that was agreed

**AC2 — Business hours** requires "time outside working hours and on configured holidays is
excluded". The calendar it would read is **US-75**, which `.squad/plans/00-mvp-scope.md`
defers with the note *"Policies seeded; 24/7 clock accepted"*.

So this story ships a 24/7 clock, AC2 is **not met**, and it is not marked done. The flag it
would read (`SlaPolicy.businessHoursOnly`) exists and is `false` on every seeded policy —
deliberately, so that no historic ticket looks mismeasured the day US-75 lands. See "What
US-75 has to do" at the bottom.

The other five criteria are built and tested.

## Approach

### The model: absolute deadlines plus accumulated pause

US-6 denormalised `firstResponseDueAt` and `resolutionDueAt` onto the ticket as absolute
timestamps, and US-67 leaned on that for its AC4. This story keeps that model rather than
switching to elapsed-time accounting, and adds two columns:

```prisma
slaPausedAt DateTime?   // set while the resolution clock is stopped
slaPausedMs Int         // accumulated, so a recomputation can honour past pauses
```

A deadline is therefore always `start + target + everything the clock was paused for`. Two
consequences worth stating:

- Reading the SLA state stays free. `TicketsService.slaFor()` has derived
  `ok`/`warn`/`breach` from these columns since US-40 and needs no change at all — it starts
  answering something other than `none` the moment these deadlines are written.
- Nothing has to be recomputed on read, which is the point of the technical note on the
  story ("store computed deadlines rather than deriving on every read").

### AC1 — clock start

`TicketsService.create` resolves the policy through `SlaPolicyService.resolveFor` — the same
call US-120's seeder makes — and writes the policy id and both deadlines. A ticket whose
facts match no policy simply has none, which `SlaStateSchema` has called `none` since US-40.

### AC3 — pause and resume

Entering `PENDING_CUSTOMER` stamps `slaPausedAt`. Leaving it adds the elapsed time to
`slaPausedMs` **and pushes `resolutionDueAt` forward by the same amount**.

Only the resolution clock pauses. The first-response clock does not: a ticket that is
waiting on the customer has by definition already had an agent reply, so its response clock
has already stopped for good.

### AC4 — response satisfied

`firstRespondedAt` is stamped the first time an agent sends a **customer-facing** message.
An internal note is not a response to the customer, and treating it as one would let an
agent satisfy a service commitment by writing a note to themselves.

This story owns the recorder. US-46 (reply to a customer) is the caller; until it exists the
service method is exercised directly, exactly as US-50 did for status transitions.

### AC5 — the scheduled check

A BullMQ repeatable job every minute, on the infrastructure US-10 built. Each run finds open
tickets whose deadline has passed and whose breach flag is not yet set, sets it, and records
a history entry attributed to the rule rather than to a person — which is precisely what
US-50's AC3 exists for.

"Raises the corresponding event" is taken to mean the history entry, because P07
(notifications) is deferred and US-71 owns escalation. The sweep does not change status: one
thing changes a ticket's status and it is US-71.

The query is `WHERE resolutionDueAt < now AND NOT resolutionBreached AND status NOT IN
(RESOLVED, CLOSED)`, which rides the `[status, resolutionDueAt]` index US-6 put there for
exactly this sweep. The flag is what makes the job idempotent — a re-run finds nothing.

### AC6 — recalculation

A priority change re-resolves the policy and recomputes both deadlines **from `createdAt`**,
not from now, adding back `slaPausedMs`. Recomputing from now would hand a ticket that has
been open for three days a fresh four-hour target every time somebody nudged its priority,
which is a way to never breach anything.

If the first response has already happened, its deadline is left alone: that clock is
finished and moving a target after the fact would be rewriting history.

### One module split

`TicketHistoryService` moves into its own `TicketHistoryModule`, imported by both
`TicketsModule` and `SlaModule`. Without it, `SlaModule` importing `TicketsModule` (for the
recorder) and `TicketsModule` importing `SlaModule` (for the clock) is a cycle. The service
itself does not move and nothing about it changes.

## Files

| Path | What |
| ---- | ---- |
| `backend/prisma/schema.prisma` | `Ticket.slaPausedAt`, `Ticket.slaPausedMs`. |
| `backend/prisma/migrations/<ts>_sla_clock_for_us68/` | **New.** |
| `backend/src/sla/sla-clock.service.ts` | **New.** `applyOnCreate`, `onStatusChange`, `onAgentReply`, `onPriorityChange`, `sweep`. |
| `backend/src/sla/sla-sweep.worker.ts` | **New.** The repeatable job. |
| `backend/src/sla/sla.module.ts` | Registers both; imports `TicketHistoryModule`. |
| `backend/src/tickets/ticket-history.module.ts` | **New.** Breaks the cycle. |
| `backend/src/tickets/tickets.module.ts` | Imports `TicketHistoryModule` and `SlaModule`. |
| `backend/src/tickets/tickets.service.ts` | Starts the clock on create; recomputes on a priority change. |
| `backend/src/sla/sla-clock.test.ts` | **New.** AC1, AC3, AC4, AC5, AC6. |

## Acceptance criteria — verification

| AC | How it is proven |
| -- | ---------------- |
| AC1 — clock start | A created ticket carries a policy id and both deadlines, computed from its own `createdAt` |
| AC2 — business hours | **Not met. Deferred with US-75 by the agreed MVP scope.** No test claims otherwise |
| AC3 — pause and resume | Entering `PENDING_CUSTOMER` stamps the pause; leaving it accumulates the elapsed time and moves `resolutionDueAt` forward by the same amount |
| AC4 — response satisfied | The first customer-facing agent message stamps `firstRespondedAt`; a second does not move it; an internal note does not satisfy it |
| AC5 — state transitions | The sweep sets `resolutionBreached` on a ticket whose target has passed, writes history attributed to the rule, and a second run changes nothing |
| AC6 — recalculation | A priority change recomputes from the original `createdAt` under the new policy and honours accumulated pause; a finished response clock is left alone |

## Out of scope

- Business hours and holidays — US-75.
- Acting on the escalation ladder — US-71.
- Notifying anybody — P07, deferred.
- The UI for any of this — US-69.

## What US-75 has to do

One function. `SlaClockService` computes every deadline through a single
`deadlineFrom(start, minutes, policy)`, which today returns `start + minutes` and ignores
`policy.businessHoursOnly`. US-75 replaces the body of that function and flips the seeded
policies to `true`. Nothing else in this story needs to change.

---

## Result

| AC | Result |
| -- | ------ |
| AC1 — clock start | ✅ deadlines computed from the ticket's own `createdAt`; the VIP policy reaches through to the clock |
| AC2 — business hours | ❌ **not built.** Deferred with US-75 by the agreed MVP scope. No test claims otherwise, and `deadlineFrom` is the single function US-75 replaces |
| AC3 — pause and resume | ✅ the pause is stamped, banked on resume, and the deadline moves by exactly the paused duration; pausing twice does not restart it |
| AC4 — response satisfied | ✅ the first customer-facing reply stops the clock; an internal note does not; a later reply does not move it; a late reply records the breach |
| AC5 — state transitions | ✅ the sweep flags both clocks, records history attributed to `sla.target-passed` with no actor, and a second run changes nothing; resolved tickets and on-track tickets are left alone |
| AC6 — recalculation | ✅ recomputed from the original start under the new policy, honouring banked pause; a finished response clock is not moved; a deadline pushed into the future clears a stale breach |

**Tests:** `sla-clock.test.js` 17 pass. Regression: tickets 21, ticket-history 11,
sla-policy 13, customers 17, demo-seed 14 — all pass. Typecheck and lint clean.

### One US-40 test was updated, not deleted

`AC2 — a ticket with no SLA policy reports state "none"` reached the `none` branch by
creating a ticket, because when it was written no clock existed and every ticket had null
deadlines. Now the seeded policies cover every priority, so a created ticket has a real
target. The test now clears the deadlines to reach the branch — which is the state `none`
actually describes, *a ticket nothing is tracking* — and a new test asserts the thing that
changed: a created ticket carries the deadlines this story computes.

## Flagged

1. **Every process that boots `AppModule` schedules the sweep**, tests included, so the
   sweep really does run during the suite. It is harmless because it is idempotent and only
   ever sets a flag that agrees with the clock — but it is worth knowing before somebody
   debugs a "mysterious" breach flag in a fixture.
2. **AC5's "raises the corresponding event" is the history entry.** There is no event bus:
   P07 is deferred and US-71 owns escalation. If review wants a real emitted event, that is
   US-62's notification service being pulled forward.

## What the next stories inherit

- **US-69** (see SLA status on a ticket) has real data to render. `slaFor()` needs no
  change; the frontend `SlaMeter` and the SLA edge rule already exist from US-26.
- **US-71** hangs off `SlaClockService.sweep`: the ladder US-67 stored is read against the
  same overdue query, and `changeStatusToEscalated` is the one rung that moves a status.
- **US-46** (reply to a customer) must call `onAgentReply` — the recorder exists and is
  tested, and until US-46 lands nothing calls it in production.
- **US-47** (status transitions) must call `onStatusChange`, same shape, same reason.
