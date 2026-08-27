# US-55 — See my workload on the agent dashboard

- **Feature:** `dashboards`
- **Story:** [See my workload on the agent dashboard](https://app.notion.com/p/3c69e083852381f1a55ce5d540264d25)
- **Phase / Layer / Release:** P06 Agent Dashboard & Tasks · Full-stack · MVP · Must have
- **Depends on:** US-40 ✅
- **Intake:** `.squad/stories/dashboards/agent-workload-dashboard/intake.md`
- **MVP position:** 25 of 28

## The story

> **As a** support agent **I want** a dashboard showing my workload and what is due soon **So
> that** I know what to work on the moment I sign in.

| AC | Requirement |
| -- | ----------- |
| **AC1** | My open tickets, pending tickets, due soon and SLA breaches, **each with a comparison indicator**. |
| **AC2** | My assigned tickets listed with id, subject, customer, priority, status, SLA and updated time. |
| **AC3** | Sortable by SLA urgency, closest to breaching first, **and that is the default sort**. |
| **AC4** | Row quick actions: open, reply, change status, reassign, **snooze** — without navigating. |
| **AC5** | KPIs and the table render **progressively with skeletons**, not blocking on the slowest query. |

## What already exists, and is reused rather than recomputed

- **`GET /tickets?view=mine&sort=sla&dir=asc`** — the queue's own list endpoint already returns
  every column AC2 names, already sorts by SLA urgency, and already applies the caller's scope
  in the query. **AC2 and AC3 need no new endpoint.**
- **`slaFor` and `WARN_FRACTION`** — the one definition of "due soon". The dashboard's KPIs are
  computed **through it**, not with a second copy of the threshold in SQL.
- **`TicketStatusControl`** (US-47) and **`TicketAssignee`** (US-48) — AC4's status and reassign
  actions already exist as controls, with their permission gating built in.
- **`DataTable`**, `StatusBadge`, `PriorityBadge`, `SlaMeter` — the table and its indicators.
- **`GET /tickets/assigned/count`** — the sidebar badge's `{ total, atRisk }`. Related but not
  enough for AC1, which wants four numbers.

## Approach

### AC1 — one endpoint, one query, four numbers from the existing rule

`GET /tickets/assigned/summary`, guarded `ticket:view`.

It fetches the caller's open assigned tickets **once** and derives all four counts in
application code through `slaFor` — the same function the queue and the detail use:

| KPI | Definition |
| --- | ---------- |
| `open` | assigned to me, not `RESOLVED` and not `CLOSED` |
| `pending` | of those, `PENDING_CUSTOMER` or `PENDING_INTERNAL` — waiting on somebody |
| `dueSoon` | of those, `slaFor(...).state === 'warn'` |
| `breached` | of those, `state === 'breach'`, or either breach flag already set |

One query rather than four counts, because the warning window is a fraction of each ticket's
*own* target and cannot be one SQL comparison — `assignedCount` made the same call for the same
reason, over the same bounded set.

**`pending` is a subset of `open`, deliberately.** AC1 lists them as separate figures and they
are: one is "how much do I hold", the other "how much of it is waiting on somebody else".

**Scope is applied as well as `assigneeId`.** A ticket assigned to me is inside any scope I
could hold, so the scope clause is redundant in practice — but rule #2 says scoped permissions
are applied in the query, and a redundant clause that can never widen is cheaper than an
argument about whether it was needed.

### AC1's comparison indicator — mostly not computable, and not faked

A comparison needs the same metric at an earlier moment. What the schema can honestly answer:

- **`open` — yes.** A ticket existed then and was not finished then:
  `createdAt <= t AND (resolvedAt IS NULL OR resolvedAt > t) AND (closedAt IS NULL OR closedAt > t)`.
  Reconstructible from columns US-47 now maintains.
- **`pending`, `dueSoon`, `breached` — no.** The status a week ago is not stored; the breach
  flags are current-only, so a ticket breached today looks identical to one breached on Tuesday;
  and "due soon" is a window relative to *now*, so it has no past value at all.

Reconstructing those needs a **daily snapshot table** — which is analytics infrastructure this
story was told not to add, and which P11 owns.

So the contract is `{ value: number; previous: number | null }` per KPI. `previous` is a real
number for `open` and **`null` for the other three**, and the client renders the indicator only
where a comparison exists rather than printing "0%" and calling it flat. **AC1 is therefore
partly met and flagged**, with the specific reason recorded per metric.

The one caveat on `open`'s comparison, stated in the API description: **assignment is taken as
current**, because `Ticket.assigneeId` is a column and not a history. A ticket reassigned to me
yesterday counts in both figures. The alternative is reading `TicketHistory` for assignment
changes per ticket, which is a per-row scan on a dashboard load.

### AC2, AC3 — the queue's endpoint, a narrower table

The dashboard calls `GET /tickets?view=mine&sort=sla&dir=asc&pageSize=10`. `sla` ascending is
already "closest to breaching first" — the queue defined that and the dashboard inherits it, so
AC3's default costs one query parameter.

The table is `DataTable` with the seven columns AC2 names and no more: no channel, no
department, no assignee column (they are all mine). `SlaMeter` renders the SLA cell, so the
dashboard and the queue show the same chip — the rule US-69's AC6 exists to protect.

### AC4 — three of five actions, from existing controls

| Action | How |
| ------ | --- |
| Open | The subject is a link to `/tickets/:id`. |
| Reply | A link to `/tickets/:id#reply`, which focuses the composer US-1 built. |
| Change status | `TicketStatusControl`, inline. |
| Reassign | `TicketAssignee`, inline — it renders read-only for an agent without `ticket:assign`, which is its own AC4. |
| **Snooze** | **Does not exist.** No column, no endpoint, no story. |

Both controls are typed for `TicketDetail` today but read only a handful of fields. Their props
are widened to the shape they actually use, so a queue `Ticket` satisfies them — a smaller
change than duplicating either control, and it makes both honest about their dependencies.

**Snooze is flagged unmet.** There is nowhere to store a snooze-until, nothing to clear it, and
no story that owns it (US-56 is tasks). A button that appeared to snooze and did not would be
worse than its absence.

### AC5 — two queries, two skeletons

The KPI row and the table are separate queries with separate loading states, so neither waits
for the other. That is what "progressively" means here, and it falls out of using two hooks
rather than one endpoint returning both.

## Files

| Path | What |
| ---- | ---- |
| `packages/shared/src/dto/ticket.ts` | `AssignedSummarySchema` — four KPIs, each `{ value, previous }`. |
| `backend/src/tickets/tickets.service.ts` | `assignedSummary`. |
| `backend/src/tickets/tickets.controller.ts` | `GET /tickets/assigned/summary`. |
| `backend/src/tickets/dashboard.test.ts` | **New.** Every metric, its scope, and the edges. |
| `frontend/src/features/dashboard/dashboard-page.tsx` | The placeholder becomes the dashboard. |
| `frontend/src/features/dashboard/use-dashboard.ts` | **New.** The two queries. |
| `frontend/src/features/dashboard/dashboard-page.test.tsx` | **New.** AC1–AC5. |
| `frontend/src/features/tickets/ticket-status.tsx` | Prop widened to what it reads. |
| `frontend/src/features/tickets/ticket-assignee.tsx` | Same. |
| `frontend/src/i18n/locales/{en,ar}.json` | `dashboard.*`, both languages. |

No migration. No new dependency. **No new analytics infrastructure** — no snapshot table, no
aggregate table, no reporting service.

## Tests

Backend (`dashboard.test.ts`), against seeded facts it creates itself:

1. `open` counts my open tickets and excludes resolved and closed ones.
2. It excludes **another agent's** tickets and **unassigned** ones.
3. `pending` counts `PENDING_CUSTOMER` and `PENDING_INTERNAL`, and nothing else.
4. `dueSoon` counts a ticket inside its warning window; a comfortable one is not counted.
5. `breached` counts a ticket past its resolution target and one with the response flag set.
6. A resolved ticket past its target counts in **neither** `dueSoon` nor `breached`.
7. An agent with no assigned tickets gets four zeros — not an error, and not nulls.
8. `previous` for `open` reflects the state a week ago: a ticket resolved two days ago counts in
   `previous` and not in `value`.
9. `previous` is `null` for `pending`, `dueSoon` and `breached` — asserted, so the gap is
   explicit rather than incidental.
10. **Scope**: an agent scoped `ASSIGNED` sees only their own figures; the endpoint cannot be
    made to report another agent's workload.
11. Unauthenticated is 401; a portal token is 401.
12. A ticket with no SLA policy is counted in `open` and in neither SLA figure.

Frontend (`dashboard-page.test.tsx`):

13. AC1 — the four KPIs render with their values; the comparison shows only for `open`.
14. AC2 — the seven columns and no more.
15. AC3 — the first request is `sort=sla&dir=asc`, and the SLA header is marked as the sort.
16. AC4 — a row offers open, reply, status and reassign; **no snooze control exists**.
17. AC5 — skeletons appear for the KPIs and the table independently, and the table renders
    while the KPI query is still pending.
18. Empty state — no assigned tickets shows a message rather than an empty grid.
19. Arabic renders with no physical-direction classes.

## Acceptance criteria — verification

| AC | Result | Depends on |
| -- | ------ | ---------- |
| AC1 | ⚠️ **the four figures are met; the comparison is met for one of them.** Open, pending, due soon and breached all render and are asserted against seeded rows. `previous` is a real number for `open` and `null` for the other three, and the card says "No comparison available" rather than printing a zero. | a daily snapshot — P11 |
| AC2 | ✅ id, subject, customer, priority, status, SLA and updated, asserted as an exact header list — plus an actions column, and **no** assignee, department, channel or branch column. | — |
| AC3 | ✅ the first request is `view=mine&sort=sla&dir=asc`, and the SLA header reports `aria-sort="ascending"`. The queue's definition of urgency, inherited rather than restated. | — |
| AC4 | ⚠️ **four of five.** Open, reply, change status and reassign are all on the row, with the status change asserted to patch the right ticket. **Snooze does not exist.** | a story that owns snooze |
| AC5 | ✅ two queries, two skeletons. Asserted by holding the KPI response open and confirming the table renders without it — and that a failed KPI query does not take the table with it. | — |

**Verified.** Backend `dashboard.test.js` **15 pass, 0 fail** (new) and `tickets.test.js`
**72 pass** unchanged. Frontend: `dashboard-page.test.tsx` **13 pass** (new), and the tickets
and dashboard suites together **83 pass** — which covers the two controls whose props were
widened. Typecheck clean across all three workspaces; ESLint clean; Prettier clean.

## Reuse rather than recomputation

- **AC2 and AC3 added no endpoint.** The dashboard calls the queue's own list with
  `view=mine&sort=sla&dir=asc`, so "closest to breaching" has one definition.
- **The KPIs go through `slaFor`** — the same function the queue and the ticket header use.
  One query fetches the caller's open tickets and all four figures are derived from them,
  because the warning window is a fraction of each ticket's *own* target and cannot be a
  single SQL comparison. `assignedCount` made the same call for the same reason.
- **AC4's status and reassign are US-47's and US-48's controls**, permission gating included.
  Their props were widened from `TicketDetail` to the fields they actually read, so a queue row
  satisfies them — a smaller change than a second copy of either, and it makes both honest
  about their dependencies.
- **No analytics infrastructure**: no snapshot table, no aggregate table, no reporting service.

## Scope — the figures cannot report anybody else's work

`assigneeId: <caller>` **and** the caller's `ticket:view` scope are both in the `where`. The
scope clause can never widen this — a ticket assigned to me is inside any scope I could hold —
but rule #2 says scoped permissions are applied in the query, and a redundant clause that
cannot widen costs less than an argument about whether it was needed.

The endpoint takes **no parameters at all**, so there is no request shape that asks about
another agent. Tests assert another agent's tickets and unassigned tickets are both absent, that
the figure matches the caller's own row count, and that a portal token is refused.

## The edges that were worth testing

- A **resolved ticket past its target** counts in neither `dueSoon` nor `breached` — its clock
  stopped, and counting it would put finished work on the pile an agent picks from.
- A ticket **no policy governs** is open and in neither SLA figure: `state: 'none'` is not `ok`
  and not `breach`.
- `dueSoon` and `breached` **partition** rather than overlap, because `slaFor` returns one state.
- A **response breach** counts even while the resolution clock is comfortable — a missed promise
  is a missed promise.
- An agent with **nothing assigned** gets four zeros, not an error and not nulls.

## Deviations

**1. AC1's comparison is one metric, not four.** Only `open` is honestly reconstructible
(`createdAt`, `resolvedAt`, `closedAt`). The status a week ago is not stored, the breach flags
are current-only, and "due soon" is a window relative to now. The contract returns
`previous: null` for those three and the card renders no indicator — a "0%" where the truth is
"we do not know" is worse than a blank. Reconstructing them needs a daily snapshot, which is
analytics infrastructure this story was told not to add.

**2. `open`'s comparison takes assignment as current**, because `Ticket.assigneeId` is a column
and not a history. A ticket reassigned to me yesterday counts in both figures. The alternative
is scanning `TicketHistory` per ticket on every dashboard load. Stated in the endpoint's own
API description, not just here.

**3. AC4's snooze is absent**, with a test asserting its absence so the gap is explicit. No
column, no endpoint, no story owns it — US-56 is tasks. A button that appeared to snooze and
did not would be worse than none.

**4. The placeholder's `dashboard.placeholder` key is gone**, along with the placeholder its own
comment said not to grow into a dashboard.

## Flagged

- **AC1's comparison indicator** — only `open` has one. `pending`, `dueSoon` and `breached`
  cannot be compared without a daily snapshot, which is P11's analytics infrastructure and
  explicitly out of scope here.
- **AC4's snooze** — no column, no endpoint, no story owns it.
- **US-58 is not touched.** The manager dashboard is the next story and shares none of this
  code beyond the components both already use.
