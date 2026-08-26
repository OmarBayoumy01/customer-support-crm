# administration — plan overview

Entry point for the **administration** feature. Only one of its stories is in the MVP
slice: everything else in P14 is configuration UI that the scope defers in favour of
seeded data.

## Stories

| NN  | File                                    | Title                       | Tracker id | Depends on   |
| --- | --------------------------------------- | --------------------------- | ---------- | ------------ |
| 28  | `28-story-generate-realistic-seed-data.md` | Generate realistic seed data | US-120     | US-6, US-67  |

## Why this one is in and the rest are not

US-120 is a **prerequisite**, not a workflow step. Nothing in the customer journey depends
on it, but every screen built after it is reviewed against a database with something in it
rather than an empty one — and an empty queue hides exactly the problems a demo needs to
surface: how a breached SLA reads, how a long thread scrolls, what an unassigned ticket
looks like, whether Arabic mirrors.

The rest of P14 — US-113 through US-119, category and department and SLA management
screens — is deferred in `../00-mvp-scope.md` on the same reasoning that keeps US-70 out:
the data those screens manage is seeded, so the screens are not on the critical path.
