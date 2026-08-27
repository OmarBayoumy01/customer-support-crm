# dashboards — plan overview

Entry point for the **dashboards** feature: the two screens that answer "what should I do
next" and "how is the team doing". Two of the twenty-eight stories in
[`../00-mvp-scope.md`](../00-mvp-scope.md) live here — US-55 and US-58 — and the second of
them **is** the "Report" step of the core workflow, since all of P11 Reports is V2.

## Stories

| NN  | File | Title | Tracker id | Depends on |
| --- | ---- | ----- | ---------- | ---------- |
| 44  | `44-story-agent-workload-dashboard.md` | See my workload on the agent dashboard | US-55 | US-40 |

## The rule this feature follows

**A dashboard reports; it does not compute.** Every figure comes from data and rules that
already exist:

- the queue's list endpoint for the table, so "closest to breaching" has one definition
- `slaFor` and `WARN_FRACTION` for anything SLA-shaped, so the warning window is not
  restated in SQL
- US-47's and US-48's controls for row actions, permission gating included

A second definition of "due soon" living in a dashboard query is how two screens start
disagreeing about which tickets are on fire.

## No analytics infrastructure

No snapshot table, no aggregate table, no reporting service, no scheduled roll-up. That is
P11's, which the MVP scope puts in V2 — and it has a consequence worth stating once:

**A point-in-time comparison is only possible where the ticket row can reconstruct it.**
`open` a week ago is answerable from `createdAt`, `resolvedAt` and `closedAt`. The status
then, the breach flags then, and "due soon" then are not: the first is not stored, the
second is current-only, and the third is a window relative to now.

So a dashboard metric is `{ value, previous: number | null }`, and a null renders no
indicator rather than a zero that would read as "flat".

## Locked decisions

- **Scope is in the query, twice over.** `assigneeId: <caller>` and the caller's
  `ticket:view` scope both appear in the `where`. The second can never widen the first, but
  rule #2 says scoped permissions are applied in the query.
- **The KPI endpoint takes no parameters**, so there is no request shape that reports
  somebody else's workload.
- **`pending` is a subset of `open`**, deliberately: one is how much I hold, the other how
  much of it is waiting on somebody else.
- **A finished ticket is in no SLA figure.** Its clock stopped; counting it would put
  completed work on the pile an agent decides from.

## What US-58 inherits

The manager dashboard shares the components and the same "report, do not compute" rule, and
it has its own scope problem to solve: a manager's figures are their *department's*, which is
`ticketScopeWhere` at `TEAM` rather than `assigneeId`. It also inherits the comparison
limitation above — and "Tickets Requiring Attention" is the panel US-71 flagged as its AC4.
