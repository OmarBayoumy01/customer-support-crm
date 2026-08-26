# Story intake

- Source of truth: Notion "User Stories", ref **US-27**.
- Page: https://app.notion.com/p/3c69e0838523811790f7f7f6d1919e0e

> **Reconstructed after implementation began (2026-08-26). This story is still
> `In progress`** — the primitives and indicators are done, several composites are not.
> See the plan for exactly which.

## Feature

- **Feature name:** Design System · **slug:** `design-system`

## Tracker

- `US-27` · Phase `P03` · Layer `Frontend` · Priority `Must have` · MVP
- **Depends on:** US-26 · **Design File:** `01-design-system.md` (does not exist)

## Description

```
As a developer
I want a shared component library covering the app's repeated patterns
So that screens are assembled rather than hand-built each time.
```

## Acceptance criteria, in brief

AC1 coverage: buttons, inputs, search field, select and combobox, date range picker, tabs,
breadcrumbs, pagination, filter bar, tooltip, dropdown, modal, drawer, confirm dialog,
avatar, file upload · AC2 status and priority badges show text and an icon, never colour
alone · AC3 default, hover, focus, active, disabled and error states all defined ·
AC4 keyboard operable, focus trapped in overlays, Escape closes · AC5 RTL safe via logical
properties.

## Out of scope

- The data table (US-30) and the rich text editor.

## Repository state at intake

shadcn/ui is generating the primitives, which means most of AC3 and AC4 arrive for free —
Radix handles focus trapping and Escape.

## The conflict that matters

**shadcn's generated components are full of physical-direction classes** — `pl-8`, `pr-2`,
`right-4`, `text-left`. AC5 forbids exactly that, and the platform mirrors for Arabic. This
is not a one-off: every future `shadcn add` reintroduces them. Radix's own `side` props
(`Tooltip`, `Sheet`) are physical too and cannot be fixed by CSS at all.

## Notes

- AC2 should be enforced by the component's shape, not by convention. A badge with a prop
  to hide its label is a badge that becomes a coloured dot on the first crowded screen.
