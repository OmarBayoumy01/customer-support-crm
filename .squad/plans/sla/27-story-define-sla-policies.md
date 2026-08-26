# US-67 — Define SLA policies

- **Feature:** `sla`
- **Story:** [Define SLA policies](https://app.notion.com/p/3c69e08385238176b1aff799134b0b0b)
- **Phase / Layer / Release:** P08 SLA & Automation · Backend · MVP · Must have
- **Depends on:** US-6 (domain schema) — done
- **Intake:** `.squad/stories/sla/define-sla-policies/intake.md`
- **MVP position:** 8 of 28

---

## What US-6 gave us, and why it is not enough

`SlaPolicy` already exists:

```prisma
priority TicketPriority        // required
departmentId String?
firstResponseMinutes Int
resolutionMinutes    Int
businessHoursOnly Boolean
isActive Boolean
@@unique([priority, departmentId])
```

That matches on **two** of the five dimensions AC2 names, has no escalation steps (AC1),
and has no way to express a VIP policy (AC3). So this story reworks the model. That is
expected — US-6 was reviewed as the *shape* of the domain, and its own comment says the
business-hours calendar "arrives with P08".

## Approach

### AC2 — applicability, and what "most specific" means

Every matcher becomes nullable, and **null means "matches anything"**:

| Matcher | Weight |
| ------- | ------ |
| `customerIsVip` | 16 |
| `priority` | 8 |
| `categoryId` | 4 |
| `departmentId` | 2 |
| `branchId` | 1 |
| `customerType` | 1 |

`specificity` is the sum of the weights of the matchers that are set, computed on write
and stored. Resolution is then one indexed query: every policy whose every non-null
matcher equals the ticket's value, ordered by `specificity DESC`, oldest first as a
deterministic tiebreak, `LIMIT 1`.

**Why weights rather than counting matchers.** AC3 requires a VIP policy to beat a general
one, and a VIP policy is naturally *less* specific than a general one — it sets one field
where the general policy might set three. Counting would pick the wrong policy. The
weights are a documented constant with a test per criterion rather than a rule someone has
to infer.

The doubling is not decoration: it makes the weights a bit field, so a more specific set
of matchers always outranks a less specific one and no two combinations tie by accident.
`customerType` shares the weight of `branchId` on purpose — individual-versus-company is
the coarsest dimension of the six.

### AC3 — VIP needs somewhere to live

**Flagged: no story before this one gave a customer a VIP flag.** US-33 gave `Customer` a
`type` of `INDIVIDUAL` or `COMPANY`, which AC2 names separately from AC3's "VIP customer" —
and a company can obviously be a VIP, so folding VIP into `type` would be wrong.

So `Customer.isVip Boolean @default(false)` is added here. It is the smallest thing that
makes AC3 testable, and it is orthogonal to `type` as the criteria are. If review would
rather VIP were a customer *tier* with more than two values, that is a migration and one
line in the weight table.

### AC1 — escalation steps

A child table rather than a JSON column, because US-71 queries them by threshold:

```prisma
model SlaEscalationStep {
  policyId       String
  sequence       Int
  clock          SlaClock          // FIRST_RESPONSE | RESOLUTION
  atPercent      Int               // of the target elapsed: 75 = at risk, 100 = breach
  notify         EscalationTarget  // ASSIGNEE | DEPARTMENT_MANAGER | SPECIFIC_USER
  notifyUserId   String?
  changeStatusToEscalated Boolean
}
```

`atPercent` rather than absolute minutes so one step shape works for a four-hour policy and
a five-day one. `75` is not arbitrary — it is the same threshold US-40's `slaFor()` already
uses (`WARN_FRACTION = 0.25` remaining), and the two now name the same number from one
place.

This shape is taken directly from US-71's criteria: AC1 warns the agent, AC2 warns the
department manager, AC3 moves the status to Escalated on breach. Three steps.

### AC4 — nothing shifts retroactively

Already true, and worth stating rather than building: US-6 denormalised
`firstResponseDueAt` and `resolutionDueAt` onto the ticket as **absolute timestamps**.
Editing a policy cannot move a timestamp that has already been written. The test asserts
it rather than assuming it.

No target snapshot columns are added to `Ticket`. The due dates *are* the snapshot, and a
second copy of the same fact is a second thing that can disagree.

### AC5 — the audit log gets its first writer

`AuditLog` has existed since US-6 with `before` / `after` JSON columns and nothing writing
to it. A small `AuditService` lands in `backend/src/audit/`, platform-wide from the start
because it is about to be called by every administrative story.

It records **only the fields that changed**, per US-6's own comment on the model, which
also keeps AC5's "before and after values" honest — a whole-row copy is not a diff.

### What is deliberately not built

No controller. `.squad/plans/00-mvp-scope.md` says "policies seeded, not managed in a UI",
and an admin API with no caller is scaffolding the definition of done tells us to delete.
US-70 adds the controller over this service.

## Files

| Path | What |
| ---- | ---- |
| `backend/prisma/schema.prisma` | `SlaPolicy` reworked; `SlaEscalationStep`, `SlaClock`, `EscalationTarget` added; `Customer.isVip`. |
| `backend/prisma/migrations/<ts>_sla_policies_for_us67/` | **New.** Includes the `NULLS NOT DISTINCT` unique index (PostgreSQL 18). |
| `packages/shared/src/dto/sla-policy.ts` | **New.** The policy contract, shared so US-70 does not invent a second one. |
| `backend/src/audit/audit.service.ts` | **New.** `record()`, diffing before/after. |
| `backend/src/audit/audit.module.ts`, `index.ts` | **New.** |
| `backend/src/sla/sla-policy.service.ts` | **New.** `create`, `update`, `resolveFor`. |
| `backend/src/sla/sla.module.ts`, `index.ts` | **New.** |
| `backend/src/sla/sla-policy.test.ts` | **New.** AC1–AC5. |
| `backend/src/seed/seed.ts` | Seeds the four default policies plus a VIP policy. |
| `backend/src/app.module.ts` | Registers `SlaModule` and `AuditModule`. |

## The unique constraint

US-6 guaranteed "exactly one platform default per priority" with
`@@unique([priority, departmentId])`. Priority becomes nullable here, and PostgreSQL
treats NULLs as distinct in a unique index, so that guarantee would quietly evaporate.

The migration adds a raw unique index over all six matchers with `NULLS NOT DISTINCT`
(PostgreSQL 15+; we run 18). Two policies matching exactly the same thing are a
configuration mistake, and the database says so rather than the resolver silently picking
one.

## Acceptance criteria — verification

| AC | How it is proven |
| -- | ---------------- |
| AC1 — policy fields | A created policy round-trips name, both targets, business hours, all six matchers, the escalation steps, and `isActive` |
| AC2 — applicability | A ticket resolves to the most specific match; a policy whose matcher disagrees is not chosen; a policy with no matchers is the fallback; an inactive or deleted policy never wins |
| AC3 — VIP override | A VIP customer's ticket takes the VIP policy over a more-matchers general policy |
| AC4 — immutable history | Editing a policy's minutes leaves an existing ticket's due dates untouched |
| AC5 — audit | Create writes `CREATE`; update writes `UPDATE` with only the changed fields in `before` and `after` |

## Out of scope

- SLA policy management API and UI — US-70.
- Business hours and holidays — US-75.
- Computing the deadlines — US-68, the next story.
- Acting on the escalation steps — US-71.

## Open for review

1. **`Customer.isVip` is new.** Nothing before this story had a VIP concept. See AC3 above.
2. **`SlaPolicy.priority` becomes nullable**, which is a real change to a US-6 model. A
   policy that applies to every priority cannot be expressed otherwise, and AC2 requires
   one.

---

## Result

| AC | Result |
| -- | ------ |
| AC1 — policy fields | ✅ every field round-trips, ladder included, `specificity` derived on write |
| AC2 — applicability | ✅ five tests: most-specific wins, a disagreeing matcher loses, all five dimensions match, inactive and archived never win |
| AC3 — VIP override | ✅ a VIP policy with two matchers beats a general one with three |
| AC4 — immutable history | ✅ editing a policy's minutes leaves an existing ticket's due dates and `slaPolicyId` untouched |
| AC5 — audit | ✅ create writes `CREATE`; update writes only the changed field in `before`/`after`; a no-op save writes nothing |

**Tests:** `sla-policy.test.js` 13 pass. Regression: tickets 20, customers 17,
ticket-history 11 — all pass. `npm run typecheck` and `npm run lint` clean.

The seeder is idempotent — run twice, still five policies.

## What the next stories inherit

- **US-68** calls `SlaPolicyService.resolveFor(facts)` on ticket creation and on a priority
  change, and writes `firstResponseDueAt` / `resolutionDueAt` from the returned targets. The
  moment it does, `TicketsService.slaFor()` stops answering `none` with no change there.
  `businessHoursOnly` is `false` on every seeded policy, which is the 24/7 clock the scope
  agreed — deliberately not `true`-and-ignored, so no historic ticket looks mismeasured the
  day US-75 lands.
- **US-71** reads `escalationSteps`: rung 0 warns the assignee at 75%, rung 1 the department
  manager at 90%, rung 2 escalates at 100%. Its AC5 ("no duplicate escalation") has exactly
  one rung with `changeStatusToEscalated` to check against.
- **US-70** adds the controller and screen over `SlaPolicyService` and
  `packages/shared/src/dto/sla-policy.ts`. Nothing about the service assumes it has no HTTP
  caller.
- **AuditService** is now available to every administrative story. It is the first writer to
  a model that had been sitting unused since US-6.
