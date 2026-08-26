# Story 24 — Manage customers through the API

- **Story:** US-33 · **Phase:** P04 · **Layer:** Backend · **Priority:** Must have
- **Depends on:** US-6, US-22 · Wave 1 of [`../00-mvp-scope.md`](../00-mvp-scope.md)

The three conflicts with the US-6 schema, and how each was resolved, are in
[`00-overview.md`](./00-overview.md). Read that first.

## Target paths

| Action     | Path                                                        |
| ---------- | ----------------------------------------------------------- |
| **create** | `packages/shared/src/dto/customer.ts` — the shared contract  |
| **create** | `backend/src/customers/customers.service.ts`                 |
| **create** | `backend/src/customers/customers.controller.ts`              |
| **create** | `backend/src/customers/dto/customer.dto.ts`                  |
| **create** | `backend/src/customers/customers.module.ts`, `index.ts`      |
| **create** | `backend/src/customers/customers.test.ts`                    |
| **modify** | `backend/prisma/schema.prisma` — `CustomerType`, `departmentId` |
| **create** | `backend/prisma/migrations/<ts>_customer_type_and_department_for_us33/` |
| **modify** | `backend/src/app.module.ts`, `packages/shared/src/index.ts`  |

No new dependencies.

## The endpoints

| | |
| - | - |
| `GET /customers` | `customer:view`. Filters, search, paging — all in the database. |
| `GET /customers/duplicate-check` | `customer:view`. What the create form calls on blur. |
| `GET /customers/:id` | `customer:view`. |
| `POST /customers` | `customer:create`. 409 on an unconfirmed duplicate. |
| `PATCH /customers/:id` | `customer:update`. |
| `DELETE /customers/:id` | `customer:delete`. Archives; 204. |

## How each criterion is proved

| AC  | Tests |
| --- | ----- |
| AC1 | A customer round-trips with type, company, department, branch and channel. And: one with **neither email nor phone is refused** — a support desk cannot contact somebody it has no way of contacting. |
| AC2 | A duplicate email answers 409 **carrying the existing customer's id**, so the agent can look rather than go and search. Confirming goes through. The check endpoint answers before submitting, and answers `null` rather than an error when there is no match. |
| AC3 | Search matches name, email and company; the type filter narrows; paging returns two of three with `total: 3` — so the database did the paging. |
| AC4 | Counts and last-interaction are on every row. `satisfactionScore` is `null` and there is a test **asserting** it is null, with the reason. |
| AC5 | Archiving sets `deletedAt`, drops the customer from lists, 404s the detail — **and leaves their tickets in place**, which is separately asserted. |
| AC6 | A reader is refused create, update and archive. An unauthenticated caller gets 401 on everything. |

## Deviations

1. **Two schema columns added** — `CustomerType` and `departmentId`. AC1 names both and US-6
   modelled neither. See `00-overview.md`.
2. **`customer:manage` does not exist**, so the four real keys are used instead of inventing
   a fifth.
3. **`satisfactionScore` is always `null`** until US-88.
4. **`sort=openTickets` falls back to name.** It is a derived value from a separate
   aggregate and cannot be ordered in the same query. Sorting by it needs either a
   materialised count on `Customer` or a raw query, and neither is worth doing before a
   screen asks for it. The enum value stays in the contract so the frontend can be written
   once.
5. **No customer scoping.** `scope.ts` implements tickets only, as US-13 recorded. Anyone
   who can view customers sees all of them.

## A flake worth watching

The full backend suite failed once on `api-conventions.test.js` at file level, then passed
on a re-run — **270 tests, 270 passing**. `node --test` runs every file in its own process
concurrently, and each now boots a full Nest app with a Prisma pool and a Redis client.
That is nine apps at once and climbing.

Nothing is wrong with the code, but the contention will get worse with every backend suite
wave 1 adds. If it starts failing regularly, `--test-concurrency` or a shared test app is
the fix — not more retries.

## Verification

```
docker compose up -d --wait postgres redis
npm run test --workspace @crm/backend    # 17 tests here, 270 in total
```
