# Customer Support CRM

A multi-role customer support / helpdesk platform. Customers submit requests, agents
resolve them against SLA targets, managers supervise workload and escalations,
administrators configure the platform.

Core workflow: **customer → ticket → categorise → assign → communicate → monitor SLA →
escalate → resolve → report**

---

## Getting started

One command installs everything.

```
git clone <repo>
cd customer-support-crm
nvm use            # picks up .nvmrc → Node 24.15.0
npm install        # installs every workspace
npm run verify     # type-check, lint, format check, tests
```

`npm install` is run **from the repository root only**. This is an npm workspaces
monorepo — running `npm install` inside `frontend/` or `backend/` can produce a nested
`node_modules` and a second lockfile. There is one lockfile, and it lives at the root.

`npm install` also installs the Git hooks, via the `prepare` script. A fresh clone is
gated from the first commit with no extra step.

---

## Repository layout

| Directory          | Contents                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| `frontend/`        | React + Vite app. Placeholder scaffold until Phase P03.                  |
| `backend/`         | NestJS API. Placeholder scaffold until US-4.                             |
| `packages/shared/` | DTOs and Zod schemas shared by both. **No auth logic — see its README.** |
| `infrastructure/`  | Docker, CI, deployment. Empty until US-11 and US-12.                     |
| `docs/`            | Phase specifications.                                                    |

---

## Scripts

All run from the repository root.

| Script                 | What it does                                | When to run it                                           |
| ---------------------- | ------------------------------------------- | -------------------------------------------------------- |
| `npm run verify`       | type-check → lint → format check → tests    | Before opening a PR. The single command a reviewer runs. |
| `npm run build`        | `tsc -b` across the project reference graph | To check everything compiles.                            |
| `npm run typecheck`    | Same as `build` — see the note below        | Any time; also runs in the pre-commit hook.              |
| `npm run lint`         | ESLint over every workspace                 |                                                          |
| `npm run lint:fix`     | ESLint with `--fix`                         |                                                          |
| `npm run format`       | Prettier `--write`                          |                                                          |
| `npm run format:check` | Prettier `--check`                          |                                                          |
| `npm run test`         | Fans out to each workspace's `test` script  |                                                          |
| `npm run clean`        | `tsc -b --clean` — removes build output     | When a stale build confuses you.                         |

**Why `typecheck` and `build` are the same command.** These are composite TypeScript
projects with project references. `tsc --build --noEmit` is rejected outright
(`error TS6310: Referenced project ... may not disable emit`), so there is no
emit-free type-check available. `tsc -b` is incremental and fast, so building _is_ the
type-check.

Workspace-level scripts exist too — `npm run dev --workspace @crm/frontend` starts Vite
on port 5173.

---

## How the workspaces fit together

`packages/shared` is the single source of truth for data contracts. A DTO is defined
there once and imported by both sides:

- `backend/src/index.ts` imports `HealthStatus` from `@crm/shared`
- `frontend/src/App.tsx` imports the same type

Rename a field in `packages/shared/src/dto/health.ts` and both type-checks fail. That is
the point — the type cannot drift, because there is only one of it.

`backend/` and `frontend/` consume the shared package through its built `dist/`, wired by
TypeScript project references. `tsc -b` builds `packages/shared` first automatically.

### The hoisting problem, and what stops it

npm hoists `node_modules` to the root. That means a workspace can `import` a package it
never declared in its own `package.json` and still compile — until someone removes the
dependency from the _other_ workspace that pulled it in, and this one breaks for no
visible reason.

`import/no-extraneous-dependencies` is set to `error` in `eslint.config.js` to prevent
exactly this. Every workspace declares its own direct dependencies. If you add an import,
add the dependency to that workspace's `package.json`.

---

## Tooling

All shared configuration lives at the root and only at the root:

| File                   | Owns                                             |
| ---------------------- | ------------------------------------------------ |
| `tsconfig.base.json`   | Compiler strictness. Every workspace extends it. |
| `tsconfig.json`        | Solution file listing the project references.    |
| `eslint.config.js`     | ESLint 9 flat config for every workspace.        |
| `.prettierrc.json`     | Formatting.                                      |
| `.editorconfig`        | LF line endings, UTF-8, 2-space indent.          |
| `commitlint.config.js` | Conventional commit messages.                    |

A workspace `tsconfig.json` overrides the base **only** for a genuine runtime difference —
`frontend/` sets `moduleResolution: "Bundler"` and DOM libs because Vite bundles it;
`backend/` and `packages/shared/` stay on `NodeNext` because Node runs them directly. If
you find yourself copying a compiler option between workspaces, it belongs in the base.

---

## Verifying the hooks

`git commit` runs two hooks:

- **`pre-commit`** → `lint-staged` (ESLint `--fix` and Prettier on staged files), then
  `npm run typecheck` across the whole project. The project-wide type-check is deliberate:
  a type error is often in a file the commit did not touch, so checking only staged files
  would let the repository go red while every individual commit looks green.
- **`commit-msg`** → commitlint, enforcing conventional commits (`feat:`, `fix:`,
  `chore:`, …).

To confirm they work, introduce a lint error, stage it, and try to commit — the commit
must be rejected.

**`git commit --no-verify` skips both hooks.** Nothing local can prevent that. The
non-bypassable backstop is CI (**US-12**), which re-runs the same checks.

### Windows

The hooks are plain `sh` scripts executed by the shell Git for Windows ships, so they run
without Git Bash being your terminal. They must keep **LF** line endings — a hook saved
with CRLF fails with `sh: ^M: not found`, and the gate silently stops working.
`.editorconfig` and Prettier's `"endOfLine": "lf"` enforce this.

---

## Conventions and constraints

Read `CLAUDE.md` before contributing. Two rules are non-negotiable:

1. **Internal notes must never reach a customer.** Filtered at the API layer, not merely
   hidden in the UI.
2. **The server is the security boundary.** Frontend permission gating is a convenience;
   every permission is enforced again in a backend guard, and scoped permissions are
   applied in the database query.

The stack is a closed set — ask before adding a dependency that is not already in it.

The platform ships in English (LTR) and Arabic (RTL) from day one. Use CSS logical
properties, never `left`/`right`.
