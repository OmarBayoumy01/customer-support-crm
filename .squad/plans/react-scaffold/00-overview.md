# react-scaffold — plan overview

Entry point for the **react-scaffold** feature. First story of **P03 Design System &
Shell**, and the one most of which was already done before the phase opened.

> **Written after implementation.** A record, not a gate.

## Stories

| NN  | File                                            | Title                         | Tracker id | Depends on | Commit    |
| --- | ----------------------------------------------- | ----------------------------- | ---------- | ---------- | --------- |
| 17  | `17-story-scaffold-the-react-application.md`    | Scaffold the React application | US-25      | US-3       | `c919e86` |

## The situation this story was in

**Three of its five criteria were already met by US-14.** P02's login screen needed a
frontend, so Vite, React Router, TanStack Query, React Hook Form with Zod, Tailwind and
shadcn/ui were all stood up out of order, along with the axios client that normalises the
backend's error envelope.

That is worth recording rather than smoothing over: the phase boundary said P03 owned the
scaffold, and the work happened in P02 because a Must-have story could not proceed without
it. The plan below covers only the remainder.

## Decisions

1. **The login screen is not code-split.** It is the first thing an unauthenticated visitor
   sees, and a second network round trip before a password field is a poor trade for a few
   kilobytes. Everything else is lazy.
2. **The error boundary sits inside the shell, not around it.** A page that throws leaves
   the sidebar and header standing and the user can navigate away; at the root, one broken
   screen becomes a blank page.
3. **Query `staleTime` is 30 seconds.** Long enough that moving between screens does not
   refetch, short enough that an agent who assigns a ticket sees it moved. A helpdesk is
   collaborative — the data genuinely changes under you.
4. **Retries are conditional, not blanket.** A 4xx is an answer, not a failed attempt to get
   one. Blanket `retry: 3` is also how a wrong password walks an account into US-14's
   lockout.
5. **`import/no-unresolved` is off for `frontend/src`.** See the story file — this is the
   one decision here somebody may want to revisit.

## What the next stories inherit

- `@/` absolute imports work in tsc and Vite. shadcn generates them.
- `RouteFallback` for suspense, `RouteErrorBoundary` for crashes, `NotFoundPage` for 404.
- Query defaults are global; a feature should override them only with a reason.
