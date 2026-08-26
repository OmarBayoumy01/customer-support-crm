# Story 20 — Build the application shell

- **Story:** US-28 · **Phase:** P03 · **Layer:** Frontend · **Priority:** Must have
- **Depends on:** US-27 · **Commit:** `c919e86`

> Written after implementation. Decisions are in `00-overview.md`.

## Target paths

| Action     | Path                                                      |
| ---------- | --------------------------------------------------------- |
| **create** | `frontend/src/components/shell/app-shell.tsx`              |
| **create** | `frontend/src/components/shell/sidebar.tsx`                |
| **create** | `frontend/src/components/shell/header.tsx`                 |
| **create** | `frontend/src/components/shell/nav-model.ts` — the sidebar as data |
| **create** | `frontend/src/app/shell-state.ts` — jotai atoms            |
| **create** | `frontend/src/features/tickets/use-assigned-ticket-count.ts` |
| **delete** | `frontend/src/components/app-nav.tsx` — US-23's placeholder |

New dependency: `jotai`.

## How each criterion is proved

| AC  | How                                                                             |
| --- | ------------------------------------------------------------------------------- |
| AC1 | Tested. All five section headings render, and the active item carries an inline-start rule. |
| AC2 | Tested. Administration items render `aria-disabled` with a lock **and a text explanation**, and no link exists to click. |
| AC3 | `atomWithStorage` on `crm:sidebar-collapsed`. Collapsed renders icons with tooltips and keeps the group headings for screen readers. |
| AC4 | All seven elements present: toggle, breadcrumb, search, gated Create dropdown, bell with count, language switcher, avatar menu. |
| AC5 | **Mechanism only — see below.**                                                 |
| AC6 | The shell is a flex row with the sidebar first in the DOM, so `dir` moves it. Every inset is a logical property. |

## AC5 is wired but not demonstrable

`GET /tickets/assigned/count` **does not exist** — tickets are a later phase. The badge
subscribes to `ASSIGNED_TICKET_COUNT_KEY`, and anything that changes an assignment
invalidates that key; that is the whole "without a full page reload" mechanism and it is
real. But the number is not, and a failure resolves to `undefined` so the badge does not
render. A sidebar showing `0` because nothing answered would be worse than one showing
nothing.

**The criterion cannot be signed off until the tickets endpoint lands.**

## Deviations

- **`localStorage` is used for the collapsed state.** Deliberately noted, because US-14
  forbade it for the access token: a layout preference is not a credential.
- **Several sidebar destinations 404.** They are listed anyway — a sidebar with two links
  would not demonstrate the grouping AC1 is about. Each route arrives with its own story.
- **`Tooltip` and `Sheet` compute their side from the language.** Radix's `side` is
  physical; there is no CSS fix.
- `/design-system` is in the sidebar under Account. Not a product destination — the living
  reference for the design system, kept in the app so it cannot go stale.

## Verification

```
npm run test --workspace @crm/frontend
npm run dev  --workspace @crm/frontend    # then toggle to Arabic and collapse the sidebar
```
