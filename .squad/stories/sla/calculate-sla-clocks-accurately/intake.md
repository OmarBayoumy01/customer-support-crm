# Story intake

- Folder: `.squad/stories/sla/calculate-sla-clocks-accurately/intake.md`
- Source: Notion User Stories database, `US-68`
  (https://app.notion.com/p/3c69e0838523810a969ed02368688be3)

---

## Feature

- **Feature name (display):** SLA
- **Feature slug (folder under `plans/`):** `sla`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-68`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P08 SLA & Automation - Backend - MVP - Must have - Persona: Developer

---

## Title

```
Calculate SLA clocks accurately
```

---

## Description

```
As a developer
I want an engine that tracks SLA clocks per ticket
So that at-risk and breached states are accurate rather than approximate.
```

---

## Acceptance criteria

```
AC1 - Clock start
Given a ticket is created
When the policy is applied
Then response and resolution deadlines are computed and stored.

AC2 - Business hours
Given a policy restricted to business hours
When elapsed time is computed
Then time outside working hours and on configured holidays is excluded.

AC3 - Pause and resume
Given a ticket set to Pending Customer
When the status changes
Then the resolution clock pauses, and it resumes when the customer replies.

AC4 - Response satisfied
Given the first agent reply is sent
When it saves
Then the response SLA is marked met and stops counting.

AC5 - State transitions
Given elapsed time crosses the at-risk threshold or the target
When the scheduled check runs
Then the ticket's SLA state moves to At risk or Breached and raises the
corresponding event.

AC6 - Recalculation
Given priority changes mid-ticket
When it saves
Then deadlines recompute from the original start using the new policy.
```

## Technical notes (from the story)

```
Scheduled evaluation via BullMQ repeatable jobs; store computed deadlines rather
than deriving on every read
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. | |

---

## Dependencies

- `US-67` SLA policies - done. `SlaPolicyService.resolveFor` is what tells this story
  which targets apply.
- `US-10` Redis and BullMQ - done. `QueueService.registerWorker` and repeatable jobs are
  already there, and the story's own technical note names BullMQ.
- `US-40`'s `slaFor()` already derives ok / warn / breach from the ticket's due dates. It
  needs no change; it starts answering once this story fills them in.

## Extra notes

- **AC2 is out of scope by agreement.** `.squad/plans/00-mvp-scope.md` records
  "24/7 SLA clock accepted" and defers US-75, which owns the business-hours calendar. AC2
  is reported as not met rather than quietly approximated.
- Position 10 of 28, the last story of wave 1.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.
- `RedisModule` and `PrismaModule` are both global; `QueueService` can be injected
  directly.

## Out of scope

- Business hours and holidays - US-75.
- Escalating on a threshold - US-71.
- Notifying anybody - P07, deferred.
- Showing the clock - US-69.
