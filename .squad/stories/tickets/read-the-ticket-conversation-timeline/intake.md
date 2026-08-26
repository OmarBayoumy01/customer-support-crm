# Story intake

- Folder: `.squad/stories/tickets/read-the-ticket-conversation-timeline/intake.md`
- Source: Notion User Stories database, `US-46`
  (https://app.notion.com/p/3c69e08385238166a5e7d665a813453f)

---

## Feature

- **Feature name (display):** Tickets
- **Feature slug (folder under `plans/`):** `tickets`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-46`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P05 Ticket Management - Full-stack - MVP - Must have -
  Persona: Support Agent - Screen: Ticket Detail - Design File: `07-ticket-detail.md`

---

## Title

```
Read the ticket conversation timeline
```

---

## Description

```
As a support agent
I want the full conversation in one timeline
So that I can follow what has already been said before I reply.
```

---

## Acceptance criteria

```
AC1 - Four entry types
Given the timeline
When it renders
Then customer messages, agent messages, internal notes, and system events are
each visually distinct.

AC2 - Internal notes unmistakable
Given an internal note
When it renders
Then it is full width with an amber treatment, a lock icon, and an explicit
not-visible-to-customer label - impossible to confuse with a reply.

AC3 - Channel provenance
Given a message arrived by email, WhatsApp, chat, SMS, or web form
When it renders
Then its channel is shown on the message.

AC4 - Attachments inline
Given a message with files
When it renders
Then files appear as compact chips with icon, name, and size, and download on
click.

AC5 - Long threads
Given a conversation with many messages
When it loads
Then recent messages render first and older ones load on demand, with the view
scrolled to the latest.

AC6 - System events are quiet
Given a status or assignment change
When it appears in the timeline
Then it renders as a small centred muted line, not as a message bubble.
```

## Related (from the story)

```
The composer that writes into this timeline is US-1.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `07-ticket-detail.md` is not in this repository. | |

---

## Dependencies

- `US-45` the workspace - done. This story extends the `TicketConversation`
  component it created rather than replacing it.
- `US-51` "Attach files to tickets" owns object storage and is **deferred** from the
  MVP scope. See the plan for what that costs AC4.

## Extra notes

- Position 13 of 28.
- `Message.channel` and the `Attachment` model have existed since US-6; neither was
  on the API contract until now.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.
- `GET /tickets/:id` already returns the messages; this story pages them.

## Out of scope

- Writing into the timeline - US-1.
- Uploading and downloading files - US-51.
