# US-45 — Work a ticket in the detail workspace

- **Feature:** `tickets`
- **Story:** [Work a ticket in the detail workspace](https://app.notion.com/p/3c69e083852381baa729e658975f4800)
- **Phase / Layer / Release:** P05 Ticket Management · Frontend · MVP · Must have
- **Depends on:** US-40 (ticket API) — done
- **Intake:** `.squad/stories/tickets/work-a-ticket-in-the-detail-workspace/intake.md`
- **MVP position:** 12 of 28

---

## The design file does not exist

`07-ticket-detail.md`, described on the story as *"the visual centrepiece of the product"*,
is not in this repository. Same gap as every other frontend story here; designed against
the P03 system instead. Flagged, not invented.

## What this story owns, and what it only places

This screen is where four later stories put their actions, so the line matters:

| This story | The story that makes it act |
| ---------- | --------------------------- |
| Places status, priority and assignee in the header | US-47 (legal transitions), US-49 (priority), US-48 (assignment) |
| Renders the conversation | US-46 extends the same component |
| Reserves the composer dock | US-1 fills it |
| Links to the customer profile | US-35 builds the profile |

**The header controls are read-only.** A control that looks interactive and silently does
nothing is worse than a value, and each of those three has real rules — a status move has
to be legal, an assignment has to respect scope — that belong to the story that wrote them.

## Approach

### AC3 — why three columns at all

One argument, and it decides the whole layout: **an agent should never have to leave this
page to answer a question about this ticket.** Navigating away to check whether the
customer has called before loses the reply you were half-way through writing, and that is
how a five-minute ticket becomes a twenty-minute one.

The centre column is `flex` with the thread scrolling inside it, so the composer docks to
the foot of *the column* rather than the foot of the page — which is what AC3 actually
asks for and what a `sticky` footer would get wrong on a short thread.

On tablet and mobile the columns stack, context last: it is the part you read once, not
the part you scroll.

### AC2 — two clocks, and what "expandable" is for

Both timers are in the header, above everything, in words as well as colour. Collapsed they
answer *how long have I got*. Expanded they answer *why that number* — the exact deadline
and the policy that set it, which is what a dispute is settled on.

That needed one field: `slaPolicyName` on `TicketDetailSchema`. The queue shows a countdown;
the workspace has to be able to name the commitment behind it.

### AC4 — the context panel, and two things it could not have

Name, company, VIP standing, active state, email and phone as working links, lifetime
counts, the customer's other tickets, notes, and a link to the full profile.

Two additions were needed, both flagged:

1. **`Customer.notes`.** AC4 names notes and no model had them. Added as free text —
   *"prefers a phone call", "hard of hearing", "always chases on Fridays"* — the standing
   context that otherwise lives in one agent's memory. US-35 will edit it; this story reads
   it.
2. **`customerId` on the ticket list query.** "Recent tickets" needs *this customer's other
   tickets*, and the filter did not exist. One line, and it belongs on the list anyway.

**"Recent interactions" is read as the customer's other tickets.** There is no interaction
model in US-6 and inventing one for a panel would be the wrong place to decide what an
interaction is. Flagged rather than approximated with something that looks like more than
it is.

### AC5 — collapsing, and remembering

`atomWithStorage`, the same mechanism the sidebar's collapse already uses, and the same
reasoning: a layout preference is not a credential, and the worst an attacker can do with
it is learn that somebody likes a wide conversation. A preference that resets on every
navigation is not a preference.

The atom lives in `shell-state.ts` rather than in the ticket feature because it describes
how a person likes to work, not anything about a ticket.

## Files

| Path | What |
| ---- | ---- |
| `frontend/src/features/tickets/ticket-detail-page.tsx` | **New.** The workspace. |
| `frontend/src/features/tickets/ticket-header.tsx` | **New.** AC1, AC2, AC6. |
| `frontend/src/features/tickets/customer-context-panel.tsx` | **New.** AC4. |
| `frontend/src/features/tickets/ticket-conversation.tsx` | **New.** The centre column; US-46 extends it. |
| `frontend/src/features/tickets/use-ticket-detail.ts` | **New.** Ticket, customer and the customer's other tickets. |
| `frontend/src/app/shell-state.ts` | `ticketContextCollapsedAtom`. |
| `frontend/src/app/router.tsx` | `/tickets/:id`. |
| `frontend/src/i18n/locales/{en,ar}.json` | `ticket.detail`, both languages. |
| `backend/prisma/schema.prisma` + migration | `Customer.notes`. |
| `packages/shared/src/dto/customer.ts` | `isVip` and `notes` on the customer contract and on update. |
| `packages/shared/src/dto/ticket.ts` | `slaPolicyName` on the detail; `customerId` on the list query. |
| `backend/src/customers/customers.service.ts` | Selects and returns the two new fields. |
| `backend/src/tickets/tickets.service.ts` | The policy name; the `customerId` filter. |
| `docs/running-the-project.md` | The `prisma generate` trap — see below. |

## A trap worth writing down

After adding `Customer.notes`, fourteen customer tests started answering **`400
BAD_REQUEST`, "The request could not be processed."** Typecheck was clean and the migration
had applied.

The cause: **`prisma migrate dev` does not regenerate the client in this project.** With the
Prisma 7 config file, the client under `src/generated/prisma` stays stale, and a stale
client throws `PrismaClientValidationError` on a field its types do not know — which the
exception filter maps to a generic 400 that points nowhere near the actual problem.

`npx prisma generate` fixes it. Now documented in the runbook, because the symptom does not
resemble the cause and the next person will lose the same half hour.

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 — header | ✅ number, subject, status, priority, assignee and the metadata strip. **Department and branch are not shown** — no ticket in the seeded set has them set, and rendering two permanently empty fields is noise. The data is on the payload; when US-49 sets them the strip gains two entries |
| AC2 — SLA | ✅ both clocks render immediately, state in words, and each expands to the exact deadline and the named policy |
| AC3 — three columns | ✅ conversation as its own labelled region with the dock inside it; stacks on narrow viewports |
| AC4 — customer context | ✅ name, company, VIP, contact links, counts, other tickets, notes, profile link. "Recent interactions" is the other-tickets list — flagged above |
| AC5 — collapsible | ✅ collapses, the conversation takes the width, and the preference survives a remount |
| AC6 — nothing behind a dialog | ✅ nothing on this screen is in a dialog at all |

**Tests:** `ticket-detail-page.test.tsx` 9 pass, including the Arabic render and the
internal-note marking. Full frontend suite 173 pass. Backend: customers 17, tickets 26.
Typecheck and lint clean.

## Out of scope

- Replying and internal notes — US-1.
- Status, priority, assignment — US-47, US-49, US-48.
- The customer profile screen — US-35.

## What the next stories inherit

- **US-46** extends `TicketConversation` rather than replacing it.
- **US-1** fills the dock, which is already a real region in the layout.
- **US-47, US-48, US-49** replace three read-only pills in `TicketHeader` with controls.
- **US-69** may want more of the SLA detail than the two clocks show; the expandable panel
  is where it goes.
