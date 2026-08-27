# Story intake

- Folder: `.squad/stories/sla/escalate-tickets-automatically/intake.md`
- Source: Notion User Stories database, `US-71`
  (https://app.notion.com/p/3c69e0838523819fad3bdb483debad70)

---

## Feature

- **Feature name (display):** SLA
- **Feature slug (folder under `plans/`):** `sla`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-71`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P08 SLA & Automation - Backend - MVP - Must have -
  Persona: Manager - Screen: Ticket Detail, Manager Dashboard -
  Design File: `05-manager-dashboard.md`

---

## Title

```
Escalate tickets automatically on SLA thresholds
```

---

## Description

```
As a manager
I want tickets to escalate automatically as they approach or pass their SLA
So that problems surface before a customer complains.
```

---

## Acceptance criteria

```
AC1 - Warning to agent
Given a ticket reaches its at-risk threshold
When the check runs
Then the assigned agent is notified with a link to the ticket.

AC2 - Warning to manager
Given a ticket remains at risk
When the manager threshold is crossed
Then the department manager is notified.

AC3 - Breach escalation
Given a ticket breaches its target
When it is detected
Then the status changes to Escalated, the manager is notified, and a history
entry records the automated action.

AC4 - Surfaces to management
Given an escalated ticket
When the manager dashboard renders
Then it appears in Tickets Requiring Attention.

AC5 - No duplicate escalation
Given a ticket already escalated
When the check runs again
Then it does not re-escalate or re-notify repeatedly.

AC6 - Attribution
Given an automated escalation
When it appears in history
Then it is attributed to the rule, not to a person.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `05-manager-dashboard.md` is not in this repository. | |

---

## Dependencies

- `US-6` modelled `SlaEscalationStep` with the comment "consumed by US-71", and gave
  `Ticket` its `escalatedAt` and `escalatedToId` columns. Nothing writes them yet.
- `US-67` **seeds the ladder on every default policy** — 75% assignee, 90% department
  manager, 100% department manager with `changeStatusToEscalated`.
- `US-68` built `SlaSweepWorker`, a BullMQ repeatable job scheduled once in Redis, and
  `SlaClockService.sweep()`. This story adds a second call inside the same worker.
- `US-50` `TicketHistoryService` takes `automationRule` **instead of** `actorUserId`,
  which is AC6 already built.
- `US-47` added `TICKET_TRANSITIONS` / `canTransition`, which the escalation must obey.
- **`US-62` is deferred.** The story's own `Depends on` names it, and
  `.squad/plans/00-mvp-scope.md` cuts all of P07.

## Extra notes

- Position 19 of 28.
- `QueueService` already applies max attempts, exponential backoff and a dead-letter
  write on the final failure. What this story owes that infrastructure is idempotency.
- **AC5 needs per-rung idempotency, not per-ticket.** `escalatedAt` only marks the rung
  that changes status; the 75% and 90% rungs would otherwise re-fire every minute.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.

## Out of scope

- Notifications of any kind - `US-62`, deferred. Do not invent a channel.
- The manager dashboard's "Tickets Requiring Attention" panel - `US-58`.
- A configurable rules engine. The ladder is per-policy configuration and that is enough.
- SLA policy management UI - `US-70`, deferred.
