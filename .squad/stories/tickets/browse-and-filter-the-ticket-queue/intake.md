# Story intake

- Folder: `.squad/stories/tickets/browse-and-filter-the-ticket-queue/intake.md`
- Source: Notion User Stories database, `US-42`
  (https://app.notion.com/p/3c69e083852381d087f6efea3f02141c)

---

## Feature

- **Feature name (display):** Tickets
- **Feature slug (folder under `plans/`):** `tickets`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-42`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P05 Ticket Management - Frontend - MVP - Must have -
  Persona: Support Agent - Screen: Tickets List - Design File: `06-tickets-list.md`

---

## Title

```
Browse and filter the ticket queue
```

---

## Description

```
As a support agent
I want a dense, filterable ticket queue
So that I can find the ticket that needs attention next without reading every row.
```

---

## Acceptance criteria

```
AC1 - Columns
Given the list
When it renders
Then it shows checkbox, ticket ID, subject with channel icon, customer, category,
priority, status, assignee, SLA, and updated time.

AC2 - Scannability
Given a row
When I look at it
Then priority and SLA state are the most visually prominent elements, and SLA
shows a countdown coloured by state.

AC3 - Filters
Given the filter toolbar
When I apply any filter
Then the list updates, the URL reflects the filter state, and applied filters
appear as removable chips.

AC4 - View tabs
Given the tab row
When I switch between All, Unassigned, My Tickets, Escalated, Breached SLA, and
Closed
Then the list filters accordingly and each tab shows a live count.

AC5 - Sorting
Given a sortable column header
When I click it
Then results re-sort server-side and the active sort is visually indicated.

AC6 - Empty states
Given no results
When filters are applied
Then the message distinguishes an empty queue from a filter that matched nothing.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `06-tickets-list.md` does not exist in this repository - see the note below. | |

---

## Dependencies

- `US-30` the data table, `US-27` the shared composites, `US-31` the states -
  all done in wave 0.
- `US-40` the ticket API - done. `US-68` fills the SLA deadlines the queue renders.
- `US-120` seeded 14 tickets across every status and priority, so this screen is
  reviewed against realistic data rather than an empty table.

## Extra notes

- **The design file named on the story, `06-tickets-list.md`, is not in this repository
  and never has been.** Every frontend story so far has been designed against the P03
  design system instead, and this one is no different. Flagged rather than invented.
- Position 11 of 28 - the first story of wave 2, and the first screen an agent
  actually works in.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.
- `useTableQueryState` already holds sort, page, search and arbitrary filters in the URL.
- `SlaMeter` and `slaEdgeClass` already exist from US-26.

## Out of scope

- The ticket detail screen - US-45.
- Bulk actions on the selection - the checkbox column and the bulk bar exist; what
  the actions *are* belongs to US-48 (assign) and US-47 (status).
- Category and assignee filter pickers - see the plan.
