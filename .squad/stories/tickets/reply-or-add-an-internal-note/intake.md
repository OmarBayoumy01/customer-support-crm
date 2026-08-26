# Story intake

- Folder: `.squad/stories/tickets/reply-or-add-an-internal-note/intake.md`
- Source: Notion User Stories database, `US-1`
  (https://app.notion.com/p/3c69e083852381f1845fe2d0796e2562)

---

## Feature

- **Feature name (display):** Tickets
- **Feature slug (folder under `plans/`):** `tickets`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-1`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P05 Ticket Management - Full-stack - MVP - Must have -
  Persona: Support Agent - Screens: Ticket Detail, Portal Ticket Detail -
  Design Files: `07-ticket-detail.md`, `25-portal-ticket-detail.md`

---

## Title

```
Reply to a customer or add an internal note
```

---

## Description

```
As a support agent
I want to switch between replying to the customer and writing an internal note
in the same composer
So that I can capture private context on a ticket without ever risking sending
it to the customer.
```

---

## Acceptance criteria

```
AC1 - Default mode is Reply
Given I open a ticket detail page
When the composer loads
Then the Reply tab is selected by default and the composer is styled as a
customer-facing reply.

AC2 - Switching to Internal Note is visually unmistakable
Given I am on the ticket detail page
When I select the Internal Note tab
Then the entire composer changes to the internal-note treatment (amber tint), a
lock icon appears, and the label "Internal note - not visible to customer" is
displayed above the text area.

AC3 - Draft content is preserved when switching modes
Given I have typed text into the composer
When I switch between Reply and Internal Note
Then my text is preserved and I am warned before the mode changes if content
already exists.

AC4 - Internal notes are distinct in the conversation timeline
Given I submit an internal note
When it appears in the conversation timeline
Then it renders full width with an amber background and a coloured left border,
clearly different from both customer messages and agent replies, and carries a
visible "Internal" label.

AC5 - Internal notes never reach the customer
Given an internal note exists on a ticket
When the customer views that ticket in the customer portal
Then the internal note is not rendered, not included in any email notification,
and not counted in the customer-visible message count.

AC6 - Send action reflects the active mode
Given I am in Internal Note mode
When I look at the send button
Then it reads "Add note" rather than "Send", and the send-and-resolve options are
not offered.

AC7 - Attachments follow the same rule
Given I attach a file to an internal note
When the customer views the ticket
Then that attachment is not visible to them.
```

## Notes (from the story)

```
This story implements design constraint #6 from the CRM specification: "Internal
notes must be visually distinct from customer messages." It is deliberately
narrow - the risk being mitigated is an agent accidentally sending private
context to a customer, which is a trust and confidentiality issue rather than a
cosmetic one.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. Neither design file is in this repository. | |

---

## Dependencies

- `US-46` the conversation timeline - done. This story writes into it.
- `US-45` reserved the composer dock this fills.
- `US-68` built `SlaClockService.onAgentReply`, which this is the first caller of.
- `US-82` (portal) is **wave 4, not built**. AC5 and AC7 describe its behaviour.
- `US-51` (attach files) owns upload and is **deferred**. AC7's "attach a file" cannot
  be performed yet.

## Extra notes

- Position 14 of 28.
- This is the story CLAUDE.md's first non-negotiable rule is about: "An internal note
  must never appear in a portal response, an email, an attachment listing, or any
  customer-facing payload - filtered at the API layer, not merely hidden in the UI.
  There is an explicit regression test for this."

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.

## Out of scope (from the story)

- @mentioning teammates inside an internal note.
- Notification routing when an agent is mentioned.
- Rich text formatting inside the composer.
