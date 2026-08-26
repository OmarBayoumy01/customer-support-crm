# Story intake

- Source of truth: Notion "User Stories", ref **US-26**.
- Page: https://app.notion.com/p/3c69e0838523819e8d23f56e14bfadef

> **Reconstructed after implementation (2026-08-26).** A record, not a gate.

## Feature

- **Feature name:** Design System · **slug:** `design-system`

## Tracker

- `US-26` · Phase `P03` · Layer `Frontend` · Priority `Must have` · MVP
- **Depends on:** US-25 · **Design File:** `01-design-system.md` (does not exist)

## Description

```
As a developer
I want design tokens defined once in the Tailwind theme
So that colour, type, and spacing stay consistent and rebranding is a config change.
```

## Acceptance criteria, in brief

AC1 named tokens, not scattered hex · AC2 the scale is 22 / 16 / 14 / 12 · AC3 status and
priority resolve colour from one shared map · AC4 an administrator's accent applies via CSS
custom properties with no rebuild · AC5 every text-on-background pair meets WCAG AA.

## Out of scope

- Dark mode (V2).

## Repository state at intake

US-14 left a deliberately thin placeholder token block with the note that P03 owns the real
one. shadcn/ui is installed with its own token names (`--primary`, `--destructive`, …)
already mapped onto that placeholder set.

## The gap that shapes everything

**`01-design-system.md` does not exist**, and neither do the other thirty screen prompt
files. There is no supplied visual direction, so one has to be chosen and justified rather
than followed. The human's standing decision since US-14 is to press on.

## Notes

- AC2 fixes the scale to four sizes. That is a constraint worth keeping rather than
  widening: a dense operational UI takes its hierarchy from weight and colour.
- AC4 and AC5 interact. An accent an administrator picks must still meet AA against the
  text placed on it, which means the text colour has to be **chosen**, not assumed white.
- AC5 is mechanically checkable, so it should be checked mechanically.
