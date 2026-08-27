# US-82 — Build the customer-scoped portal API

- **Feature:** `portal`
- **Story:** [Build the customer-scoped portal API](https://app.notion.com/p/3c69e0838523812cb4b0e3fdea6b5aaf)
- **Phase / Layer / Release:** P10 Customer Portal · Backend · MVP · Must have
- **Depends on:** US-40 ✅ · **US-21 — see the note below**
- **Intake:** `.squad/stories/portal/customer-scoped-portal-api/intake.md`
- **MVP position:** 20 of 28

**This is the highest-stakes story left.** It is the story that makes the project's first
non-negotiable rule real, and `.squad/plans/00-mvp-scope.md` says so in its risk list: US-1
writes `isInternal`, US-82 filters on it, and the two are four waves apart.

## The story, in full

> **As a** developer **I want** a separate customer-scoped API surface for the portal **So
> that** internal data can never leak through a portal endpoint.

| AC | Requirement |
| -- | ----------- |
| **AC1** | A portal endpoint returns only records belonging to that customer, **enforced in the query**. |
| **AC2** | Internal notes, assignee identity beyond a first name, SLA timers, internal statuses and internal attachments are **absent from the payload entirely** — not merely hidden in the UI. |
| **AC3** | Internal statuses map to the customer-facing set: Open, In Progress, Waiting on You, Resolved, Closed. |
| **AC4** | A staff token against a portal endpoint, **or a customer token against a staff endpoint**, is rejected. |
| **AC5** | Requests are throttled per account and per IP. |

The story carries no design file, no screen, and no notes beyond these.

### On the US-21 dependency

US-21 is the portal **sign-in screen** and is not built. What US-82 actually needs from it —
the `crm-portal` token audience — has existed since US-14: `TOKEN_AUDIENCES` is
`['crm-staff', 'crm-portal']`, `AuthService.login` already takes an audience parameter, and
`TokenService.signAccessToken` already stamps it.

So this story is buildable and fully testable now, by minting a portal token directly in the
test the way every other auth suite does. **Nothing here waits for US-21, and US-21 becomes a
screen over an API that already refuses to leak.** Doing it in this order is deliberate: the
boundary should exist before anything is pointed at it.

## Non-negotiable rule #1 — how it is enforced on the server

> *"An internal note must never appear in a portal response, an email, an attachment listing,
> or any customer-facing payload — filtered at the API layer, not merely hidden in the UI.
> There is an explicit regression test for this."* — `CLAUDE.md`

Five leak vectors, named individually, because "filter the messages" is only the first of them.

### 1. The messages themselves — already built, and this is its first caller

`TicketsService.messages(id, actor, { includeInternal: false })` applies
`{ ticketId, isInternal: false }` **in the `where`**, not as a filter over fetched rows. US-1
wrote it for this story and left the comment saying so. The portal passes `false`.

### 2. The count, from the same `where`

`messages()` already counts with the identical clause. This matters more than it looks: a
portal that says *"12 messages"* and renders 9 has disclosed the existence of three internal
notes without ever showing one. Any count the portal returns comes from the filtered query.

### 3. Attachments — **a live leak in the staff query, and the reason this needs care**

`Attachment` has **no `isInternal` column of its own.** An attachment is internal because the
*message carrying it* is internal. The staff detail selects attachments at the **ticket**
level with no reference to the parent message:

```ts
attachments: { select: { id, messageId, fileName, contentType, sizeBytes } }
```

Reusing that shape in the portal would list the filename of a file attached to an internal
note. So the portal query filters attachments **through the relation**:

```ts
attachments: { where: { message: { isInternal: false } }, select: { ... } }
```

Filenames leak intent on their own — `escalation-to-legal.pdf` needs no body text. This is the
vector AC2 names as "internal attachments", and it is not covered by filtering messages.

### 4. Ticket history — omitted entirely, not filtered

The staff detail carries a hundred history entries: assignments with both agents' names,
escalations, department moves, internal field changes. There is no subset of that a customer
should see, and no AC asks for one. **The portal DTO has no `history` field at all** — nothing
to filter is safer than something filtered, because a filter can be got wrong later.

### 5. The payload shape — a separate DTO, not a subset of `TicketDetail`

**The portal gets its own Zod schemas in `packages/shared`, built from nothing.** Not
`TicketDetailSchema.omit(...)`, and not a serialiser that strips fields.

That is the load-bearing decision of this story. An `omit` list is a denylist: the day
somebody adds `internalNotes` or `escalationReason` to the staff DTO, the portal inherits it
and the omit list does not know. A separate schema is an allowlist — a new staff field simply
does not appear, and adding it to the portal takes a deliberate edit to a file whose header
says what the rule is.

**Also stripped by construction, per AC2:** `sla` (every timer), `slaPolicyName`,
`assigneeId`, `departmentId`, `branchId`, `escalatedAt`, `escalatedToId`, `reopenCount`,
`tags`, and the internal `status`. The assignee appears as a **first name only** —
`assigneeFirstName` — which is what AC2 permits, so a customer can say "Layla was helping me"
without the portal handing out a staff directory.

### And the regression test the rule demands

`backend/src/portal/portal.test.ts` will contain a test named for the rule itself: a ticket
with a customer message, an agent reply, **an internal note, and an attachment on that internal
note**, asserted through the portal endpoints to confirm that neither the note, its body, its
author, its filename, nor the count that would betray it is present. Asserted against the
serialised JSON, not the service return value, so the test covers the whole path.

## Approach for the rest

### AC1 — scope resolved from the token, not from role configuration

The portal resolves `Customer.userId → customer.id` once per request and filters
`{ customerId }` in every query.

**Deliberately not `ticketScopeWhere` with the `OWN` scope**, even though US-13 wrote exactly
that clause (`{ customer: { userId } }`). The reason is a failure mode: the permission scope is
*configuration*, so an administrator who ever granted a customer-facing role `ticket:view` at
`ALL` would widen the portal to every ticket in the platform. The portal's scope must not be a
thing anybody can misconfigure. It is derived from the authenticated identity and nothing else,
and it is in the `where` clause of every query.

A portal user whose `User` row has no linked `Customer` gets an empty scope and a 403 — fail
closed, never "no filter".

### AC3 — one mapping, in shared, and it hides `ESCALATED`

| Internal | Portal |
| -------- | ------ |
| `NEW` | Open |
| `OPEN`, `PENDING_INTERNAL`, `ESCALATED` | In Progress |
| `PENDING_CUSTOMER` | Waiting on You |
| `RESOLVED` | Resolved |
| `CLOSED` | Closed |

`PENDING_INTERNAL` and `ESCALATED` are internal states — AC2 requires their absence, and the
mapping is where that happens rather than being a second thing to remember. A customer whose
ticket has been escalated sees "In Progress", which is true, and learns nothing about the
internal escalation. The map is exhaustive over `TicketStatus` so a status added later is a
compile error rather than a leak.

### AC4 — audience enforcement, in both directions

- **Staff token on a portal route:** a `PortalJwtStrategy` registered as `jwt-portal`, pinned
  to `audience: 'crm-portal'`. `passport-jwt` rejects the wrong `aud` before any handler runs.
- **Customer token on a staff route:** already true — `JwtStrategy` pins `crm-staff` and the
  comment on that line names US-21. It gets a test in this story rather than an assumption.

One wrinkle worth stating because it is a foot-gun: `JwtAuthGuard` is registered **globally**,
so a portal controller must carry `@Public()` (to skip the staff guard) **plus**
`@UseGuards(PortalAuthGuard)`. `@Public()` alone would leave the route open to the internet.
Both go on the controller class, and a test asserts an unauthenticated portal request is 401 —
that test is the thing standing between a future refactor and an open endpoint.

Portal token revocation reuses `TokenRevocationService`, the same as staff.

### AC5 — throttling on the existing Redis, no new dependency

`PortalThrottleService`, modelled on `LoginThrottleService`: `INCR` with a TTL window, two
counters per request — one keyed on the customer, one on the IP — and the same fail-open
posture with a `degradations()` counter, so a Redis outage degrades the limit rather than
taking the portal down. `RATE_LIMITED` → 429 is already in the error map.

`@nestjs/throttler` is **not** added: the pattern exists in this codebase, uses the Redis the
project already runs, and works across replicas because the counter is in Redis rather than in
process memory.

Three new config keys, added to the config schema and `.env.example` with the rest.

## Files

| Path | What |
| ---- | ---- |
| `packages/shared/src/dto/portal.ts` | **New.** `PortalTicketSchema`, `PortalTicketDetailSchema`, `PortalMessageSchema`, `PortalTicketStatusSchema`, `toPortalStatus`. |
| `backend/src/portal/portal.module.ts` | **New.** |
| `backend/src/portal/portal-jwt.strategy.ts` | **New.** `jwt-portal`, audience-pinned. |
| `backend/src/portal/portal-auth.guard.ts` | **New.** |
| `backend/src/portal/portal.service.ts` | **New.** Customer resolution, the scoped queries, the mapping. |
| `backend/src/portal/portal.controller.ts` | **New.** `GET /portal/tickets`, `GET /portal/tickets/:id`, `GET /portal/tickets/:id/messages`. |
| `backend/src/portal/portal-throttle.service.ts` | **New.** AC5. |
| `backend/src/portal/portal.test.ts` | **New.** Including the rule #1 regression test. |
| `backend/src/config/*` + `.env.example` | Three throttle keys. |
| `backend/src/app.module.ts` | Registers `PortalModule`. |

No migration. No new dependency.

## Tests

1. **Rule #1, the regression test** — a ticket with a reply, an internal note and an attachment
   on that note: neither the note, its body, its author, its filename nor an inflated count
   appears in any portal response.
2. **AC1** — a customer sees only their own tickets; another customer's ticket is 404 (not 403
   — the same reasoning the staff API uses).
3. **AC1, fail closed** — a portal user with no linked `Customer` gets 403, never an unfiltered
   list.
4. **AC2** — the serialised payload has no `sla`, `assigneeId`, `departmentId`, `escalatedAt`,
   internal `status`, or `history` key, asserted as key absence rather than null values.
5. **AC2** — the assignee is a first name only.
6. **AC3** — each of the seven internal statuses maps to the right customer-facing one, and
   `ESCALATED` reads as "In Progress".
7. **AC4** — a staff token on a portal route is 401; a portal token on a staff route is 401; no
   token is 401.
8. **AC5** — the account limit and the IP limit each return 429 when exceeded, and the throttle
   fails open when Redis is unavailable.

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 | ✅ every query carries `customerId` in its `where`, resolved from the token. Another customer's ticket is 404; a portal user with no `Customer` row is 403, never unscoped. |
| AC2 | ✅ asserted as **key absence** on the serialised payload for `sla`, `slaPolicyName`, `assigneeId`, `assigneeName`, `departmentId`, `branchId`, `escalatedAt`, `escalatedToId`, `reopenCount`, `tags`, `history`, `customer`. The assignee is a first name; the surname does not appear anywhere in the response. |
| AC3 | ✅ all seven internal statuses map to the five customer-facing ones, and `PENDING_INTERNAL` / `ESCALATED` do not appear in the payload at all. Filtering by a portal status becomes an `IN` clause over internal statuses in the query. |
| AC4 | ✅ both directions: a staff token on a portal route is 401, a portal token on a staff route is 401, and no token is 401. |
| AC5 | ✅ the account counter trips to 429 through the API, and the IP counter is independent of it. Fails open when Redis is unavailable, which the test accounts for rather than asserting against. |

**Verified.** `portal.test.js` **13 pass, 0 fail** — including the rule #1 regression test.
`env.schema.test.js` **26 pass** (that file gained three keys). Typecheck clean across all
three workspaces; ESLint clean; Prettier clean.

## Non-negotiable rule #1 — where it is enforced

All five vectors are closed on the server, and the regression test asserts against the
serialised JSON rather than a service return value, because the rule is about what leaves the
process:

1. **Messages** — `isInternal: false` is in the `where`, so a note is never fetched.
2. **The count** — the same `where`, so a total cannot betray what the list omitted.
3. **Attachments** — selected **through the message** (`where: { message: { isInternal: false } }`),
   not off the ticket as the staff detail does. The test attaches
   `escalation-to-legal.pdf` to the internal note and asserts the filename is absent: a
   filename discloses intent with no body text at all.
4. **History** — no such field exists on the portal contract.
5. **The contract** — hand-written allowlist schemas in `packages/shared/src/dto/portal.ts`,
   never an `omit` of the staff DTO, so a field added to the staff side cannot arrive here by
   inheritance.

## Two deviations from the plan

**1. The portal does not call `TicketsService.messages(..., { includeInternal: false })`.**
The plan said it would, and it cannot: that method resolves the caller through the
*permission scope*, which is the exact mechanism you instructed me not to use for ownership,
and it returns the staff message shape — full author names and attachments selected off the
ticket. `PortalService` therefore issues its own query with `isInternal: false` **and**
`customerId` in the same `where`. The rule is still enforced in the database, which is what
the rule requires; the reuse is what changed. US-1's method keeps its comment and its own
test, and remains the staff paging path.

**2. `GET /portal/tickets/:id/messages` loads the ticket first.** It calls
`portal.ticket(...)` to refuse a ticket that is not the caller's before any message is read,
which costs one extra query. The alternative — trusting the message query's own `ticket:
{ customerId }` clause — returns an empty page rather than a 404 for somebody else's ticket,
and an empty page is a weaker answer than "no such request".

## Not built, deliberately

- **`POST /portal/tickets`** is US-86. This is the read surface plus the boundary; the write
  endpoint inherits the guard, the throttle and the scope.
- **No portal sign-in.** US-21 owns it; the tests mint a portal token directly, so the
  boundary is finished and tested before anything is pointed at it.
- **No notifications**, no US-21 work, no attachment downloads (US-51).

## Flagged before starting

- **US-84 and US-85 consume this**, and both are in the same wave. If the portal DTO needs a
  field they turn out to need, it is added here deliberately — which is the point of the
  allowlist.
- **Attachments still have no download URL** (US-51, object storage, deferred). The portal lists
  non-internal attachments; it cannot serve them, same as the staff API.
- **`POST /portal/tickets` is US-86**, not this story. This is the read surface plus the
  boundary; the write endpoint arrives next and inherits the guard, the throttle and the scope.
