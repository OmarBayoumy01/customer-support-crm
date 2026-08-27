# US-86 — Submit a support request

- **Feature:** `portal`
- **Story:** [Submit a support request](https://app.notion.com/p/3c69e083852381dabe7ac7dcb5f67fa9)
- **Phase / Layer / Release:** P10 Customer Portal · Frontend · MVP · Must have
- **Depends on:** US-82 ✅ · **US-76 (knowledge base) — cut by the MVP scope**
- **Intake:** `.squad/stories/portal/submit-a-support-request/intake.md`
- **MVP position:** 22 of 28

## The story

> **As a** customer **I want** a short, friendly form to submit a request **So that** getting
> help does not feel like filling in a support system.

| AC | Requirement |
| -- | ----------- |
| **AC1** | The form asks only for subject, category, urgency, description, optional attachments, and preferred contact method. |
| **AC2** | Urgency offers **plain descriptions rather than internal priority names**, mapped to priority behind the scenes. |
| **AC3** | While typing a subject, **matching articles are suggested** before the description, with a clear way to continue. |
| **AC4** | On success: a confirmation with the **request number**, the **email that will receive updates**, and links to view it or return home. |
| **AC5** | Missing required field → a **non-technical** message, e.g. "Please tell us what's happening". |
| **AC6** | A file over the limit → **told the limit in plain terms before the upload starts**. |

The story's `Layer` is Frontend, but there is no write endpoint on the portal yet, so this
also adds `POST /portal/tickets` behind the boundary US-82 built.

## What already exists

- **The whole boundary** — `PortalAuthGuard` (audience `crm-portal`), `PortalService`,
  allowlist DTOs, the per-account and per-IP throttle, and `scopeFor` in the controller which
  resolves the customer and counts the request in one place.
- **`TicketsService.create`** — the sequential number from Postgres's own sequence, the
  `CREATED` history entry, and `SlaClockService.applyOnCreate`. All of that is business rule,
  not staff authorisation.
- **`CategoriesService.list`** — active categories in the administrator's order.

## Approach

### The identity comes from the token, and the body cannot carry it

`POST /portal/tickets` takes **subject, description, categoryId, urgency and preferred
contact** and nothing else. The customer is `scopeFor(user, request)` — the same resolution
US-82's read endpoints use, which throttles in the same call.

Four fields are set by the server and are **not accepted from the body at all**, so there is
no request that can ask for them:

| Field | Value | Why not from the body |
| ----- | ----- | --------------------- |
| `customerId` | resolved from the token | The whole point. A body field here is a customer filing against somebody else. |
| `channel` | `WEB` | It *arrived* through the portal. That is an observed fact, not a preference. |
| `departmentId`, `branchId`, `tags` | absent | Internal routing. A customer choosing a department is a customer choosing which team's SLA they get. |
| `status` | the schema default (`NEW`) | Triage is staff work. |

### Reusing `TicketsService.create` — what that does and does not import

The portal builds a `CreateTicket` **itself** from validated, server-chosen values and hands
it to `TicketsService.create`. What that reuses is the number, the history entry and the SLA
clock start — the things that would be wrong if reimplemented.

**It imports no authorisation.** `create` has never done permission work: its caller's guard
does, and the `customerId` it receives is the one the portal resolved from the token. The
actor passed is `{ userId: <portal user>, departmentId: null }`, used only to attribute the
`CREATED` entry — which is correct, because the customer really did create it.

**The response is re-read through `portal.ticket(customerId, id)`**, not returned from
`create`. `create` returns the staff `Ticket` — SLA block, assignee, department, internal
status — and the portal must never serialise that. Going back through the read path means the
submit response and the read response are the same allowlisted shape by construction, rather
than by two functions agreeing.

### AC2 — plain urgency, mapped in shared

```ts
export const PORTAL_URGENCY = ['whenever', 'soon', 'blocked'] as const;

export const URGENCY_PRIORITY: Record<PortalUrgency, TicketPriority> = {
  whenever: 'LOW',
  soon: 'MEDIUM',
  blocked: 'HIGH',
};
```

The wire value is the plain one; `LOW`/`MEDIUM`/`HIGH` never appear in a portal payload or in
the form, which is AC2 as written.

**`URGENT` is deliberately not reachable from the portal.** Every customer's problem is urgent
to them, and a self-service field that sets the tightest SLA is a field that is always set to
the tightest SLA. Escalating to `URGENT` is triage — US-49 gives agents that control. Because
the map has no `URGENT` entry, the API cannot be talked into one.

### AC1 — category, without leaking routing

`GET /portal/categories` returns `{ id, name }` only, locale-resolved. `CategoriesService.list`
supplies the rows; the staff `Category` shape also carries `departmentId`, `departmentName` and
`defaultPriority`, which is exactly the internal routing detail US-82's allowlist exists to
keep out. The category is validated server-side as existing **and active** — a customer
posting a stale id gets 422, not a ticket filed under a retired category.

### AC1 — preferred contact method

`Customer.preferredChannel` already models this, so the submitted preference is written there
rather than invented somewhere new. It is the customer's standing preference, which is what
the column means.

**Nothing sends anything.** No email, no WhatsApp, no SMS — recording a preference is not
integrating with a channel, and P13 owns the channels.

### AC5 — friendly validation

The portal form has its own message keys ("Please tell us what's happening", "A short summary
helps us route it"), replacing the shared schema's messages the same way US-14's login form
does. The rules stay in the shared schema so the client and the server cannot disagree about
what is valid; only the words are the client's.

### The screen

`/portal/new`, reached from the portal home. Three states: the form, submitting, and the
confirmation. The confirmation is a state of the same route rather than a redirect, so the
request number is still on screen if the customer stops to read it.

## AC3 and AC6 — unmet, and not faked

**AC3, article deflection.** The knowledge base is all of P09 (US-76 to US-80), cut entirely
by the MVP scope, and US-76 is this story's own listed dependency. There are no articles to
match, so nothing is suggested. **No placeholder article list.**

**AC6, attachment limits**, and the attachment half of AC1. Object storage is US-51, deferred;
there is no upload endpoint and no way to store a file. A file input that cannot upload would
be worse than none. **No fake file picker.**

Both are flagged below rather than approximated.

## Files

| Path | What |
| ---- | ---- |
| `packages/shared/src/dto/portal.ts` | `PortalUrgencySchema`, `URGENCY_PRIORITY`, `SubmitPortalTicketSchema`, `PortalCategorySchema`. |
| `backend/src/portal/portal.service.ts` | `categories()`, `submit()`. |
| `backend/src/portal/portal.controller.ts` | `POST /portal/tickets`, `GET /portal/categories`. |
| `backend/src/portal/dto/portal.dto.ts` | `SubmitPortalTicketDto`. |
| `backend/src/portal/portal.module.ts` | Imports `TicketsModule` and `CategoriesModule`. |
| `backend/src/portal/portal-submit.test.ts` | **New.** The server ACs and the boundary. |
| `frontend/src/features/portal/portal-submit-page.tsx` | **New.** The form and its confirmation. |
| `frontend/src/features/portal/portal-submit.test.tsx` | **New.** AC1, AC2, AC4, AC5. |
| `frontend/src/features/portal/use-portal.ts` | **New.** The queries and the mutation. |
| `frontend/src/features/portal/portal-home-page.tsx` | A link to the form. |
| `frontend/src/app/router.tsx` | `/portal/new`. |
| `frontend/src/i18n/locales/{en,ar}.json` | `portal.submit.*`, both languages. |

No migration. No new dependency.

## Tests

Backend (`portal-submit.test.ts`), asserting the **serialised response and the database row**:

1. An authenticated customer creates a ticket: 201, and the response is the portal shape.
2. The row's `customerId` is the token's customer, and `channel` is `WEB`.
3. **A `customerId` in the body is ignored** — the ticket still belongs to the caller.
4. Unauthenticated is 401.
5. A staff token on `POST /portal/tickets` is 401.
6. A portal token on `POST /tickets` (staff) is 401.
7. Validation: empty subject, absent subject, and an over-long one are 422; an unknown or
   inactive category is 422.
8. `urgency: 'blocked'` stores `HIGH`; an out-of-range urgency is refused; **`URGENT` cannot
   be reached** through any accepted value.
9. The new ticket's status is `NEW`, and it has SLA deadlines — the clock ran.
10. The preferred contact is written to the customer's `preferredChannel`.
11. The response carries no internal fields (the same key-absence assertion US-82 uses).
12. The throttle applies to this endpoint too.

Frontend (`portal-submit.test.tsx`):

13. The form asks for exactly the fields AC1 names that exist, and nothing else.
14. Urgency offers plain wording, and `LOW`/`MEDIUM`/`HIGH` appear nowhere in the DOM.
15. Submitting posts the plain urgency value, not a priority.
16. AC4 — the confirmation shows the request number, the email that will receive updates, and
    a way back home.
17. AC5 — a missing subject shows the friendly message, and nothing is posted.
18. Arabic renders with no physical-direction classes.

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 | ⚠️ **four of six fields.** Subject, category, urgency, description and preferred contact are all there and asserted. **Attachments are absent** — object storage is US-51, deferred, so there is nowhere to put a file. |
| AC2 | ✅ three plain descriptions; `LOW`/`MEDIUM`/`HIGH` appear nowhere in the DOM or on the wire, and the plain value is what is posted. Each maps to the right priority in the database, and **`URGENT` is unreachable** — asserted against four spellings of it. |
| AC3 | ❌ **unmet.** The knowledge base is all of P09, cut, and US-76 is this story's own stated dependency. No placeholder article list. |
| AC4 | ⚠️ the confirmation shows the **request number** and the **email that will receive updates**, and links home. **The "view it" link is absent** — the request detail screen is US-85. |
| AC5 | ✅ three non-technical messages ("Please tell us what you need help with.", "Please tell us what is happening.", "Please let us know how urgent it is."), each asserted, and nothing is posted when validation fails. |
| AC6 | ❌ **unmet**, with AC1's attachments. Needs US-51. No file picker that cannot upload. |

**Verified.** Backend `portal-submit.test.js` **16 pass, 0 fail** (new) and `portal.test.js`
**13 pass** (US-82's boundary, unchanged). Frontend `portal-submit.test.tsx` **10 pass** (new)
and `portal-login.test.tsx` **10 pass**. Typecheck clean across all three workspaces; ESLint
clean; Prettier clean. No new dependency.

Every backend assertion checks **both the serialised response and the database row**, since
the two disagreeing is the bug worth catching.

## Ownership — how it is guaranteed, not merely checked

`SubmitPortalTicketSchema` has **no `customerId`, no `channel`, no `departmentId`, no
`branchId`, no `tags` and no `status`.** The customer is a parameter that the controller
resolves from the portal token through the same `scopeFor` the read endpoints use — which also
counts the request against the throttle, so the write inherits AC5 of US-82 with no new code.

That is stronger than validating a body field away: there is nothing to disagree about. A test
posts `customerId: <another customer>` and asserts the row still belongs to the caller, and a
second confirms the ticket appears only in the caller's own list.

## What was reused, and what was deliberately not

**Reused:** `TicketsService.create` — the sequential number from Postgres's own sequence, the
`CREATED` history entry, and `SlaClockService.applyOnCreate`. Rules about what a ticket *is*.
Tests assert the new request has a policy and both deadlines, and that the history entry names
a real actor.

**Not reused:** any authorisation. `create` has never done permission work, and the
`customerId` it receives is the one the portal resolved. The portal does **not** consult a
permission scope, so nothing about a role configuration can widen it.

**The response does not come from `create`.** It is re-read through
`portal.ticket(customerId, id)`, so the submit response is the same allowlisted shape as the
read path by construction. A test asserts twelve internal keys — including `priority` and
`channel` — are absent.

## Deviations from the plan

**1. `scopeFor` now returns `{ customerId, userId }`** rather than a bare string, because
`submit` needs both: the customer the request belongs to and the user to attribute the
`CREATED` entry to. Both still come from the token; the read endpoints destructure the
customer id and are otherwise unchanged.

**2. The injected services are named `categoryList` and `ticketRules`**, not `categories` and
`tickets` — those collided with `PortalService`'s own `categories()` and `tickets()` methods.
The names now say why they are injected, which is the better outcome.

## Not built

No US-84 list, no US-85 detail or reply. No email, WhatsApp or SMS integration — the preferred
contact method is **recorded** on `Customer.preferredChannel` and nothing is sent to it; P13
owns the channels.

## Flagged

- **AC3** — unmet. Needs P09 (US-76 onward), cut from the MVP.
- **AC6 and AC1's attachments** — unmet. Need US-51 object storage, deferred.
- **AC4's "view it" link** — the request detail screen is US-85. The confirmation shows the
  number and links home; the link to the request itself completes with US-85.
