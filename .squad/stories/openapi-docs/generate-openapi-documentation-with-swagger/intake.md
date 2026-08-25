# Story intake

- Source of truth: Notion "User Stories" database, ref **US-8**.

## Feature

- **Feature name (display):** OpenAPI Documentation
- **Feature slug:** `openapi-docs`

## Tracker (metadata only)

- **Work item id:** `US-8` · Phase `P01 Foundation` · Layer `Backend` · Priority `Should have` · Release `MVP`
- **Depends on:** US-7 (done)

## Title

```
Generate OpenAPI documentation with Swagger
```

## Description

```
As a developer
I want auto-generated OpenAPI documentation
So that frontend work can proceed against a contract without reading backend source.
```

## Acceptance criteria

```
AC1 — Docs available
  Given the app is running in a non-production environment, When I open /api/docs,
  Then interactive Swagger UI lists every endpoint grouped by module.

AC2 — Schemas documented
  Given any endpoint, When I inspect it in the docs,
  Then request and response DTOs, enums, and error shapes are described.

AC3 — Auth in docs
  Given a protected endpoint, When I use the docs UI,
  Then I can supply a bearer token and call it successfully.

AC4 — Production safety
  Given production, When I request the docs path,
  Then it is disabled or requires authentication.
```

## Technical notes from the story

- `@nestjs/swagger` decorators on DTOs; keep them beside the DTO, not in the controller

## Out of scope

- Generating a typed frontend client from the spec.

## Repository state at intake

US-3 through US-7 are done and committed. **US-7 is the important one here:** DTOs are Zod
schemas wrapped by `createZodDto`, which exposes the schema as a `zodSchema` static
specifically so this story can generate documentation from the same definition that
performs validation. The response envelope (`{ data }` / `{ data, pagination }`) and the
`ApiError` shape are settled and live in `packages/shared`.

`class-validator` and `class-transformer` are **not** installed and must not be added.
`@nestjs/swagger` lists them as peers but only its CLI plugin needs them.

## The problem this story has to solve

`@nestjs/swagger` documents classes decorated with `@ApiProperty()`. Our DTOs are Zod
schemas. Something has to convert one to the other, and the options are:

- a new dependency (`zod-to-json-schema`), which is outside the approved stack;
- migrating `packages/shared` to the `zod/v4` subpath that the installed Zod 3.25 ships,
  which has a real `toJSONSchema` but changes `.datetime()` and other call sites; or
- a converter written here, covering the subset the codebase uses.

Whichever is chosen, the plan must say why, and the result must not silently emit an empty
schema for a shape it does not understand — a wrong contract is worse than a missing one,
because the frontend builds against it.

## Note on AC3

There are **no protected endpoints yet** — authentication is P02. "Call it successfully"
can only be proved against a stand-in guard. Say so rather than implying the real thing was
tested.
