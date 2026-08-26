# Running the project

Everything needed to get a working stack, sign in, and check that it is actually working.

There are **two ways to run this**, and which one you need depends on whether your machine
lets a Docker container reach the npm registry. Try Path A first; if it fails during the
image build, read [When the image build fails](#when-the-image-build-fails) and use
Path B.

---

## Prerequisites

| Path                  | You need                                                 |
| --------------------- | -------------------------------------------------------- |
| **A** — all in Docker | Docker Desktop. Nothing else.                            |
| **B** — hybrid        | Docker Desktop, plus Node 24.15.0 (`nvm use`) and npm 11 |

---

## Path A — everything in Docker

The intended setup, and what CI does.

```
git clone <repo>
cd customer-support-crm
docker compose up -d --wait
```

That starts Postgres, Redis, the API, and the frontend; creates the databases; applies
every migration; and waits for each service to report healthy before starting the one that
depends on it. The first run builds two images and takes a few minutes.

Then **seed the database** — see [First run: seed it](#first-run-seed-it) below. Without
this there are no roles, no permissions, and **no account you can sign in with.**

---

## Path B — data services in Docker, app on the host

Same result, and what you want anyway if you are attaching a debugger or running tests in a
loop.

```
nvm use                                 # .nvmrc → Node 24.15.0
npm install                             # from the ROOT only — see the note below
docker compose up -d --wait postgres redis

cp backend/.env.example backend/.env    # if you have not already
npm run migrate:deploy --workspace @crm/backend
npx tsc -b backend
npm run db:seed --workspace @crm/backend

# two terminals, or background them
npm run start --workspace @crm/backend
npm run dev   --workspace @crm/frontend
```

> **`npm install` runs from the repository root only.** This is an npm workspaces monorepo.
> Running it inside `frontend/` or `backend/` produces a nested `node_modules` and a second
> lockfile. There is one lockfile and it lives at the root.

`backend/.env` points `DATABASE_URL` and `REDIS_URL` at `127.0.0.1`, which is correct when
the API runs on the host and the databases are in Docker.

---

## First run: seed it

```
npm run db:seed --workspace @crm/backend
```

Idempotent — safe to run again, and it runs on every `prisma migrate reset`. It creates:

- 34 permissions and the four system roles (administrator, manager, agent, customer)
- **Five SLA policies** — one per priority plus a VIP override, each with a three-rung
  escalation ladder. These are reference data and are created in every environment.
- **Four development users**, but only when `SEED_PASSWORD` is set and `NODE_ENV` is not
  `production`. Without that variable it creates no users and says so.
- **The demonstration data set**, behind the same two guards: 2 branches, 3 departments,
  6 categories, 5 more staff, 5 customers, 14 tickets with real conversations,
  attachments, tasks and 3 knowledge articles. Roughly a third of it is in Arabic, so RTL
  can be checked against something other than lorem ipsum.

### Development accounts

Password is whatever `SEED_PASSWORD` is set to — `DevPassw0rd!` in
`backend/.env.example`.

| Email                | Role          |
| -------------------- | ------------- |
| `admin@crm.local`    | administrator |
| `manager@crm.local`  | manager       |
| `agent@crm.local`    | agent         |
| `customer@crm.local` | customer      |

These exist only because a helpdesk with no accounts cannot be signed into. The seed
**refuses to create them when `NODE_ENV=production`**, and it never overwrites a password
on re-run — so changing yours locally sticks.

### Demo staff

The demonstration data adds five more accounts, same password, same guards. Sign in as one
of these to see a queue that actually belongs to somebody:

| Email                     | Role    | Department       |
| ------------------------- | ------- | ---------------- |
| `nadia.saleh@crm.local`   | agent   | Customer Support |
| `tom.becker@crm.local`    | agent   | Customer Support |
| `huda.mansour@crm.local`  | agent   | Billing          |
| `priya.raman@crm.local`   | agent   | Technical        |
| `khalid.otaibi@crm.local` | manager | Technical        |

Everything in the demo set is invented — names, companies, order numbers, amounts. Nothing
is taken from a real customer.

---

## Where things are

| What              | URL                            |
| ----------------- | ------------------------------ |
| Frontend          | http://localhost:5173          |
| API               | http://localhost:3000          |
| Health            | http://localhost:3000/health   |
| API documentation | http://localhost:3000/api/docs |

**Check `/health` first when something is wrong.** It reports the database and Redis
separately, so it tells you _which_ thing is down rather than that something is:

```json
{
  "data": {
    "status": "ok",
    "dependencies": {
      "database": { "status": "up", "latencyMs": 2 },
      "redis": { "status": "up", "latencyMs": 2 }
    }
  }
}
```

It always answers `200` while the process is alive — read `status`, not the HTTP code.

---

## Checking it actually works

Open http://localhost:5173, sign in as `agent@crm.local`, and you should land on the
dashboard. The toggle in the corner of the login card switches to Arabic and mirrors the
whole layout — worth clicking, because RTL is a requirement from day one and it is easiest
to catch a regression by eye.

From the command line:

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"agent@crm.local","password":"DevPassw0rd!"}'
```

A healthy response has `data.accessToken`, `data.expiresIn: 900`, the user, their effective
permissions, and a `Set-Cookie: crm_refresh_token=…; Path=/auth; HttpOnly; SameSite=Strict`.

> **A page refresh returns you to the login screen, and that is expected.** The access
> token is held in memory only — anything in `localStorage` is readable by any script that
> gets onto the page. **US-15 (silent refresh)** is what makes the session survive a
> reload, using the httpOnly cookie that is already being set. There is a test asserting
> the token is never persisted, so please do not "fix" the reload by storing it.

---

## Day-to-day commands

All from the repository root.

| Command                                                         | What it does                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run test --workspace @crm/backend`                         | Backend suite (`node:test`). **Needs Postgres and Redis running.**                  |
| `npm run test --workspace @crm/frontend`                        | Frontend suite (Vitest + Testing Library)                                           |
| `npm run test --workspace @crm/shared`                          | Shared DTO and schema tests                                                         |
| `npm run typecheck`                                             | `tsc -b` across the project reference graph                                         |
| `npm run lint` / `npm run lint:fix`                             | ESLint                                                                              |
| `npm run format` / `npm run format:check`                       | Prettier                                                                            |
| `npm run verify`                                                | All of the above. What a reviewer runs before merging.                              |
| `npm run migrate:dev --workspace @crm/backend -- --name <name>` | Create a migration from a schema change. **Then run `prisma generate`** — see below |
| `npm run migrate:deploy --workspace @crm/backend`               | Apply pending migrations (never interactive)                                        |
| `npm run db:seed --workspace @crm/backend`                      | Seed; idempotent                                                                    |

**Prefer the narrow suite.** `npm run verify` runs everything including the backend
integration tests, which is minutes. If you changed the frontend, run the frontend suite.

The backend and frontend use **different test runners** — `node:test` and Vitest
respectively — which is deliberate: Vitest shares Vite's config and belongs with the
frontend, and the backend has no bundler to share one with.

**No test skips itself when Postgres or Redis is missing.** It fails loudly and names the
command to run.

### Docker housekeeping

```
docker compose logs -f backend   # follow one service
docker compose down              # stop; your data survives
docker compose down -v           # stop and DELETE the database volume
docker compose up -d --build     # after changing a Dockerfile or a dependency
```

---

## When the image build fails

If `docker compose up --build` dies during `npm ci` with:

```
npm error Exit handler never called!
npm error This is an error with npm itself.
```

**that message is a lie, and npm has swallowed the real one.** Get it out:

```bash
docker compose build backend --progress plain 2>&1 | grep -i "npm error"
```

The common cause on a corporate machine is TLS interception — a proxy or antivirus
(Zscaler, Netskope, ESET, and friends) re-signs HTTPS traffic with its own certificate.
Your host trusts that CA because Windows was told to; **the container does not**, so every
registry fetch fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` and npm falls over. To confirm,
look for that string in the npm debug log:

```bash
docker run --rm node:24.15.0-alpine sh -c \
  "npm view npm version >/dev/null 2>&1; grep -c UNABLE_TO_VERIFY /root/.npm/_logs/*-debug-0.log"
```

Anything above zero and this is your problem.

**The fix** is to give the image your organisation's root CA — export it from the Windows
certificate store as a `.crt`, `COPY` it into the image, and set `NODE_EXTRA_CA_CERTS` to
its path. Do **not** reach for `npm config set strict-ssl false`: it turns off certificate
verification for every package you install, in an image someone will eventually copy into
production.

**Until that is sorted, use Path B.** The host toolchain already trusts the CA, so
`npm install` works there; only the containers are affected. Everything runs and every test
passes — you just do not get the one-command start.

---

## If something will not start

- **A port is already in use.** Set `POSTGRES_PORT`, `REDIS_PORT`, `BACKEND_PORT` or
  `FRONTEND_PORT` in a root `.env`. Containers always talk to each other on the standard
  ports regardless of what you map on the host.
- **The service exits complaining about `JWT_ACCESS_SECRET`.** It is required, has no
  default, and must be at least 32 characters — deliberately, because a signing key with a
  default is a signing key everyone already has. Copy `backend/.env.example`.
- **`docker compose up` hangs on `backend`.** It waits for Postgres and Redis to report
  _healthy_, not merely started. `docker compose logs postgres` will say why.
- **Login returns 401 for credentials you are sure about.** Run the seed. Then check you
  are using the password from `SEED_PASSWORD`, not the one in the table above.
- **Login returns 429.** You tripped the brute-force lockout: five failures per account,
  twenty per IP address, over a fifteen-minute window. Wait it out, or clear the counter
  with `docker compose exec redis redis-cli --scan --pattern 'crm:auth:fail:*' | xargs docker compose exec -T redis redis-cli del`.
- **The login form loads but sign-in does nothing.** Check the browser network tab. In
  development Vite proxies `/auth` to the API so the request is same-origin — a
  `SameSite=Strict` cookie is _not_ sent on a cross-origin call, so bypassing the proxy
  gives you a login that appears to work while issuing no usable session. Inside Compose
  the proxy target is the `backend` service name, not `127.0.0.1`.
- **An edit does nothing.** Bind mounts from Windows and macOS do not deliver filesystem
  events into Linux containers, so the watchers poll. If polling has been turned off, this
  is the first thing to break.
- **`Cannot find module '@crm/shared'`.** The shared package has not been built. Inside
  Compose the entrypoint handles it; on the host, `npx tsc -b backend` (which builds the
  shared package first, automatically).
- **A stale build is confusing you.** `npm run clean`, then rebuild.

---

## Resetting

```bash
# Wipe the database and start over — destroys all local data.
docker compose down -v
docker compose up -d --wait postgres redis
npm run migrate:deploy --workspace @crm/backend
npm run db:seed --workspace @crm/backend
```

`npm run migrate:reset --workspace @crm/backend` does the same to the database only, and
re-runs the seed for you.

### After changing `schema.prisma`, run `prisma generate`

```bash
npx prisma generate --workspace @crm/backend   # from backend/, just: npx prisma generate
```

**`migrate dev` does not do this for you here.** With the Prisma 7 config file this project
uses, the client under `backend/src/generated/prisma` is not regenerated as a side effect of
creating a migration, and a stale client fails in a way that does not point at itself:
`tsc` is happy, and the API answers **`400 BAD_REQUEST` with "The request could not be
processed."** on every request that touches the new column. That is a
`PrismaClientValidationError` — the client rejecting a field its types do not know about —
mapped by the exception filter.

If a whole test suite starts answering 400 immediately after a schema change, this is why.
