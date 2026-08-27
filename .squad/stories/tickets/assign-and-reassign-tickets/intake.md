# Story intake

- Folder: `.squad/stories/tickets/assign-and-reassign-tickets/intake.md`
- Source: Notion User Stories database, `US-48`
  (https://app.notion.com/p/3c69e083852381509f7fdf1a21eadffb)

---

## Feature

- **Feature name (display):** Tickets
- **Feature slug (folder under `plans/`):** `tickets`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-48`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P05 Ticket Management - Full-stack - MVP - Must have -
  Persona: Manager - Screen: Ticket Detail, Tickets List -
  Design File: `07-ticket-detail.md`

---

## Title

```
Assign and reassign tickets
```

---

## Description

```
As a manager
I want to assign and reassign tickets to agents
So that work is distributed and nothing sits unowned.
```

---

## Acceptance criteria

```
AC1 - Assign
Given a ticket
When I choose an assignee
Then the ticket updates, the agent is notified, and a history entry records who
reassigned it.

AC2 - Workload visibility
Given the assignee picker
When it opens
Then each agent shows their current open ticket count so I can avoid overloading
one person.

AC3 - Unassign
Given an assigned ticket
When I unassign it
Then it returns to the Unassigned queue and remains visible to the team.

AC4 - Permission boundary
Given an agent without `ticket:assign`
When they view a ticket
Then the assignee control is read-only.

AC5 - Availability
Given an agent who is inactive or out of office
When the picker renders
Then they are marked unavailable and are not offered by default.

AC6 - Handover context
Given a reassignment
When it happens
Then the new assignee sees who owned it previously and any internal notes are
preserved.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `07-ticket-detail.md` is not in this repository. | |

---

## Dependencies

- `US-45` the workspace - done. This story replaces the last of its read-only pills.
- `US-42` the queue - done. Its `unassigned` view is what AC3 returns a ticket to;
  nothing new is needed there.
- `US-50` records field changes - done, but it maps every `assigneeId` change to
  `ASSIGNED`, so an unassignment currently records as an assignment. AC3 needs that
  split.
- `US-22` `PermissionsGuard` and `ticket:assign` - the permission already exists in
  the catalogue and is held by manager (TEAM) and administrator (ALL), **not** agent.
- **P07 notifications (US-60 to US-66) are deferred by the MVP scope**, so AC1's
  "the agent is notified" has no channel. See the plan.

## Extra notes

- Position 16 of 28.
- `assigneeId` is today accepted by `PATCH /tickets/:id` under `ticket:update`, which
  means an agent can already reassign a ticket. That is the gap AC4 closes on the
  server, not merely in the UI.
- `Combobox` (US-27) names US-48's assignee picker as its first intended consumer and
  has been unused since.
- There is no representation of "out of office" anywhere in the domain schema.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.

## Out of scope

- Automatic round-robin assignment and load balancing - the automation phase.
- Bulk reassignment from the queue - `US-44`, deferred.
