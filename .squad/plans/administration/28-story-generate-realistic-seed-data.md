# US-120 — Generate realistic seed data

- **Feature:** `administration`
- **Story:** [Generate realistic seed data](https://app.notion.com/p/3c69e08385238146b850f1e70b1f520c)
- **Phase / Layer / Release:** P14 Administration · Backend · MVP · Must have
- **Depends on:** US-6 (schema), and in practice US-67 (a ticket needs a policy to have a
  deadline)
- **Intake:** `.squad/stories/administration/generate-realistic-seed-data/intake.md`
- **MVP position:** 9 of 28

---

## Approach

### Content and plumbing are separate files

`demo-data.ts` is the data set: branches, departments, categories, staff, customers,
fourteen tickets with their conversations, and three articles. No Prisma, no side effects.

`demo-seed.ts` turns it into rows.

The split exists because the thing a reviewer actually has to judge — *do these tickets
sound like real support cases?* — is AC2, and it should be readable without wading through
upserts. It also means changing the demo set is editing prose, not editing a script.

### AC2 — what "realistic" was taken to mean

Every ticket is a case somebody could plausibly have raised, written end to end: a refund
that was approved but never settled, an API key rotated by a migration whose notice went to
the wrong contact, scanners dropping off a warehouse network after a site move. The
conversations include the agent being wrong, the customer chasing, and internal notes that
say what the agent would not say to the customer.

The test enforces the floor rather than the ceiling: no placeholder vocabulary anywhere,
and a median message length above sixty characters. It cannot assert that the writing is
good, and it does not pretend to — it asserts that nobody has replaced it with `foo`.

### AC4 — the breach is computed, not declared

`resolutionBreached` is set from whether the clock actually passed, using the deadline that
came from the policy US-67 resolved. Setting the flag by hand would seed a database that
disagrees with itself the moment US-68 starts computing the same field, and the test asserts
the two agree.

Ticket ages are spread from one hour to two weeks, so a freshly seeded database has tickets
at every stage of their life rather than fourteen created at the same instant.

### AC5 — two different guarantees

**Refuses production** is a guard at the top of `seedDemoData`: `NODE_ENV=production`
returns without writing, and so does a missing `SEED_PASSWORD`. Both are the same guards
the development users already used, for the same reason — invented tickets from invented
customers sitting in a real agent's queue is the same class of problem as a known password
on a live helpdesk.

**Does not duplicate** is per-record. Branches, departments, categories, staff and articles
upsert on their natural keys. Customers are find-then-write, because `email` is indexed but
deliberately not unique — a household can share one. Tickets key on subject scoped to the
customer, which works because these subjects are written rather than generated.

### The SLA seeding moved

`seedSlaPolicies` was inside `seed.ts`; it is now
`backend/src/sla/seed-default-policies.ts`. The demo seeder needs it, and so does the demo
seeder's test, and a function only reachable from inside another file's `seed()` is not
importable by either.

Similarly, US-67's policy-matching `where` clause moved into `sla-matching.ts` so the
seeder resolves policies through **exactly** the query the application uses. A demo whose
SLA column disagrees with the API would be worse than a demo with no SLA at all.

## Files

| Path | What |
| ---- | ---- |
| `backend/src/seed/demo-data.ts` | **New.** The data set. Content only. |
| `backend/src/seed/demo-seed.ts` | **New.** Turns it into rows. |
| `backend/src/seed/demo-seed.test.ts` | **New.** AC1–AC5. |
| `backend/src/seed/seed.ts` | Calls the demo seeder after the policies. |
| `backend/src/sla/seed-default-policies.ts` | **New.** Moved out of `seed.ts` so both callers can reach it. |
| `backend/src/sla/sla-matching.ts` | **New.** The candidate query, shared by the service and the seeder. |
| `docs/running-the-project.md` | Documents what the seed now creates, and the demo staff accounts. |

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 — coverage | ✅ every entity the criterion names, all seven statuses, all four priorities, staff across manager and agent (administrator is already a development user) |
| AC2 — realistic content | ✅ no placeholder vocabulary in any subject, description or message; median message length above 60 characters; all but three tickets carry a real exchange |
| AC3 — bilingual | ✅ four Arabic ticket subjects, Arabic message bodies, an Arabic article and a matched EN/AR translation pair, Arabic locales on both customers and staff |
| AC4 — edge cases | ✅ a breach (and the flag agrees with the clock), two unassigned tickets, an eight-message thread, two attachments; every ticket resolved a policy |
| AC5 — idempotent and safe | ✅ a second run changes no count; `NODE_ENV=production` writes nothing; a missing `SEED_PASSWORD` writes nothing |

**Tests:** `demo-seed.test.js` 14 pass. Regression: tickets 20, customers 17,
ticket-history 11, sla-policy 13 — all pass against a database that now contains the demo
set. Typecheck and lint clean.

## Flagged

1. **`Channel` has no `PHONE` and no `PORTAL`.** The enum is `EMAIL`, `WHATSAPP`, `CHAT`,
   `SMS`, `WEB`. Tickets a customer phoned in are therefore recorded as `WEB` — an agent
   typing into the web app, which is literally what happens. Not changed here; if the
   product wants to distinguish a phone call, that is a migration and a US-6 amendment.
2. **Attachment rows point at storage keys with no object behind them.** S3 is not wired up
   in the MVP. The filename, size and content type are what the ticket screen renders, and
   the key is honest about being a placeholder rather than pretending a file exists.
3. **One SLA test had to be strengthened.** `AC2 — every dimension the criterion names can
   match` in `sla-policy.test.ts` was written against a database with no seeded policies. Now
   that the test database has them, single-matcher fixtures collide with the unique index
   and lose on specificity. The test now anchors each case to unused scenery *and* asserts
   the negative — a ticket that disagrees on that one dimension does not resolve to the
   policy — which is a better test than the one it replaced.

## What the next stories inherit

- **US-68** has fourteen tickets with real deadlines to recompute against, including ones
  already breached.
- **US-42** (the queue) and **US-45** (the workspace) can be reviewed against something.
  A queue of one ticket does not show whether a queue is readable.
- **US-82** (the portal) has four tickets carrying internal notes, which is what the
  regression test for the project's first rule needs to be true about.
