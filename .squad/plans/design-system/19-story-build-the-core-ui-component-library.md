# Story 19 — Build the core UI component library

- **Story:** US-27 · **Phase:** P03 · **Layer:** Frontend · **Priority:** Must have
- **Depends on:** US-26 · **State: IN PROGRESS** · partial in `c919e86`

> Written while the story is unfinished. The remaining work is listed explicitly below —
> this file is the handover, not a completion record.

## Done

| Action     | Path                                                        |
| ---------- | ----------------------------------------------------------- |
| **create** | `frontend/src/components/ui/*` — 20 shadcn primitives: button, input, label, badge, separator, tooltip, dropdown-menu, dialog, sheet, alert-dialog, avatar, tabs, breadcrumb, popover, command, select, checkbox, skeleton, scroll-area, table, calendar, sonner |
| **create** | `frontend/src/components/domain/indicators.tsx` — `StatusBadge`, `PriorityBadge`, `SlaBadge`, `SlaMeter`, `slaEdgeClass` |
| **create** | `frontend/src/components/ui/README.md` — the two manual steps after `shadcn add` |
| **modify** | `frontend/src/components/ui/*` — physical direction classes rewritten |

## Not done — what AC1 still lacks

The criterion names these and they are **not** built: **search field**, **combobox**,
**date range picker**, **pagination**, **filter bar**, **confirm dialog** (the `alert-dialog`
primitive is present but not wrapped into the project's own confirm), and **file upload**.

The primitives each needs are installed. What is missing is the composition and the props
that make them this project's components rather than shadcn's.

## Criteria status

| AC  | State | Note                                                                        |
| --- | ----- | --------------------------------------------------------------------------- |
| AC1 | **Partial** | See the list above.                                                   |
| AC2 | Done  | `Badge` takes no prop to hide its label, and there is a test asserting every entry in the map carries one. |
| AC3 | Done  | Inherited from the shadcn variants, demonstrated on `/design-system` including the error state. |
| AC4 | Done  | Radix handles focus trapping and Escape. **Not yet asserted by a test** — worth adding with the remaining components. |
| AC5 | Done  | See below.                                                                  |

## AC5 — the deviation that matters most

**shadcn generates 33 physical-direction classes** — `pl-8`, `pr-2`, `right-4`, `text-left`.
AC5 forbids exactly that. They are rewritten to logical properties (`ps-`, `pe-`, `start-`,
`end-`, `text-start`) by a scripted pass that only matches a token at the **start** of a
class, so `slide-in-from-right-2` and `data-[side=right]` are left alone.

**This recurs on every `shadcn add`.** `components/ui/README.md` documents it.

Radix's own `side` props are physical and cannot be fixed in CSS at all, so `Tooltip` and
`Sheet` compute their side from the active language.

## Remaining work, in the order it is wanted

1. `ConfirmDialog` — wraps `alert-dialog`; needed by anything destructive.
2. `SearchField` and `Combobox` — `command` + `popover` are installed.
3. `Pagination` and `FilterBar` — both wanted by **US-30**, so they come before it.
4. `DateRangePicker` — `calendar` is installed.
5. `FileUpload` — no consumer until the attachments story; last.
6. A keyboard test covering focus trap and Escape, closing AC4 properly.

## Verification

```
npm run test --workspace @crm/frontend
```
