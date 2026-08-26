# Story intake

- Source of truth: Notion "User Stories", ref **US-28**.
- Page: https://app.notion.com/p/3c69e0838523812bb744d0dbbb75dd24

> **Reconstructed after implementation (2026-08-26).** A record, not a gate.

## Feature

- **Feature name:** Design System · **slug:** `design-system`

## Tracker

- `US-28` · Phase `P03` · Layer `Frontend` · Priority `Must have` · MVP
- **Depends on:** US-27 · **Design File:** `02-app-shell-navigation.md` (does not exist)

## Description

```
As a signed-in staff user
I want consistent sidebar and header navigation on every screen
So that I always know where I am and can reach anything in one or two clicks.
```

## Acceptance criteria, in brief

AC1 grouped sections Workspace / Knowledge / Analytics / Administration / Account, current
item highlighted · AC2 permission-aware, never linking to a page that will reject ·
AC3 collapse persists across navigation and reload, icons with tooltips · AC4 header holds
toggle, breadcrumb, search, Create dropdown, notification bell with count, language
switcher, avatar menu · AC5 the My Tickets badge updates without a full page reload ·
AC6 in Arabic the sidebar moves to the right and the breadcrumb reverses.

## Out of scope

- Mobile navigation (the responsive story).

## Repository state at intake

US-23 built a temporary `AppNav` strip with the gating logic in it, explicitly noted as
P03's to replace. `usePermission` exists. There are no ticket endpoints, so AC5 has nothing
real to count.

## Conflicts and gaps to raise

1. **AC5 cannot be demonstrated end to end** — `GET /tickets/assigned/count` does not exist.
   The subscription mechanism can be built and tested; the number cannot be real yet.
2. **AC1 names five sections but most destinations do not exist.** A sidebar with two links
   would not demonstrate the grouping the criterion is about.

## Notes

- AC6 should cost nothing if the shell is a flex row with the sidebar first in the DOM:
  flex respects `dir`. Anything that needs a directional override is a design smell.
