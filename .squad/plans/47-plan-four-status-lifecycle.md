# Four-status lifecycle — investigation and plan

**Requested:** collapse `TicketStatus` to `NEW`, `WAITING_FOR_AGENT`, `WAITING_FOR_CUSTOMER`,
`RESOLVED`, drive transitions from business events, keep escalation as data, and migrate
existing rows.

**Status: nothing implemented.** Steps 3–8 of the brief are not started. This is Steps 1 and 2.

Written against commit `c1735b2`. Supersedes the five-status target in
`46-impact-report-status-simplification.md`; §5 and §7 of that report still hold.

---

## 1. Where we are

Seven statuses today: `NEW`, `OPEN`, `PENDING_CUSTOMER`, `PENDING_INTERNAL`, `ESCALATED`,
`RESOLVED`, `CLOSED`. Live data: 17 tickets — 3 `NEW`, 10 `ESCALATED`, 2 `RESOLVED`,
1 `CLOSED`, 1 `OPEN`.

Three things write a status, and only three:

| Writer | Where | Trigger |
| ------ | ----- | ------- |
| `changeStatus` | `tickets.service.ts` | An agent picks a status. Validated by `canTransition` + `STATUS_PERMISSION` |
| `onCustomerReply` | `tickets.service.ts:1523` | A customer reply to a `RESOLVED` ticket → `OPEN` |
| the SLA sweep | `sla-escalation.service.ts:225` | A breach rung with `changeStatusToEscalated` → `ESCALATED` |

**Nothing else does.** Assignment does not touch status (US-48 kept it out of the state
machine on purpose) and neither does an agent's reply — which is why two of the brief's five
events are new behaviour rather than renames.

---

## 2. Dependency map

### Contract and database

| Location | What it holds | Change |
| -------- | ------------- | ------ |
| `backend/prisma/schema.prisma:41` | `enum TicketStatus`, 7 values | 4 values. Postgres cannot drop enum values — the type is recreated |
| `schema.prisma:535` | `status TicketStatus @default(NEW)` | Unchanged |
| `schema.prisma:613-624` | **7 indexes on `status`** | Rebuilt by the type swap; no definition changes |
| `schema.prisma:581-583` | `escalatedAt`, `escalatedToId` | **Unchanged and now load-bearing** — this is where escalation lives |
| `schema.prisma` `closedAt` | Set when a ticket reached `CLOSED` | Column **kept**, nothing writes it. Their brief defers customer close to "a separate action or field", and this is that field |
| `packages/shared/src/dto/ticket.ts:13` | `TicketStatusSchema` | The one canonical definition both sides import |
| `ticket.ts:43` | `TICKET_TRANSITIONS` (7 × ~5) | 4 × ≤2 (§3) |
| `ticket.ts:72` | `STATUS_PERMISSION` | `ESCALATED` and `CLOSED` entries go; `RESOLVED: ticket:close` stays |
| `ticket.ts` `TicketSchema` | `closedAt` on the wire | Stays (nullable, historical) |
| `packages/shared/src/dto/portal.ts:32-65` | `PortalTicketStatusSchema` + `PORTAL_STATUS` + its inverse | **Deleted** (§6) |
| `packages/shared/src/dto/ticket-counts.ts:11` | `TICKET_VIEWS` includes `escalated` and `closed` | `closed` → `resolved`; `escalated` keeps its name and changes its `where` |

### Behaviour that reads a status

| Location | Reads | Change |
| -------- | ----- | ------ |
| `sla-clock.service.ts:20` | `PAUSED_STATUS = 'PENDING_CUSTOMER'` | → `WAITING_FOR_CUSTOMER`. **The pause/resume machinery is untouched** — `onStatusChange` pauses on entering that status and banks the elapsed time on leaving it, whatever the destination |
| `sla-clock.service.ts:23` · `sla-escalation.service.ts:27` | `FINISHED_STATUSES = [RESOLVED, CLOSED]` | → `[RESOLVED]` |
| `sla-escalation.service.ts:222-259` | Writes `status: 'ESCALATED'`, guards on `canTransition(…, 'ESCALATED')` and `status === 'ESCALATED'` | **Stops writing status.** Keeps `escalatedAt` + `escalatedToId`, which it already writes. Idempotency becomes `escalatedAt !== null` alone — already half the existing condition. The "cannot legally reach ESCALATED, leaving the status alone" warning branch disappears with the problem |
| `schema.prisma:857` | `SlaEscalationStep.changeStatusToEscalated` | Column and seeded ladders keep working; **its meaning becomes "mark escalated"**. Rename deferred — a migration for a name, while every value stays valid, is not worth it in this change |
| `tickets.service.ts:167` | `statusTimestamps`: `to === 'OPEN' && from ∈ {RESOLVED, CLOSED}` → clears `resolvedAt`, bumps `reopenCount` | Depends on **Decision 1** |
| `tickets.service.ts:1529` | `onCustomerReply`: `RESOLVED → OPEN` | Depends on **Decision 1** |
| `tickets.service.ts:484` | `viewWhere('escalated')` = `status: 'ESCALATED'` | → `escalatedAt: { not: null }` **and** not resolved |
| `tickets.service.ts:497` | `viewWhere('closed')` = `status IN (RESOLVED, CLOSED)` | → `status: 'RESOLVED'`, view renamed `resolved` |
| `tickets.service.ts` ×6 | `status: { notIn: ['RESOLVED','CLOSED'] }` — the definition of "open" in the queue, both dashboards, the sidebar badge and the customer context panel | → `{ not: 'RESOLVED' }`. **This is why "open" survives losing the `OPEN` status** (§7) |
| `tickets.service.ts:586` | US-55's "Pending" KPI = `PENDING_CUSTOMER \|\| PENDING_INTERNAL` | → `WAITING_FOR_CUSTOMER` |
| `tickets.service.ts` `attention` | `status: 'ESCALATED'` in US-58's group | → `escalatedAt: { not: null }` |
| `ticket-history.service.ts:145` | `statusEventFor` — `REOPENED` when `to === 'OPEN'` from a finished state; `CLOSED` event | Depends on **Decision 1**; the `CLOSED` event type stays in the enum, unwritten |
| `portal.service.ts:558` | A reply to a `CLOSED` ticket is refused 422 | Depends on **Decision 1** |
| `portal.service.ts:109` | Customer timeline maps history `toValue` through `PORTAL_STATUS` | Needs the **legacy** map too, or old events vanish from a customer's timeline (§6) |
| `customers.service.ts` | one open-ticket count | Same `notIn` → `not` change |

### Presentation

| Location | What | Change |
| -------- | ---- | ------ |
| `frontend/src/lib/design-tokens.ts:32-99` | The status list **and** `STATUS_PRESENTATION` — icon, colour and label key per status | 7 → 4 entries. Each keeps an icon and a text label; colour is never the only signal |
| `features/tickets/ticket-status.tsx` | The transition control | **Reads `TICKET_TRANSITIONS`; adapts by itself.** No edit expected |
| `features/tickets/ticket-header.tsx`, `tickets-queue-page.tsx`, `dashboard-page.tsx`, `team-dashboard-page.tsx` | Status literals in filters and labels | Mechanical |
| `components/domain/ticket-timeline.tsx:106` | Builds `ticket.status.${camel(value)}` from **history text** | Retired keys must survive, or a 2026 timeline renders `ticket.status.open` (§5) |
| `features/portal/portal-requests.tsx`, `portal-request-page.tsx` | Portal status chips and filter | Now render the canonical status through the customer label map |
| `i18n/locales/{en,ar}.json` | `ticket.status.*` ×7, portal status labels ×5 | 4 canonical + 4 agent-facing next-action phrasings + 4 customer labels + **retired keys kept for history** |
| `features/design-system/design-system-page.tsx:241` | Hardcodes `ESCALATED` | Mechanical |
| `components/shell/nav-model.ts`, `queue-tabs.tsx` | The `escalated` and `closed` tabs | `closed` → `resolved`; `escalated` stays, meaning changes |

### Tests — 14 files, ~180 assertions

`tickets.test.ts` (40) · `portal-reply.test.ts` (23) · `sla-escalation.test.ts` (17) ·
`dashboard.test.ts` (12) · `domain-schema.test.ts` (11) · `portal.test.ts` (11) ·
`team-dashboard.test.ts` (10) · `ticket-history.test.ts` (7) · `sla-clock.test.ts` (7) ·
`demo-seed.test.ts` (7) · `portal-list.test.ts` (6) · `portal-submit.test.ts` (19, 2 touch
status) · frontend: `ticket-status.test.tsx` (7), `portal-requests.test.tsx` (6),
`team-dashboard.test.tsx` (8), `ticket-timeline.test.tsx` (3), `components.test.tsx` (4).

Two need thought rather than search-and-replace, because they are the tests that would
otherwise be edited into agreeing with a bug:

- `domain-schema.test.ts` asserts the **enum members** directly.
- `sla-escalation.test.ts` asserts `status === 'ESCALATED'` — the assertion becomes
  `escalatedAt !== null` **and** that the status did *not* move.

`backend/src/seed/demo-data.ts` seeds `NEW ×2, OPEN ×4, PENDING_CUSTOMER ×2,
PENDING_INTERNAL ×2, ESCALATED ×1, RESOLVED ×2, CLOSED ×1` — re-expressed in the new
vocabulary so the demo still shows every state.

---

## 3. The state machine

```
NEW ──────────────→ WAITING_FOR_AGENT
                          │   ↑
                          ↓   │
                    WAITING_FOR_CUSTOMER
                          │
        both ─────────────┴──→ RESOLVED
```

```ts
NEW:                  ['WAITING_FOR_AGENT']
WAITING_FOR_AGENT:    ['WAITING_FOR_CUSTOMER', 'RESOLVED']
WAITING_FOR_CUSTOMER: ['WAITING_FOR_AGENT', 'RESOLVED']
RESOLVED:             []          // pending Decision 1
```

**Permissions.** `RESOLVED` keeps `ticket:close`; everything else needs `ticket:update`,
which is the existing floor. The event-driven transitions in §4 do **not** go through
`STATUS_PERMISSION`: assignment is already gated by `ticket:assign` and a reply by
`message:create`, and requiring `ticket:update` on top would break both for an agent who
legitimately holds one but not the other. Stated here because it is a real widening of what
can move a status without `ticket:update`.

---

## 4. The five events

| Event | Transition | Today | Work |
| ----- | ---------- | ----- | ---- |
| Customer or agent creates | → `NEW` | already `NEW` | none |
| Assignment | `NEW → WAITING_FOR_AGENT` | **assignment never touches status** | new. Guarded: only from `NEW`, so reassigning an active ticket does not reset it, per the brief |
| Agent's customer-facing reply | `NEW`/`WAITING_FOR_AGENT` → `WAITING_FOR_CUSTOMER` | reply writes `lastAgentReplyAt` + `firstRespondedAt`; **status untouched** | new, and it **pauses the resolution clock** (§8) |
| Internal note | no change | already no change | a test pinning it |
| Customer reply | `WAITING_FOR_CUSTOMER → WAITING_FOR_AGENT` | `onCustomerReply` handles `RESOLVED` only | extend the **existing** method — no second implementation |
| Agent resolves | `WAITING_FOR_AGENT`/`WAITING_FOR_CUSTOMER` → `RESOLVED` | exists | rename |

**`NEW` + an agent reply.** The brief's table has no `NEW → WAITING_FOR_CUSTOMER` edge, but an
agent can reply to an unassigned `NEW` ticket today and will keep doing so. Proposal: a
customer-facing reply from `NEW` moves straight to `WAITING_FOR_CUSTOMER` — the reply is
proof the team has it, and refusing would leave a replied-to ticket sitting in `NEW`. This
adds one edge to the table above (`NEW → WAITING_FOR_CUSTOMER`). **Decision 2.**

---

## 5. Migration

One migration, four steps, no data deleted.

**Step 1 — the enum.** Postgres cannot drop a value from an enum, so:
`CREATE TYPE "TicketStatus_new"` with the four values → `ALTER TABLE "Ticket" ALTER COLUMN
status TYPE "TicketStatus_new" USING (mapping)` → drop the old type → rename. The seven
`status` indexes are rebuilt by the column rewrite; none of their definitions change.

**Step 2 — the row mapping.** `OPEN` and `ESCALATED` are the only ambiguous ones, and the
schema already carries the answer: US-6 denormalised `lastAgentReplyAt` and
`lastCustomerReplyAt` precisely so "waiting on us" versus "waiting on them" is a column
comparison. So the mapping asks **who spoke last** rather than guessing:

| Old | New | Why |
| --- | --- | --- |
| `NEW` | `NEW` | identical meaning |
| `PENDING_CUSTOMER` | `WAITING_FOR_CUSTOMER` | identical meaning |
| `PENDING_INTERNAL` | `WAITING_FOR_AGENT` | internal work is still the team's turn — and **nothing ever wrote this value**, so no live row is affected |
| `OPEN` | `WAITING_FOR_CUSTOMER` if `lastAgentReplyAt > coalesce(lastCustomerReplyAt, createdAt)`, else `WAITING_FOR_AGENT` | the last word decides whose turn it is |
| `ESCALATED` | same rule, default `WAITING_FOR_AGENT` | escalation is not a turn. **Plus step 3** |
| `CLOSED` | `RESOLVED` | the only terminal state left. `closedAt` is preserved, so which ones were closed rather than merely resolved is still recoverable |
| `RESOLVED` | `RESOLVED` | identical |

**Step 3 — no escalation is lost.** Every row with `status = 'ESCALATED'` and
`escalatedAt IS NULL` gets `escalatedAt` backfilled from its earliest `ESCALATED` history
entry, falling back to `updatedAt`. Without this, dropping the status would silently
un-escalate the 10 escalated tickets in the dev database. The sweep already writes
`escalatedAt` for anything it escalates from now on.

**Step 4 — history is left alone.** `TicketHistory` is append-only, enforced by the trigger
US-50's AC4 added, and its `fromValue`/`toValue` are text. Old rows will say `OPEN`,
`PENDING_INTERNAL`, `ESCALATED`, `CLOSED` forever. Therefore the **retired label keys stay in
both locale files**, marked historical, on the staff timeline *and* in the portal's event
mapper — otherwise a 2026 timeline renders the literal string `ticket.status.open` to staff
and drops the event entirely for a customer.

**Reversibility.** The down migration can restore the type but not the distinctions
(`OPEN` versus `PENDING_INTERNAL`, `RESOLVED` versus `CLOSED` where `closedAt` is null).
Stated rather than pretended: this is a forward-only change, which is why the mapping is
computed from data rather than assumed.

---

## 6. The portal, and deleting `PORTAL_STATUS`

`PORTAL_STATUS` exists because seven internal states had to be flattened to five
customer-facing ones. At four, the internal vocabulary **is** the customer vocabulary: the
brief's four labels map 1:1. So `PortalTicketStatusSchema`, `PORTAL_STATUS` and its inverse
filter go, the portal DTO carries the canonical status, and the labels live in the portal's
i18n:

| Status | Customer sees | Agent sees |
| ------ | ------------- | ---------- |
| `NEW` | Received | New |
| `WAITING_FOR_AGENT` | Waiting for support | Your action is required |
| `WAITING_FOR_CUSTOMER` | Waiting for your reply | Waiting for customer |
| `RESOLVED` | Resolved | Resolved |

Two consequences worth being explicit about:

1. **The portal API's status values change** (`OPEN` → `NEW`, `WAITING_ON_YOU` →
   `WAITING_FOR_CUSTOMER`, …). Only our own client consumes it, so this is safe now and
   would not be later.
2. **The allowlist DTO stays an allowlist.** Sharing the status enum is not sharing the
   ticket DTO: the portal schemas remain hand-built, and the five leak protections US-82
   put in place are untouched. Nothing internal is expressible in the four values — which
   is exactly why the mapping can go.

---

## 7. Dashboards, and the definition of "open"

`OPEN` disappears as a status; "open" as a *concept* is already
`status NOT IN (RESOLVED, CLOSED)` in six places and becomes `status <> 'RESOLVED'`.

**Documented definition:** **Active = `NEW` + `WAITING_FOR_AGENT` + `WAITING_FOR_CUSTOMER`.**
Every "open tickets" figure on the agent dashboard (US-55), the manager dashboard (US-58),
the queue tabs, the sidebar badge and the customer context panel means exactly that, and
none of them changes what it counts — only how it is spelled. US-55's "Pending" KPI becomes
`WAITING_FOR_CUSTOMER` alone. US-58's "at risk" and "breached" are unchanged: they come from
`slaFor`, which reads due dates and breach flags, not statuses.

---

## 8. SLA

One line changes: `PAUSED_STATUS` becomes `WAITING_FOR_CUSTOMER`. The pause and resume
machinery is untouched — `onStatusChange` banks the paused interval and pushes the deadline
out by exactly that much, whatever the destination status is.

**But the *frequency* of pausing changes, and that is the largest behavioural risk in this
change.** Today the clock pauses only when an agent explicitly sets `PENDING_CUSTOMER`, which
in the demo data has happened twice. Under the new model **every customer-facing reply
pauses the resolution clock**, because every reply moves the ticket to
`WAITING_FOR_CUSTOMER`. Resolution times will get longer and breach counts will fall, on
every dashboard, immediately.

That follows from the brief and I think it is the honest reading of "waiting on them" — but
it is a policy change, not a rename, and it should be your stated decision. **Decision 3.**

The first-response clock is unaffected: `firstRespondedAt` still stops it, once.

---

## 9. Escalation

The sweep keeps everything except the status write: threshold detection, the recipient,
`escalatedAt`, `escalatedToId`, the `ESCALATED` history entry with its automation rule, and
the per-rung records. `ESCALATED` as a *history event type* stays in `TicketEventType` — the
brief agrees escalation is an event.

Consequences, all already listed in §2: the queue's `escalated` tab and US-58's "needs
attention" group switch from `status = 'ESCALATED'` to `escalatedAt IS NOT NULL` and not
resolved; the "cannot legally reach ESCALATED" branch is deleted along with the problem it
worked around; idempotency rests on `escalatedAt`.

One improvement falls out: today a ticket the sweep cannot legally move to `ESCALATED` is
logged and left un-escalated. As data, escalation always records.

---

## 10. Decisions I need before Step 3

**Decision 1 — reopening. This is the one that changes the most code.**

Your transition table says `RESOLVED → nothing`, and also "do not invent reopening
behaviour". There is no invention needed: **reopening already exists, deliberately, and is
tested.** US-47 decided a customer reply to a `RESOLVED` ticket reopens it, US-85 gave that
rule its only caller, and `portal-reply.test.ts` asserts it. It is why `reopenCount` and the
`REOPENED` history event exist.

So the two readings are:

| | Behaviour | Cost |
| - | --------- | ---- |
| **1a — keep it** (my recommendation) | `RESOLVED → WAITING_FOR_AGENT`, by a customer reply only. No agent-facing transition out of `RESOLVED` | Adds one edge to your table. Keeps `reopenCount`, `REOPENED`, `statusTimestamps`' clearing rule, and US-47/US-85's tests as they are |
| **1b — drop it** | `RESOLVED` is terminal. A customer reply to a resolved request is refused, as a reply to a closed one is today | Deletes the reopen rule, `reopenCount`'s only writer, the `REOPENED` event's only writer, and ~6 assertions. **A customer whose problem was not actually fixed has no way back in** until a "reopen" or "customer close" story exists |

1b is closer to the letter of your table; 1a is closer to "do not invent, and do not remove
what the product already does". I recommend **1a** and will implement 1b without argument if
you say so.

**Decision 2 — `NEW` + an agent reply.** Add the `NEW → WAITING_FOR_CUSTOMER` edge (§4), or
require assignment first and refuse the reply? *Recommendation: add the edge.*

**Decision 3 — the SLA pause (§8).** Confirm that every agent reply should pause the
resolution clock. It follows from the brief; it will move every SLA figure.

**Decision 4 — the queue's `closed` tab.** Rename the view to `resolved` (a query-parameter
change, ours alone) or keep the word "closed" as a label over `status = 'RESOLVED'`?
*Recommendation: rename, since you asked for no references to removed statuses.*

---

## 11. Sequencing, once decided

| # | Step | Verified by |
| - | ---- | ----------- |
| 1 | Shared contract: the enum, transitions, `STATUS_PERMISSION`; delete `PORTAL_STATUS` | `tsc -b` fails everywhere that reads a retired value — the compiler *is* the checklist |
| 2 | Migration: type swap, row mapping, `escalatedAt` backfill | a count per status before and after, on the dev database |
| 3 | Escalation: stop writing status | `sla-escalation.test.ts` |
| 4 | SLA: `PAUSED_STATUS` | `sla-clock.test.ts` |
| 5 | The five events: assign, agent reply, customer reply, resolve | new tests per event, plus the internal-note test |
| 6 | Queue, dashboards, portal service | `tickets.test.ts`, `dashboard.test.ts`, `team-dashboard.test.ts`, the four portal suites |
| 7 | Frontend: tokens, labels both languages, timeline legacy keys, tabs, portal chips | the frontend suites |
| 8 | Seed re-expressed; then the real walk-through end to end | the browser path, as in the last two fixes |

Estimated blast radius: **~40 source files, 1 migration, 17 test files.** No new dependency.
No snapshot or aggregate table. No second lifecycle for agent-created tickets — US-41, when
it lands, uses this one.
