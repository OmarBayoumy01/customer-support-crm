# Story 17 — Scaffold the React application

- **Story:** US-25 · **Phase:** P03 · **Layer:** Frontend · **Priority:** Must have
- **Depends on:** US-3 · **Commit:** `c919e86`

> Written after implementation. Context for why this story was mostly already done is in
> `00-overview.md`.

## Already satisfied before this story ran

| AC  | By        | What                                                              |
| --- | --------- | ----------------------------------------------------------------- |
| AC1 | US-14     | Vite builds; the app renders a routed page.                       |
| AC4 | US-14     | One axios client, auth header attached, error envelope normalised into `ApiRequestError`. |
| AC5 | US-14     | React Hook Form with `zodResolver`, against the **shared** `LoginRequestSchema`. |

## Target paths

| Action     | Path                                                     |
| ---------- | -------------------------------------------------------- |
| **create** | `frontend/src/app/route-error-boundary.tsx`               |
| **create** | `frontend/src/features/not-found/not-found-page.tsx`      |
| **create** | `frontend/src/components/states/route-fallback.tsx`       |
| **modify** | `frontend/src/app/router.tsx` — `lazy()` per feature, 404 |
| **modify** | `frontend/src/app/providers.tsx` — query defaults         |
| **modify** | `frontend/tsconfig.json`, `frontend/vite.config.ts` — `@/` alias |
| **modify** | `eslint.config.js` — see the deviation below              |

## How each criterion is proved

| AC  | How                                                                              |
| --- | -------------------------------------------------------------------------------- |
| AC1 | `npm run build --workspace @crm/frontend` succeeds.                              |
| AC2 | The build emits a separate chunk per feature — `login-page`, `dashboard-page`, `admin-page`, `design-system-page`, `not-found-page`. A `*` route renders the 404 inside the shell. |
| AC3 | `createQueryClient` sets `staleTime`, a conditional `retry`, and `refetchOnWindowFocus: false` globally. |
| AC4 | Covered by US-14's and US-15's client tests, which assert the envelope mapping and the auth header. |
| AC5 | Covered by `login-page.test.tsx`, which asserts validation runs before any request. |

**AC2 is verified from the build output rather than a unit test**, because chunking is a
bundler behaviour and a test that mocked it would be asserting nothing.

## Deviations

**`import/no-unresolved` is disabled for `frontend/src`.** The `@/` alias resolves in both
`tsconfig.json` and `vite.config.ts`, but `eslint-import-resolver-typescript` v4 does not
read `paths` out of this project — verified by calling the resolver directly, not inferred
from the error. The alternative was rewriting every generated file on each `shadcn add`.

Nothing is lost: `tsc -b` resolves these modules and runs in the same pipeline, so an
import that does not exist is still a build failure. The rule keeps working in `backend/`
and `packages/shared/`, which use relative and package imports only.

Worth revisiting if the resolver is fixed upstream.

## Verification

```
npm run build --workspace @crm/frontend
npm run test  --workspace @crm/frontend
```
