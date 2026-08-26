# Story intake

- Folder: `.squad/stories/administration/generate-realistic-seed-data/intake.md`
- Source: Notion User Stories database, `US-120`
  (https://app.notion.com/p/3c69e08385238146b850f1e70b1f520c)

---

## Feature

- **Feature name (display):** Administration
- **Feature slug (folder under `plans/`):** `administration`

## Tracker (metadata only)

- **Tracker type:** `notion`
- **Work item id:** `US-120`
- **Work item type:** User story
- **Status:** Ready → In progress
- **Assignee:** —
- **Labels:** P14 Administration · Backend · MVP · Must have · Persona: Developer · no
  design file

---

## Title

```
Generate realistic seed data
```

---

## Description

```
As a developer
I want realistic seed data
So that the application can be demonstrated and tested without hand-entering records.
```

---

## Acceptance criteria

```
AC1 — Coverage
Given the seed script
When it runs
Then it creates roles, departments, branches, users across every role, customers,
tickets in every status and priority, messages, articles, tasks, and SLA policies.

AC2 — Realistic content
Given seeded tickets
When viewed
Then subjects and conversations read like real support cases, not placeholder text.

AC3 — Bilingual
Given seed data
When it is created
Then some records are in Arabic so RTL can be tested meaningfully.

AC4 — Edge cases included
Given the seed
When it runs
Then it includes breached SLAs, unassigned tickets, long conversations, and
tickets with attachments.

AC5 — Idempotent and safe
Given the script runs twice
When it completes
Then it does not duplicate data, and it refuses to run against a production database.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. | |

---

## Dependencies

- **Blocked by / related ids:** `US-6` (domain schema) — done. In practice also `US-67`,
  which landed immediately before: a ticket with no SLA policy has no deadline, and AC4's
  "breached SLAs" needs one.
- The existing seeder (`backend/src/seed/seed.ts`) already covers permissions, roles, four
  development users and the SLA policies, and already carries the production guard AC5
  asks for. This story extends it rather than replacing it.

## Extra notes

- `.squad/plans/00-mvp-scope.md` puts this at position 9 of 28. It is a **prerequisite**
  rather than a workflow step: without it, every screen built after this one is reviewed
  against an empty database.
- AC1 names articles and tasks. Their features (P09 knowledge base, P10 tasks) are
  deferred, but the models exist and seeding a handful is cheap.

## Technical hints

- Repos/roots: `.`. Primary language: `typescript`.
- The seeder runs outside Nest — plain `PrismaClient` over a `pg` Pool, `process.env`, and
  `console`.

## Out of scope

- Any UI for managing the data.
- Real uploaded objects behind the attachment rows — S3 storage is not wired up in the MVP.
