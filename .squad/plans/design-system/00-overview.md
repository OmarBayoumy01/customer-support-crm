# design-system — plan overview

Entry point for the **design-system** feature: tokens, components, and the shell they are
assembled into. The visual identity of the product.

> **Written after implementation**, and while US-27 is still in progress. A record for two
> of the three stories, and a statement of what remains for the third.

## Stories

| NN  | File                                                | Title                             | Tracker id | Depends on | State                    |
| --- | --------------------------------------------------- | --------------------------------- | ---------- | ---------- | ------------------------ |
| 18  | `18-story-define-design-tokens-and-theming.md`      | Define design tokens and theming  | US-26      | US-25      | Done · `c919e86`         |
| 19  | `19-story-build-the-core-ui-component-library.md`   | Build the core UI component library | US-27    | US-26      | **In progress** · `c919e86` |
| 20  | `20-story-build-the-application-shell.md`           | Build the application shell       | US-28      | US-27      | Done · `c919e86`         |

## The design direction, and why it is a choice rather than a default

**No design file exists.** `01-design-system.md` and `02-app-shell-navigation.md` are named
by the stories and have never been added to the repository, along with the other twenty-nine
screen prompts. The human's standing decision since US-14 is to press on. So the direction
below was chosen and has to justify itself.

### Colour is rationed to urgency

Most support tools colour everything — blue buttons, green chips, purple charts — and the
result is that when a ticket is forty seconds from breaching its SLA, nothing on the screen
says so louder than the Export button does. This product's spine is a countdown, so:

- the chrome is monochrome cool graphite;
- **one** indigo carries interactive intent — links, primary actions, focus, selection;
- the saturated ramp belongs to **SLA state and priority alone**, and nothing else may use
  those tokens.

The indigo was chosen to be far from that ramp in **hue**, not in contrast. There is a test
asserting the separation and it measures hue deliberately: contrast is a lightness measure,
so a saturated indigo and a saturated red of similar lightness score barely above 1:1 while
being impossible to confuse. The first version of that test measured the wrong thing.

### The signature: the SLA edge

`SlaMeter` is the one component allowed to be loud, and its compressed form —
`slaEdgeClass`, a `border-inline-start` rule on a row — is what makes a queue of a hundred
tickets scannable vertically. It mirrors in Arabic for free, because it is a logical
property.

### Type

IBM Plex Sans with IBM Plex Sans Arabic and IBM Plex Mono, self-hosted. Not a default
pairing: the Arabic was drawn alongside the Latin by the same team, so the page does not
change texture when the language switches — which is what most bilingual pairings get
wrong. Mono is for ticket ids, durations and counts, where tabular figures make a queue
scannable. That is function, not flavour.

**The restraint is the risk.** Three of four priorities are grey; most statuses are grey.
This will read as plainer than a typical CRM. If it reads as unfinished rather than
disciplined, the palette is the thing to widen — but the argument is that an agent's eye
should have exactly one thing to catch.

## Decisions

1. **Three token layers**: raw palette (the only hex in the codebase) → role tokens
   (`--ink`, `--line`, `--sla-warn`) → shadcn's names mapped onto them. One place a colour
   is chosen.
2. **`@theme inline`, not `@theme`**, so a token overridden down the tree takes effect.
   Runtime branding depends on it.
3. **Only the accent is brandable.** The greys are the instrument the product is read
   through, and the urgency ramp means something — letting an administrator recolour
   "breached" would be letting them turn the alarm off.
4. **The text colour on the accent is chosen, not assumed.** An administrator who picks pale
   yellow gets dark text; assuming white is how "brandable" quietly breaks AC5.
5. **Badges have no prop to hide their label.** The moment one exists, a crowded screen
   turns it off and the status becomes a coloured dot.
6. **jotai for shell UI state**, React context for the session. A handful of unrelated
   booleans read by two components each would re-render the whole tree from a context.
7. **The design-system page lives inside the app**, not in a separate styleguide build. A
   styleguide that is a separate build is a styleguide that goes stale.

## What the next stories inherit

- `STATUS_PRESENTATION`, `PRIORITY_PRESENTATION`, `SLA_PRESENTATION` — the one map every
  screen resolves a domain value through.
- `AppShell`, `Sidebar`, `Header`, `NAV_SECTIONS` — a new destination is a row in the model.
- `RouteFallback` and `PermissionDenied` for **US-31**, which should extend them rather than
  start again.
- `Toaster` is already mounted in `AppProviders` for **US-32**.
- **US-30's data table** should use `slaEdgeClass` on its rows — that is what the signature
  was built for.
