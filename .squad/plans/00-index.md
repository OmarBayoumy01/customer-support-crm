# Plans index

> **Scope is set by [`00-mvp-scope.md`](./00-mvp-scope.md).** 28 stories, chosen to make one
> complete customer-support journey work end to end rather than to finish every MVP story.
> Read it before planning anything — several stories below the line were cut deliberately.

One row per feature folder under `.squad/plans/`. `NN` continues as a global execution sequence across all features when `naming.globalSequence` is `true` in `config.yaml`.

| Feature               | Overview                                                | NN range |
| --------------------- | ------------------------------------------------------- | -------- |
| `monorepo-foundation` | [00-overview.md](./monorepo-foundation/00-overview.md)   | 01       |
| `nestjs-bootstrap`    | [00-overview.md](./nestjs-bootstrap/00-overview.md)      | 02       |
| `prisma-postgres`     | [00-overview.md](./prisma-postgres/00-overview.md)       | 03       |
| `domain-schema`       | [00-overview.md](./domain-schema/00-overview.md)         | 04       |
| `api-conventions`     | [00-overview.md](./api-conventions/00-overview.md)       | 05       |
| `openapi-docs`        | [00-overview.md](./openapi-docs/00-overview.md)          | 06       |
| `structured-logging`  | [00-overview.md](./structured-logging/00-overview.md)    | 07       |
| `redis-cache-queues`  | [00-overview.md](./redis-cache-queues/00-overview.md)    | 08       |
| `docker-compose`      | [00-overview.md](./docker-compose/00-overview.md)        | 09       |
| `ci-pipeline`         | [00-overview.md](./ci-pipeline/00-overview.md)           | 10       |
| `roles-permissions`   | [00-overview.md](./roles-permissions/00-overview.md)     | 11       |
| `staff-login`         | [00-overview.md](./staff-login/00-overview.md)           | 12       |
| `session-lifecycle`   | [00-overview.md](./session-lifecycle/00-overview.md)     | 13–14    |
| `authorisation`       | [00-overview.md](./authorisation/00-overview.md)         | 15–16    |
| `react-scaffold`      | [00-overview.md](./react-scaffold/00-overview.md)        | 17       |
| `design-system`       | [00-overview.md](./design-system/00-overview.md)         | 18–23    |
| `customers`           | [00-overview.md](./customers/00-overview.md)             | 24       |
| `tickets`             | [00-overview.md](./tickets/00-overview.md)               | 25–26, 30–32 |
| `sla`                 | [00-overview.md](./sla/00-overview.md)                   | 27, 29   |
| `administration`      | [00-overview.md](./administration/00-overview.md)        | 28       |

## A note on 13–20

**These eight were written after their code shipped, on 2026-08-26.** Stories US-15, US-16,
US-22, US-23, US-25, US-26, US-27 and US-28 were implemented, tested and committed without
a plan file, and the records were reconstructed afterwards from the Notion stories and the
shipped code.

They are accurate — decisions, deviations and what each story leaves the next are all
recorded — but they were **not** the review gate `CLAUDE.md` describes, and nothing in the
repository should be read as evidence that gate was used for them. Each carries the same
warning at the top of its file.

Plans 01–12 were written before their implementation, in the normal way.
