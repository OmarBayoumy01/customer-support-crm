# Story intake

- Folder: `.squad/stories/sla/define-sla-policies/intake.md`
- Source: Notion User Stories database, `US-67`
  (https://app.notion.com/p/3c69e08385238176b1aff799134b0b0b)

---

## Feature

- **Feature name (display):** SLA
- **Feature slug (folder under `plans/`):** `sla`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-67`
- **Work item type:** User story
- **Status:** Ready → In progress
- **Assignee:** —
- **Labels:** P08 SLA & Automation · Backend · MVP · Must have · Persona: Administrator ·
  no design file

---

## Title

```
Define SLA policies
```

---

## Description

```
As an administrator
I want SLA policies defined with response and resolution targets
So that service commitments are configuration rather than tribal knowledge.
```

---

## Acceptance criteria

```
AC1 — Policy fields
Given a policy
When it is created
Then it stores name, first response target, resolution target, business hours,
applicability rules, escalation steps, and active state.

AC2 — Applicability
Given a new ticket
When policies are evaluated
Then the most specific matching policy wins, matching on priority, category,
department, branch, and customer type.

AC3 — VIP override
Given a VIP customer with a dedicated policy
When their ticket is created
Then the VIP policy applies over the general one.

AC4 — Immutable history
Given a policy is edited
When the change saves
Then tickets already governed by it keep their original targets rather than
shifting retroactively.

AC5 — Audit
Given a policy change
When it saves
Then it is written to the audit log with before and after values.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. | |

---

## Dependencies

- **Blocked by / related ids:** `US-6` (domain schema) — done. This story reworks the
  `SlaPolicy` model US-6 sketched.
- **Consumers already waiting:**
  - `US-68` (SLA clocks) needs the resolved policy and its targets.
  - `US-71` (automatic escalation) needs the escalation steps and their thresholds.
  - `US-40`'s `slaFor()` already derives `ok` / `warn` / `breach` from the ticket's due
    dates and starts answering something other than `none` as soon as those are filled.

## Extra notes

- `.squad/plans/00-mvp-scope.md` puts this at position 8 of 28, with the simplification
  **"Policies seeded, not managed in a UI (US-70 deferred)"**. No controller, no screen.
- The MVP accepts a **24/7 clock**: `businessHoursOnly` is stored (AC1 names it) but
  US-75, which would configure the calendar it reads, is deferred.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.
- `AuditLog` exists in the schema (US-6) with `before` / `after` JSON columns, but nothing
  writes to it yet. AC5 is its first caller.

## Out of scope

- The SLA policy management UI and API — `US-70`.
- Business hours and holiday calendars — `US-75`.
- Computing or storing deadlines — `US-68`.
- Acting on the escalation steps — `US-71`. This story defines them.
