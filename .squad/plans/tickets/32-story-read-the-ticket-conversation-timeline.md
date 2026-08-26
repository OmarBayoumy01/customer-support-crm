# US-46 — Read the ticket conversation timeline

- **Feature:** `tickets`
- **Story:** [Read the ticket conversation timeline](https://app.notion.com/p/3c69e08385238166a5e7d665a813453f)
- **Phase / Layer / Release:** P05 Ticket Management · Full-stack · MVP · Must have
- **Depends on:** US-45 (the workspace) — done
- **Intake:** `.squad/stories/tickets/read-the-ticket-conversation-timeline/intake.md`
- **MVP position:** 13 of 28

---

## AC4 is met in part, and the missing half has an owner

**"…and download on click" is not built.** Object storage is **US-51**, which the MVP scope
defers. `Attachment.storageKey` currently names a key with nothing behind it — US-120 said
so when it seeded the rows.

So the chips render with icon, name and size, and they are **not links**. A link that 404s
teaches people the feature is broken; a chip that shows what is attached is honest about
where the work stopped. The hover text says downloading arrives with US-51.

Everything else in AC4, and all of AC1, AC2, AC3, AC5 and AC6, is built and tested.

## Approach

### AC1 — four types, four different shapes

The distinction has to survive a glance, so each type differs in **geometry**, not only in
colour:

| Entry | Shape |
| ----- | ----- |
| Customer message | Inline start, paper ground, square corner on the start side |
| Agent reply | Inline end, brand tint, square corner on the end side |
| Internal note | **Full width**, amber, dashed border — deliberately unlike either bubble |
| System event | A small centred pill. Not a bubble at all |

Alignment is `items-start` / `items-end` and the corners are logical (`rounded-ss` /
`rounded-se`), so Arabic mirrors the whole thing without a second rule.

### AC2 — the one that matters

**The project's first non-negotiable rule lives on `isInternal`.** The API enforces it
(US-82's portal controller queries `isInternal: false`), and this is the belt to that
braces — the one screen where a person could otherwise read a note and paste it into a
reply.

So an internal note is marked **four ways over**: full width, amber ground, a lock icon,
and the words *"Not visible to the customer"* spelled out rather than abbreviated to a
badge. The criterion asks for an explicit label and that is what "explicit" means.

### AC3 — channel per message, not per ticket

`Message.channel` has existed since US-6 and was never on the contract. It is per message
for a reason: a conversation that opened as an email and continued on WhatsApp is an
ordinary support conversation, and an agent about to reply needs to know which one they are
replying on. Icon **and** word, like every other status on this platform.

Null on a system event, which arrived by no channel at all — and the timeline then shows
nothing rather than guessing.

### AC5 — the detail stops sending the whole thread

`GET /tickets/:id` used to return every message. It now returns the **most recent thirty**,
oldest-first within that slice, plus `messageCount`.

That is the point of the criterion: a ticket that has run three weeks has a hundred
messages and an agent opens it to read the last three. Sending all hundred makes the
workspace slowest for exactly the tickets that matter most.

`GET /tickets/:id/messages` pages backwards, newest first — page 2 is what came before page
1. The frontend uses `useInfiniteQuery` rather than component state so the pages survive a
refetch of the ticket: an agent who has scrolled back through three weeks should not lose
their place because the detail query revalidated.

The view scrolls to the foot **on arrival only**. Doing it on every change would yank the
reader back to the end of the thread they had just scrolled away from.

### AC6 — quiet means quiet

A system event is a centred muted pill with no author line and no channel tag. It is
context, and context that shouts is noise.

## Files

| Path | What |
| ---- | ---- |
| `packages/shared/src/dto/ticket.ts` | `channel` and `attachments` on the message; `messageId` on the attachment; `messageCount` on the detail. |
| `packages/shared/src/index.ts` | Exports `TicketAttachment`. |
| `backend/src/tickets/tickets.service.ts` | `MESSAGE_SELECT` and `toMessage` shared by both readers; the detail's slice; `messages()`. |
| `backend/src/tickets/tickets.controller.ts` | `GET /tickets/:id/messages`. |
| `frontend/src/features/tickets/ticket-conversation.tsx` | The timeline: four types, channel tags, attachment chips, load-earlier, scroll-to-latest. |
| `frontend/src/features/tickets/use-ticket-detail.ts` | `useEarlierMessages`. |
| `frontend/src/features/tickets/ticket-detail-page.tsx` | Assembles the thread from the earlier pages plus the recent slice. |
| `frontend/src/i18n/locales/{en,ar}.json` | The label, the chip's hover text, the load-earlier count. |

`toMessage` is a free function rather than a method because the detail and the paged
endpoint both map messages, and two copies would drift the moment one gained a field.

## Acceptance criteria — verification

| AC | Result |
| -- | ------ |
| AC1 — four entry types | ✅ each has its own geometry, asserted by alignment and by ground rather than by colour name alone |
| AC2 — internal notes unmistakable | ✅ full width (asserted: not capped at 85% like a bubble), amber, lock, and the words in full; an agent reply carries no such label |
| AC3 — channel provenance | ✅ named on each message; a message with no channel says nothing |
| AC4 — attachments inline | ⚠️ **partly.** Chips with icon, name and size, on the message that carried them — verified end to end against the seeded Arabic ticket. **Download is US-51's**, and the chip is deliberately not a link |
| AC5 — long threads | ✅ the detail sends the most recent 30 of 35 with the total; the paged endpoint returns them backwards; the button appears only when there are more; the view scrolls to the latest on arrival |
| AC6 — system events are quiet | ✅ a centred pill, no author, no channel |

**Tests:** `ticket-conversation.test.tsx` 13 pass (Arabic included), `tickets.test.js` 32
pass (6 new). Full frontend suite 186. Regressions: ticket-history 11, demo-seed 14,
sla-clock 17. Typecheck and lint clean.

Also verified against the running stack: the seeded Arabic access ticket returns its
attachment on the message that carried it, with the channel, through the dev proxy.

## Out of scope

- Writing into the timeline — US-1, which fills the dock US-45 reserved.
- Uploading and downloading — US-51.

## What the next stories inherit

- **US-1** writes into this timeline and should invalidate `['tickets', 'detail', id]`.
- **US-47** and **US-48** produce the system events AC6 renders quietly — they should write
  a `SYSTEM` message, not only a history entry, if the change is meant to be visible in the
  conversation.
- **US-51** turns the chips into links. Nothing else about them needs to change.
- **US-82** must keep querying `isInternal: false`. The staff timeline deliberately shows
  notes; that is the whole point of them.
