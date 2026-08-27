# Story intake

- Folder: `.squad/stories/portal/track-my-requests/intake.md`
- Source: Notion User Stories database, `US-84`
  (https://app.notion.com/p/3c69e0838523816c9b2ff72ce0614fde)

---

## Feature

- **Feature name (display):** Portal
- **Feature slug (folder under `plans/`):** `portal`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-84`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P10 Customer Portal - Frontend - MVP - Must have - Persona: Customer -
  Screen: Portal My Tickets - Design File: `24-portal-my-tickets.md`

---

## Title

```
Track my requests in the portal
```

---

## Description

```
As a customer
I want to see all my requests in one list
So that I can find and follow up on any of them.
```

---

## Acceptance criteria

```
AC1 - Card layout
Given the list
When it renders
Then each request is a generous card or row showing number, subject, opened date,
category, status, and last update - not a dense data table.

AC2 - Simple filters
Given the filter row
When it renders
Then it offers only search, status, and date - no department, branch, assignee, or
channel.

AC3 - Action needed flagged
Given a request awaiting my reply
When it renders
Then it is visually marked with a reply-needed indicator.

AC4 - Rate resolved requests
Given a resolved request
When it renders
Then an inline star rating prompt is offered.

AC5 - Empty state
Given I have no requests
When the page renders
Then a friendly message and a submit button are shown.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `24-portal-my-tickets.md` is not in this repository. | |

---

## Dependencies

- `US-82` built `GET /portal/tickets`: scoped to the caller's customer in the query,
  paged, with the customer-facing status filter. Every field AC1 names is already on
  `PortalTicketSchema`.
- `US-82`'s `WAITING_ON_YOU` is AC3's state — it is already the portal translation of
  `PENDING_CUSTOMER`.
- `US-86` supplied `/portal/new`, so AC5's submit button has somewhere to go.
- **`US-88` (rating) is deferred** by `.squad/plans/00-mvp-scope.md`, so AC4 has no
  column and no endpoint.
- `US-83` (a separate portal home) is deferred, so `/portal` is this screen.

## Extra notes

- Position 23 of 28.
- **The backend gap is AC2's search and date filters**, which do not exist. Status and
  paging do.
- `q` must not search descriptions or message bodies: a customer recognises a request by
  its subject or number, and searching message text would have a portal query reading
  rows the internal-note filter exists to keep out of reach.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.

## Out of scope

- Opening a request, reading it, replying - `US-85`.
- Rating - `US-88`, deferred.
- Notifications, knowledge base, attachments.
