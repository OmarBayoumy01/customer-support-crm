# US-42 — Browse and filter the ticket queue

- **Feature:** `tickets`
- **Story:** [Browse and filter the ticket queue](https://app.notion.com/p/3c69e083852381d087f6efea3f02141c)
- **Phase / Layer / Release:** P05 Ticket Management · Frontend · MVP · Must have
- **Depends on:** US-30 (data table) and US-40 (ticket API) — both done
- **Intake:** `.squad/stories/tickets/browse-and-filter-the-ticket-queue/intake.md`
- **MVP position:** 11 of 28 — the first story of wave 2

---

## The design file does not exist

The story names `06-tickets-list.md`. **That file is not in this repository and never has
been** — the same gap every frontend story in this project has hit. This screen is designed
against the P03 design system, whose thesis is already recorded: *colour is rationed to
urgency*, and the SLA edge is the signature element.

Flagged rather than invented. If the design files turn up, this screen is worth a second
look.

## Approach

### AC2 first, because it decides the rest

"Priority and SLA state are the most visually prominent elements" is a statement about a
**dense** screen, and the trap is obvious: make them prominent by colouring them, and a
queue where every row is coloured is a queue where nothing stands out.

So the row carries a **coloured rule on its inline start** — `slaEdgeClass`, which has
existed since US-26 waiting for this screen — and the SLA cell is the `SlaMeter`: a bar, a
countdown in tabular mono, and the state in words. Everything else on the row is chrome
grey. `border-inline-start` mirrors in Arabic without a second rule.

`DataTable` gained one prop for this: `rowClassName(row)`. The table stays ignorant of what
a ticket is.

### AC4 — the tabs are server-side views, not client-side filters

Each tab is a named view the **server** defines (`TicketsService.viewWhere`), and both the
list and the count go through it. That is the point: a tab labelled "Breached SLA" whose
count is computed one way and whose list is filtered another is worse than no count at all,
and it is exactly what happens when the frontend assembles the filters itself.

`GET /tickets/counts` answers all six in one request. Six list calls with `pageSize=1` would
give the same numbers and cost seven round trips to render one screen.

"All" is the **absence** of a view rather than `view=all`, so the default queue has a clean
URL worth pasting into chat.

### AC3 — the URL is the state, and the chips say so

`useTableQueryState` already made the query string the only copy of the view (US-30, AC1).
This screen adds the chips: a dropdown two rows up showing "Urgent" is a control; a chip is
a **statement about what you are looking at**, which is what an agent needs coming back to
a tab twenty minutes later wondering why the queue looks short.

Each chip names its filter as well as its value. On this screen in particular, "Urgent"
alone does not say whether it is a priority or an SLA state.

### What the toolbar does not have, and why

Filters on **status, priority, channel and SLA state** — every one of which is an enum the
frontend already knows.

**Category and assignee are deliberately absent from the toolbar.** Both need a lookup
endpoint that no story has built yet: categories arrive with US-49 (set category and
priority) and assignable agents with US-48 (assign and reassign). The *capability* is
already there — `?categoryId=…` and `?assigneeId=…` work today and the API filters on both
— only the picker is missing, and building two lookup endpoints here would be doing US-48
and US-49's work early and badly.

### Backend additions this frontend story required

Three, each small and each with no other owner:

| Addition | Why |
| -------- | --- |
| `Ticket.categoryName` | AC1 wants a category **column**. Sending only an id would force the queue to fetch a lookup to render one cell. Resolved server-side alongside `assigneeName`, which has worked this way since US-40 |
| `GET /tickets/counts` | AC4's live counts. No other story provides them |
| `GET /tickets/assigned/count` | The sidebar badge US-28 built and left waiting — same query family, and it lights up with no frontend change |

`view` also joins `TicketListQuerySchema`, so a tab is one parameter rather than the client
reassembling four.

## Files

| Path | What |
| ---- | ---- |
| `frontend/src/features/tickets/tickets-queue-page.tsx` | **New.** The screen. |
| `frontend/src/features/tickets/queue-tabs.tsx` | **New.** AC4, a real `tablist`. |
| `frontend/src/features/tickets/filter-chips.tsx` | **New.** AC3. |
| `frontend/src/features/tickets/use-tickets.ts` | **New.** The list and counts queries. |
| `frontend/src/features/tickets/use-assigned-ticket-count.ts` | The endpoint it was waiting for now exists. |
| `frontend/src/components/data-table/data-table.tsx` | `rowClassName`, for the SLA edge. |
| `frontend/src/app/router.tsx` | `/tickets`, and `/tickets/mine` redirecting to the view. |
| `frontend/src/i18n/locales/{en,ar}.json` | `ticket.queue` and `ticket.channel`, both languages. |
| `packages/shared/src/dto/ticket-counts.ts` | **New.** The six views, named once. |
| `packages/shared/src/dto/ticket.ts` | `categoryName`; `view` on the list query. |
| `backend/src/tickets/tickets.service.ts` | `viewWhere`, `counts`, `assignedCount`; `categoryName`. |
| `backend/src/tickets/tickets.controller.ts` | The two count endpoints. |

**`/tickets/counts` is declared before `/tickets/:id`.** Nest matches in declaration order,
so a literal path after a parameterised one is never reached — it would resolve as a ticket
whose id is "counts".

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 — columns | ✅ all nine plus the checkbox; the channel is named in text for a reader who cannot see the icon |
| AC2 — scannability | ✅ SLA edge on the row, `SlaMeter` with a countdown and a state in words; priority and status are text-plus-icon, never colour alone; a ticket with no target says "No target" |
| AC3 — filters | ✅ a filter from the URL reaches the API and appears as a named chip; removing the chip drops it from the request |
| AC4 — view tabs | ✅ six tabs, live counts from one request, `aria-selected` on the active one, and the URL is the source of which tab is open |
| AC5 — sorting | ✅ the header sends `sort=` to the API and the column reports `aria-sort` |
| AC6 — empty states | ✅ an empty queue invites the agent to wait; a filter that matched nothing offers to clear it |

**Tests:** `tickets-queue-page.test.tsx` 14 pass, including the Arabic render.
`tickets.test.js` 26 pass (5 new, covering the counts endpoints, their scoping, and
`categoryName`). Typecheck and lint clean; the other frontend suites (76 tests) still pass.

## Out of scope

- The ticket detail screen — US-45. The row click routes to `/tickets/:id`, which is
  US-45's route and currently the 404.
- What the bulk bar *does* — the selection and the bar exist from US-30; the actions are
  US-47 and US-48.
- Category and assignee pickers — see above.

## What the next stories inherit

- **US-45** owns `/tickets/:id`, which this screen already navigates to.
- **US-48** and **US-49** bring the lookups that complete the filter toolbar, and the
  actions the bulk bar is waiting for.
- **US-69** has the SLA cell already built; it needs the same treatment on the detail
  header.
