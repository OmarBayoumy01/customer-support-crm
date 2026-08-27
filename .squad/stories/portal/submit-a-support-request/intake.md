# Story intake

- Folder: `.squad/stories/portal/submit-a-support-request/intake.md`
- Source: Notion User Stories database, `US-86`
  (https://app.notion.com/p/3c69e083852381dabe7ac7dcb5f67fa9)

---

## Feature

- **Feature name (display):** Portal
- **Feature slug (folder under `plans/`):** `portal`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-86`
- **Work item type:** User story
- **Status:** Ready -> In progress
- **Labels:** P10 Customer Portal - Frontend - MVP - Must have - Persona: Customer -
  Screen: Portal Submit Ticket - Design File: `26-portal-submit-ticket.md`

---

## Title

```
Submit a support request
```

---

## Description

```
As a customer
I want a short, friendly form to submit a request
So that getting help does not feel like filling in a support system.
```

---

## Acceptance criteria

```
AC1 - Minimal fields
Given the form
When it renders
Then it asks only for subject, category, urgency, description, optional
attachments, and preferred contact method.

AC2 - Urgency in plain language
Given the urgency field
When it renders
Then it offers plain descriptions rather than internal priority names, mapped to
priority behind the scenes.

AC3 - Article deflection
Given I am typing a subject
When matching articles exist
Then they are suggested before the description field, with a clear way to
continue if they do not help.

AC4 - Confirmation
Given I submit
When it succeeds
Then I see a confirmation with my request number, the email that will receive
updates, and links to view it or return home.

AC5 - Friendly validation
Given a missing required field
When I submit
Then the message is non-technical, such as "Please tell us what's happening".

AC6 - Attachment limits
Given a file over the limit
When I attach it
Then I am told the limit in plain terms before the upload starts.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. `26-portal-submit-ticket.md` is not in this repository. | |

---

## Dependencies

- `US-82` built the whole boundary: `PortalAuthGuard` (audience `crm-portal`), the
  customer scoping, the allowlist DTOs and the per-account / per-IP throttle. This story
  adds the first **write** behind it.
- `US-21` added the sign-in, so there is a real portal session to submit under.
- **`US-76` (knowledge base) is a stated dependency and is cut** — all of P09 is out of
  the MVP scope.
- `US-51` (object storage) is deferred, so there is nowhere to put an attachment.
- `TicketsService.create` owns the sequential number, the `CREATED` history entry and the
  SLA clock start. Those are business rules, not authorisation.
- `CategoriesService.list` returns active categories — with `departmentId`,
  `departmentName` and `defaultPriority`, which the portal must not pass on.

## Extra notes

- Position 22 of 28.
- **The ticket's owner must come from the token.** `SubmitPortalTicketSchema` therefore has
  no `customerId`, no `channel`, no `departmentId`, no `tags` and no `status` — a contract
  with nothing to disagree about beats a check that the body matches the token.
- `Customer.preferredChannel` already models AC1's preferred contact method.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.

## Out of scope

- The request list - `US-84`. Reading and replying - `US-85`.
- Article suggestions - `US-76`, cut.
- Attachments and their limits - `US-51`, deferred.
- Any email, WhatsApp or SMS integration - P13. Recording a preferred channel is not
  sending to one.
