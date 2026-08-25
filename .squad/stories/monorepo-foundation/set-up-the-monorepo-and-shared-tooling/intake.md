# Story intake

- Folder: `.squad/stories/monorepo-foundation/set-up-the-monorepo-and-shared-tooling/intake.md`
- Source of truth: Notion "User Stories" database, ref **US-3**.

---

## Feature

- **Feature name (display):** Monorepo Foundation
- **Feature slug (folder under `plans/`):** `monorepo-foundation`

## Tracker (metadata only)

- **Tracker type:** `none` (stories live in Notion)
- **Work item id:** `US-3`
- **Work item type:** User story
- **Status:** Ready
- **Assignee:** unassigned
- **Labels:** Phase `P01 Foundation` · Layer `Infrastructure` · Persona `Developer` · Priority `Must have` · Release `MVP`

---

## Title

```
Set up the monorepo and shared tooling
```

---

## Description

```
As a developer
I want a monorepo with frontend/, backend/, and infrastructure/ workspaces and shared tooling
So that both apps share types and lint rules instead of drifting apart.

This is the first story of Phase 1 (Foundation). Nothing user-facing is built in this
phase. The goal is a repository where a new developer runs one command and gets a
working stack. The repository is currently empty apart from CLAUDE.md, .gitignore and
.squad/ — every directory below has to be created by this story.

Target repository layout (from CLAUDE.md, authoritative):

    customer-support-crm/
    ├── frontend/           React + Vite app
    ├── backend/            NestJS API
    ├── packages/shared/    DTOs and Zod schemas shared by both
    ├── infrastructure/     Docker, CI, deployment
    └── docs/               Phase specifications

Approved stack — do NOT substitute or add dependencies outside this list without asking:

  Frontend       React, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router,
                 TanStack Query, React Hook Form + Zod, Recharts, i18next
  Backend        Node.js, NestJS, TypeScript, PostgreSQL, Prisma, Redis, Socket.IO, JWT
  Infrastructure Docker, GitHub Actions, S3-compatible storage

This story only needs the workspace skeletons and the shared tooling. The frontend and
backend apps must build/run as empty-but-valid scaffolds; the actual NestJS bootstrap
(US-4) and any UI (P03) are separate stories.
```

---

## Acceptance criteria

```
AC1 — Workspace structure
  Given a fresh clone
  When I run install at the root
  Then dependencies install for all workspaces in one command.

AC2 — Shared types package
  Given a DTO defined once
  When the frontend imports it
  Then the same TypeScript type is used on both sides with no duplication.

AC3 — Consistent tooling
  Given any workspace
  When I run lint and format
  Then ESLint, Prettier, and tsconfig resolve from shared root config.

AC4 — Git hygiene
  Given a commit attempt
  When staged files fail lint or type-check
  Then the commit is blocked by a pre-commit hook.

Every acceptance criterion must be covered by a test or an executable check. If an AC
cannot be tested, say so in the plan rather than marking it done.
AC2 in particular needs a real proof: one DTO defined in packages/shared, imported by
both backend and frontend, verified by type-check — not just a package that exists.
```

---

## Attachments

| File (relative to this folder) | What it is |
| ------------------------------ | ---------- |
| None. | |

---

## Dependencies

- **Blocked by / related ids:** none — US-3 is the first story in the repository.
- **Depends on code areas or other stories:** nothing exists yet. This story creates the
  ground every later story builds on, so directory names and tooling choices here are
  hard to change later.
- **Unblocks:** US-4 (NestJS bootstrap), US-5 (Prisma), US-11 (Docker Compose), US-12 (CI).

## Extra notes (optional)

- Working agreement: one story at a time, stop for review before starting the next.
- Prefer boring, explicit code over clever abstractions. This codebase will be maintained
  by people who did not write it.
- Definition of done that applies to every story: all ACs met and covered by tests;
  TypeScript strict with no `any` without a written justification; lint and format pass;
  no secrets, keys, or credentials committed; errors handled and logged, never swallowed.
- Two project rules that are non-negotiable and that the tooling set up here must not make
  harder to enforce later:
  1. Internal notes must never reach a customer — filtered at the API layer, not merely
     hidden in the UI, with an explicit regression test. Implication for this story: the
     shared package must be able to express separate customer-facing and internal DTO
     shapes, so keep it a real build target with its own types, not a dumping ground.
  2. The server is the security boundary — every permission is enforced again in a backend
     guard and scoped permissions applied in the database query. Implication for this
     story: `packages/shared` carries DTOs and Zod schemas only. No auth logic, no
     enforcement, nothing the frontend could be tempted to treat as the source of truth.
- The platform ships bilingual (English LTR / Arabic RTL) from day one. Nothing in this
  story renders UI, but the frontend scaffold should not make i18n a retrofit.
- Re-read from Notion on 2026-08-25 after the story was corrected. The "Out of scope"
  section now reads "CI pipeline (US-12) and Docker (US-11)" and matches the database.
  Story, acceptance criteria, technical notes, and all properties are otherwise unchanged.

## Technical hints (optional)

- Repos/roots: `.`. Primary language: `typescript`.
- **Package manager: npm workspaces — decided, not open.** The Notion story offers
  "pnpm workspaces (or npm workspaces)"; the team picked npm. Do not propose pnpm, yarn,
  turborepo, or nx. Installed toolchain is Node 24.15.0 and npm 11.12.1.
- Because npm hoists `node_modules`, a workspace can import a package it never declared
  and still compile. Counter that explicitly: every workspace declares its own direct
  dependencies in its own `package.json`, and lint forbids importing anything undeclared
  (e.g. `import/no-extraneous-dependencies`). Call this out in the plan — it is exactly
  the drift this story exists to prevent.
- `packages/shared` for DTOs and Zod schemas; consumed by both `backend/` and `frontend/`.
- Husky + lint-staged; conventional commits.
- Node version pinned via `.nvmrc`.
- Developers on this project are on Windows — scripts and hooks must work there, not only
  on macOS/Linux.
- "One command" in AC1 should be spelled out in the README so a new developer can follow
  it without asking.

## Out of scope

- CI pipeline (US-12) — no GitHub Actions workflows in this story.
- Docker and Docker Compose (US-11) — `infrastructure/` may exist, but no containers.
- NestJS application bootstrap and typed configuration (US-4).
- Prisma, PostgreSQL, Redis (US-5, US-10).
- Any UI, design tokens, or component work (Phase P03).
- Authentication and permissions (Phase P02).
