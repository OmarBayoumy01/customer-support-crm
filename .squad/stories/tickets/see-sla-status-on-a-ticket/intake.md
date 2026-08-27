# Story intake

- Folder: `.squad/stories/tickets/see-sla-status-on-a-ticket/intake.md`
- Source: Notion User Stories database, `US-69`
  (https://app.notion.com/p/3c69e083852381ccb6a0d6ea68ecbf38)

---

## Feature

- **Feature name (display):** Tickets
- **Feature slug (folder under `plans/`):** `tickets`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-69`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P08 SLA & Automation - Frontend - MVP - Must have -
  Persona: Support Agent - Screen: Ticket Detail, Tickets List -
  Design File: `07-ticket-detail.md`

---

## Title

```
See SLA status on a ticket
```

---

## Description

```
As a support agent
I want SLA status visible on the ticket at a glance
So that I know how long I have before I am late.
```

---

## Acceptance criteria

```
AC1 - Always visible
Given a ticket detail page
When it renders
Then response and resolution timers appear in the header without scrolling.

AC2 - Human phrasing
Given a timer
When it renders
Then it reads naturally, such as "Response due in 18 min" or "Overdue by 40 min".

AC3 - State colouring
Given an SLA state
When it renders
Then on track is green, at risk amber, breached red, and completed grey, always
with a text label alongside.

AC4 - Expandable detail
Given I click the timer
When it expands
Then I see the policy name, target, exact deadline timestamp, and any paused
periods.

AC5 - Live countdown
Given the page stays open
When time passes
Then the countdown updates without a refresh and changes colour as it crosses
thresholds.

AC6 - In lists too
Given the ticket list and dashboards
When they render
Then the same SLA chip and colours are used, never a different representation.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `07-ticket-detail.md` is not in this repository. | |

---

## Dependencies

- `US-45` built a private `SlaClock` inside `ticket-header.tsx` that already satisfies
  AC1 and half of AC4.
- `US-68` maintains `slaPausedAt` and `slaPausedMs` and **nothing has ever read them**.
- `US-47` exposed `firstRespondedAt`, which is what tells a response clock it is done.
- `US-26` `SLA_PRESENTATION`, `slaStateFor` and `SlaMeter` are the shared tokens AC6 is
  about; the queue already uses them.

## Extra notes

- Position 18 of 28.
- **`SlaState` has three states plus `none`; AC3 names four.** "Completed" does not exist
  anywhere yet.
- The header's countdown is computed once at render and only moves when TanStack Query
  refetches, so AC5 is unmet.
- AC4 asks for the target and the paused periods, and **neither is in the API payload**.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.

## Out of scope

- Business-hours SLA - `US-75`, deferred.
- SLA policy management UI - `US-70`, deferred.
- Dashboards, which AC6 also mentions - `US-55` and `US-58`.
