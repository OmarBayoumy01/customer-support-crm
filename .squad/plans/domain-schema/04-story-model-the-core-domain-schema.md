# 04 — Model the core domain schema

- **Story:** US-6 · **Phase:** P01 Foundation · **Layer:** Backend · **Priority:** Must have
- **Depends on:** US-5 (done)

> The reviewed schema itself is `schema.proposed.prisma` in this folder, and the nine
> design decisions with their reasoning are in `00-overview.md`. This file records the
> shape of the work and how each acceptance criterion is proved.

## Target paths

| Action     | Path                                              |
| ---------- | ------------------------------------------------- |
| **modify** | `backend/prisma/schema.prisma` — the whole domain  |
| **create** | `backend/prisma/migrations/<ts>_core_domain_schema/migration.sql` |
| **create** | `backend/src/prisma/soft-delete.extension.ts`     |
| **create** | `backend/src/prisma/domain-schema.test.ts`        |
| **create** | `backend/src/prisma/soft-delete.test.ts`          |
| **modify** | `backend/src/prisma/prisma.service.ts` — add `notDeleted` |
| **modify** | `backend/src/prisma/prisma.service.test.ts` — probe model is gone |
| **modify** | `backend/src/prisma/migrations.test.ts` — probe model is gone |

Nothing outside `backend/`. No frontend or shared-package change: the domain types stay
server-side until a story actually needs a DTO for them.

## Shape

**16 entities plus 2 join tables.** `UserRole` and `RolePermission` are explicit rather
than implicit many-to-many, because both carry data — who granted a role and when, and the
scope attached to a permission grant.

**11 enum types**, all real PostgreSQL enums so AC3 is enforced by the database rather than
by TypeScript. Beyond the three the story names (`TicketStatus`, `TicketPriority`,
`Channel`): `MessageSenderType`, `TaskStatus`, `NotificationKind`, `ArticleStatus`,
`Locale`, `PermissionScope`, `AuditAction`, `TicketEventType`.

**Soft delete is a client extension**, not a convention. See `00-overview.md`.

## How each criterion is proved

| AC  | Test                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------ |
| AC1 | Queries `information_schema.tables` for all sixteen names, and asserts `MigrationProbe` is gone.             |
| AC2 | Builds a full graph — branch, department, agent, category, customer, SLA policy, ticket, message, attachment, history — then loads the ticket with every relation included and asserts each resolves. Plus `Restrict` on customer delete and `Cascade` to messages and attachments. |
| AC3 | Writes an invalid status and an invalid priority through **raw SQL**, bypassing the generated types, and asserts PostgreSQL raises `invalid input value for enum`. Plus a `pg_enum` query asserting the exact members the story specifies. |
| AC4 | `createdAt`/`updatedAt` on create; `updatedAt` advances on update while `createdAt` does not; soft-deleted rows vanish from `notDeleted` but still exist; the filter merges with a caller's `where` rather than replacing it; append-only tables are untouched; clearing `deletedAt` restores a row. |
| AC5 | Inserts 10,000 tickets in one statement spread across 20 agents, statuses, and due dates, runs `ANALYZE`, then asserts `EXPLAIN` of the agent-queue and SLA-sweep queries shows an index scan and no `Seq Scan on "Ticket"`. Cleans up its fixture. |

`ANALYZE` matters: without fresh statistics the planner is guessing on a
just-populated table, and its guess is not the one production would make.

## Verification

```
npm run db:up --workspace @crm/backend    # if not already running
npm run verify
```

Green as of 2026-08-26: 11 shared tests, 51 backend tests.
