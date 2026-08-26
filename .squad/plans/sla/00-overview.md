# sla — plan overview

Entry point for the **SLA** feature: the clock the whole product is judged by. Four of the
twenty-eight stories in [`../00-mvp-scope.md`](../00-mvp-scope.md) live here — US-67, US-68,
US-69, US-71 — and the ticket API has been carrying `slaState: 'none'` since US-40 waiting
for them.

## Stories

| NN  | File                             | Title              | Tracker id | Depends on |
| --- | -------------------------------- | ------------------ | ---------- | ---------- |
| 27  | `27-story-define-sla-policies.md` | Define SLA policies | US-67      | US-6       |
| 29  | `29-story-calculate-sla-clocks-accurately.md` | Calculate SLA clocks accurately | US-68 | US-67, US-10 |

## The MVP simplification, stated once

Two things are deliberately not built, both recorded in the scope document and both
agreed:

- **No management UI.** US-70 owns the CRUD screen. Policies are seeded.
- **A 24/7 clock.** US-75 configures business hours and holidays and is deferred, so
  `businessHoursOnly` is stored because AC1 names it, and nothing reads it yet.

Neither is a shortcut in the data model: a policy that later needs a UI or a calendar
needs no migration to get one.
