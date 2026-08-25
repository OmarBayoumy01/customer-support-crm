# Story intake

- Source of truth: Notion "User Stories" database, ref **US-6**.

## Feature

- **Feature name (display):** Domain Schema
- **Feature slug:** `domain-schema`

## Tracker (metadata only)

- **Work item id:** `US-6` · Phase `P01 Foundation` · Layer `Backend` · Priority `Must have` · Release `MVP`
- **Depends on:** US-5 (done)

## Title

```
Model the core domain schema
```

## Description

```
As a developer
I want the core domain schema modelled in Prisma
So that every later feature builds on one agreed data model rather than inventing its own.
```

## Acceptance criteria

```
AC1 — Core entities exist
  Given the schema, When I inspect it, Then it contains User, Role, Permission,
  Department, Branch, Customer, Ticket, Message, Attachment, Category,
  TicketHistory, SlaPolicy, Task, Notification, KnowledgeArticle, and AuditLog.

AC2 — Ticket relationships
  Given a ticket, When I query it, Then it resolves its customer, assigned agent,
  category, department, branch, messages, attachments, history, and SLA state.

AC3 — Enums are enforced at the database level
  Given ticket status and priority, When an invalid value is written,
  Then the database rejects it.

AC4 — Soft delete and timestamps
  Given any core entity, When it is created or modified,
  Then createdAt, updatedAt, and where relevant deletedAt are maintained automatically.

AC5 — Indexes on hot paths
  Given ticket list queries filtered by status, assignee, and updated date,
  When they run against realistic data volume,
  Then the query planner uses an index rather than a sequential scan.
```

## Technical notes from the story

- Status enum: NEW, OPEN, PENDING_CUSTOMER, PENDING_INTERNAL, ESCALATED, RESOLVED, CLOSED
- Priority enum: LOW, MEDIUM, HIGH, URGENT
- Channel enum: EMAIL, WHATSAPP, CHAT, SMS, WEB
- Message carries an `isInternal` flag — this is what US-1 depends on

## Out of scope

- Seed data (US-12).

## Repository state at intake

US-3, US-4, and US-5 are done and committed. `backend/prisma/schema.prisma` exists with the
Prisma 7 generator and datasource blocks settled, plus a temporary `MigrationProbe` model
that **this story drops**. `PrismaService` is global and owns the `pg.Pool`.
`prisma/migrations/` holds one committed migration. Tests are `node:test` +
`@nestjs/testing` against `dist/`, and require a running database.

**Do not touch the generator block.** `importFileExtension = "js"` is load-bearing; without
it the generated client emits `.ts` import specifiers that Node cannot resolve from `dist/`.

## The gate

CLAUDE.md flags this as the highest-stakes story in the phase and requires the full schema
to be presented for review **before** migrations are written. That review happened against
`.squad/plans/domain-schema/schema.proposed.prisma`; the nine decisions and their reasoning
are recorded in `00-overview.md`.
