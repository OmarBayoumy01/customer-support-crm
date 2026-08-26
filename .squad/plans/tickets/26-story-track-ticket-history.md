# US-50 — Track ticket history

- **Feature:** `tickets`
- **Story:** [Track ticket history](https://app.notion.com/p/3c69e0838523814cade4f1844bd78096)
- **Phase / Layer / Release:** P05 Ticket Management · Full-stack · MVP · Must have
- **Depends on:** US-40 (Build the ticket API) — done
- **Intake:** `.squad/stories/tickets/track-ticket-history/intake.md`
- **MVP position:** 7 of 28 in `.squad/plans/00-mvp-scope.md`

---

## What this story actually is

US-40 already created `TicketHistoryService` and wrote an entry for every field change,
because its own AC5 required it. This story is the other four criteria: **every event
kind**, **attribution**, **automation versus a person**, **immutability**, and **a panel a
manager can read**.

The persona is a manager reconstructing a dispute. That single sentence decides most of
the design below: exact timestamps rather than "3 hours ago", newest first, and an
attribution that is never a guess.

## Approach

### AC4 first, because it constrains everything else

"History is append-only" is either a property of the database or it is a promise the next
developer breaks. `TicketHistory` already had no `updatedAt` and no `deletedAt` (US-6),
which expresses the intent but enforces nothing — Prisma will happily `update` a row whose
model has no timestamp.

So: a `BEFORE UPDATE OR DELETE` trigger that raises. `DELETE` is refused only while the
parent ticket still exists, which keeps a genuine cascade working — when a ticket is
purged, PostgreSQL removes the parent first, so by the time the trigger fires there is
nothing left for the history to describe.

**Flagged during execution:** the trigger originally raised with
`ERRCODE = 'restrict_violation'`. That sits in PostgreSQL's integrity-constraint class,
and Prisma renders the whole class as `Foreign key constraint violated` — the message
never reached the caller. Dropped the errcode so the default `P0001` carries the sentence.

### AC3 — one attribution, never two

`HistoryEntry` gains `automationRule`. When it is set, `record()` forces `actorUserId` to
`null`, **even if the caller passed one**. That is deliberate and tested: an SLA escalation
attributed to whoever last touched the ticket is a lie in the one record kept for settling
disputes, and the person it names is the one who gets asked about it.

The rule name lives in `metadata` under a single exported key rather than a new column —
`metadata` was already there, and a column would need a migration on a table US-47, US-68
and US-71 are all about to write to.

### AC1 — the events, and what the enum does not have

`TicketEventType` has no `RESOLVED`. Resolution and closure arrive as `STATUS_CHANGED`
with `toValue` of `RESOLVED`/`CLOSED`, and "reassigned" is `ASSIGNED` with a non-null
`fromValue`. **This is flagged rather than fixed:** adding enum members now would leave
US-47's transition endpoint choosing between two names for the same change. If review
disagrees, it is a migration and one line in `EVENT_FOR_FIELD`.

### AC5 — the panel

A compact vertical timeline: one hairline rail, one node per event, one sentence each.
Chrome greys only — the saturated ramp belongs to SLA and priority, and an audit trail is
a record, not an alarm. Collapsed to the four most recent entries once a ticket passes six,
because reconstructing a dispute starts at the end and works backwards.

The staff ticket detail screen is US-41 and does not exist yet, so this ships as a
standalone component with its own tests. US-41 mounts it.

## Files

| Path | What |
| ---- | ---- |
| `backend/prisma/migrations/20260826200000_append_only_history_for_us50/migration.sql` | **New.** The `history_is_append_only()` trigger. Hand-written — no schema change to diff. |
| `packages/shared/src/dto/ticket.ts` | `automationRule: string \| null` on `TicketHistoryEntrySchema`. |
| `backend/src/tickets/ticket-history.service.ts` | `automationRule` on `HistoryEntry`, `AUTOMATION_METADATA_KEY`, `automationRuleOf()`, paginated `forTicket()`. |
| `backend/src/tickets/tickets.service.ts` | `metadata` in the history select; `automationRule` in the detail mapping. |
| `backend/src/tickets/tickets.controller.ts` | `GET /tickets/:id/history`. |
| `backend/src/tickets/dto/ticket.dto.ts` | `PaginationQueryDto`. |
| `backend/src/tickets/ticket-history.test.ts` | **New.** AC1–AC4. |
| `frontend/src/components/domain/ticket-timeline.tsx` | **New.** The panel. |
| `frontend/src/components/domain/ticket-timeline.test.tsx` | **New.** AC5, plus AC2/AC3 on the rendering side. |
| `frontend/src/i18n/locales/{en,ar}.json` | The `ticket.history` namespace, both languages. |

## Security

`GET /tickets/:id/history` resolves the ticket through `TicketsService.detail` before
reading any history, so scope is decided in one place rather than two that have to agree.
A ticket outside the caller's scope answers 404, not 403 — tested.

Nothing here touches `Message.isInternal`; history records field changes, not message
bodies.

## Acceptance criteria — verification

| AC | How it is proven | Result |
| -- | ---------------- | ------ |
| AC1 — events captured | `ticket-history.test.ts`: creation, assignment, reassignment, priority, status-to-`RESOLVED`; newest-first and paging | ✅ |
| AC2 — attribution | actor name, `field`, `fromValue`, `toValue`, parseable `createdAt`; front end asserts the rendered sentence and the `datetime` attribute | ✅ |
| AC3 — system versus human | an entry with `automationRule` reports `actorName: null` **even though an actor was passed**; a human change reports `automationRule: null` | ✅ |
| AC4 — immutable | `UPDATE` rejects with `/append-only/`; `DELETE` rejects and the row is still there; a ticket purge still cascades to zero | ✅ |
| AC5 — presentation | ≤6 entries render whole with no toggle; 10 render 4 with a "Show 6 earlier events" button that expands and re-collapses; empty history says so | ✅ |

## Tests run

- `backend`: `ticket-history.test.js` — 11 pass. `tickets.test.js` (US-40 regression) — 20 pass.
- `frontend`: `ticket-timeline.test.tsx` — 8 pass, including the Arabic rendering.
- `npm run typecheck` and `npm run lint` clean across the workspace.

## Out of scope

- The system-wide `AuditLog` — separate administration feature.
- Writing `ESCALATED` entries — US-71 owns escalation; this story provides the recorder.
- Mounting the timeline on a screen — US-41.

## Open for review

1. **`TicketEventType` has no `RESOLVED`.** Documented above; nothing invented.
2. **`record()` never throws.** A failed history write is logged and swallowed so it cannot
   fail the change it was describing. Carried over from US-40; still the right trade, but
   it means AC1 is "recorded unless the database was down", which the log will show.
