# customers — plan overview

Entry point for the **customers** feature. First story of **wave 1** in
[`../00-mvp-scope.md`](../00-mvp-scope.md): the backend spine.

## Stories

| NN  | File                                          | Title                          | Tracker id | Depends on   |
| --- | --------------------------------------------- | ------------------------------ | ---------- | ------------ |
| 24  | `24-story-manage-customers-through-the-api.md` | Manage customers through the API | US-33    | US-6, US-22  |

## Three conflicts between US-33 and the schema US-6 shipped

Raised rather than reinterpreted, per CLAUDE.md.

### 1. `type` and `department` do not exist on `Customer` — **schema change**

AC1 requires a customer to store "name, email, phone, company, **type**, **department**,
branch, and status". US-6 modelled `branchId` but neither of the other two.

Both are added: a `CustomerType` enum (`INDIVIDUAL` / `COMPANY`) and a nullable
`departmentId`. The alternative — deriving type from whether `companyName` is set — is the
kind of implicit rule that is wrong the first time a sole trader gives a trading name.

`departmentId` is nullable and means *which support department owns this customer*, not a
department the customer belongs to. Most customers have none.

### 2. `customer:manage` does not exist — **using the real keys**

AC6 says "a user without `customer:manage`". US-13's catalogue has no such permission; it
has `customer:view`, `customer:create`, `customer:update` and `customer:delete`.

The finer-grained set is used, because it is what exists and what the seeded roles are
already granted. A write is refused unless the caller holds the matching one. **No new
permission is invented** — the criterion's intent is "writes are permission-checked", and
that is met.

### 3. Satisfaction score cannot be computed — **returns `null`**

AC4 wants open ticket count, last interaction time, and satisfaction score on every list
row. The first two are real. The third needs ratings, which are **US-88, deferred** by the
MVP scope — there is no rating data in the system and no table to read it from.

The field is present in the contract and is `null` until US-88 lands. Returning a fabricated
number would be worse than returning nothing.

## Decisions

1. **Derived fields come from a grouped aggregate, not N+1.** One `groupBy` over tickets for
   the whole page. AC4's point is "without needing extra requests" — doing it as a query per
   row would satisfy the letter and miss the reason.
2. **Duplicate detection warns, it does not block** (AC2). The endpoint answers 409 with the
   existing record attached, and the caller re-posts with `confirmDuplicate: true`. Two
   people can genuinely share a phone number, and a support desk that cannot record the
   second one is broken in a way an agent cannot work around.
3. **Archive is `deletedAt`, and tickets are untouched** (AC5). The soft-delete extension
   from US-5 already filters reads, so archiving a customer removes them from lists while
   their tickets stay auditable.
4. **No customer scoping.** `scope.ts` implements tickets only, as US-13 recorded. Every
   agent who can view customers sees all of them. If that is wrong it is a story, not a
   detail to invent here.

## What the next stories inherit

- **US-35** (customer profile) reads `GET /customers/:id`.
- **US-40** (ticket API) needs `customerId` to be real; this is what makes it so.
- **US-120** (seed data) seeds customers through the same service, so the seed cannot
  produce a shape the API would reject.
