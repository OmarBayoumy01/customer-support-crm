# US-69 — See SLA status on a ticket

- **Feature:** `tickets`
- **Story:** [See SLA status on a ticket](https://app.notion.com/p/3c69e083852381ccb6a0d6ea68ecbf38)
- **Phase / Layer / Release:** P08 SLA & Automation · Frontend · MVP · Must have
- **Depends on:** US-68 (the clock) and US-45 (the header) — both done
- **Intake:** `.squad/stories/tickets/see-sla-status-on-a-ticket/intake.md`
- **MVP position:** 18 of 28

A short plan: three of the six criteria are already met by US-45's header, and the story is
mostly two real gaps plus one contract addition.

## Already met

- **AC1** — both clocks are in the header, above the fold, no scrolling (US-45, AC2).
- **AC6** — the queue renders `SlaMeter` from the same `SLA_PRESENTATION` tokens and the same
  `slaStateFor` threshold the detail uses. Colours and thresholds already cannot diverge.
- **AC4, partly** — the header's clock expands to show the deadline and the policy name.

## The three real gaps

1. **There is no "completed" state.** AC3 names four — on track, at risk, breached, completed
   — and `SlaState` has three plus `none`. So a ticket that was answered inside its target
   still shows a green *running* countdown, and a resolved ticket shows time "left" against a
   clock that stopped. Grey is the missing signal.
2. **The countdown does not move** (AC5). It is computed once at render and only changes when
   TanStack Query refetches. An agent watching a ticket sees a frozen number.
3. **AC4 asks for the target and any paused periods, and neither is in the payload.** The
   policy *name* is there; its minutes are not, and `slaPausedAt` / `slaPausedMs` — which
   US-68 has been maintaining since it was written — are not exposed at all.

## Approach

### One component, replacing the header's private clock

`SlaTimer` in `frontend/src/components/domain/sla-timer.tsx`, and the local `SlaClock` inside
`ticket-header.tsx` is deleted. It lives in `components/domain/` beside the other indicators
because AC6 is a rule about every surface, and a timer that only exists inside one screen is
the thing AC6 is written to prevent.

### AC3 — `met` is a presentation state, not a server state

Derived in the client, not added to `SlaStateSchema`:

- the **response** clock is completed when `firstRespondedAt` is set — US-47 already exposed
  that column for its resolve warning;
- the **resolution** clock is completed when the ticket is `RESOLVED` or `CLOSED`.

Both are facts the payload already carries, and neither is a *state of the SLA* the server
should be asked to compute — the shared enum stays four values (`none`/`ok`/`warn`/`breach`)
and the component maps to a fifth for rendering. Grey uses the tokens `STATUS_PRESENTATION`
already uses for `NEW` rather than inventing a colour, and carries a text label like every
other state, per the definition of done's ban on colour alone.

### AC5 — one ticking clock, not one per timer

A `useNow(intervalMs)` hook in `frontend/src/hooks/use-now.ts` returning a `Date` that
re-renders on a one-second interval. Two timers in the header share the hook, so there are two
intervals rather than one — acceptable, and the alternative (a context publishing a tick) is
infrastructure for a problem two components do not have.

The countdown crosses `warn` and `breach` on its own as a consequence, because the state is
derived from the remaining fraction on every tick rather than from a value fixed at fetch time.

`Date.now()` is not read inside the arithmetic: the "now" comes in as a parameter, which keeps
the phrasing and state functions pure and testable with a fixed clock.

### AC4 — the payload gains four fields

`TicketSlaSchema` gains `pausedAt`, `pausedMs`, `responseTargetMinutes`,
`resolutionTargetMinutes`.

**The story's `Layer` is Frontend, and this is a backend change.** The smallest change that
satisfies AC4 as written — it asks for the target and the paused periods — and the alternative
is the client inferring a target from `createdAt` to `dueAt`, which is wrong by exactly the
banked pause. Flagged rather than quietly done.

They go on `TicketSlaSchema` (shared by the list and the detail) rather than on the detail
alone, which costs the list query one indexed join for the policy minutes. Two SLA shapes
would be the thing AC6 forbids, and the paused state is worth having in the queue too: a row
counting down while its clock is stopped is a lie the list currently tells.

### AC2 — phrasing per clock, not per number

`"First response due in 18m"` / `"First response overdue by 40m"` / `"First response met"`.
The label and the number are one sentence rather than a column heading above a bare figure,
because AC2 asks for it to read naturally. `formatRemaining` stays the only formatter, so the
queue and the header phrase durations identically.

### The queue

`SlaMeter` gains an optional `met` prop, and the queue passes it for a resolved or closed
ticket. That is the minimum for AC3 to hold in a list — the `closed` tab currently shows
green countdowns against stopped clocks. The chip, tokens and thresholds are untouched.

## Files

| Path | What |
| ---- | ---- |
| `packages/shared/src/dto/ticket.ts` | Four fields on `TicketSlaSchema`. |
| `backend/src/tickets/tickets.service.ts` | Select the pause columns and the policy minutes; map them. |
| `backend/src/tickets/tickets.test.ts` | The four fields are populated and the pause is visible. |
| `frontend/src/lib/design-tokens.ts` | The `met` presentation. |
| `frontend/src/hooks/use-now.ts` | **New.** The tick. |
| `frontend/src/components/domain/sla-timer.tsx` | **New.** The timer, with its pure helpers. |
| `frontend/src/components/domain/sla-timer.test.tsx` | **New.** AC2–AC5. |
| `frontend/src/components/domain/indicators.tsx` | `SlaMeter` learns `met`. |
| `frontend/src/features/tickets/ticket-header.tsx` | `SlaClock` deleted; `SlaTimer` used. |
| `frontend/src/features/tickets/tickets-queue-page.tsx` | Passes `met`. |
| `frontend/src/i18n/locales/{en,ar}.json` | `ticket.sla.timer.*`, both languages. |

No migration. No new dependency.

## Tests

Frontend `sla-timer.test.tsx`, with a fixed clock and fake timers:

1. Reads as a sentence — "due in", "overdue by" (AC2).
2. Four states render with the right token **and a text label** (AC3).
3. A met clock is grey and says so rather than showing a countdown (AC3).
4. Expanding shows the policy, the target, the exact deadline, and the paused total (AC4).
5. Advancing the fake clock changes the number without a refetch, and crossing 75% flips the
   state to at risk (AC5).

Backend: one test that the four new fields arrive, including a non-zero `pausedMs` after a
pause and resume.

Existing suites that touch the SLA header and the queue are re-run once, since the fixtures
gain fields.

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 | ✅ both timers in the header, above the fold — US-45's layout, unchanged. |
| AC2 | ✅ "First response due in 18m" / "overdue by 40m" / "met" / ": no target". One sentence, one formatter shared with the queue. |
| AC3 | ✅ four states, each named in words beside its colour. **The completed state is new** — a response answered inside its target no longer shows a green running countdown, and a resolved ticket no longer shows time "left". |
| AC4 | ✅ expanding shows target, exact deadline, policy, and either the paused total or "since" when the clock is stopped now. |
| AC5 | ✅ the number falls on a one-second tick with no refetch, and the state flips as it crosses 75% — asserted against a fixed clock with fake timers. |
| AC6 | ⚠️ verified for the two surfaces that exist. The queue's `SlaMeter` reads the same tokens, the same threshold function and the same duration formatter, and now honours the completed state too. **Dashboards do not exist yet** (US-55, US-58) — flagged, not claimed. |

**Verified.** Backend `tickets.test.js` **72 pass, 0 fail** (1 new). Frontend
`sla-timer.test.tsx` **12 pass** (new), and the three suites whose fixtures or markup changed
— `ticket-detail-page`, `tickets-queue-page`, `components` — **all pass**. Typecheck clean
across the three workspaces; ESLint and Prettier clean.

Verification was deliberately narrow per the cost budget: the one backend suite and the four
frontend files this touched.

## Two things found while implementing

**The trigger's accessible name was a regression, caught by an existing test.** Moving the
state word onto the collapsible trigger left both clocks announcing "Breached" to a screen
reader, with nothing to tell them apart. The trigger now carries
`aria-label="First response — Breached"` while the visible text stays the state. US-45's own
test is what caught it, by querying the button by name.

**The threshold test was wrong before the code was.** The state fraction is measured from when
the clock started to its deadline, not against the policy's target minutes — so a ticket an
hour into a 68-minute window is already at risk regardless of a 30-minute response target. The
first version of the AC5 test asserted otherwise and failed. The test was fixed; the arithmetic
matches `slaStateFor`, which the queue has used since US-42.

## Deviation from the plan

**The story's `Layer` is Frontend and this added four fields to the API.** `TicketSlaSchema`
gained `pausedAt`, `pausedMs`, `responseTargetMinutes` and `resolutionTargetMinutes`, and
`TICKET_SELECT` gained one indexed join for the policy minutes. AC4 asks for the target and the
paused periods; the client cannot derive either — inferring a target from `createdAt` to the
deadline is wrong by exactly the banked pause, which is the thing being displayed. Flagged
rather than done quietly.

## Flagged

- **AC6's "and dashboards"** — there are no dashboards yet (US-55, US-58). Verified for the
  two surfaces that exist; the rule is written down here for whoever builds them.
- **AC4's "paused periods"** plural — the schema banks a *total* (`slaPausedMs`) and the
  current pause start, not a list of intervals. The total is what US-68 chose to store, and a
  per-interval history would be a schema change. The timer shows the total and whether it is
  paused now.
