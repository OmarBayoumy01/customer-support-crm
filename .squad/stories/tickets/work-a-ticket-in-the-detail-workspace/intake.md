# Story intake

- Folder: `.squad/stories/tickets/work-a-ticket-in-the-detail-workspace/intake.md`
- Source: Notion User Stories database, `US-45`
  (https://app.notion.com/p/3c69e083852381baa729e658975f4800)

---

## Feature

- **Feature name (display):** Tickets
- **Feature slug (folder under `plans/`):** `tickets`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-45`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P05 Ticket Management - Frontend - MVP - Must have -
  Persona: Support Agent - Screen: Ticket Detail - Design File: `07-ticket-detail.md`

---

## Title

```
Work a ticket in the detail workspace
```

---

## Description

```
As a support agent
I want a three-column ticket workspace
So that I can read context, understand the problem, and respond without leaving the page.
```

---

## Acceptance criteria

```
AC1 - Header
Given a ticket
When it opens
Then the header shows ticket number, subject, and inline controls for status,
priority, and assignee, plus a metadata strip with channel, category,
department, branch, and created time.

AC2 - SLA visible without scrolling
Given the ticket header
When it renders
Then response and resolution SLA timers are visible immediately, coloured by
state, and expandable to show policy and exact deadline.

AC3 - Three columns
Given a desktop viewport
When the page renders
Then the conversation occupies the centre, customer context and ticket
information occupy the right, and the composer docks to the bottom of the centre
column.

AC4 - Customer context without navigation
Given the right column
When it renders
Then it shows the customer's name, contact details, status, recent tickets,
recent interactions, and notes, with a link to the full profile.

AC5 - Collapsible panels
Given the right column
When I collapse it
Then the conversation expands to use the space and my preference persists.

AC6 - Nothing important behind a dialog
Given the ticket
When I need status, priority, assignment, or SLA
Then each is directly visible or one click away, never nested in multiple
dialogs.
```

## Design file (from the story)

```
07-ticket-detail.md - the visual centrepiece of the product.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `07-ticket-detail.md` is not in this repository. | |

---

## Dependencies

- `US-40` the ticket API - done. Its AC3 returns the whole workspace in one response.
- `US-50` the history timeline component - done, and mounted here.
- `US-68` the SLA clock - done, so both timers show real numbers.
- `US-33` the customer API - done; the context panel reads `GET /customers/:id`.

## Extra notes

- Position 12 of 28. The screen the rest of wave 2 hangs actions off.
- **US-46 owns the conversation** and **US-1 owns the composer**. This story places
  both and fills the conversation with the minimum that makes the layout real.
- **US-47, US-48 and US-49** own status, assignment and priority respectively. This
  story places those controls; it does not make them act.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.
- `atomWithStorage` already backs the sidebar's collapse preference - AC5 wants the
  same treatment.

## Out of scope

- Replying, adding an internal note - US-1.
- Changing status, priority or assignee - US-47, US-49, US-48.
- The customer profile screen the panel links to - US-35.
