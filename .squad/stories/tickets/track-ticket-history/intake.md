# Story intake

- Folder: `.squad/stories/tickets/track-ticket-history/intake.md`
- Source: Notion User Stories database, `US-50`
  (https://app.notion.com/p/3c69e0838523814cade4f1844bd78096)

---

## Feature

- **Feature name (display):** Tickets
- **Feature slug (folder under `plans/`):** `tickets`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-50`
- **Work item type:** User story
- **Status:** Ready → In progress
- **Assignee:** —
- **Labels:** P05 Ticket Management · Full-stack · MVP · Must have · Persona: Manager ·
  Screen: Ticket Detail · Design File: `07-ticket-detail.md`

---

## Title

```
Track ticket history
```

---

## Description

```
As a manager
I want a complete audit trail on every ticket
So that I can reconstruct what happened when a customer disputes it.
```

---

## Acceptance criteria

```
AC1 — Events captured
Given a ticket
When I open its history
Then I see created, assigned, priority changed, status changed, escalated,
reassigned, resolved, and closed events.

AC2 — Attribution
Given any history entry
When it renders
Then it names the actor, the exact timestamp, and the old and new values where
applicable.

AC3 — System versus human
Given an automated change
When it appears in history
Then it is attributed to the automation rule that caused it, not to a person.

AC4 — Immutable
Given a history entry
When anyone attempts to edit or delete it
Then the operation is refused — history is append-only.

AC5 — Presentation
Given the history panel
When it renders
Then it is a compact vertical timeline, collapsed by default on long tickets.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. | |

---

## Dependencies

- **Blocked by / related ids:** `US-40` (Build the ticket API) — done, commit `b7251bc`.
  `US-47` (status transitions) and `US-71` (escalation) are the callers that will write
  the `ESCALATED` and resolved/closed entries; this story provides the recorder they use.
- **Depends on code areas or other stories:**
  - `backend/src/tickets/ticket-history.service.ts` — created by US-40 for AC5 of that
    story, extended here.
  - `TicketHistory` in `backend/prisma/schema.prisma` — US-6 already gave it no
    `updatedAt` and no `deletedAt`.

## Extra notes

- The 28-story MVP slice (`.squad/plans/00-mvp-scope.md`) puts this at position 7, right
  after the ticket API, because every later workflow story writes into it.
- `TicketEventType` has no `RESOLVED` member. AC1's "resolved" and "closed" arrive as
  `STATUS_CHANGED` with `toValue` of `RESOLVED`/`CLOSED`; "reassigned" is `ASSIGNED` with
  a non-null `fromValue`. Flagged in the plan rather than adding enum members that US-47
  would then have to choose between.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.
- Existing surfaces: `GET /tickets/:id` already returns the most recent history inline.
- The staff ticket detail screen does not exist yet (US-41). The timeline lands as a
  standalone component with its own tests so US-41 mounts it rather than rebuilding it.

## Out of scope

- The system-wide audit log (`AuditLog`), which is a separate administration feature.
- Writing `ESCALATED` entries — US-71 owns escalation.
