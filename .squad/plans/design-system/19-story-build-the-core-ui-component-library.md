# Story 19 — Build the core UI component library

- **Story:** US-27 · **Phase:** P03 · **Layer:** Frontend · **Priority:** Must have
- **Depends on:** US-26 · **State: IN PROGRESS** · primitives shipped in `c919e86`

> **Scope narrowed 2026-08-26** by [`../00-mvp-scope.md`](../00-mvp-scope.md). AC1 names
> sixteen components; this story now builds **only the ones the vertical slice consumes**.
> The rest are not cancelled — they wait for a consumer, which is the honest reason to
> build a component at all.

## Already done

23 shadcn primitives under `components/ui/`, all rewritten to logical properties;
`components/domain/indicators.tsx` with `StatusBadge`, `PriorityBadge`, `SlaBadge`,
`SlaMeter` and `slaEdgeClass`; `components/ui/README.md` documenting the two manual steps
after every `shadcn add`.

## Build now — and only these

| Component | The consumer that justifies it |
| --------- | ------------------------------ |
| **`ConfirmDialog`** | US-47 resolving or closing a ticket, US-48 reassigning away from someone |
| **`Combobox`** | US-48 assignee picker, US-49 category picker, US-41 customer picker |
| **`SearchField`** | US-42 queue search, US-30's toolbar |
| **`FilterBar`** | US-42 queue filters — status, priority, assignee — and US-30 |
| **`Pagination`** | US-30, and therefore every list in the slice |

## Deferred, with the reason

- **Date range picker** — the `calendar` primitive is installed, but the first real
  consumer is a report filter, and reporting is two dashboards with no date filtering
  (US-55, US-58). Building it now means guessing its API.
- **File upload** — US-51 attachments is deferred, so it has no consumer at all.
- **Tabs, breadcrumbs, tooltip, dropdown, modal, drawer, avatar** — already present as
  primitives and already used by the shell. Nothing further to compose.

## Target paths

| Action     | Path                                                     |
| ---------- | -------------------------------------------------------- |
| **create** | `frontend/src/components/ui/pagination.tsx` — shadcn primitive |
| **create** | `frontend/src/components/common/confirm-dialog.tsx`       |
| **create** | `frontend/src/components/common/combobox.tsx`             |
| **create** | `frontend/src/components/common/search-field.tsx`         |
| **create** | `frontend/src/components/common/filter-bar.tsx`           |
| **create** | `frontend/src/components/common/components.test.tsx`      |
| **modify** | `frontend/src/features/design-system/design-system-page.tsx` — show them |
| **modify** | `frontend/src/i18n/locales/{en,ar}.json`                  |

## Criteria status after this story

| AC  | State | Note                                                                    |
| --- | ----- | ------------------------------------------------------------------------ |
| AC1 | **Met for the slice** | Five composites built; two deferred with a stated reason above. Re-open when US-51 or reporting arrives. |
| AC2 | Done  | `Badge` has no prop to hide its label, and a test asserts every entry in the shared map carries one. |
| AC3 | Done  | Inherited from the shadcn variants, demonstrated on `/design-system` including the error state. |
| AC4 | **Closed by this story** | Radix handles focus trapping and Escape, but that was never asserted. `ConfirmDialog` gets a keyboard test covering focus trap, Escape, and that Escape means cancel — not confirm. |
| AC5 | Done  | 33 generated physical-direction classes rewritten to logical ones; recurs on every `shadcn add`, documented in `components/ui/README.md`. Radix's `side` props are physical and are computed from the active language. |

## The decisions in these five components

1. **`ConfirmDialog` takes the consequence, not a generic message.** Its props are the
   action's own words — "Resolve ticket", "Resolve" — because a dialog that says "Are you
   sure?" makes the reader reconstruct what they clicked. It is also where `destructive`
   lives, so the red variant cannot be applied to a harmless action by accident.
2. **Escape cancels.** Never confirms. Asserted, because getting it the other way round is
   how a dialog becomes dangerous.
3. **`Combobox` is single-select and requires a label.** Multi-select has no consumer in
   the slice. Search is client-side over an options array — the first list long enough to
   need a server-side search is the customer picker, and that arrives with US-41.
4. **`FilterBar` owns no state.** It renders the filters it is given and reports changes
   upward, so the queue's URL stays the source of truth for what is filtered. A filter bar
   that remembers things is a filter bar that disagrees with the address bar.
5. **`Pagination` is 1-based**, matching `PaginationMeta` from `@crm/shared`, so the page
   number in the UI is the page number in the query string and in the API.

## Test plan

`frontend/src/components/common/components.test.tsx`, Vitest and Testing Library:

1. **AC4 — focus is trapped in `ConfirmDialog`** and Escape closes it.
2. **AC4 — Escape cancels rather than confirms.** The one that matters.
3. `ConfirmDialog` calls `onConfirm` once, and shows a pending state while it resolves.
4. `Combobox` filters as you type, selects with the keyboard, and reports the value.
5. `Combobox` renders an empty state when nothing matches.
6. `SearchField` reports what was typed and clears.
7. `FilterBar` reports a change without holding the value itself.
8. `Pagination` disables previous on page 1 and next on the last page.
9. **AC5** — no rendered class carries a physical direction, across all five.

## Verification

```
npm run test --workspace @crm/frontend
```

Then `/design-system` in the running app, in both languages.
