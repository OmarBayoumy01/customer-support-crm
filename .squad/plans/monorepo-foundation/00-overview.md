# Monorepo Foundation — overview

The first slice of **Phase P01 Foundation**. Turns an empty repository into one where a
new developer runs a single command and gets a working, type-checked, lint-clean stack
with `frontend/`, `backend/`, and `packages/shared/` wired together.

Source of truth for the stories: the **User Stories** database in Notion.

## Stories

| Story id | File | Title | Depends on |
| -------- | ---- | ----- | ---------- |
| 01 | `01-story-set-up-the-monorepo-and-shared-tooling.md` | Set up the monorepo and shared tooling | set-up-the-monorepo-and-shared-tooling | — |

## Decisions locked by this feature

Later stories inherit these. Reopening one means revisiting every workspace, so change
them deliberately rather than in passing.

- **Package manager: npm workspaces.** The Notion story offered pnpm or npm; the team
  chose npm. This propagates into US-11 (Docker) and US-12 (CI).
- **Because npm hoists `node_modules`**, a workspace can import an undeclared package and
  still compile. Guarded twice: `import-x/no-extraneous-dependencies` in lint, and
  `tests/dependency-boundaries.test.mjs`, which a lint-disable comment cannot reach.
- **Shared config lives only at the root.** One `tsconfig.base.json`, one
  `eslint.config.js`, one `.prettierrc.json`. Workspaces extend and override only for a
  genuine runtime difference.
- **No test runner chosen.** `node:test` from the standard library covers this story's
  checks with zero new dependencies. The backend runner is US-4's call, the frontend
  runner Phase P03's.
- **`packages/shared` carries DTOs and Zod schemas only** — no auth logic, no enforcement.
  The server is the security boundary, and everything in that package is readable by the
  browser.

## Follows on

- **US-4** — Bootstrap the NestJS backend with typed configuration.
- **US-11** — Containerise local development with Docker Compose.
- **US-12** — Build the CI pipeline, the non-bypassable backstop for the checks the
  pre-commit hook runs locally.
