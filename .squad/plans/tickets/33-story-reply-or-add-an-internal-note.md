# US-1 — Reply to a customer or add an internal note

- **Feature:** `tickets`
- **Story:** [Reply to a customer or add an internal note](https://app.notion.com/p/3c69e083852381f1845fe2d0796e2562)
- **Phase / Layer / Release:** P05 Ticket Management · Full-stack · MVP · Must have
- **Depends on:** US-46 (the timeline) — done
- **Intake:** `.squad/stories/tickets/reply-or-add-an-internal-note/intake.md`
- **MVP position:** 14 of 28

---

## This is the story the first non-negotiable rule is about

CLAUDE.md: *"An internal note must never reach a customer… filtered at the API layer, not
merely hidden in the UI. There is an explicit regression test for this."*

The story says the same thing in its own words — the risk is *"an agent accidentally
sending private context to a customer, which is a trust and confidentiality issue rather
than a cosmetic one."*

Every decision below is downstream of that, and two of them are worth stating before the
detail:

1. **`isInternal` is required on the API, not defaulted.** A default makes the dangerous
   value the one you get by forgetting, and forgetting is the failure mode this story
   exists to prevent. An omitted flag is a 422.
2. **The rule is enforced in the query, not in the component.** `TicketsService.messages`
   takes `includeInternal`, and when it is false the filter is a `where` clause — count
   included.

## What is built, and what has no owner yet

| AC | State |
| -- | ----- |
| AC1, AC2, AC3, AC6 | Built and tested |
| AC4 | Built in US-46; this story adds the coloured inline-start rule the criterion names |
| AC5 | **The rule is built and tested. The portal is not** — US-82 is wave 4 |
| AC7 | **The rule is built and tested. Attaching a file is not** — US-51 is deferred |

AC5 and AC7 describe the *portal's* behaviour, and the portal does not exist. Rather than
mark them done or skip them, the capability they depend on is built and asserted **now**,
at the layer that exists:

```ts
const portal = await tickets.messages(id, actor, { skip, take, includeInternal: false });
```

A test asserts that this returns neither the note, nor its attachments, nor a count that
includes it. US-82 calls it with `includeInternal: false` and inherits the guarantee
rather than reimplementing it — which is the whole point of putting the rule in the
service rather than in a controller.

**Why the count matters as much as the rows.** A portal that says "2 messages" and renders
1 has leaked the existence of a note without ever showing it. Both the `findMany` and the
`count` take the same `where`, deliberately.

**AC7 needs no separate mechanism.** An attachment belongs to a message, so a filtered-out
message takes its files with it. That is asserted rather than assumed.

## Approach

### One endpoint, not two

`POST /tickets/:id/messages` serves both, separated by the flag. Two endpoints would be two
places to get the rule wrong, and the second one is always the one somebody forgets to
audit.

`ticket:update` rather than a permission of its own: replying is the ordinary way an agent
changes a ticket, and a role that may not update a ticket has no business writing on it.

### The SLA clock hears about a reply, not a note

`SlaClockService.onAgentReply` is called with the flag. It refuses an internal note itself
— US-68 built it that way — but the flag is passed rather than the call being skipped, so
the two agree explicitly instead of by coincidence.

`lastAgentReplyAt` is only stamped by a customer-facing reply, for the same reason: US-6
denormalised it so "waiting on us" versus "waiting on them" is a column comparison, and a
private note does not move a ticket out of "waiting on us".

### AC2 — the whole composer, not a checkbox

Note mode retints the entire composer, adds a lock, and puts *"Internal note — not visible
to the customer"* **above the text area** — not in a tooltip and not in the placeholder,
because it has to be readable at the moment somebody is typing.

A single toggle you can miss is precisely how the accident happens.

### AC3 — warned *and* preserved

The criterion asks for both, which reads oddly until you see what the dialog is for: the
text always survives, and what the interruption buys is a moment's attention at the one
point where a note could become a reply. The dialog says which direction it is going and
what that means — *"sending it will deliver it to the customer."*

`ConfirmDialog` gained an optional controlled `open`, because this confirmation is not
opened by a button: the "trigger" is a tab the agent has already pressed. One confirmation
component, not two.

### The mode is deliberately not in the URL

Everything else on this screen is shareable state. A half-written note is not, and a link
that opens somebody else's composer in note mode is a way to get this story wrong.

## Files

| Path | What |
| ---- | ---- |
| `packages/shared/src/dto/ticket.ts` | `CreateTicketMessageSchema` — `isInternal` required. |
| `backend/src/tickets/tickets.service.ts` | `addMessage`; `includeInternal` on `messages`. |
| `backend/src/tickets/tickets.controller.ts` | `POST /tickets/:id/messages`. |
| `backend/src/tickets/dto/ticket.dto.ts` | `CreateTicketMessageDto`. |
| `frontend/src/features/tickets/ticket-composer.tsx` | **New.** The composer. |
| `frontend/src/features/tickets/ticket-composer.test.tsx` | **New.** AC1, AC2, AC3, AC6. |
| `frontend/src/features/tickets/ticket-detail-page.tsx` | Mounts it in the dock US-45 reserved. |
| `frontend/src/features/tickets/ticket-conversation.tsx` | AC4's coloured inline-start rule. |
| `frontend/src/components/common/confirm-dialog.tsx` | Optional controlled `open`. |
| `frontend/src/components/ui/textarea.tsx` | **New** shadcn primitive. |
| `frontend/src/i18n/locales/{en,ar}.json` | `ticket.composer`, both languages. |

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 | ✅ Reply selected on load; no note warning present |
| AC2 | ✅ the whole composer takes the amber ground, a lock appears, and the label sits above the text area |
| AC3 | ✅ an empty composer switches silently; a draft raises the dialog, survives a confirm, and survives a cancel with the mode unchanged |
| AC4 | ✅ full width, amber, **and** a `border-s-4` rule — logical, so it is on the reading edge in Arabic too |
| AC5 | ⚠️ **rule built and tested; portal is US-82.** `includeInternal: false` excludes the note *and* corrects the count |
| AC6 | ✅ "Send" becomes "Add note"; no send-and-resolve on a note; disabled while empty |
| AC7 | ⚠️ **rule built and tested; uploading is US-51.** A note's attachments are excluded with it |

**Tests:** `ticket-composer.test.tsx` 10 pass (Arabic included). `tickets.test.js` 38 pass
(6 new, covering the required flag, the portal-visible read, attachments, and the clock).
Full frontend suite 196. Typecheck and lint clean.

## Flagged

1. **`agent@crm.local` cannot exercise this on a demo ticket** — agent scope is `ASSIGNED`
   and no demo ticket is theirs. Sign in as `admin@crm.local` or a demo agent.
2. **A stale backend process 404s this endpoint.** The build is current; the process has to
   be restarted to pick up a new route. Cost time twice this session.

## What the next stories inherit

- **US-82** calls `messages(..., { includeInternal: false })` and gets the rule for free.
  It must not re-derive it.
- **US-47** adds send-and-resolve to the reply mode — the composer deliberately leaves the
  space for it and offers nothing on a note.
- **US-51** adds an attach control to the composer; the exclusion rule already holds.
