# Monorepo Foundation — overview

The first slice of **Phase P01 Foundation**. Turns an empty repository into one where a
new developer runs a single command and gets a working, type-checked, lint-clean stack
with `frontend/`, `backend/`, and `packages/shared/` wired together.

Source of truth for the stories: the **User Stories** database in Notion.

## Stories

| #   | File                                                | Title                                          | Depends on |
| --- | --------------------------------------------------- | ---------------------------------------------- | ---------- |
| 01  | `01-story-set-up-the-monorepo-and-shared-tooling.md` | Set up the monorepo and shared tooling (US-3)   | —          |

Status: **implemented** — `npm run verify` passes; all four ACs verified. See
"Deviations from the plan" below.

## Decisions locked by this feature

Later stories inherit these. Reopening one means revisiting every workspace, so change
them deliberately rather than in passing.

- **Package manager: npm workspaces.** The Notion story offered pnpm or npm; the team
  chose npm. This propagates into US-11 (Docker) and US-12 (CI).
- **Because npm hoists `node_modules`**, a workspace can import an undeclared package and
  still compile. Guarded by `import/no-extraneous-dependencies` at error level in
  `eslint.config.js`, verified by inducing the failure.
- **Shared config lives only at the root.** One `tsconfig.base.json`, one
  `eslint.config.js`, one `.prettierrc.json`, one `.editorconfig`. Workspaces extend and
  override only for a genuine runtime difference.
- **`typecheck` and `build` are the same command (`tsc -b`).** Composite projects with
  references cannot type-check without emitting — `tsc -b --noEmit` fails with TS6310.
- **No test runner chosen.** `node:test` from the standard library covers this story with
  zero new dependencies. The backend runner is US-4's call (NestJS ships Jest), the
  frontend runner Phase P03's.
- **`packages/shared` carries DTOs and Zod schemas only** — no auth logic, no enforcement.
  The server is the security boundary, and everything in that package is readable by the
  browser.

## Deviations from the plan

Applied during implementation, each verified rather than assumed:

1. **`tsc -b --noEmit` → `tsc -b`.** The plan's typecheck script is invalid: composite
   referenced projects may not disable emit (TS6310, reproduced).
2. **`moduleResolution: "Bundler"` moved out of the base config.** The backend must run
   `node dist/index.js`; Bundler resolution emits extensionless imports that Node ESM
   rejects. Base is `NodeNext`; `frontend/` overrides to `Bundler` for Vite.
3. **`vitest` not installed.** Not in the approved stack, and CLAUDE.md requires asking
   first. The frontend has no test script yet; that choice belongs to Phase P03.
4. **`eslint-import-resolver-typescript` added.** Required by the plan's own
   `import/no-unresolved` rule but missing from its dependency list.
5. **Frontend `tsc -b` output moved to `.tsbuild/`.** The plan pointed it at `dist/`,
   which Vite also owns — `tsc -b && vite build` would have mixed two toolchains' output.
6. **`frontend/src/App.tsx` annotates the shared type explicitly.** As the plan wrote it,
   the value went straight into `HealthStatusSchema.parse()`, whose parameter is
   `unknown` — a field rename in the shared DTO left the frontend type-check green. AC2
   says the frontend must catch drift, so the literal is typed before parsing.
7. **`.gitattributes` added.** Not in the plan. Git's `core.autocrlf` was rewriting hook
   files to CRLF, which breaks `.husky/pre-commit` with `sh: ^M: not found` and disables
   the AC4 gate silently.
8. **Type-check moved out of `lint-staged` into the hook body.** lint-staged appends
   staged filenames to each command, which `tsc -b` rejects. `.husky/pre-commit` runs
   `npx lint-staged` then `npm run typecheck`.

## Known limitations

- **`git commit --no-verify` bypasses both hooks.** Nothing local prevents it; CI (US-12)
  is the non-bypassable backstop. AC4 holds for an ordinary commit only.
- **Nothing programmatically stops `packages/shared` growing auth logic.** Enforced by its
  README and code review, not by a test.

## Follows on

- **US-4** — Bootstrap the NestJS backend with typed configuration. Replaces
  `backend/src/index.ts`.
- **US-11** — Containerise local development with Docker Compose.
- **US-12** — Build the CI pipeline, the non-bypassable backstop for the checks the
  pre-commit hook runs locally.
