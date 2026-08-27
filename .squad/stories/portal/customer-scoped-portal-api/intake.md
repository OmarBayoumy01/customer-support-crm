# Story intake

- Folder: `.squad/stories/portal/customer-scoped-portal-api/intake.md`
- Source: Notion User Stories database, `US-82`
  (https://app.notion.com/p/3c69e0838523812cb4b0e3fdea6b5aaf)

---

## Feature

- **Feature name (display):** Portal
- **Feature slug (folder under `plans/`):** `portal`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-82`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P10 Customer Portal - Backend - MVP - Must have - Persona: Customer
- **Design File:** none. **Screen:** none.

---

## Title

```
Build the customer-scoped portal API
```

---

## Description

```
As a developer
I want a separate customer-scoped API surface for the portal
So that internal data can never leak through a portal endpoint.
```

---

## Acceptance criteria

```
AC1 - Own scope
Given a portal endpoint
When a customer calls it
Then it returns only records belonging to that customer, enforced in the query.

AC2 - Internal data stripped
Given a portal ticket response
When it is serialised
Then internal notes, assignee identity beyond a first name, SLA timers, internal
statuses, and internal attachments are absent from the payload entirely - not
merely hidden in the UI.

AC3 - Status translation
Given internal statuses
When returned to the portal
Then they map to the customer-facing set: Open, In Progress, Waiting on You,
Resolved, Closed.

AC4 - Audience enforcement
Given a staff token
When it is used against a portal endpoint, or a customer token against a staff
endpoint
Then the request is rejected.

AC5 - Rate limited
Given the portal is publicly reachable
When requests exceed a threshold
Then they are throttled per account and per IP.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. The story carries no design file and no screen. | |

---

## The rule this story exists to enforce

From `CLAUDE.md`, non-negotiable rule #1:

> An internal note must never appear in a portal response, an email, an attachment
> listing, or any customer-facing payload - **filtered at the API layer, not merely hidden
> in the UI.** There is an explicit regression test for this.

`.squad/plans/00-mvp-scope.md` names the risk directly: US-1 writes `isInternal`, US-82
filters on it, and the two are four waves apart. **The filter and its regression test
belong to this story and must not be assumed done.**

## Dependencies

- `US-40` the ticket API and its `Message.isInternal` column - done.
- `US-1` wrote `TicketsService.messages(..., { includeInternal: false })` for this story
  and left the comment saying so.
- `US-13` `ticketScopeWhere` has an `OWN` scope producing `{ customer: { userId } }` -
  **deliberately not used**, see the plan.
- `US-14` `TOKEN_AUDIENCES` already contains `crm-portal`; `AuthService.login` takes an
  audience and `TokenService` stamps it.
- `US-16` `TokenRevocationService` - a portal session must stop working when signed out.
- **`US-21` is the portal sign-in *screen*** and is not built. Nothing here waits for it:
  the audience exists, and the tests mint a portal token directly.

## Extra notes

- Position 20 of 28.
- `Attachment` has **no `isInternal` column.** A file is internal because its message is,
  and the staff detail selects attachments at the *ticket* level with no reference to the
  parent message. That is a leak vector filtering messages does not close.
- No throttling library is in the dependency list, and none is to be added.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.

## Out of scope

- `POST /portal/tickets` - `US-86`.
- The portal sign-in screen - `US-21`.
- Notifications of any kind - `US-62`, deferred.
- Attachment downloads - `US-51`, deferred.
