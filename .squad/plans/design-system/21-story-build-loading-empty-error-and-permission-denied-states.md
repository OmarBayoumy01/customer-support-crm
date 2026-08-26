# Story 21 — Build loading, empty, error, and permission-denied states

- **Story:** US-31 · **Phase:** P03 · **Layer:** Frontend · **Priority:** Must have
- **Depends on:** US-27 · **Design File:** `28-states-loading-empty-error.md` (does not exist)

## What already exists

`RouteFallback` (a skeleton, from US-25) and `PermissionDenied` (from US-23). Both are
extended rather than replaced — the second one needs a real change, see AC4 below.

## Target paths

| Action     | Path                                                       |
| ---------- | ---------------------------------------------------------- |
| **create** | `frontend/src/components/states/skeletons.tsx` — table, list and detail shapes |
| **create** | `frontend/src/components/states/empty-state.tsx`            |
| **create** | `frontend/src/components/states/error-state.tsx`            |
| **create** | `frontend/src/components/states/offline-banner.tsx`         |
| **create** | `frontend/src/components/states/use-online-status.ts`       |
| **create** | `frontend/src/components/states/states.test.tsx`            |
| **move**   | `PermissionDenied` out of `features/auth/require-permission.tsx` into `components/states/permission-denied.tsx` |
| **modify** | `frontend/src/app/providers.tsx` — mount the offline banner  |
| **modify** | `frontend/src/features/design-system/design-system-page.tsx` |

## AC4 contradicts a decision made in US-23 — reconciled, not ignored

US-23's denied screen deliberately **named no permission**, on the grounds that
"you need `user:manage`" is a sentence for a developer and hands anyone probing the app the
vocabulary of its internals. There is a test asserting the key never reaches the DOM.

AC4 here asks for a screen "naming the missing access".

Both are right, and they are about different things. The screen now names the **capability
in human language** — "Administration", "Ticket assignment" — taken from the i18n bundle
via a capability key, never the raw permission string. `user:manage` still never reaches
the DOM, and the US-23 test stays exactly as it is.

## The shape of each state

| State | Rule |
| ----- | ---- |
| **Loading** | Skeletons in the shape of the content, never a full-page spinner. Three shapes cover the slice: a table, a list, and a detail pane. A spinner says "something is happening"; a skeleton says "a table with six rows is coming", and the layout does not jump when it arrives. |
| **Empty** | Headline, one line, one action. The action is the screen's — "Create a ticket" on an empty queue — because an empty screen is an invitation to act, not a dead end. A *filtered* empty is a different state: it offers "Clear filters", not "Create". |
| **Error** | Says what failed and offers retry. **Never apologises and never blames.** The retry re-runs only the failed request, which is why it takes an `onRetry` rather than reloading the page. Carries the request id when there is one, because that is the thing a user reads out over the phone. |
| **Permission denied** | Names the capability, not the key. Two ways out: the dashboard, and asking for access. |
| **Offline** | A persistent banner, top of the shell, cleared automatically on reconnect. |

## Test plan

`frontend/src/components/states/states.test.tsx`:

1. **AC1** — each skeleton renders the right number of placeholder rows and is `aria-busy`,
   announced once rather than narrating every block.
2. **AC2** — the empty state renders headline, description and action, and fires it.
3. **AC2** — the *filtered* empty state offers clearing rather than creating.
4. **AC3** — retry calls `onRetry` and does **not** reload the page.
5. **AC3** — the copy neither apologises nor blames: asserted against `/sorry|you (did|entered)/i`.
6. **AC3** — a request id is shown when present, and nothing is shown when absent.
7. **AC4** — the capability is named and the raw permission key never reaches the DOM.
8. **AC5** — going offline shows the banner; `online` clears it without a reload.
9. **AC5** — the banner is a live region, so it is announced rather than merely appearing.
10. RTL — no physical-direction class in any of them.

## Out of scope

Offline write queueing, per the story.

## Verification

```
npm run test --workspace @crm/frontend
```

Then `/design-system` and, for the banner, DevTools → Network → Offline.
