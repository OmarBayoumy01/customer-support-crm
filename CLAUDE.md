# Customer Support CRM

A multi-role customer support / helpdesk platform. Customers submit requests, agents
resolve them against SLA targets, managers supervise workload and escalations,
administrators configure the platform.

Core workflow: **customer → ticket → categorise → assign → communicate → monitor SLA →
escalate → resolve → report**

---

## Where the work comes from

All 125 user stories live in Notion, not in this repo.

**Database:** https://app.notion.com/p/fdeccf91bcb64167bfc52ba514a74b18

Query it through the Notion MCP server. Each row is one story; the page body holds the
full acceptance criteria.

### Properties

| Property      | Meaning                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `Ref`         | Stable ID, `US-3`, `US-4`, … Use this for ordering within a phase.       |
| `Phase`       | `P01 Foundation` through `P15 Platform & Hardening`. Drives build order. |
| `Layer`       | Infrastructure / Backend / Frontend / Full-stack                         |
| `Release`     | MVP / V2 / V3                                                            |
| `Priority`    | Must have / Should have / Could have / Nice to have                      |
| `Status`      | Draft / Ready / In progress / In review / Done                           |
| `Depends on`  | Story refs that must be finished first                                   |
| `Design File` | Matching UI prompt file, for frontend stories                            |
| `Screen`      | Which screen(s) the story touches                                        |

### Rules for reading it

- **Work one phase at a time.** Filter `Phase` to the current phase and sort by `Ref`
  ascending. Do not pull stories from later phases.
- **`Depends on` is verified for Phase 1 only.** In later phases some refs drift by one
  row. If a dependency looks wrong, follow `Ref` order within the phase and flag it rather
  than guessing.
- **Update `Status` as you go** — set `In progress` when you start a story, `In review`
  when you finish it. Do not set `Done` yourself; that is the human's call after review.
- **Never edit the story text.** If a story is wrong or ambiguous, say so and wait. Do not
  silently reinterpret it.

---

## Stack — do not substitute without asking

**Frontend**
React · TypeScript · Vite · Tailwind CSS · shadcn/ui · React Router · TanStack Query ·
React Hook Form + Zod · Recharts · i18next

**Backend**
Node.js · NestJS · TypeScript · PostgreSQL · Prisma · Redis · Socket.IO · JWT

**Infrastructure**
Docker · GitHub Actions · S3-compatible storage

**AI (phase 12 only)**
OpenAI API with retrieval over the knowledge base

---

## Repository layout

```
customer-support-crm/
├── frontend/           React + Vite app
├── backend/            NestJS API
├── packages/shared/    DTOs and Zod schemas shared by both
├── infrastructure/     Docker, CI, deployment
└── docs/               Notes and decisions
```

---

## Tooling — Squad Kit

We use **Squad Kit** (https://squad-kit.com/), a spec-driven development CLI. A strong
model plans once, then a cheaper model executes that plan many times.

**The Notion story is the spec.** Do not write a new spec from scratch — the story
statement, acceptance criteria, technical notes, and out-of-scope list are already the
input. Pull the story, feed it in, plan against it.

### The cycle, per story

1. **Pull** the story from Notion. Read the full page body, not just the row.
2. **Plan** with the strong model — one pass, producing the implementation plan.
3. **Review the plan with me before execution begins.** This is the gate. Once the cheap
   model starts executing, correcting course is far more expensive than catching it in the
   plan.
4. **Execute** the plan.
5. **Verify** against the acceptance criteria one by one, then set the story's `Status` to
   `In review` in Notion and stop.

Acceptance criteria are written as Given / When / Then precisely so they can be checked
mechanically after execution. Walk them individually — do not summarise them as "all
passing" without checking each.

### Where output goes

Route generated files by the story's `Layer` property in Notion:

| Story `Layer`    | Output location                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Frontend`       | `frontend/`                                                                                                                                             |
| `Backend`        | `backend/`                                                                                                                                              |
| `Full-stack`     | Split it — UI into `frontend/`, API and data into `backend/`, and any type or schema shared by both into `packages/shared/`                             |
| `Infrastructure` | `infrastructure/`, except root-level config such as `docker-compose.yml`, `.github/workflows/`, and workspace config, which stay at the repository root |

- **State the target paths in the plan**, before execution, so misplaced output is caught
  at review rather than after the fact.
- **Never leave generated files at the repository root** unless they are genuinely
  root-level config.
- **Shared types go in `packages/shared/`.** If the same DTO or Zod schema is generated on
  both sides, consolidate and import from there rather than keeping two copies.
- **Generated code still has to meet the definition of done below.** Delete unused
  scaffolding rather than leaving it in the repo.

### Where the plan gate does and does not apply

The confirm-before-you-write rule below applies to **the plan**, not to every file the
executing model touches. Once I have approved a plan, execution runs to completion without
stopping for each file.

Stop mid-execution only if you hit something the plan did not anticipate — a missing
dependency, an ambiguous acceptance criterion, or a conflict with an earlier story. In that
case stop and ask rather than improvising.

---

## Working agreement

- **One story at a time.** Pull it, plan it, get the plan approved, execute, verify, stop.
- **The plan is the review point.** State your approach, the files you will create, and
  their target paths — then wait for confirmation before execution.
- **Do not skip ahead.** Later phases depend on decisions made in earlier ones.
- **Ask before adding a dependency** that is not in the stack above.
- **Every acceptance criterion is a test.** If an AC cannot be tested, say so rather than
  marking it done.
- Prefer boring, explicit code over clever abstractions. This codebase will be maintained
  by people who did not write it.

## Definition of done — every story

- [ ] All acceptance criteria met and covered by tests
- [ ] TypeScript strict, no `any` without written justification
- [ ] Lint and format pass
- [ ] No secrets, keys, or credentials committed
- [ ] Errors handled and logged, never swallowed
- [ ] Follows the API response and error conventions once those exist

## Definition of done — additionally for anything with a UI

- [ ] Matches the design system tokens (colours, type scale, spacing)
- [ ] Works at desktop, tablet, and mobile breakpoints
- [ ] Mirrors correctly in Arabic RTL — CSS logical properties, never `left`/`right`
- [ ] Keyboard accessible with visible focus states
- [ ] Status and priority never communicated by colour alone — always text plus icon
- [ ] Loading, empty, and error states implemented
- [ ] Permissions respected for the relevant role

---

## Two rules that are non-negotiable

**1. Internal notes must never reach a customer.**
Tickets carry both customer-facing messages and internal notes, separated by
`Message.isInternal`. An internal note must never appear in a portal response, an email, an
attachment listing, or any customer-facing payload — filtered at the API layer, not merely
hidden in the UI. There is an explicit regression test for this.

**2. The server is the security boundary.**
Frontend permission gating is a convenience so users are not offered actions that will
fail. Every permission is enforced again in a backend guard, and scoped permissions are
applied in the database query — never by filtering after fetching everything.

---

## Bilingual from day one

The platform ships in English (LTR) and Arabic (RTL). This is not a late-stage
localisation pass — build with it in mind from the first component. Mirror layout
properly: sidebar side, breadcrumbs, table alignment, icon placement, chat bubble
direction, form labels, pagination, drawers.

---

## Current phase

**Phase 1 — Foundation** (10 stories, `US-3` through `US-12`).

Nothing user-facing is built in this phase. Success is: a new developer clones the repo,
runs one command, and gets a working stack with documented APIs and a green CI pipeline.

⚠️ **`US-6`, the domain schema, is the highest-stakes story in this phase.** Every later
feature is built on it and changing it afterwards is expensive. Present the full schema for
review before writing migrations.

### Phase 1 exit criteria

- [ ] `docker compose up` gives a working stack from a clean clone
- [ ] `/health` reports database and Redis as up
- [ ] `/api/docs` lists endpoints with documented schemas
- [ ] CI is green on a pull request
- [ ] The Prisma schema covers every core entity, with `Message.isInternal` in place

Then stop and report. Do not begin Phase 2 without explicit approval.
