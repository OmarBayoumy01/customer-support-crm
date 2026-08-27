# Story intake

- Folder: `.squad/stories/dashboards/agent-workload-dashboard/intake.md`
- Source: Notion User Stories database, `US-55`
  (https://app.notion.com/p/3c69e083852381f1a55ce5d540264d25)

---

## Feature

- **Feature name (display):** Dashboards
- **Feature slug (folder under `plans/`):** `dashboards`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-55`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P06 Agent Dashboard & Tasks - Full-stack - MVP - Must have -
  Persona: Support Agent - Screen: Agent Dashboard - Design File: `04-agent-dashboard.md`

---

## Title

```
See my workload on the agent dashboard
```

---

## Description

```
As a support agent
I want a dashboard showing my workload and what is due soon
So that I know what to work on the moment I sign in.
```

---

## Acceptance criteria

```
AC1 - KPI row
Given the dashboard
When it loads
Then it shows my open tickets, pending tickets, due soon, and SLA breaches, each
with a comparison indicator.

AC2 - My tickets table
Given the main column
When it renders
Then it lists my assigned tickets with ID, subject, customer, priority, status,
SLA, and updated time.

AC3 - Urgency-first sorting
Given the sort control
When I sort by SLA urgency
Then tickets closest to breaching appear first, and this is the default sort.

AC4 - Act without navigating
Given a row
When I use its quick actions
Then I can open, reply, change status, reassign, or snooze directly from the
dashboard.

AC5 - Performance
Given the dashboard
When it loads
Then KPIs and the table render progressively with skeletons rather than blocking
on the slowest query.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `04-agent-dashboard.md` is not in this repository. | |

---

## Dependencies

- `US-40` the ticket API — `GET /tickets?view=mine&sort=sla&dir=asc` already returns every
  column AC2 names, already sorts by SLA urgency, and already applies the caller's scope
  in the query. **AC2 and AC3 need no new endpoint.**
- `US-68`'s `slaFor` and `WARN_FRACTION` are the one definition of "due soon". The KPIs are
  computed through it rather than with a second copy of the threshold in SQL.
- `US-47`'s `TicketStatusControl` and `US-48`'s `TicketAssignee` are AC4's status and
  reassign actions, permission gating included.
- `US-30`'s `DataTable`, `US-26`'s badges and `US-69`'s `SlaMeter`.
- `US-42`'s `GET /tickets/assigned/count` — related, but two numbers where AC1 wants four.

## Extra notes

- Position 25 of 28.
- **AC1's comparison indicator is mostly not computable.** Only `open` has an honest past
  value, reconstructible from `createdAt`, `resolvedAt` and `closedAt`. The status a week
  ago is not stored, the breach flags are current-only, and "due soon" is a window relative
  to now — those need a daily snapshot, which is P11's analytics work.
- **AC4's snooze does not exist**: no column, no endpoint, and no story owns it (US-56 is
  tasks).
- The dashboard page is a US-14 placeholder whose own comment says not to grow it into the
  real thing. This is the real thing.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.

## Out of scope

- The manager dashboard - `US-58`.
- Any analytics infrastructure: no snapshot table, no aggregate table, no reporting service.
- Tasks - `US-56`, deferred.
