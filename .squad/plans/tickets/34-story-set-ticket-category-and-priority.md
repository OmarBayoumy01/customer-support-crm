# US-49 — Set ticket category and priority

- **Feature:** `tickets`
- **Story:** [Set ticket category and priority](https://app.notion.com/p/3c69e083852381b4805bff9276e4fced)
- **Phase / Layer / Release:** P05 Ticket Management · Full-stack · MVP · Must have
- **Depends on:** US-45 (the workspace) — done
- **Intake:** `.squad/stories/tickets/set-ticket-category-and-priority/intake.md`
- **MVP position:** 15 of 28

---

## Half of this story was already built

Worth saying before the approach, because it changes what the work actually was:

- **AC2** — US-68 already re-resolves the SLA policy on a priority change and recomputes
  the deadline from the original start. Nothing new was needed on the server.
- **AC5** — US-50's `recordChanges` already writes a `PRIORITY_CHANGED` and a
  `CATEGORY_CHANGED` entry with both values.

So this story is really: **two real controls, a category list to populate one of them, and
the routing hint that has been sitting unread in the schema since US-6.** Both inherited
criteria are now covered by tests rather than assumed.

## AC3's second half has an owner, and it is not this story

*"…and administrators can manage that list in settings."*

That is **US-113**, which `.squad/plans/00-mvp-scope.md` defers along with the rest of the
P14 configuration screens, on the same reasoning that defers US-70: the data is seeded, so
the management screen is not on the critical path.

So `GET /categories` is built — the half an agent needs to file a ticket — and the write
endpoints are not. `CategoriesModule` exports its service so US-113 builds on it rather
than beside it, and the controller's comment says why the guard is `ticket:view` and not
`category:manage`.

## Approach

### AC4 — the routing hint, applied on the server

`Category.departmentId` has been documented as a routing hint since US-6 and had no reader.
It is applied in `TicketsService.update`, not in the client, so it holds for every caller:
this screen, US-41's create screen, and whatever files a ticket from an inbound email in
P13.

**A hint, not a rule.** It is skipped when the same request also sets a department
explicitly, because an agent moving a ticket to a specific team meant that, and a category
quietly overruling them is how people stop trusting a form. Both directions are tested.

The message AC4 asks for is raised **only when the department actually moved** — a category
with no department mapped changes nothing about routing, and claiming otherwise teaches
people to ignore the message.

### AC2 — surfacing a recomputation the client cannot predict

The `PATCH` response carries the new deadlines, and the detail query is invalidated rather
than patched. Guessing the new deadline client-side would be a second implementation of
US-68's clock, and the two would disagree the first time the SLA policy changed.

### Both controls save on change

No Save button. There is nothing to batch — one field, one decision — and a form that needs
saving is a form somebody leaves half-changed. Categorising is the first thing that happens
to a ticket and the thing most often got wrong on the way in, so it has to be cheap to fix.

### Category names are sent in both languages

`GET /categories` returns `nameEn` and `nameAr` rather than one resolved server-side. A
category name is *picked* from a list and then *read* on a ticket, and the person doing
each may not be in the same locale. The client knows which language it is in; the server
would be guessing.

**Flagged inconsistency:** `Ticket.categoryName` (added by US-42 for the queue column) is
still `nameEn` unconditionally. It should follow the request locale. Left alone rather than
changed mid-story, because it affects the queue and belongs with whatever story does the
locale-aware read properly.

## Files

| Path | What |
| ---- | ---- |
| `packages/shared/src/dto/category.ts` | **New.** The category contract. |
| `backend/src/categories/` | **New.** Service, controller, module — read-only. |
| `backend/src/tickets/tickets.service.ts` | AC4's routing hint in `update`. |
| `backend/src/app.module.ts` | Registers `CategoriesModule`. |
| `frontend/src/features/tickets/ticket-classification.tsx` | **New.** Both controls. |
| `frontend/src/features/tickets/ticket-classification.test.tsx` | **New.** AC1, AC3, AC4. |
| `frontend/src/features/tickets/ticket-header.tsx` | Two read-only pills become controls. |
| `frontend/src/test/setup.ts` | Toasts are reset between tests — see below. |
| `frontend/src/i18n/locales/{en,ar}.json` | `ticket.classification`, both languages. |

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 | ✅ four priorities, each with its icon and label — never colour alone |
| AC2 | ✅ backend: Low → Urgent moves the deadline **earlier**, and the PATCH response carries it. Frontend invalidates rather than guesses |
| AC3 | ⚠️ **the picker is built; managing the list is US-113.** Active categories only, in the administrator's own order |
| AC4 | ✅ a mapped category moves the department and says so; an explicit department in the same request wins; an unmapped category says nothing about routing |
| AC5 | ✅ both changes appear with `fromValue` and `toValue` |

**Tests:** `tickets.test.js` 44 pass (6 new). `ticket-classification.test.tsx` 7 pass
(Arabic included). Full frontend suite 203. Typecheck and lint clean.

## A harness fix that was overdue

`dismissToasts()` now runs in the shared `afterEach`, beside `resetSessionStore()`.

Sonner's queue is module state, so a toast raised by one test was still mounted for the
next — which turned *"no routing message was shown"* into a failure caused by the previous
assertion **passing**. That is the worst kind of flake: it points at the wrong test.

## What the next stories inherit

- **US-42's queue toolbar** can now have its category filter — the lookup it was waiting
  for exists.
- **US-41** (create a ticket) uses the same `useCategories`, and gets `defaultPriority` for
  free.
- **US-113** builds its management screen on `CategoriesService` rather than beside it.
- **US-47** and **US-48** replace the two remaining read-only pills in the header, the same
  way this story replaced these two.
