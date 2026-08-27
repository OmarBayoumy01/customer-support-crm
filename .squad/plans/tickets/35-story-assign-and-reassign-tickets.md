# US-48 — Assign and reassign tickets

- **Feature:** `tickets`
- **Story:** [Assign and reassign tickets](https://app.notion.com/p/3c69e083852381509f7fdf1a21eadffb)
- **Phase / Layer / Release:** P05 Ticket Management · Full-stack · MVP · Must have
- **Depends on:** US-45 (the workspace) — done
- **Intake:** `.squad/stories/tickets/assign-and-reassign-tickets/intake.md`
- **MVP position:** 16 of 28

---

## The thing worth saying first: there is a live permission hole

`assigneeId` is in `UpdateTicketSchema`, so **`PATCH /tickets/:id` will reassign a ticket
today, under `ticket:update`.** An agent holds `ticket:update` (at `ASSIGNED` scope) and does
not hold `ticket:assign`. So an agent can currently take a ticket off a colleague, or hand
their own work to somebody else, and nothing refuses it.

AC4 reads like a UI criterion — "the assignee control is read-only". It is not. Under
non-negotiable rule #2 the frontend gate is the convenience and the server is the boundary,
and right now the server has no boundary here at all. **The main body of this story is
closing that, not rendering a picker.**

## Approach

### AC4 — assignment becomes its own endpoint

`PATCH /tickets/:id/assignee`, guarded `@RequirePermission('ticket:assign')`, and
`assigneeId` comes **out** of `UpdateTicketSchema`.

This is the precedent US-40 already set for status, in a comment on the same PATCH handler:
moving a ticket through its lifecycle got its own endpoint because it has its own rules, and
accepting it on the general PATCH "would be a second, unguarded door onto the same state
machine". Assignment has its own permission, its own candidate rules, and its own history
semantics. Same reasoning, same shape.

The alternative — keep it on the general PATCH and check `ticket:assign` inside the service
when `assigneeId` is present — was rejected because it makes one endpoint answer to two
permissions depending on its body, which no guard can express declaratively and no reader of
the controller can see.

Verified there is no other caller: `assigneeId` appears in `UpdateTicketSchema` and in
`TicketListQuerySchema` (a filter, untouched). `CreateTicketSchema` has no `assigneeId`, so
US-41 is unaffected.

### AC4 — and the candidate is validated, not trusted

A guard that says "you may assign" is not the same as "you may assign *this ticket* to *this
person*". The service therefore refuses an assignee who is not in the caller's own assignable
set — the same query that builds the picker, not a second rule that has to agree with it:

- the ticket resolves through the existing `scopeFor`, so a manager cannot assign a ticket
  outside their department, and
- the candidate must come back from `assignableWhere(actor)` (below), or the call answers 422
  `VALIDATION_FAILED`.

Enforced in the database query, never by filtering a fetched list — rule #2 again.

### AC2 / AC5 — `GET /tickets/assignees`

One endpoint, guarded `ticket:assign`, returning the candidates with the two facts the picker
has to show. Declared **before** `@Get(':id')`, for the reason already written above `counts`:
Nest matches in declaration order, and `/tickets/assignees` would otherwise resolve as a
ticket whose id is "assignees".

It lives in the tickets controller rather than a new `staff` module. The list is defined by
ticket work — who can be given a ticket, and how many open tickets they hold — and a `staff`
module created for one endpoint would collide with US-114, which is deferred but owns staff
administration properly.

**Who counts as a candidate is derived from permissions, not from role keys.** A candidate is
a user who holds `ticket:update` through some role and has no `customerProfile`. Hardcoding
`role.key IN ('agent','manager')` would be a third place to update when somebody defines a
custom role, and the catalogue already answers the question: `customer` holds `ticket:view`
and `ticket:create` at `OWN` and deliberately **not** `ticket:update`. The
`customerProfile: null` clause is belt and braces against a custom role that grants it.

Scope, applied in the query:

| Caller's `ticket:assign` scope | Candidates |
| ------------------------------ | ---------- |
| `ALL` (administrator) | every candidate |
| `TEAM` (manager) | the caller's own department |
| anything else | the caller alone |

The last row is not a real configuration — no seeded role grants `ticket:assign` at `OWN` or
`ASSIGNED` — but a guard that admits somebody must still return something defensible rather
than everybody.

**The open counts are one query, not one per agent:** a single `groupBy` over
`Ticket.assigneeId` where the status is one of the open ones, joined onto the candidate rows
in memory. Four agents today, but the queue's own `counts` endpoint already established that
a per-row count is how a picker becomes the slowest thing on the screen.

### AC5 — `isActive` is the only availability this domain has

`User.isActive` exists and is honoured: an inactive user comes back `isAvailable: false`, is
rendered disabled in the picker, and is refused by the server if somebody posts their id
anyway.

**Out of office is not modelled anywhere** — no field, no enum, no table, verified across
`schema.prisma`, `backend/src`, and `packages/shared`. It is not being invented here. Adding
a column to `User` is a schema change, and the story that owns agent availability (shift
patterns, out-of-office windows) does not exist in the 28-story slice. **AC5 is therefore
half met, and it is flagged below rather than quietly counted.**

Unavailable candidates are still returned, not filtered out of the response. "Marked
unavailable and not offered by default" is two things: a ticket whose assignee has since gone
inactive must still render that person's name in the picker, or the control claims
"Unassigned" for a ticket that is assigned. Returning them with `isAvailable: false` and
disabling the row satisfies both halves; filtering them out satisfies neither.

### AC1 — "the agent is notified" has no channel

P07 (US-60 to US-66) is deferred by `00-mvp-scope.md`, exactly as it is for US-71's
escalation. There is nowhere to send a notification.

What ships instead: the assignment is recorded in history with its actor, and it appears
immediately in the new assignee's queue and in the sidebar badge
(`/tickets/assigned/count`, whose cache key the mutation invalidates). A structured log line
is written at info with the ticket, the actor and the new assignee, so the event is traceable
and US-62 has something to consume. **Flagged below.**

### AC1 / AC3 — an unassignment is not an assignment

`recordChanges` maps `assigneeId` to `ASSIGNED` unconditionally, so clearing an assignee
currently writes an `ASSIGNED` entry with an empty `toValue`. The enum has had `UNASSIGNED`
since US-6 and nothing has ever written it.

The mapping becomes a function rather than a lookup table: `assigneeId` with a null next
value is `UNASSIGNED`, otherwise `ASSIGNED`. Every other field keeps the table's behaviour.

### AC6 — the timeline has to say a name, not a UUID

`TicketHistory.fromValue`/`toValue` hold ids, and the timeline renders them raw — so a
reassignment reads *"Assignee moved from 0192c… to 0192d…"*. AC6 says the new assignee sees
who owned it previously. A UUID does not meet that.

Ids stay in `fromValue`/`toValue`: they are the machine-readable record, and P11's reports
will want them. The **names** are captured into `metadata` at write time
(`{ fromLabel, toLabel }`) and surfaced by `forTicket` as `fromLabel`/`toLabel` on
`TicketHistoryEntry`, which the timeline prefers over the raw value when present.

Captured at write time rather than joined at read time, deliberately: history is append-only
and describes what was true when it happened. A join would rename a historical entry when
somebody's name changes, and would render a blank once a user row is deleted —
`TicketHistory.actorUserId` is already `onDelete: SetNull` for that reason.

The fields are generic (`fromLabel`, not `fromAssigneeName`) so the category and department
entries — which have the same UUID-in-the-timeline problem, inherited from US-49 — can be
fixed by whichever story next touches them, without a second mechanism.

### AC6 — internal notes are preserved

Nothing in this story touches `Message`, so this holds by construction. It still gets a
regression test: the criterion is a promise to the person taking the handover, and the
project's first non-negotiable rule lives one field away. The test reassigns a ticket that
carries an internal note and asserts the note is still returned to the new assignee.

### AC3 — the Unassigned queue already exists

US-42 built the `unassigned` view (`assigneeId: null`) and its tab count. Unassigning writes
null, so the ticket appears there with no new code. "Remains visible to the team" holds
because `departmentId` is untouched — a manager's `TEAM` scope still matches it. Both are
asserted rather than assumed.

### Frontend — one control, and `Combobox` finally gets its first consumer

`Combobox` (US-27) names "US-48 assignee" as its first intended consumer and has been unused
since it was written. It is the right control: the list is short today and long in any real
deployment, and it already supports typing to narrow.

It needs two additive props to carry AC2 and AC5, both of which `CommandItem` already
supports underneath:

- `disabled?: boolean` on `ComboboxOption` — the unavailable rows.
- `meta?: ReactNode` on `ComboboxOption` — end-aligned trailing text, where "7 open" and
  "Unavailable" go.

Additive, so `Combobox`'s other planned consumers (US-49's category, US-41's customer) are
unaffected.

The read-only branch for AC4 is the `Badge` that is in the header today — it stays exactly as
it is, chosen with `usePermission('ticket:assign')`. Not a disabled combobox: a disabled
control invites a click that teaches nothing, and the existing fallback already reads
correctly.

`Avatar` initials go in the option's adornment. Workload is **text** ("7 open"), never a
colour — the definition of done bans colour-only signalling, and "avoid overloading one
person" is the number, not a hue.

---

## Files

| Path | What |
| ---- | ---- |
| `packages/shared/src/dto/ticket.ts` | `assigneeId` leaves `UpdateTicketSchema`; new `AssignTicketSchema` and `AssignableAgentSchema`; `fromLabel`/`toLabel` on `TicketHistoryEntrySchema`. |
| `backend/src/tickets/dto/ticket.dto.ts` | `AssignTicketDto`. |
| `backend/src/tickets/tickets.service.ts` | `assignableWhere`, `assignees()`, `assign()`. |
| `backend/src/tickets/tickets.controller.ts` | `GET /tickets/assignees` (before `:id`) and `PATCH /tickets/:id/assignee`. |
| `backend/src/tickets/ticket-history.service.ts` | The `UNASSIGNED` split; labels through `metadata`. |
| `backend/src/tickets/tickets.test.ts` | AC1–AC6 on the server. |
| `backend/src/tickets/ticket-history.test.ts` | The `UNASSIGNED` split and the labels. |
| `frontend/src/components/common/combobox.tsx` | `disabled` and `meta` on `ComboboxOption`. |
| `frontend/src/features/tickets/ticket-assignee.tsx` | **New.** The control, both branches. |
| `frontend/src/features/tickets/ticket-assignee.test.tsx` | **New.** AC2, AC4, AC5, AC6. |
| `frontend/src/features/tickets/use-assignees.ts` | **New.** The picker's query. |
| `frontend/src/features/tickets/ticket-header.tsx` | The last read-only pill becomes a control. |
| `frontend/src/components/domain/ticket-timeline.tsx` | Prefer `fromLabel`/`toLabel`. |
| `frontend/src/i18n/locales/{en,ar}.json` | `ticket.assignee.*`, both languages. |

No migration. No new dependency.

## Shapes

```ts
// packages/shared/src/dto/ticket.ts
export const AssignTicketSchema = z.object({
  /**
   * `null` unassigns — AC3. Required rather than optional: an omitted
   * assignee and a deliberate unassignment must not look the same.
   */
  assigneeId: z.string().uuid().nullable(),
});

export const AssignableAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  departmentName: z.string().nullable(),
  /** AC2. Open = not RESOLVED and not CLOSED, matching the queue's `open` view. */
  openTicketCount: z.number().int().nonnegative(),
  /** AC5. False today only when the user is inactive — see the flag. */
  isAvailable: z.boolean(),
});
```

## Test plan

Backend (`tickets.test.ts`, against the real Postgres harness):

1. A manager assigns → row updated, `ASSIGNED` entry with the actor and both labels.
2. **An agent with `ticket:update` but not `ticket:assign` is refused 403** — the hole.
3. `PATCH /tickets/:id` carrying `assigneeId` no longer assigns (the schema refuses it).
4. Unassign → null, an `UNASSIGNED` entry, and the ticket returns in the `unassigned` view.
5. That unassigned ticket is still visible to a `TEAM`-scoped manager (AC3's second half).
6. `GET /tickets/assignees` — counts match the fixtures; a `TEAM` manager sees only their own
   department; an administrator sees everyone.
7. An inactive candidate returns `isAvailable: false`, and assigning to them is refused 422.
8. Assigning to a candidate outside the caller's scope is refused 422.
9. A portal customer never appears as a candidate.
10. AC6 regression: an internal note survives a reassignment and is still returned to the new
    assignee.

Frontend (`ticket-assignee.test.tsx`):

11. The picker lists candidates with their open counts as text (AC2).
12. Unavailable candidates are marked in words and cannot be chosen (AC5).
13. Without `ticket:assign` the badge renders and no combobox exists (AC4).
14. Choosing an assignee invalidates detail, list, counts and the sidebar badge.
15. Arabic renders with no physical-direction classes (the existing RTL assertion).

Per the cost budget: the two touched workspaces' tests, then one typecheck and one lint at
the end — not the full pipeline.

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 | ⚠️ **partly.** The ticket updates and the history entry names the actor — written and covered by tests, **not yet executed** (see below). "The agent is notified" has no channel; flagged. |
| AC2 | ⚠️ each candidate carries an open ticket count, rendered as text. Frontend verified green; the backend half is written and unexecuted. |
| AC3 | ⚠️ unassigning returns the ticket to the `unassigned` view with the department untouched, recorded as `UNASSIGNED`. Written and unexecuted. |
| AC4 | ⚠️ **the real hole is closed** — `assigneeId` is out of `UpdateTicketSchema`, the new route is guarded by `ticket:assign`, and the candidate is re-checked in the service. Frontend read-only branch verified green; the 403 tests are unexecuted. |
| AC5 | ⚠️ **half met by design.** Inactive is honoured end to end (marked in the picker, refused by the server) and verified green on the frontend. **Out of office is not modelled**; flagged. |
| AC6 | ⚠️ the timeline reads names rather than UUIDs, and internal notes survive a reassignment. Written and unexecuted. |

**What ran, and what did not.** Frontend: `ticket-assignee.test.tsx` 9 pass, plus the four
files this story touched — `ticket-timeline`, `ticket-detail-page`, `components` (Combobox),
`ticket-classification` — 39 pass. Typecheck clean across all three workspaces; ESLint clean;
Prettier clean.

**The backend suite has not been executed.** Postgres and Redis were not running on the
machine (the Docker engine was down), so `prepare-test-db` could not reach a database. The
19 backend tests are written — 15 in `tickets.test.ts`, 4 in `ticket-history.test.ts` — and
they compile, but *compiling is not passing*. Until they run, every backend row above is
unverified, and the story stays `In progress` in Notion.

To run them:

```
docker compose up -d --wait postgres redis
npm run test --workspace @crm/backend
```

## One deviation from the plan

422 is raised as `UNPROCESSABLE`, not `VALIDATION_FAILED`. Both are 422; `ApiException` has
no `validationFailed` helper, and the codebase's own error-code documentation reserves
`UNPROCESSABLE` for "well-formed and understood, but refused by a business rule" — which is
exactly what an unassignable candidate is. `VALIDATION_FAILED` is for schema failures.

## A change to the existing test suites, worth flagging at review

Ten setup calls across `tickets.test.ts` and two in `ticket-history.test.ts` arranged an
assigned ticket by sending `assigneeId` to `PATCH /tickets/:id`. That route no longer accepts
it, so they were rewritten to go through the new endpoint via a `setAssignee` helper, and the
manager fixtures gained `ticket:assign`.

**They would otherwise have kept passing while testing nothing** — Zod strips an unknown key
rather than rejecting it, so the PATCH would have answered 200 and quietly not assigned. Two
of the rewritten tests then assert the ticket *did* move, which is what catches it.

## Flagged — not met, and not to be quietly closed

- **AC1, "the agent is notified"** — no notification channel exists; P07 is deferred. The
  assignment is logged and lands in the assignee's queue and sidebar badge. Completes with
  US-62.
- **AC5, "or out of office"** — not modelled in the domain. `isActive` is honoured; an
  out-of-office window needs a schema field and a story that owns agent availability, and
  neither exists in the MVP slice. Half of this criterion is genuinely unmet.

## Inherited inconsistency, still not fixed here

`Ticket.categoryName` is `nameEn` unconditionally while `GET /categories` returns both
languages (flagged by US-49). This story does not touch it. `departmentName` on the new
assignee payload raises the same question and is answered the same way for now — English —
rather than inventing a third convention mid-story.

## What the next stories inherit

- **US-47** replaces the header's last read-only pill (status) against the same pattern used
  here, and its transition endpoint sits beside `PATCH :id/assignee`.
- **US-71** escalates by reassigning to a manager, and can call `assign()` rather than writing
  `assigneeId` directly — so escalation gets the same history and the same validation.
- **US-55** and **US-58** both want per-agent open counts; `assignees()` is that query,
  already scoped.
- **US-44** (bulk reassign, deferred) has its endpoint — it needs a list body, not new rules.
- **US-62** consumes the log line as its first notification.
