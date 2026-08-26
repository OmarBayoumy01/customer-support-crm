# Story 22 — Give feedback with toast notifications

- **Story:** US-32 · **Phase:** P03 · **Layer:** Frontend · **Priority:** Must have
- **Depends on:** US-27

## What already exists

`components/ui/sonner.tsx` and the host mounted in `AppProviders`, both from US-26's
scaffolding. Neither had any usage, helpers, or opinion attached.

## Target paths

| Action     | Path                                            |
| ---------- | ----------------------------------------------- |
| **create** | `frontend/src/lib/toast.ts` — the only way this app raises feedback |
| **create** | `frontend/src/lib/toast.test.ts`                 |
| **modify** | `frontend/src/components/ui/sonner.tsx` — position, stacking, direction |
| **modify** | `frontend/src/i18n/locales/{en,ar}.json`         |

## The shape

Four functions, and the differences between them are the story:

| | Duration | Action |
| - | -------- | ------ |
| `toastSuccess` | 4s, auto-dismisses | none |
| `toastError` | **`Infinity`** | retry, when the caller can supply one |
| `toastUndo` | 6s | Undo |
| `toastPromise` | sonner's own | — |

**Success dismisses itself; failure does not.** A confirmation you missed costs nothing. An
error you missed means you believe your reply sent when it did not — which on a support
desk is the whole failure mode this story exists to prevent.

## How each criterion is proved

| AC  | How                                                                             |
| --- | -------------------------------------------------------------------------------- |
| AC1 | `toastSuccess` passes a finite 4s duration and no action. |
| AC2 | `toastError` passes `Infinity`, and an action **only when `onRetry` is given** — a retry button that does nothing is worse than none. It uses the server's own message rather than inventing one, and shows the request id so it can be quoted. |
| AC3 | `toastUndo` passes six seconds and an Undo action that calls back. A plain success has none: undo is opt-in, because offering it for something irreversible teaches people to stop trusting the one place the product promises safety. |
| AC4 | `visibleToasts={3}` caps the stack and sonner collapses the rest. **Position is bottom-*start*, not bottom-end** — see below. |
| AC5 | sonner renders into its own `aria-live` region, so a toast is announced rather than only drawn. Nothing to add; worth stating so nobody removes the host and wonders. |

## Why bottom-start rather than the usual bottom-end

AC4 says toasts must not cover the primary action area. On this product's screens the
primary action sits at the inline **end** — the composer's send button, a form's submit —
so stacking toasts there would cover the control the user just pressed and is about to
press again. The side flips with the language, so it stays out of the way in Arabic too.

## Deviations

- **The tests assert on the arguments handed to sonner, not on pixels.** Every criterion
  here is about duration, persistence, and whether an action exists — those are arguments.
  Rendering assertions would test sonner.
- **Calls are captured into plain arrays** rather than read back off a `MockInstance`;
  sonner's overloads make the spy's generics awkward to name for no gain.
- `next-themes` stays removed — this app has one theme, and a theme provider to hard-code
  "light" is a package to maintain in exchange for nothing.

## Verification

```
npm run test --workspace @crm/frontend
```
