# US-58 — Supervise the team from the manager dashboard

- **Feature:** `dashboards`
- **Story:** [Supervise the team from the manager dashboard](https://app.notion.com/p/3c69e0838523819eb422e275d10a2863)
- **Phase / Layer / Release:** P06 Agent Dashboard & Tasks · Full-stack · MVP · Must have
- **Depends on:** US-40 ✅
- **Intake:** `.squad/stories/dashboards/manager-team-dashboard/intake.md`
- **MVP position:** 26 of 28 — **the "Report" step of the core workflow**, since all of P11 is V2.

## The story

> **As a** manager **I want** an overview of team workload and SLA health **So that** I can
> intervene before things breach rather than after.

| AC | Requirement |
| -- | ----------- |
| **AC1** | Total open, unassigned, SLA at risk, SLA breached, **average response time**, **average resolution time**, and **customer satisfaction**. |
| **AC2** | Charts: tickets over time, by status, by priority, by department, and agent workload — clean and minimal. |
| **AC3** | A "tickets requiring attention" table: ticket, customer, agent, priority, SLA status, last update, with inline **reassign, escalate and view**. |
| **AC4** | A breached ticket in that table is **visually marked so it cannot be missed**. |
| **AC5** | Department and branch filters, respected by **every** KPI, chart and table. |
| **AC6** | An agent without management permission sees the **permission-denied screen**. |

## Scope — the manager's own, from the token, and filters that can only narrow

This is the part worth stating before anything else, because AC5 asks for a department filter
and a department filter is the shape a privilege escalation takes.

**The scope comes from `ticketScopeWhere(scopes, { userId, departmentId })`** — the caller's
`ticket:view` grants, resolved from their token, exactly as every other ticket read does. It is
in the `where` of every query on the page.

**AC5's `departmentId` and `branchId` are filters, not scope selectors.** They are `AND`ed with
the scope clause and can therefore only ever narrow it:

- an administrator (`ALL`) filtering by a department sees that department;
- a manager (`TEAM`) filtering by **another** department sees **zero**, not that department —
  scope ∩ filter is empty, and that is the correct answer rather than an error;
- no request can widen what the token allows, because the scope clause is not built from
  anything the request sent.

That is how AC5 and "never accept a scope selector from the request" hold at the same time, and
there is a test that a manager passing a foreign `departmentId` gets zeros.

`TicketListQuerySchema` already carries `departmentId` and `branchId` as filters, so the
attention table gets AC5 for free; the overview endpoint takes the same two.

## AC6 — `report:view`

The route is guarded by `report:view`, which the catalogue grants to a manager at `TEAM` and an
administrator at `ALL`, and **not to an agent**. The frontend route nests inside
`RequirePermission permission="report:view"`, which renders the permission-denied screen US-31
built — so AC6 is one route wrapper plus the guard behind it.

## AC1 — five of seven figures, from existing rules

`GET /tickets/team/overview`, on the tickets controller because that is where `scopeFor` and
`slaFor` already live. A separate reports module is P11's, and this story is told not to build
analytics infrastructure.

| KPI | How | Honest? |
| --- | --- | ------- |
| total open | SQL `count`, scope in the `where` | ✅ |
| unassigned | SQL `count`, `assigneeId: null` and open | ✅ |
| SLA at risk | `slaFor(...).state === 'warn'` over a bounded scoped fetch | ✅ |
| SLA breached | `state === 'breach'` or either breach flag | ✅ |
| average response time | mean of `firstRespondedAt − createdAt` | ✅ |
| average resolution time | mean of `resolvedAt − createdAt` | ✅ |
| **customer satisfaction** | **nothing to average** | ❌ |

**The SLA figures use `slaFor` and nothing else** — the same function US-55, the queue and the
ticket header use. No dashboard definition of "at risk", "breached", "open" or "resolved" is
created anywhere in this story.

**The two averages** are computed from a bounded fetch of two timestamp columns over a
**30-day window**, scoped. Not raw SQL: composing `ticketScopeWhere` into a hand-written
`EXTRACT(EPOCH …)` would mean writing the scope clause twice, in two languages, and rule #2's
whole point is that there is one mechanism for it. A narrow two-column select over a bounded
window is the same pattern `assignedCount` and US-55 use, and it keeps the scope in Prisma
where it can be trusted.

**Customer satisfaction is unmet.** There is no rating column, no endpoint that could set one,
and **US-88 is deferred** by the MVP scope. A satisfaction figure derived from anything else
available — resolution time, reopen count — would be a number with a label that lies about
what it measures. The KPI is omitted from the payload entirely rather than sent as a null the
client might render as "0%". **Flagged, dependency US-88.**

## AC2 — five distributions, and no charts library

`.squad/plans/00-mvp-scope.md` records the simplification for this story in its own words:
*"Team workload, SLA breaches, open by status. **No charts library**, no exports."* Recharts is
in `CLAUDE.md`'s stack list but is **not installed**, and adding it here would be both a new
dependency and a contradiction of the scope decision.

So the five distributions render as **accessible bar rows** — a label, a proportional bar, and
the number — built from the design system's own tokens. AC2 asks for "clean and minimal", and a
labelled bar row with its figure beside it is more legible at this size than a chart canvas, as
well as being readable by a screen reader and printable.

Where each comes from:

| Distribution | Query |
| ------------ | ----- |
| by status | Prisma `groupBy` on `status`, scope in the `where` |
| by priority | `groupBy` on `priority` |
| by department | `groupBy` on `departmentId`, names resolved in a second indexed read |
| agent workload | `groupBy` on `assigneeId` over open tickets, names resolved likewise |
| over time | the bounded 30-day fetch, bucketed by day |

`groupBy` keeps four of the five entirely in the database. "Over time" needs date truncation,
which Prisma's `groupBy` cannot express, so it is bucketed from the same bounded window the
averages already read — one fetch serving two purposes rather than a second query.

## AC3 — the attention table, from the queue's own pipeline

**A new filter on the existing list, not a new endpoint.** `TicketListQuerySchema` gains
`attention: 'true'`, the same shape `unassigned` already has, and `whereFrom` turns it into one
SQL group:

```
status NOT IN (RESOLVED, CLOSED)
AND ( firstResponseBreached OR resolutionBreached
      OR status = ESCALATED
      OR resolutionDueAt < now )
```

Everything else — the scope, the sort, the paging, the serialisation, the `total` — is the
queue's, already tested. `sort=sla&dir=asc` puts the worst first.

**Purely SQL, and that is deliberate.** The at-risk *fraction* cannot be a SQL comparison, so
including it would mean filtering fetched rows and reporting a `total` that disagreed with the
rows returned — the caveat the queue's own `warn` filter carries. "Requiring attention" is
therefore **already past a target, or escalated**: the tickets a manager must act on now. The
`resolutionDueAt < now` clause covers the minute between a deadline passing and the sweep
flagging it. Intervening *before* a breach is served by the **SLA at risk** KPI beside the
table, which is where the fraction can be computed honestly.

This is also **US-71's AC4**, which that story flagged as belonging here.

The three inline actions reuse what exists:

| Action | How |
| ------ | --- |
| Reassign | `TicketAssignee` — US-48's control, its `ticket:assign` gating intact |
| Escalate | `PATCH /tickets/:id/status` with `ESCALATED` — US-47's validated transition, which already requires `ticket:escalate`. **No new lifecycle rule and no new endpoint.** |
| View | A link to `/tickets/:id` |

## AC4 — breach emphasis

`DataTable` already takes `rowClassName`, so a breached row gets a tinted ground and an
inline-start rule. **Plus the words**: the SLA cell is `SlaMeter`, which names the state, and
the row carries a "Breached" badge. The definition of done forbids colour as the only signal,
and a manager scanning for what to escalate is exactly the person a colour-only cue fails.

## Files

| Path | What |
| ---- | ---- |
| `packages/shared/src/dto/ticket-counts.ts` | `TeamOverviewSchema`, `DistributionSchema`. |
| `packages/shared/src/dto/ticket.ts` | `attention` on the list query. |
| `backend/src/tickets/tickets.service.ts` | `teamOverview`; the `attention` clause in `whereFrom`. |
| `backend/src/tickets/tickets.controller.ts` | `GET /tickets/team/overview`, guarded `report:view`. |
| `backend/src/tickets/team-dashboard.test.ts` | **New.** Scope, every figure, the edges. |
| `frontend/src/features/dashboard/team-dashboard-page.tsx` | **New.** KPIs, bars, table. |
| `frontend/src/features/dashboard/team-dashboard.test.tsx` | **New.** AC1–AC6. |
| `frontend/src/features/dashboard/use-dashboard.ts` | The two new queries. |
| `frontend/src/app/router.tsx` | `/team`, inside `RequirePermission report:view`. |
| `frontend/src/components/shell/nav-model.ts` | A nav item for it. |
| `frontend/src/i18n/locales/{en,ar}.json` | `team.*`, both languages. |

No migration. **No new dependency.** No snapshot table, no aggregate table, no reporting
service.

## Tests

Backend (`team-dashboard.test.ts`), against rows it seeds itself:

1. A manager's figures cover their **whole department**, not just their own assigned tickets.
2. **Another department's tickets are excluded** from every KPI and every distribution.
3. **A foreign `departmentId` filter returns zeros**, not that department's data.
4. An administrator's filter *does* narrow to the department they ask for.
5. Unassigned: counted in `unassigned` **and** in `open`, and absent from agent workload.
6. The KPI figures equal the scoped row counts, computed independently in the test.
7. The SLA figures match `slaFor`: at-risk and breached partition, a resolved ticket past its
   target is in neither, and a ticket with **no policy** is open and in neither.
8. The averages are computed over responded/resolved tickets only, and are **null** when there
   is nothing to average — not zero.
9. `attention=true` returns breached and escalated tickets and **not** healthy ones, with the
   caller's scope still applied.
10. Empty: a manager whose department has no tickets gets zeros and empty distributions.
11. `report:view` is required — an agent is **403**.
12. A portal token is **401**; unauthenticated is **401**.
13. `customerSatisfaction` is **absent from the payload**, asserted, so the gap is explicit.

Frontend (`team-dashboard.test.tsx`):

14. AC1 — the six available KPIs render; satisfaction is absent and not a "0".
15. AC2 — five labelled distributions, each with its figures, and no canvas or SVG chart.
16. AC3 — the table's seven columns, and reassign, escalate and view on a row.
17. AC3 — escalate PATCHes `/tickets/:id/status` with `ESCALATED`.
18. AC4 — a breached row is marked, in words as well as by colour.
19. AC5 — changing the department filter re-requests **every** query with it.
20. AC6 — an agent without `report:view` sees the permission-denied screen at `/team`.
21. Empty and error states; Arabic with no physical-direction classes.

## Flagged

- **AC1's customer satisfaction** — unmet. No rating exists anywhere; **US-88** owns it.
- **AC2's "charts"** — rendered as accessible bar rows, not a charting library, per the scope
  document's own simplification for this story. A deviation in medium, not in content.
- **AC3's "requiring attention"** is *past a target or escalated*, purely in SQL. At-risk is the
  KPI beside it, because the fraction cannot be a SQL comparison without breaking `total`.
- The averages read a **30-day window** with a bounded row cap; stated in the API description.
