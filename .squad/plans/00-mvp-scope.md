# MVP scope — one complete support journey

Agreed 2026-08-26. **The goal is not "finish all MVP stories".** It is to make one
customer-support journey work end to end, as quickly as possible:

> Customer signs in → submits a request → an agent receives it → categorises it → assigns
> it → communicates with the customer → SLA is monitored → escalation happens when needed →
> the ticket is resolved → the customer sees the result and can continue the conversation.

**28 stories.** 89 of the 125 are MVP; 20 are built; this cuts the remaining 69 to 28.
Deployment and monitoring (US-126, US-127) stay out until the deployment target is settled.

---

## Backlog corrections applied

Four fixes were made to Notion on 2026-08-26, all where the intent was unambiguous:

| Story | Was | Now | Why |
| ----- | --- | --- | --- |
| **US-1** | `Draft`, no dependency | `Ready`, depends on US-46 | The page has seven acceptance criteria, a definition of done, an out-of-scope list and notes. It is not a draft in substance — the status was stale. A reply composer cannot exist before the conversation timeline it posts into. |
| **US-61** | depends on **US-61** | US-60 | Self-referencing. "Update tickets in real time" needs the WebSocket gateway. |
| **US-63** | depends on **US-63** | US-62 | Self-referencing. The notification centre needs the notification service. |
| **US-62** | depends on US-10, **US-61** | US-10, US-60 | The notification service needs the gateway to push through. US-61 is a sibling consumer, not a provider. |

### Flagged, not corrected

- **US-127** depends on `US-9, US-119`. US-119 is "Manage ticket categories"; monitoring and
  backup have nothing to do with it. The plausible intent is **US-126** (deploy), but that
  is a seven-place drift rather than an off-by-one, so it is a guess. Deferred anyway.
- **US-64** and **US-66** both depend on US-63 (the notification *centre*) where they
  probably want US-62 (the notification *service*). Deferred; left alone.
- **US-119** depends on US-50 (ticket history). Categories have no obvious dependency on
  history. Deferred; left alone.
- **US-2 is not a bug.** It is titled "TEMPLATE — duplicate this row for a new story" and
  has no phase or release on purpose. Leave it.

---

## The 28

**W** = a step a person performs in the business workflow.
**P** = a prerequisite that exists so the workflow can be built. Necessary, but not a
business capability, and it should not be mistaken for one.

| Story | | Priority | Status | Depends on | Why it is in the MVP | Simplification |
| ----- | - | -------- | ------ | ---------- | -------------------- | -------------- |
| **US-27** Build the core UI component library | P | Must | In progress | US-26 | Every form and dialog in the slice is assembled from it | Build only what the slice uses: confirm dialog, combobox, pagination, filter bar. Date range picker and file upload wait for a consumer. |
| **US-31** Loading, empty, error, permission-denied states | P | Must | US-27 | Every screen needs all four; without them each screen invents its own | `RouteFallback` and `PermissionDenied` already exist — extend rather than restart |
| **US-32** Toast notifications | P | Must | US-27 | Every mutation in the slice needs to confirm it happened | Host already mounted in `AppProviders`; needs the helpers and the usage |
| **US-30** Build the shared data table | P | Must | US-27 | The ticket queue and every list depend on it | Sort, filter, paginate, select. No column reordering, no saved views |
| **US-33** Manage customers through the API | P | Must | US-6, US-22 | A ticket cannot exist without a customer to raise it | CRUD only. Merge, import and export are later stories |
| **US-40** Build the ticket API | P | Must | US-6, US-22 | The spine. Nineteen of the 28 touch it | — |
| **US-50** Track ticket history | W | Must | US-40 | Makes categorise / assign / escalate / resolve **visible**, which is what makes the demo credible | — |
| **US-67** Define SLA policies | P | Must | US-6 | A clock needs a target to run against | Policies seeded, not managed in a UI (US-70 deferred) |
| **US-120** Generate realistic seed data | P | Must | US-6 | **Nothing is demonstrable without data.** Also replaces six deferred admin UIs | Seeds customers, agents, categories, departments, SLA policies, tickets and portal accounts |
| **US-68** Calculate SLA clocks accurately | W | Must | US-67, US-10 | "Monitor SLA" | **24/7 clock.** Business hours and holidays (US-75) deferred |
| **US-42** Browse and filter the ticket queue | W | Must | US-30, US-40 | "An agent receives it" | — |
| **US-45** Work a ticket in the detail workspace | W | Must | US-40 | The screen the whole middle of the journey happens on | — |
| **US-46** Read the ticket conversation timeline | W | Must | US-45 | "Communicate" | — |
| **US-1** Reply to a customer or add an internal note | W | Must | US-46 | "Communicate", and it carries non-negotiable rule #1 | **AC7 (attachments hidden from customers) cannot be fully met** — US-51 is deferred, so there are no attachments. The API filter is still written; the criterion completes with US-51 |
| **US-49** Set ticket category and priority | W | Must | US-45 | "Categorise" | Categories seeded |
| **US-48** Assign and reassign tickets | W | Must | US-45 | "Assign" | Manual assignment only. Round-robin and load balancing are later |
| **US-47** Change ticket status through valid transitions | W | Must | US-45 | "Resolve", and the state machine escalation depends on | — |
| **US-69** See SLA status on a ticket | W | Must | US-68, US-45 | "Monitor SLA", visibly | The `SlaMeter` and edge rule already exist from US-26 |
| **US-71** Escalate tickets automatically on SLA thresholds | W | Must | US-68, ~~US-62~~ | "Escalation occurs when necessary" | **Escalates without notifications.** Changes status, writes history, logs. P07 is deferred, so the dependency on US-62 is dropped |
| **US-41** Create a ticket as an agent | W | Must | US-40 | The agent-side entry to the journey, beside the portal one | — |
| **US-35** View a customer profile | W | Must | US-33 | "Customer" as a thing an agent can actually look at | Profile and their tickets. Interaction history (US-36) and notes (US-37) deferred |
| **US-21** Sign in to the customer portal | W | Must | ~~US-20~~ | "Customer logs in" | **Portal accounts come from the seed**, not registration. US-20 deferred. The `crm-portal` token audience already exists from US-14 |
| **US-82** Build the customer-scoped portal API | P | Must | US-21, US-40 | The boundary that makes rule #1 real — internal notes filtered at the API | — |
| **US-86** Submit a support request | W | Must | US-82, ~~US-76~~ | "Submits a request" | **No knowledge-article suggestions.** US-76 is deferred, so that dependency is dropped |
| **US-84** Track my requests in the portal | W | Must | US-82 | "The customer sees the result" | List only. Portal home (US-83) deferred |
| **US-85** Read and reply to my request | W | Must | US-82 | "…and can continue the conversation" — this is what closes the loop | Rating (US-88) and reopen (US-90) deferred |
| **US-55** See my workload on the agent dashboard | W | Must | US-40 | The first screen after sign-in, currently a placeholder | Counts and my queue. The sidebar badge already subscribes to the key this provides |
| **US-58** Supervise the team from the manager dashboard | W | Must | US-40 | **This is the "Report" step.** P11 Reports & Analytics is entirely V2 | Team workload, SLA breaches, open by status. No charts library, no exports |

---

## Critical path

The order the journey happens in, and therefore what has to work for the demo to run:

```
US-21  customer signs in            ← portal accounts from US-120
US-86  submits a request            ← US-82
US-42  agent sees it in the queue   ← US-30, US-40
US-45  agent opens it
US-49  categorises it
US-48  assigns it
US-46  reads the conversation
US-1   replies (or notes privately) ← rule #1 enforced in US-82
US-68  SLA clock runs
US-69  agent sees the clock
US-71  escalates if the clock passes the threshold
US-47  agent resolves it
US-84  customer sees the result
US-85  customer replies again       → back to US-46
US-58  manager reports on all of it
```

## Supporting prerequisites

Not workflow steps. They exist so the steps above can be built, and none of them is
demonstrable on its own:

**US-27** component library · **US-30** data table · **US-31** states · **US-32** toasts ·
**US-33** customer API · **US-40** ticket API · **US-67** SLA policies · **US-82** portal
API · **US-120** seed data

`US-120` carries unusual weight: it stands in for six deferred administration screens
(US-70, US-113, US-114, US-115, US-117, US-119). Categories, departments, SLA policies,
staff and portal accounts are all seeded rather than managed.

## Deferred — stop working on these

| | Why |
| - | --- |
| **All of P07** — US-60, 61, 62, 63, 64, 66 | Real-time and notifications are a demo flourish, not a workflow step. US-71 escalates without them |
| **All of P09** — US-76 – 80 | The knowledge base is not in the journey at all |
| **P11 Reports** (V2), **P12 AI** (V3), **P13 Integrations** (V2/V3) | Already outside MVP |
| **US-17, 18, 20** password reset, registration | Previously decided |
| **US-19, 113, 114, 115, 117, 119** staff invite and admin screens | Replaced by seed data |
| **US-70** SLA policy UI, **US-75** business hours | Policies seeded; 24/7 clock accepted |
| **US-29** global search | The header button can open an empty palette |
| **US-34** customer list, **US-36** interaction history, **US-37** customer notes | The profile is reachable from a ticket |
| **US-44** bulk actions, **US-51** attachments, **US-52** quick replies | Should-haves, or need S3 |
| **US-56** tasks, **US-57**, **US-59** | Not in the journey |
| **US-83** portal home, **US-87** help centre, **US-88** rating, **US-89** profile, **US-90** reopen | The loop closes without them |
| **US-121, 122, 123** i18n, responsive, accessibility | Substantially done already — treat as a review pass at the end, not stories |
| **US-126, 127** deploy and monitor | Tier 3. Blocked on the deployment target, and on the Docker build failing locally |
| **US-128** automated test suite | Every story ships with tests; this is a consolidation story |

---

## Implementation order

Each story runs through the squad-kit flow: `squad new-story` → fill the intake from the
Notion page → `squad new-plan` → **review the plan** → implement → verify each acceptance
criterion → set Notion to `In review`.

**Wave 0 — finish the toolkit.** Unblocks every screen; nothing visible ships until it is done.

1. US-27 · 2. US-31 · 3. US-32 · 4. US-30

**Wave 1 — the backend spine.** No UI; the demo is not visible yet but everything after is fast.

5. US-33 · 6. US-40 · 7. US-50 · 8. US-67 · 9. US-120 · 10. US-68

*Seed data lands here on purpose: after the ticket, customer and SLA shapes are settled, and
before the first screen, so every screen is built against realistic data rather than an
empty table.*

**Wave 2 — the agent workspace.** The middle of the journey, and the biggest wave.

11. US-42 · 12. US-45 · 13. US-46 · 14. US-1 · 15. US-49 · 16. US-48 · 17. US-47 ·
18. US-69 · 19. US-41 · 20. US-35

*After wave 2 the agent half of the journey is demonstrable end to end.*

**Wave 3 — automation.**

21. US-71

**Wave 4 — the customer portal.** Closes the loop.

22. US-21 · 23. US-82 · 24. US-86 · 25. US-84 · 26. US-85

*After wave 4 the whole journey runs.*

**Wave 5 — reporting.**

27. US-55 · 28. US-58

---

## Risks to the slice

1. **`Message.isInternal` is the whole of rule #1**, and it is enforced in two places at
   once — US-1 writes the flag, US-82 filters on it. Those two stories are four waves
   apart. The filter and its regression test belong to **US-82** and must not be assumed
   done by US-1.
2. **US-71 has no notification channel**, so an escalation is only visible in the ticket
   history and the queue. If the demo needs an escalation to *announce* itself, US-62 comes
   back into scope.
3. **US-120 is load-bearing.** Six administration screens were cut on the assumption the
   seed produces credible data. If it does not, several of them return.
4. **"Report" is two dashboards, not analytics.** If the demo audience expects charts and
   exports, part of P11 has to be pulled forward from V2 — a scope change, not a detail.
