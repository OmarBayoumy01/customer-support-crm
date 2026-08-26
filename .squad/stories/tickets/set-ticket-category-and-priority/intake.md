# Story intake

- Folder: `.squad/stories/tickets/set-ticket-category-and-priority/intake.md`
- Source: Notion User Stories database, `US-49`
  (https://app.notion.com/p/3c69e083852381b4805bff9276e4fced)

---

## Feature

- **Feature name (display):** Tickets
- **Feature slug (folder under `plans/`):** `tickets`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-49`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P05 Ticket Management - Full-stack - MVP - Must have -
  Persona: Support Agent - Screen: Ticket Detail - Design File: `07-ticket-detail.md`

---

## Title

```
Set ticket category and priority
```

---

## Description

```
As a support agent
I want to set and change a ticket's category and priority
So that routing, SLA, and reporting reflect what the ticket actually is.
```

---

## Acceptance criteria

```
AC1 - Priority values
Given the priority control
When I open it
Then it offers Low, Medium, High, and Urgent with consistent colours and labels.

AC2 - SLA recalculation
Given I change priority
When it saves
Then the applicable SLA policy is re-evaluated and the displayed deadlines
update immediately.

AC3 - Category management
Given the category control
When I open it
Then it lists the configured categories, and administrators can manage that list
in settings.

AC4 - Department routing
Given a category mapped to a department
When I select it
Then the department field updates and I am told the ticket will route
accordingly.

AC5 - History
Given any priority or category change
When it saves
Then it appears in the ticket history with old and new values.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `07-ticket-detail.md` is not in this repository. | |

---

## Dependencies

- `US-45` the workspace - done. This story replaces two of its read-only pills.
- `US-68` already recomputes the SLA on a priority change; AC2 is largely
  verification that the screen surfaces it.
- `US-50` already records field changes; AC5 is likewise verification.
- **`US-113` owns "administrators can manage that list in settings"** and is deferred
  by the MVP scope. See the plan.

## Extra notes

- Position 15 of 28.
- `Category.departmentId` has been a documented routing hint since US-6 and had no
  reader until now.
- This also unblocks the category filter US-42 flagged as missing from the queue's
  toolbar.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.

## Out of scope

- AI-suggested categorisation.
- Creating and editing categories - `US-113`.
