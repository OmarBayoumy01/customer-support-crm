# Story 18 — Define design tokens and theming

- **Story:** US-26 · **Phase:** P03 · **Layer:** Frontend · **Priority:** Must have
- **Depends on:** US-25 · **Commit:** `c919e86`

> Written after implementation. The direction and its reasoning are in `00-overview.md`.

## Target paths

| Action     | Path                                                     |
| ---------- | -------------------------------------------------------- |
| **modify** | `frontend/src/styles/index.css` — the three token layers  |
| **create** | `frontend/src/lib/design-tokens.ts` — the status/priority/SLA map |
| **create** | `frontend/src/lib/branding.ts` — runtime accent, contrast, hue |
| **create** | `frontend/src/lib/design-tokens.test.ts`                  |
| **create** | `frontend/src/features/design-system/design-system-page.tsx` |

New dependencies: `@fontsource/ibm-plex-sans`, `-sans-arabic`, `-mono`; `lucide-react`.

## How each criterion is proved

| AC  | How                                                                             |
| --- | ------------------------------------------------------------------------------- |
| AC1 | Every colour is a named token in `:root`. Hex appears in exactly one layer of one file. |
| AC2 | `--text-page` 22px, `--text-section` 16px, `--text-body` 14px, `--text-meta` 12px, and no fifth size. |
| AC3 | Tested. Every status and every priority has an entry; the key sets are asserted **equal** to the domain enums, so a drift in either direction fails. |
| AC4 | Tested. A valid accent writes four custom properties; a malformed one is refused rather than written silently; reset restores the default. |
| AC5 | Tested, mechanically. Every text-on-background pair, every badge on its own soft ground, and every SLA colour on both paper and ground meets 4.5:1. Plus: any accent an administrator picks still meets AA against its chosen text colour. |

## The two tests worth keeping above the others

- **"nothing is communicated by colour alone"** — every entry in the map must carry a label
  key and an icon. It is the definition of done as an assertion.
- **"most of the palette is deliberately colourless"** — fails if a later change starts
  painting every status. The thesis, written down where it can break.

## Deviations

- **`01-design-system.md` does not exist**, so the direction was chosen rather than
  followed. See `00-overview.md`.
- The hue-separation test originally measured contrast ratio, which says nothing about
  whether two colours can be confused. Corrected to measure hue.
- Dark mode is out of scope (V2), but the `@custom-variant dark` is declared because
  shadcn emits `dark:` classes regardless and they have to compile.

## Verification

```
npm run test --workspace @crm/frontend    # 31 tests here
```

Then open `/design-system` in the running app and switch to Arabic.
