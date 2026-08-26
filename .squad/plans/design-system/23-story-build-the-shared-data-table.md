# Story 23 — Build the shared data table

- **Story:** US-30 · **Phase:** P03 · **Layer:** Frontend · **Priority:** Must have
- **Depends on:** US-27 · **Design File:** `06-tickets-list.md` (does not exist)

Consumers in the slice: **US-42** the ticket queue, and any list that follows.

## No table library

TanStack Table is the obvious reach and it is not taken. It earns its weight on
*client-side* work — grouping, faceting, virtualisation over ten thousand rows held in the
browser. AC1 says the opposite: sorting, filtering and paging all happen **server-side**,
so the component's whole job is to render one page of rows and report what the user asked
for. That is a props-in, callbacks-out component, and wrapping a library to get it would
add a dependency, a second mental model, and an adapter, in exchange for nothing.

If a screen later needs client-side grouping, that is the moment to reconsider — with a
consumer, rather than in advance.

## Target paths

| Action     | Path                                                    |
| ---------- | ------------------------------------------------------- |
| **create** | `frontend/src/components/data-table/data-table.tsx`      |
| **create** | `frontend/src/components/data-table/use-table-query-state.ts` — the URL is the state |
| **create** | `frontend/src/components/data-table/data-table.test.tsx` |
| **modify** | `frontend/src/features/design-system/design-system-page.tsx` |
| **modify** | `frontend/src/i18n/locales/{en,ar}.json`                 |

## AC1 — the URL is the state, not a mirror of it

Sort, page, search and filters live in the query string and nowhere else. The table holds
no copy of them.

That is the difference between a filtered view you can send someone and one you can only
describe. It also means the back button works, a reload keeps the view, and — the case that
actually bites — a manager pasting a link into chat shows their colleague the same list
they are looking at, rather than an unfiltered default.

`useTableQueryState` owns the reading and writing. **Changing a filter or the sort resets
the page to 1**, because staying on page 4 of a list that just became six rows long shows
an empty table and reads as a bug.

## AC5 — two empty states, not one with a flag

Already built in US-31, and reused rather than reinvented:

- **no records at all** → `EmptyState` with the screen's own action ("Create a ticket")
- **filters matched nothing** → `NoResultsState`, which offers the filters back

Offering "Create a ticket" to somebody who has just filtered a full queue down to nothing
answers a question they did not ask.

## The rest

| AC  | How |
| --- | --- |
| AC2 | Selection is held by the caller, not the table, so a bulk action can survive a page change if a screen wants that. The bar appears only when the selection is non-empty and states the count in words. Header checkbox selects the visible page and reports indeterminate when partial. |
| AC3 | `overflow-x-auto` on a wrapper with `min-w` on the table. Columns keep their legibility and the table scrolls; nothing is compressed to fit. The wrapper is what scrolls, so the page itself never does. |
| AC4 | Delegates to US-31: `TableSkeleton`, `EmptyState`/`NoResultsState`, `ErrorState` with retry. The table renders exactly one of them and never a header over an error. |

## Test plan

1. AC1 — sorting a column writes `sort` and `dir` to the URL, and toggles direction.
2. AC1 — changing sort or a filter **resets the page to 1**.
3. AC1 — the table reads its state from the URL rather than internal state, so a rendered
   link reproduces the view.
4. AC2 — selecting rows shows the bar with a count; clearing hides it.
5. AC2 — the header checkbox selects the page and goes indeterminate when partial.
6. AC4 — loading renders the skeleton and no rows.
7. AC4 — an error renders `ErrorState` with a working retry, and no table header.
8. AC5 — empty with filters offers clearing; empty without them offers the screen's action.
9. AC3 — the scroll container exists and carries `overflow-x-auto`.
10. Sortable headers are buttons with `aria-sort`, so the sort is announced.
11. RTL — no physical-direction class.

## Out of scope

User-configurable column visibility (V2), per the story.

## Verification

```
npm run test --workspace @crm/frontend
```

Then `/design-system`, where the table is shown with live sorting and selection.
