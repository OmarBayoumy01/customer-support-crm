# tickets — plan overview

Entry point for the **tickets** feature. The spine: **nineteen of the twenty-eight stories**
in [`../00-mvp-scope.md`](../00-mvp-scope.md) touch it.

## Stories

| NN  | File                               | Title                | Tracker id | Depends on  |
| --- | ---------------------------------- | -------------------- | ---------- | ----------- |
| 25  | `25-story-build-the-ticket-api.md` | Build the ticket API | US-40      | US-6, US-22 |

## No schema change

Unusually for a story this size, US-6 already modelled everything: `number` is
`@default(autoincrement())`, so AC1's sequential reference is free and collision-proof under
concurrency; the SLA due dates are denormalised onto the ticket, so AC2's SLA filter is a
column comparison against an index rather than a join; and `TicketHistory` already has
`field` / `fromValue` / `toValue`, which is exactly AC5's shape.

That is US-6's review paying off, and worth recording as such.

## Decisions

1. **SLA state is derived on read, never stored.** A stored state goes stale the moment a
   clock passes with nothing running, and then the queue lies about what is on fire. The
   columns are already on the row, so computing it costs nothing.
2. **`none` is not `ok`.** A ticket with no policy is not being tracked, which is a
   different answer from being comfortably within a target.
3. **Status is absent from `PATCH`.** Moving a ticket through its lifecycle is US-47's
   transition endpoint, which validates that the move is legal. Accepting it here would be a
   second, unguarded door onto the same state machine. There is a test asserting a `status`
   in the body is ignored.
4. **Out of scope answers 404, not 403.** Telling somebody a ticket exists but is not theirs
   still tells them it exists.
5. **The staff detail returns internal notes.** The rule is enforced in US-82's portal
   controller, which queries `isInternal: false`. Filtering here would break the agent's own
   timeline, which is the thing internal notes exist for.
6. **The actor's department is read, not taken from the token.** It changes when somebody
   moves team, and a claim would carry the old one for the life of the token. One indexed
   lookup is the honest cost of a correct `TEAM` scope.
7. **History records only what moved.** A `PATCH` echoing the whole object back leaves no
   trace, or a timeline is unreadable within a week.

## The one filter not finished in SQL

**`slaState=warn`.** "Due soon" is a fraction of each ticket's *own* target, so it cannot be
one comparison against a fixed window. The query narrows to unbreached tickets with a due
date, and the fraction is applied to that page in `list`.

It refines a page, never a table, and the code says so where it happens. A generated column
holding the fraction moves it fully into SQL — worth doing when a screen sorts by it.
Nothing does yet.

## A bug the tests caught

The search `OR` and the breach `OR` were being merged into one `where.OR`, which turns an
intersection into a union: *matches the search **or** is breached*, rather than **and**.
Independent groups now each get their own entry under `AND`.

Worth recording because of how it fails — a filter that returns too much looks like the data
being wrong rather than the query.

## What the next stories inherit

- **US-41** create screen · **US-42** queue · **US-45** workspace all read this contract.
- **US-47, US-48, US-49** each add a guarded operation and must record through
  `TicketHistoryService` rather than writing their own entries.
- **US-50** adds the history *endpoint*; the recording already happens here.
- **US-68** fills `firstResponseDueAt` and `resolutionDueAt`; `slaFor` starts answering
  something other than `none` the moment it does, with no change here.
- **US-82** is a separate controller. It must query `isInternal: false`, and that is where
  the regression test for the project's first rule belongs.
