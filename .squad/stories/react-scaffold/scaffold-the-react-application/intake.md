# Story intake

- Source of truth: Notion "User Stories", ref **US-25**.
- Page: https://app.notion.com/p/3c69e0838523811cb01ad175d236aa05

> **Reconstructed after implementation (2026-08-26).** A record, not a gate — and an
> unusual one, because most of this story was already satisfied by US-14 before P03 opened.

## Feature

- **Feature name:** React Scaffold · **slug:** `react-scaffold`

## Tracker

- `US-25` · Phase `P03 Design System & Shell` · Layer `Frontend` · Priority `Must have` · MVP
- **Depends on:** US-3

## Description

```
As a developer
I want the React application scaffolded with the agreed frontend stack
So that feature work starts on settled foundations rather than ad-hoc choices.
```

## Acceptance criteria, in brief

AC1 the app builds with Vite and renders a routed shell · AC2 routes are code-split by
feature and a 404 exists · AC3 TanStack Query has global defaults for stale time, retry and
error handling · AC4 one typed client attaches auth headers and normalises the error
envelope · AC5 forms use React Hook Form and Zod, sharing the backend schema.

## Technical notes from the story

- Vite + TS + Tailwind + shadcn/ui; absolute imports via `@/`; error boundary at route level.

## Repository state at intake

**AC1, AC4 and AC5 were already met by US-14**, which stood the frontend up out of order
because P02's login screen needed it. The axios client with its envelope-normalising
interceptor exists; the login form already validates against the shared `LoginRequestSchema`.

Outstanding: code splitting, a 404 route, query defaults beyond `retry: false`, and the
route-level error boundary. The `@/` alias exists but generated imports were being rewritten
to relative paths because the eslint resolver would not read `paths`.

## Notes

- The story sits in P03 but its dependency, US-3, is P01. Nothing forced it to wait; the
  phase boundary is where it was filed, not when it was needed.
