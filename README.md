# Customer Support CRM

A multi-role customer support / helpdesk platform. Customers submit requests, agents
resolve them against SLA targets, managers supervise workload and escalations,
administrators configure the platform.

Core workflow: **customer → ticket → categorise → assign → communicate → monitor SLA →
escalate → resolve → report**

---

## Where this stands

**This is unfinished, on purpose.** It is built alongside a full-time job, in the time
that leaves, with heavy use of AI assistance — so it advances in bursts and stops
mid-slice rather than arriving complete.

My day job is full-stack **Vue + .NET**; my own specialism is **frontend React**. This
repository is where the React side gets exercised properly, which is why the frontend is
further along and more opinionated than a project at this stage would usually be.

What that means for anyone reading the code:

- **Finished work is genuinely finished** — tested, verified against the acceptance
  criteria it was built from, and documented where it deviates.
- **Unfinished work is named rather than hidden.**
  [`.squad/plans/00-workflow-status.md`](./.squad/plans/00-workflow-status.md) lists what is
  done, what is next, and every acceptance criterion deliberately left unmet — with the
  reason, and the story that would complete it.
- Sidebar items that say **not built yet** mean exactly that. They are not broken links.

### Where the work comes from

The 125 user stories are not in this repository — they live in Notion, and each row carries
its own acceptance criteria:

**→ [User stories](https://app.notion.com/p/fdeccf91bcb64167bfc52ba514a74b18?v=3c79e0838523814a945d000cf1a54ea3)**

That is the spec. Every commit here traces back to a story ref (`US-42`, `US-58`, …), the
acceptance criteria are checked one by one before a story is marked reviewed, and anything
that could not be met honestly is recorded as unmet instead. `CLAUDE.md` explains how the
database is read and in what order.

### What this was meant to be

The setup I actually wanted was larger than what is here.

**Figma for the design and Jira for the work, linked to each other** — every Jira card
carrying its own frame, so a story arrived with both its acceptance criteria and the screen
it was supposed to produce. Both pulled into the agent through **MCP servers**, so the
design and the ticket were read from the source rather than pasted into a prompt. And the
build itself driven by a spec-driven harness — **Squad Kit**, **Superpowers**, or
**OpenSpec** — where a strong model plans once and a cheaper one executes that plan many
times.

**I ran out of credits before that existed.** Claude and the Google AI Pro plan both went on
my day job first — full-stack Vue and .NET — and what was left funded this. So the design
half was never wired up: the stories live in Notion, read through its MCP server, and the
plan-per-story flow in `.squad/plans/` is the modest version of the harness I was aiming at.

It is worth saying plainly rather than implying the tooling was a choice. The architecture
in this repository is what I would build again; the pipeline around it is not finished, and
the reason is budget rather than design.

---

## Getting started

**→ [`docs/running-the-project.md`](./docs/running-the-project.md) is the full runbook** —
both ways to run it, the development accounts, how to check it works, and what to do when
it does not. What follows is the short version.

```
git clone <repo>
cd customer-support-crm
docker compose up -d --wait
npm run db:seed --workspace @crm/backend     # roles, permissions, and dev users
```

That starts Postgres, Redis, the API, and the frontend, applies every migration, and waits
for each service to be healthy before starting the one that depends on it. The first run
builds two images and takes a few minutes; afterwards it is seconds.

**The seed is not optional on a fresh database.** Without it there are no roles, no
permissions, and no account anyone can sign in with. It is idempotent.

| What              | Where                          |
| ----------------- | ------------------------------ |
| Frontend          | http://localhost:5173          |
| API               | http://localhost:3000          |
| Health            | http://localhost:3000/health   |
| API documentation | http://localhost:3000/api/docs |

Sign in as `agent@crm.local` with the password from `SEED_PASSWORD`
(`DevPassw0rd!` in `backend/.env.example`). The other three accounts, one per role, are in
the runbook.

`/health` is the one to check first: it reports the database and Redis separately, so if
something is wrong it tells you which thing.

**Edit any file and it takes effect** — no rebuild, no restart. The backend takes a few
seconds (TypeScript recompiles, then the process restarts); the frontend is near-instant.

> **If the image build fails with npm's `Exit handler never called!`**, your machine is
> probably intercepting TLS and the container does not trust the CA doing it. That message
> is not the real error. The runbook has the diagnosis, the proper fix, and the workaround
> — run the databases in Docker and the app on the host, which needs Node 24.15.0 and
> `npm install` from the repository root.

**The test suite needs Postgres and Redis running.** No test skips itself when they are
absent — it fails loudly and names the command to run.

---

## Repository layout

| Directory            | Contents                                                                  |
| -------------------- | ------------------------------------------------------------------------- |
| `frontend/`          | React + Vite app. Placeholder scaffold until Phase P03.                   |
| `backend/`           | NestJS API — config, Prisma, Redis, API conventions, OpenAPI, logging.    |
| `packages/shared/`   | DTOs and Zod schemas shared by both. **No auth logic — see its README.**  |
| `infrastructure/`    | Docker images and entrypoints for the Compose stack. CI arrives in US-12. |
| `docs/`              | Phase specifications.                                                     |
| `docker-compose.yml` | The whole stack for local development. Root-level by convention.          |

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
