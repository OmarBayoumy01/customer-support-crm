# Story intake

- Folder: `.squad/stories/tickets/change-ticket-status/intake.md`
- Source: Notion User Stories database, `US-47`
  (https://app.notion.com/p/3c69e0838523817fb81de8253dc35631)

---

## Feature

- **Feature name (display):** Tickets
- **Feature slug (folder under `plans/`):** `tickets`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-47`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P05 Ticket Management - Full-stack - MVP - Must have -
  Persona: Support Agent - Screen: Ticket Detail, Tickets List -
  Design File: `07-ticket-detail.md`

---

## Title

```
Change ticket status through valid transitions
```

---

## Description

```
As a support agent
I want to move a ticket through its lifecycle statuses
So that everyone can see where the work actually stands.
```

---

## Acceptance criteria

```
AC1 - Status set
Given the status control
When I open it
Then it offers New, Open, Pending Customer, Pending Internal, Escalated,
Resolved, and Closed.

AC2 - Valid transitions
Given the current status
When I open the control
Then only transitions valid from that state are offered, and invalid ones are
rejected server-side too.

AC3 - Resolution requires substance
Given I set a ticket to Resolved
When no agent reply exists on the ticket
Then I am warned before confirming, to prevent silent closures.

AC4 - Automatic side effects
Given a status change
When it saves
Then the SLA clock reacts appropriately - pausing on Pending Customer and
stopping on Resolved - and a history entry is written.

AC5 - Reopening
Given a customer replies to a Resolved ticket
When the message arrives
Then the ticket reopens automatically and the assigned agent is notified.

AC6 - Consistent everywhere
Given a status
When it is shown in any list, dashboard, notification, or report
Then the same label and colour are used.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `07-ticket-detail.md` is not in this repository. | |

---

## Dependencies

- `US-45` the workspace - done. This story replaces its last read-only pill.
- `US-68` **already built the SLA half of AC4.** `SlaClockService.onStatusChange`
  pauses the resolution clock on `PENDING_CUSTOMER` and stops it on
  `RESOLVED` / `CLOSED`, with the banked pause added back on resume. It has no caller.
- `US-50` records field changes and `TicketEventType` already carries `REOPENED`,
  `CLOSED` and `ESCALATED` - none of which anything writes yet.
- `US-26` `StatusBadge` and `STATUS_PRESENTATION` are the single renderer for a status,
  so AC6 is largely a matter of not introducing a second one.
- `US-48` established the pattern this follows: a guarded operation of its own beside
  `PATCH /tickets/:id`, rather than a field on it.
- **AC5's trigger does not exist.** Nothing in the codebase writes a message with
  `senderType: 'CUSTOMER'` - the portal reply endpoint is `US-85`, in wave 4.
- **P07 notifications are deferred**, so AC5's "the assigned agent is notified" has no
  channel, exactly as with US-48 AC1.

## Extra notes

- Position 17 of 28.
- There is **no transition map anywhere in the codebase**. This story defines it.
- `resolvedAt`, `closedAt` and `reopenCount` are read by the detail payload and are
  never written by anything. This story writes them.
- `PATCH /tickets/:id` already refuses `status`, and there is a test asserting it -
  US-40 left the door shut on purpose, for this story to open properly.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.

## Out of scope

- Configurable custom statuses per department - V3.
- Bulk status changes from the queue - `US-44`, deferred.
