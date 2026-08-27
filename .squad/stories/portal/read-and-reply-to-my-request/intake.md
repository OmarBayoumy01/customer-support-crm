# Story intake

- Folder: `.squad/stories/portal/read-and-reply-to-my-request/intake.md`
- Source: Notion User Stories database, `US-85`
  (https://app.notion.com/p/3c69e08385238101af5ceb810c21655f)

---

## Feature

- **Feature name (display):** Portal
- **Feature slug (folder under `plans/`):** `portal`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-85`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P10 Customer Portal - Frontend - MVP - Must have - Persona: Customer -
  Screen: Portal Ticket Detail - Design File: `25-portal-ticket-detail.md`

---

## Title

```
Read and reply to my request
```

---

## Description

```
As a customer
I want to read and reply to my request thread
So that I can continue the conversation with support.
```

---

## Acceptance criteria

```
AC1 - Clean thread
Given a request
When it renders
Then my messages and support messages appear as a simple two-sided thread with
timestamps.

AC2 - Nothing internal
Given internal notes exist on the ticket
When I view it
Then they are absent entirely, and no internal attachment is listed or
downloadable.

AC3 - Agent identity limited
Given a support reply
When it renders
Then it shows a first name and avatar only, not full staff details.

AC4 - Progress indicator
Given the request header
When it renders
Then a simple Received -> In Progress -> Resolved indicator replaces SLA timers.

AC5 - Simple composer
Given the reply box
When it renders
Then it offers a plain text area, an attachment button, and Send - with no mode
switcher or canned replies.

AC6 - System events in plain language
Given a status change
When it appears
Then it reads as plain language such as "Your request was assigned to a support
agent".
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `25-portal-ticket-detail.md` is not in this repository. | |

---

## Dependencies

- `US-82` built `GET /portal/tickets/:id`: the conversation with `isInternal: false` in the
  `where`, attachments filtered **through the message**, ownership in the same query, and
  the count taken from the filtered set. **AC2 is already built and has the rule #1
  regression test.**
- `US-82` also made `authorName` a first name for staff — AC3's limit, already in the
  contract — and never put an SLA field in the portal payload, which is AC4's second half.
- **`US-47` wrote `TicketsService.onCustomerReply` and nothing has ever called it.** It
  reopens a `RESOLVED` request to `OPEN`, clears `resolvedAt`, increments `reopenCount`,
  writes a `REOPENED` entry with no actor, and restarts the clock. `CLOSED` is deliberately
  excluded.
- `US-84` supplied the list this screen is opened from.
- `US-51` (object storage) is deferred, so AC5's attachment button has nowhere to upload to.
- `US-88` (rating) and `US-90` (customer reopen) stay out.

## Extra notes

- Position 24 of 28. **This closes the loop.**
- **AC6 pushes against US-82's "no internal history".** It must be a narrow allowlist of
  event kinds rendered into sentences client-side — never the history feed, never an actor
  name, never a from/to value, never an internal status string.
- `Ticket.lastCustomerReplyAt` has existed since US-6 and nothing writes it.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.

## Out of scope

- Rating - `US-88`. Reopening a closed request on demand - `US-90`.
- Attachments and uploads - `US-51`.
- Notifications, knowledge base.
