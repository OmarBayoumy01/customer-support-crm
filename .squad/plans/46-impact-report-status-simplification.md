# Impact report — three personas, five statuses

**Requested:** simplify the mental model to three business personas and five ticket statuses,
without breaking anything already working.
**Status:** report only. **No code has been changed.** Step 11 of the brief's critical rule
is not started.

Written against commit `5cca64b`.

---

## 1. Verdict up front

| Question | Answer |
| -------- | ------ |
| Can the five-status model carry every behaviour built so far? | **Yes** — with two caveats below, both solvable |
| Does any information get lost? | **No.** `escalatedAt` / `escalatedToId` already exist and are already written |
| Is the persona model already three? | **In the authorisation system, no** — there are four roles, and that is fine. **In the product, one boundary is broken today** (§7) |
| Biggest risk | The **history table is append-only, enforced by a database trigger**. Old status names cannot be rewritten (§5) |
| Second biggest | The workflow the brief describes needs **three status transitions that do not exist yet** (§4). This is new behaviour, not a rename |
| Size | ~40 source files, ~180 references, 1 migration, ~14 test files. Not a rename — a lifecycle change |

---

## 2. The persona question

The brief asks for three personas. The authorisation system has **four roles**
(`administrator`, `manager`, `agent`, `customer`) and the brief explicitly allows that:
*"The distinction between permissions/roles can remain in the authorization system if
required."*

Product surfaces today, mapped to the three personas:

| Persona | Surfaces | Roles that reach them |
| ------- | -------- | --------------------- |
| Customer | `/portal/*` — sign in, submit, list, thread, reply | `customer` (needs a linked `Customer` row) |
| Agent | `/dashboard`, `/tickets`, ticket workspace | `agent`, and anyone above |
| Admin / Manager | `/team` (workload, SLA, attention), `/admin` (users, roles), assignment | `manager` (`TEAM`), `administrator` (`ALL`) |

**Nothing needs merging.** Admin and Manager already share one product surface — `/team` is
one page whose numbers differ only by the caller's scope, which is precisely "one workflow,
two scopes". No separate admin dashboard exists to collapse.

---

## 3. Status inventory — every reference, by concern

Seven statuses today: `NEW`, `OPEN`, `PENDING_CUSTOMER`, `PENDING_INTERNAL`, `ESCALATED`,
`RESOLVED`, `CLOSED`.

### Contract and database

| Location | What | Action |
| -------- | ---- | ------ |
| `backend/prisma/schema.prisma:41` | `enum TicketStatus` | Add 2 values, retire 3. Postgres cannot drop enum values — the type must be recreated |
| `schema.prisma:613-624` | **7 indexes on `status`** | Rebuilt by the enum swap; no definition change |
| `packages/shared/src/dto/ticket.ts:13` | `TicketStatusSchema` | The single source both sides import |
| `ticket.ts:43` | `TICKET_TRANSITIONS` | Shrinks from 7×~5 to 5×~3 (§4) |
| `ticket.ts:72` | `STATUS_PERMISSION` | `ESCALATED` entry goes; `RESOLVED`/`CLOSED` stay |
| `packages/shared/src/dto/portal.ts:52` | `PORTAL_STATUS` (internal → customer-facing) | **Becomes almost 1:1**, which is the real prize (§6) |
| `portal.ts:~211` | `PORTAL_STATUS_FILTER` (the inverse) | Simplifies with it |

### Behaviour that reads a status

| Location | Reads | Effect of the change |
| -------- | ----- | -------------------- |
| `sla-clock.service.ts:20` | `PAUSED_STATUS = 'PENDING_CUSTOMER'` | Rename to `WAITING_FOR_CUSTOMER`. **The pause rule must survive verbatim** — it is what stops a clock running while a customer is thinking |
| `sla-clock.service.ts:23` | `FINISHED_STATUSES = [RESOLVED, CLOSED]` | Unchanged |
| `sla-escalation.service.ts:27` | same | Unchanged |
| `sla-escalation.service.ts:225-253` | `status === 'ESCALATED'`, `canTransition(…,'ESCALATED')`, writes `status: 'ESCALATED'` | **The core edit.** Drop the status write; keep `escalatedAt` + `escalatedToId`, which it already writes. Idempotency moves entirely onto `escalatedAt !== null` — already half the condition |
| `schema.prisma:857` | `SlaEscalationStep.changeStatusToEscalated` | Semantics become "mark escalated". Rename is cosmetic; **the column and the seeded ladders keep working either way** |
| `tickets.service.ts:586` | `PENDING_CUSTOMER \|\| PENDING_INTERNAL` → the dashboard's "Pending" KPI | Becomes one status. US-55's AC1 wording ("pending") still holds |
| `tickets.service.ts:~484` | `viewWhere('escalated')` → `status: 'ESCALATED'` | Becomes `escalatedAt: { not: null }` **and** open. Queue tab and its count both come from this one function, so they cannot disagree |
| `tickets.service.ts` `attention` clause | `status: 'ESCALATED'` in the US-58 group | Same substitution. Still one SQL group, so `total` stays honest |
| `tickets.service.ts:167` | `statusTimestamps`: reopen detected as `to === 'OPEN'` | Becomes `IN_PROGRESS` |
| `tickets.service.ts:1529` | `onCustomerReply`: `RESOLVED → OPEN` | Becomes `RESOLVED → IN_PROGRESS`. **One implementation, reused — no second reopen path** |
| `tickets.service.ts` (open counts, ×5) | `notIn: ['RESOLVED','CLOSED']` | Unchanged — this is why "open" survives losing the `OPEN` status |
| `customers.service.ts` | one open-ticket count | Unchanged |

### Presentation

| Location | What | Action |
| -------- | ---- | ------ |
| `frontend/src/lib/design-tokens.ts:32-99` | The status list **and** `STATUS_PRESENTATION` — colour, icon, label key per status | 7 entries → 5. Each has an icon and a text label; the definition of done forbids colour alone, so both must move together |
| `features/tickets/ticket-status.tsx` | The transition control | **Reads `TICKET_TRANSITIONS` — adapts on its own.** No edit expected |
| `components/domain/ticket-timeline.tsx:106` | `ticket.status.${camel(value)}` from **history text** | ⚠️ Needs a legacy label map (§5) |
| `i18n/locales/{en,ar}.json` → `ticket.status.*` | 7 keys × 2 languages | 5 keys × 2, **plus** legacy keys kept for history (§5) |
| `features/design-system/design-system-page.tsx:241` | Hardcodes `ESCALATED` in a demo | Update |
| `queue-tabs.tsx:13` | `escalated:` tab icon | Tab stays (it is a view, not a status) |

### Tests — 14 files, ~180 assertions

`tickets.test.ts` (40) · `portal-reply.test.ts` (23) · `sla-escalation.test.ts` (17) ·
`dashboard.test.ts` (12) · `domain-schema.test.ts` (11) · `portal.test.ts` (11) ·
`team-dashboard.test.ts` (10) · `ticket-history.test.ts` (7) · `sla-clock.test.ts` (7) ·
`demo-seed.test.ts` (7) · `portal-list.test.ts` (6) · plus 5 frontend suites.

`domain-schema.test.ts` asserts the **enum members** directly, and
`sla-escalation.test.ts` asserts **`status === 'ESCALATED'`** — those two are the ones that
must be rewritten thoughtfully rather than search-replaced, because they are the tests that
would otherwise be edited into agreeing with a bug.

`backend/src/seed/demo-data.ts` (15) seeds statuses; the demo set must be re-expressed.

---

## 4. The transitions the new workflow needs — and does not have

This is the part that is **not** a rename, and the reason this cannot be done as one.

| Brief | Today | Gap |
| ----- | ----- | --- |
| Step 2 — assign ⇒ `IN_PROGRESS` | `assign()` sets `assigneeId` and **never touches status** | **New behaviour.** Deliberate today: US-48 kept assignment out of the state machine, and US-47 owns status |
| Step 4 — agent's customer-facing reply ⇒ `WAITING_FOR_CUSTOMER` | The reply writes `lastAgentReplyAt`, `firstRespondedAt` and the clock. **Status untouched** | **New behaviour**, and it **starts the SLA pause** — a reply would now stop the resolution clock. That is a real change to SLA arithmetic, not a label |
| Step 5 — customer reply ⇒ `IN_PROGRESS` | `onCustomerReply` handles **`RESOLVED` only** | Extend the existing method — already flagged as unmet in `00-workflow-status.md` |
| Step 7 — customer accepts ⇒ `CLOSED` | **No portal close endpoint exists.** Portal has 6 routes; none closes | **New endpoint + UI.** Nearest owner is US-90 (deferred) |
| Step 8 — reply to `RESOLVED` ⇒ `IN_PROGRESS` | Exists, `RESOLVED → OPEN` | Rename only ✅ |

**Two of these change SLA behaviour** (steps 2 and 4). Step 4 especially: today an agent
replying keeps the resolution clock running, which is why a ticket can breach while the
agent waits. Under the brief, that reply pauses the clock. That is a defensible product
decision, but it is a **policy change**, and it will move every SLA number on the manager
dashboard. It should be decided explicitly, not inherited from a rename.

---

## 5. The one thing that cannot be migrated

`TicketHistory` is **append-only, enforced by a Postgres trigger** —
`20260826200000_append_only_history_for_us50/migration.sql` raises on UPDATE and DELETE.
US-50's AC4 is that guarantee, and there is a test for it.

History stores status names as **text** in `fromValue` / `toValue`. So:

- Existing rows will say `OPEN`, `PENDING_INTERNAL`, `ESCALATED` **forever**.
- `ticket-timeline.tsx:106` builds an i18n key from that text, and i18next echoes a missing
  key back — so a timeline entry would render the literal string `ticket.status.open`.

**Therefore:** the retired keys must be **kept** in both locale files, marked as historical.
Dropping the trigger to rewrite history would trade an audit guarantee for tidiness, and is
not on the table.

The `TicketEventType` enum keeps `ESCALATED` — that is an *event*, which the brief agrees
escalation is. No change there.

---

## 6. What actually gets better

Not just cosmetic, and worth stating because it justifies the cost:

1. **The portal mapping nearly disappears.** `PORTAL_STATUS` exists because seven internal
   states had to be flattened to four customer-facing ones. At five statuses the internal
   and customer vocabularies coincide except `NEW → Received`. The leak surface for
   "internal status semantics reaching a customer" shrinks to almost nothing.
2. **Escalation stops fighting the state machine.** Today the sweep may find a ticket it
   cannot legally move to `ESCALATED`, and logs a warning instead of escalating
   (`sla-escalation.service.ts:257`). As data, escalation always succeeds.
3. **A breached, escalated, assigned ticket becomes expressible in one row** without the
   status having to pick which fact to represent.
4. **`PENDING_INTERNAL` is dead weight.** Nothing writes it — grep finds it in the enum, the
   labels, and read-side checks only. Removing it removes a state the product never enters.

---

## 7. Two live findings, outside the rename

Both surfaced while inspecting, both relevant to the persona boundary.

### 7.1 A customer account can sign in to the staff app — this is your 403

`/auth/portal/login` refuses staff accounts (`requirePortalAccount: true`,
`auth.controller.ts:138`). **`/auth/login` has no mirror check.** So `customer@crm.local`
signs in at the staff login, gets a `crm-staff` token, and lands in the agent UI holding the
customer role's five grants — where nearly every action returns
*"You do not have permission to do that."* (`PermissionsGuard`, the only source of that
message in the codebase).

That is what you hit. **The customer reply itself is not broken:** I replied through
`POST /portal/tickets/:id/messages` as both portal accounts and got 201, with the reply
appearing in the thread — including on the ticket where you had replied as Amina.

Against the brief — *"The customer must NEVER access staff dashboards"* — this is a real
boundary gap. The fix is small and symmetrical: refuse an account with a linked `Customer`
row at the staff login, with its own error code so the sign-in screen can send them to the
portal. **Not done — awaiting your go-ahead**, since it is a security-boundary change and
US-21's AC2 only ever specified the one direction.

### 7.2 Staff cannot create a ticket at all

The header's Create menu (`header.tsx:62`) renders "Create ticket" as a **dead dropdown
item** — no handler, no route. `POST /tickets` exists and is guarded; only the UI is
missing. That is **US-41**, one of the two unstarted MVP stories. It is why you could not
make a ticket from the staff side; the portal path works.

---

## 8. Recommended sequencing

Not one change. Four, each independently verifiable:

| # | Change | Why separate | Risk |
| - | ------ | ------------ | ---- |
| 0 | Staff login refuses customer accounts (§7.1) | Independent of the statuses, fixes a live boundary gap today | Low |
| 1 | **`ESCALATED` → escalation data** | Self-contained: columns already exist and are already written. Touches the sweep, two queue definitions, one dashboard clause | Low–medium |
| 2 | **Rename `OPEN`→`IN_PROGRESS`, `PENDING_CUSTOMER`→`WAITING_FOR_CUSTOMER`; drop `PENDING_INTERNAL`** | Pure rename plus one dead state. One migration, wide but mechanical | Medium — the enum swap and 7 indexes |
| 3 | **The new transitions** (§4, steps 2/4/7) | **Behaviour, not naming.** Step 4 changes SLA arithmetic and needs your explicit decision | High — moves every SLA figure |

Doing 1 and 2 as one migration is tempting and I would not: if an SLA number looks wrong
afterwards, you want to know whether the escalation change or the rename caused it.

---

## 9. Decisions I need from you before step 11

1. **Step 4 and the SLA clock.** Should an agent's customer-facing reply move the ticket to
   `WAITING_FOR_CUSTOMER` and thereby **pause the resolution clock**? It follows from the
   brief, and it will change breach counts across the board. *(My recommendation: yes for
   the status, and keep the pause — it is the honest reading of "waiting on them" — but it
   should be your call, stated, because it rewrites the SLA story.)*
2. **Step 7's customer close.** In scope now, or left to US-90? It needs a new portal
   endpoint and UI — the only genuinely new surface in this brief.
3. **Fix 7.1 now?** Small, and it closes the boundary the persona model depends on.
4. **`changeStatusToEscalated`** — rename the column (a migration) or leave the name and
   change only its meaning?

Nothing in this report has been implemented. Say which of 0–3 to start and I will plan that
one story properly before touching code.
