# US-84 — Track my requests in the portal

- **Feature:** `portal`
- **Story:** [Track my requests in the portal](https://app.notion.com/p/3c69e0838523816c9b2ff72ce0614fde)
- **Phase / Layer / Release:** P10 Customer Portal · Frontend · MVP · Must have
- **Depends on:** US-82 ✅
- **Intake:** `.squad/stories/portal/track-my-requests/intake.md`
- **MVP position:** 23 of 28

## The story

> **As a** customer **I want** to see all my requests in one list **So that** I can find and
> follow up on any of them.

| AC | Requirement |
| -- | ----------- |
| **AC1** | Each request is a **generous card or row** — number, subject, opened date, category, status, last update. **Not a dense data table.** |
| **AC2** | The filter row offers **only search, status and date** — no department, branch, assignee or channel. |
| **AC3** | A request **awaiting my reply** is visually marked with a reply-needed indicator. |
| **AC4** | A resolved request offers an **inline star rating prompt**. |
| **AC5** | No requests → a friendly message and a submit button. |

## What already exists

- **`GET /portal/tickets`** — scoped to the caller's customer in the query, paged, with a
  customer-facing status filter translated to internal statuses in an `IN` clause.
- **`PortalTicketSchema`** already carries every field AC1 names: `number`, `subject`,
  `status`, `categoryName`, `createdAt`, `updatedAt`.
- **`WAITING_ON_YOU`** — AC3's state, already the portal translation of `PENDING_CUSTOMER`.
- **`/portal/new`** — AC5's submit button has somewhere to go, from US-86.

So the backend gap is small and specific: **AC2's search and date filters do not exist.**

## Approach

### AC2 — two filters added to the allowlist query, applied in the query

`PortalTicketListQuerySchema` gains `q`, `createdFrom` and `createdTo`. Nothing else:

```ts
q: z.string().trim().max(200).optional(),
createdFrom: z.string().datetime().optional(),
createdTo: z.string().datetime().optional(),
```

**The schema is the enforcement.** AC2 says *only* search, status and date, and the way that
becomes true is that there is nowhere in the contract to put a department, a branch, an
assignee or a channel — the same allowlist argument US-82 made for the response, applied to
the request. A customer cannot filter by assignee because the query type has no such field.

`q` searches **subject only**, not the description and not the messages. A customer looking
for a request recognises it by its subject line or its number, and searching message bodies
would mean a portal query reading rows that the message filter exists to keep out of reach.
Numbers are matched too, since "1042" is how a customer refers to a request.

All three go into the **same `where`** as `customerId`, so scope and filter are one query and
neither can be applied to a set the other did not narrow.

### The identity, unchanged

`customerId` is still resolved from the portal token by `scopeFor`, which throttles in the
same call. **No query parameter, path parameter or body field is read for it, and none
exists** — the list handler takes `PortalTicketListQueryDto`, which has no customer field.
The service takes the customer as a separate argument. Nothing in this story touches that.

### AC1 — cards, and the fields are already there

A list of `Card`s rather than the shared `DataTable`. The data table is the staff queue's
instrument — sortable columns, density, bulk selection — and AC1 explicitly rules that out.
A customer has a handful of requests and reads them like letters, not like rows.

Each card: the number and subject as the heading, the status as a badge, then the category,
opened date and last update as a metadata line. Status carries **text and an icon**, never
colour alone, per the definition of done.

### AC3 — the reply-needed indicator

`status === 'WAITING_ON_YOU'` is the whole condition, and it already means exactly that.
Marked with a border on the card's inline-start edge **plus** a labelled badge — the edge alone
would be colour, which the definition of done forbids as the only signal. Same technique as
the staff queue's SLA rail, and the same reason it is `border-s` rather than `border-l`.

### AC5 — the empty state

Distinguished from "no results for your filters", which is a different situation with a
different answer: the first offers the submit button, the second offers to clear the filters.
Conflating them tells somebody with twelve requests that they have never contacted support.

`/portal` becomes the list. The placeholder card US-21 put there said the list was coming;
this replaces it, which is what US-21's plan said would happen.

## AC4 — unmet, and not faked

**Rating is US-88, deferred by `.squad/plans/00-mvp-scope.md`** ("Rating (US-88) and reopen
(US-90) deferred").

There is no rating column on `Ticket`, no endpoint to submit one, and nowhere to store a star.
Rendering five stars that discard the click would be worse than rendering none: it invites a
customer to give feedback and silently throws it away.

**Flagged, not approximated.** No stars, no disabled stars, no "coming soon" prompt.

## Files

| Path | What |
| ---- | ---- |
| `packages/shared/src/dto/portal.ts` | `q`, `createdFrom`, `createdTo` on the list query. |
| `backend/src/portal/portal.service.ts` | The three filters, in the same `where` as `customerId`. |
| `backend/src/portal/portal-list.test.ts` | **New.** Ownership, filters, paging, empty, shape. |
| `frontend/src/features/portal/use-portal.ts` | `usePortalTickets`. |
| `frontend/src/features/portal/portal-requests.tsx` | **New.** The cards, filters and states. |
| `frontend/src/features/portal/portal-requests.test.tsx` | **New.** AC1, AC2, AC3, AC5. |
| `frontend/src/features/portal/portal-home-page.tsx` | The placeholder card becomes the list. |
| `frontend/src/i18n/locales/{en,ar}.json` | `portal.requests.*`, both languages. |

No migration. No new dependency. **No change to the guard, the audience, the throttle or the
allowlist principle** — only two fields added to a request contract, and they are filters.

## Tests

Backend (`portal-list.test.ts`), against the serialised response and the rows:

1. Only the caller's requests are returned; another customer's is absent.
2. A customer with no requests gets an empty array and `total: 0`, not an error.
3. `q` matches a subject, and by number; a non-matching term returns nothing.
4. `q` **does not** match on description or message bodies.
5. `createdFrom` / `createdTo` narrow by date, and the ownership filter still holds with them.
6. `status=WAITING_ON_YOU` returns the `PENDING_CUSTOMER` ticket and nothing else; the
   internal name never appears in the payload.
7. Paging: `pageSize` bounds the page and `total` counts the whole scoped set.
8. **A `customerId` query parameter is ignored** — the scope is still the token's.
9. The rows carry no internal fields (key absence).
10. Unauthenticated is 401; a staff token is 401.

Frontend (`portal-requests.test.tsx`):

11. AC1 — a card shows number, subject, status, category, opened and updated; no `table` role.
12. AC2 — search, status and date controls exist; **no assignee, department, branch or
    channel control does.**
13. AC3 — a `WAITING_ON_YOU` request is marked, in words as well as colour.
14. AC5 — no requests shows the friendly message and a link to `/portal/new`; no *matching*
    requests shows a different message that offers to clear the filters.
15. Searching sends `q` to the API rather than filtering in the browser.
16. Arabic renders with no physical-direction classes.

## Acceptance criteria — verification

| AC | Result | Depends on |
| -- | ------ | ---------- |
| AC1 | ✅ a card per request with the number, subject, status, category, opened date and last update. Asserted **not** to be a table (`queryByRole('table')` absent, list items present), and the status is a word rather than a colour. | — |
| AC2 | ✅ search, status and date, and **nothing else** — asserted by absence for assignee, department, branch, channel and agent controls. All three filters go to the server, applied in the same `where` as `customerId`. | — |
| AC3 | ✅ a `WAITING_ON_YOU` request carries an inline-start edge marker **and** a labelled badge; a request in any other state carries neither. | — |
| AC4 | ❌ **unmet.** Rating is **US-88**, deferred: no column, no endpoint, nowhere to put a star. | US-88 |
| AC5 | ✅ no requests shows a friendly message and a link to `/portal/new`. **No *matching* requests is a separate state** offering to clear the filters. | — |

**Verified.** Backend `portal-list.test.js` **15 pass, 0 fail** (new). Frontend: all three
portal suites **34 pass** — `portal-requests.test.tsx` (14, new), `portal-submit.test.tsx` (10)
and `portal-login.test.tsx` (10). Typecheck clean across all three workspaces; ESLint clean;
Prettier clean. No new dependency.

## The boundary, unchanged

`customerId` still comes from `scopeFor`, which resolves it from the portal token and
throttles in the same call. **No query parameter, path parameter or body field is read for it,
and none exists** — the handler takes `PortalTicketListQueryDto`, which has no customer field,
and the service takes the customer as a separate argument. A test passes
`?customerId=<another customer>` and asserts the scope is still the token's.

Two filters were added to the request contract and nothing else, which is how AC2's "only
search, status and date" is enforced: there is nowhere to put an assignee. The same allowlist
argument US-82 made about the response, applied to the request.

Scope and filters share one `where`, so a wide date range cannot widen the scope it is applied
inside — there is a test for exactly that.

## `q` searches the subject and the number, and nothing else

Deliberately not descriptions and **not message bodies**. A customer recognises a request by
its subject line or by the number they were given, and searching message text would have a
portal query reading rows that the internal-note filter exists to keep out of reach. Two tests
plant a distinctive word in a description and in a message body and assert neither is findable.

## Deviations

**1. AC1's "opened date" and "last update" are dates, not timestamps.** `dateStyle: 'medium'`,
because a customer following up on a request from last month wants the day, and a
minute-precise timestamp on a card is staff-instrument precision.

**2. `/portal` became this screen** rather than a new route. US-83 (a separate portal home) is
deferred, so a customer's landing page is their request list — and US-21's plan already said
its placeholder card would be replaced by exactly this.

**3. The cards do not link anywhere.** Opening a request is US-85. A card that navigates to a
route which does not exist is worse than one that does not navigate, so they are not links yet.

**4. The Arabic reply-needed badge was reworded** (`يلزم ردّك` rather than `بانتظار ردّك`)
because it was word-for-word identical to the `WAITING_ON_YOU` status label beside it. The same
phrase twice on one card reads as a mistake. English already differed.

## Two test-harness notes

- **`createQueryClient` retries a 5xx twice with backoff**, which is the right policy and makes
  a 500 a race in a test that wants the error branch. The failed-load test uses a 4xx, where
  the retry predicate stops immediately.
- **Date assertions must not pin a locale's format.** `Intl` decides it, and asserting
  "1 Aug 2026" fails under `en-US`. The tests assert the sentence around the date instead.

## Flagged

- **AC4** — unmet. Rating is **US-88**, deferred; there is no column, no endpoint and nowhere
  to put a star.
- Opening a request goes to **US-85**. The cards are not links yet, because there is nothing to
  link to — a card that navigates to a 404 is worse than one that does not navigate.
