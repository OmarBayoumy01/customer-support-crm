# Workflow status and handoff

**Written 2026-08-27.** Read this first if you are picking the project up cold. It says where
the end-to-end journey actually stands, what is left, in what order, and which decisions are
already settled so you do not relitigate them.

Companion documents, in order of authority:

1. **The Notion story** — https://app.notion.com/p/fdeccf91bcb64167bfc52ba514a74b18 (125
   stories; the acceptance criteria are the requirement)
2. `CLAUDE.md` — working agreement, the two non-negotiable rules, definition of done
3. `.squad/plans/00-mvp-scope.md` — **the master plan**: the 28-story slice, why each story
   is in, what is deferred and why
4. `.squad/plans/00-index.md` → per-feature `00-overview.md` → numbered per-story plans

---

## Where the journey stands

The target flow, with the story that owns each step and its real state:

| Step | Story | State |
| ---- | ----- | ----- |
| Customer signs in (portal) | **US-21** | ❌ not started |
| Customer submits a request | **US-86** | ❌ not started |
| Agent sees it in the queue | US-42 | ✅ in review |
| Agent opens the workspace | US-45 | ✅ in review |
| Categorise | US-49 | ✅ in review |
| Assign | US-48 | ✅ in review |
| Read the conversation | US-46 | ✅ in review |
| Reply / internal note | US-1 | ✅ in review |
| SLA clock runs | US-67, US-68 | ✅ in review (backend) |
| Agent *sees* the clock on a ticket | US-69 | ✅ in review |
| Escalate on breach | US-71 | ✅ in review |
| Resolve | US-47 | ✅ in review |
| Customer-scoped portal API | US-82 | ✅ in review |
| Customer sees the result | **US-84** | ❌ not started |
| Customer replies again | **US-85** | ❌ not started |
| Manager reports on it | **US-55, US-58** | ❌ not started |

**20 of 28 stories are done** (waves 0 and 1, eight of ten in wave 2, wave 3, and the portal API). Every finished story is
`In review` in Notion — never `Done`, which is the human's call.

**What is demonstrable today:** sign in as a seeded agent → browse and filter the queue → open
a ticket → change priority and category → assign or unassign → read the timeline → reply or
add an internal note → move the status through a validated lifecycle, watching both SLA
timers tick down and change state as they go. All against real data from the seed, all
through the real API.

**What is not:** nothing enters the system from a customer, and there is no dashboard or
report. Escalation happens but cannot notify anybody — see the flags.

---

## Implementation map

| Workflow area | Existing | Missing | Stories | Depends on |
| ------------- | -------- | ------- | ------- | ---------- |
| **Authentication** | Staff login, JWT access + refresh, session lifecycle, revocation, `crm-portal` token audience already defined | Password reset, self-registration — **deliberately deferred** | US-13–16, US-22–25 ✅ · US-17, 18, 20 deferred | — |
| **Users / roles** | 4 system roles, permission catalogue, `PermissionsGuard`, scoped queries (`ALL`/`TEAM`/`ASSIGNED`/`OWN`), frontend gating | Staff admin screens — replaced by seed data | US-22, 23 ✅ · US-19, 114 deferred | — |
| **Customers** | Full CRUD API, search, dedupe, stats; customer context panel on the ticket | **No `/customers` routes at all.** No profile page | **US-35** ❌ · US-33 ✅ · US-34, 36, 37 deferred | US-33 |
| **Tickets** | API, queue with filters/sort/paging, detail workspace, history with an append-only DB trigger | **Agent-side create screen** | **US-41** ❌ · US-40, 42, 45, 50 ✅ | US-40 |
| **Categorisation** | `GET /categories`, both controls save on change, `Category.departmentId` routing hint applied server-side | Category management UI — deferred to US-113 | US-49 ✅ | US-45 |
| **Assignment** | `PATCH /tickets/:id/assignee` behind `ticket:assign`, candidate list with workload + availability, scope enforced in the query | Round-robin / load balancing — out of scope | US-48 ✅ | US-45 |
| **Communication** | Timeline, reply composer, internal-note mode, `Message.isInternal` written and the API filter written | Attachments (needs S3) | US-1, 46 ✅ · US-51 deferred | US-46 |
| **SLA** | Policies seeded, clocks computed, pause/stop, breach sweep worker on the existing BullMQ/Redis, live ticking timers on the ticket with target, deadline and paused time | — | US-67, 68, 69 ✅ · US-70, 75 deferred | — |
| **Escalation** | The seeded 75/90/100% ladder is read every minute inside the existing sweep; the breach rung moves the ticket to `ESCALATED`, stamps `escalatedAt`/`escalatedToId`, and records history attributed to the rule. Idempotent per rung | Notifications — **US-62**, deferred | US-71 ✅ | — |
| **Resolution** | Validated transitions, `resolvedAt`/`closedAt`/`reopenCount`, reopen rule built | Reopen *trigger* — needs US-85 | US-47 ✅ | US-45 |
| **Ticket history** | Every mutation recorded, actor or automation attributed, names stored beside ids, append-only enforced by a trigger | — | US-50 ✅ | US-40 |
| **Portal** | **The customer-scoped API and its boundary**: own module, own passport strategy pinned to `crm-portal`, allowlist DTOs, per-account and per-IP rate limit, and rule #1 enforced in the query with its regression test | Sign-in screen, submit, and the two screens | US-82 ✅ · **US-21, 86, 84, 85** ❌ | US-40, US-120 |
| **Dashboard** | Placeholder page, sidebar badge already live | **All metrics** | **US-55** ❌ | US-40 |
| **Reports** | Nothing | **The manager dashboard** — this *is* the "Report" step | **US-58** ❌ | US-40 |

---

## What is left, in the order to do it

Eight stories. The order below is the critical path, not the story numbers.

| # | Story | Why here | Size |
| - | ----- | -------- | ---- |
| 1 | **US-21** Sign in to the customer portal | Opens the customer half. Portal accounts come from the seed | small |
| 2 | **US-86** Submit a support request | "Customer submits" — the real entry point | medium |
| 3 | **US-84** Track my requests | "The customer sees the result" | small |
| 4 | **US-85** Read and reply to my request | Closes the loop, and supplies US-47's reopen trigger | medium |
| 5 | **US-55** Agent dashboard | First screen after sign-in; currently a placeholder | medium |
| 6 | **US-58** Manager dashboard | **This is the "Report" step.** P11 Reports is entirely V2 | medium |
| 7 | US-41 Create a ticket as an agent | Second entry point. **The loop closes without it** | medium |
| 8 | US-35 View a customer profile | The customer as a thing you can open. **The loop closes without it** | medium |

**If credits are the binding constraint, stop after 6.** Items 7 and 8 are the two remaining
wave-2 stories and both are genuine capabilities, but neither is on the critical path: tickets
enter through the portal, and the customer is already visible from the ticket's context panel.
That is a scope decision for the human, flagged rather than taken.

---

## Decisions already locked — do not relitigate

- **Postgres enums are the lifecycle.** `NEW`, `OPEN`, `PENDING_CUSTOMER`, `PENDING_INTERNAL`,
  `ESCALATED`, `RESOLVED`, `CLOSED` (US-6). There is no `IN_PROGRESS`. Legal moves live in
  `TICKET_TRANSITIONS` in `packages/shared/src/dto/ticket.ts` and are enforced on both sides.
- **The server is the security boundary.** Every permission is re-checked in a guard, and
  scoped permissions are applied *in the query* — never by filtering a fetched list.
- **An internal note must never reach a customer.** `Message.isInternal` is written by US-1,
  and **US-82 closed all five leak vectors** — messages, counts, attachments (selected
  through the message, since `Attachment` has no flag of its own), history (absent from the
  contract), and the contract itself (hand-written allowlists, never an `omit` of the staff
  DTO). The regression test is `backend/src/portal/portal.test.ts`, asserted against the
  serialised JSON. **Any new customer-facing surface must close the same five.**
- **A guarded operation gets its own route.** `PATCH /tickets/:id` deliberately refuses
  `status` and `assigneeId`; those are `/status` and `/assignee` behind their own permissions.
  Anything with its own rules follows that pattern.
- **Shared contracts over duplication.** DTOs, enums and Zod schemas live in
  `packages/shared` and are imported by both sides.
- **The portal never uses the `OWN` permission scope for ownership.** A permission scope is
  configuration; the portal resolves `Customer.userId → customerId` from the token and
  filters on it unconditionally. No linked customer means 403, never "no filter".
- **Portal routes carry `@Public()` *and* `@UseGuards(PortalAuthGuard)`.** The first is
  needed to bypass the staff-pinned global guard; the first *without* the second is an open
  endpoint. The 401 test is what catches that.
- **One queue.** BullMQ on the existing Redis. `SlaSweepWorker` is the pattern to follow.
- **History is append-only**, enforced by a database trigger, and labels are captured at write
  time so a later rename cannot rewrite the past.
- **shadcn primitives, logical CSS properties only** (`ms`/`me`, `start`/`end`). There is a
  test that fails on a physical direction class. Status and priority are always text + icon,
  never colour alone.
- **24/7 SLA clock.** Business hours (US-75) deferred behind one `deadlineFrom()`.

## Acceptance criteria deliberately unmet — do not quietly close

| Story | AC | Why | Completes with |
| ----- | -- | --- | -------------- |
| US-68 | AC2 business hours | Needs US-75's calendar | US-75 |
| US-46 / US-1 | attachment download | Needs S3 | US-51 |
| US-49 | AC3 manage categories | `GET /categories` built; the screen is not | US-113 |
| US-48 | AC1 agent is notified | No notification channel exists | US-62 |
| US-48 | AC5 out of office | **Not modelled in the schema at all** | a story that owns agent availability |
| US-47 | AC5 reopen trigger | `onCustomerReply` built and tested; nothing writes a customer message | US-85 |
| US-71 | AC1, AC2 notifications | Each rung records history and logs its recipient; no channel exists | US-62 |
| US-71 | AC4 Tickets Requiring Attention | Escalated tickets surface in the queue's `escalated` view | US-58 |
| US-69 | AC6 "and dashboards" | Verified on the ticket and the queue; there are no dashboards yet | US-55, US-58 |
| US-69 | AC4 paused *periods* | The schema banks a total plus the current pause, not a list of intervals | a schema change nobody needs yet |

---

## Three questions that need a human answer

1. **End-to-end test.** There is no Playwright or Cypress in the stack, and `CLAUDE.md` says
   ask before adding a dependency. The in-stack option is a backend integration test that
   walks the whole journey against the real Postgres — cheap, deterministic, and it exercises
   every rule that matters, but it does not drive the browser. **Recommendation: do that, and
   treat a browser E2E as a separate decision.**
2. **Notifications.** US-48 AC1, US-47 AC5 and US-71 all say somebody is notified, and P07 is
   deferred, so none of them can be. If the demo needs an escalation to *announce* itself,
   US-62 comes back into scope. Otherwise escalation is visible only in history and the queue.
3. **Wave 2's last two stories** (US-41, US-35) — cut or keep? See the table above.

---

## Running and verifying

Full runbook: `docs/running-the-project.md`. Short version, and the only setup that works on
this machine:

```
docker compose up -d --wait postgres redis     # Docker cannot build the app images here — TLS interception
npm run migrate:deploy --workspace @crm/backend
npx tsc -b backend && npm run db:seed --workspace @crm/backend
npm run start --workspace @crm/backend         # :3000
npm run dev   --workspace @crm/frontend        # :5173
```

Seeded accounts: `admin@` / `manager@` / `agent@` / `customer@crm.local`, password from
`SEED_PASSWORD` (`DevPassw0rd!`).

**Verification is deliberately narrow — the human is credit-constrained.** Do not run
`npm run verify`. Run the one suite the change touched, once:

```
node --env-file-if-exists=.env.test --test dist/tickets/tickets.test.js   # from backend/, after tsc -b
npx vitest run src/features/tickets/<file>.test.tsx                       # from frontend/
```

One typecheck and one lint at the end of a story, not per file. The pre-commit hook runs
eslint, prettier and a full typecheck, so a commit is itself a verification gate.

## Handoff protocol

Per `CLAUDE.md`, one story at a time: pull the Notion story → fill an intake under
`.squad/stories/<feature>/<slug>/` → write a numbered plan under `.squad/plans/<feature>/`
(**the tickets feature is at 37**; plan numbers are a global sequence) → **stop for human
review of the plan** → implement → verify each AC individually → set Notion to `In review`
→ commit → update this file's status table.

Do not set a story to `Done`. Do not edit story text in Notion. If a story is wrong or
ambiguous, say so and wait.
