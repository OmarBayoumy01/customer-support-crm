# openapi-docs — plan overview

Entry point for the **openapi-docs** feature.

## Stories

| NN  | File                                                        | Title                                      | Tracker id | Depends on |
| --- | ----------------------------------------------------------- | ------------------------------------------ | ---------- | ---------- |
| 06  | `06-story-generate-openapi-documentation-with-swagger.md`    | Generate OpenAPI documentation with Swagger | US-8       | US-7       |

## Decisions

1. **A converter written here, not a new dependency.** `zod-to-json-schema` is outside the
   approved stack, and migrating `packages/shared` to the `zod/v4` subpath — which the
   installed Zod 3.25 ships, complete with a real `toJSONSchema` — changes `.datetime()`
   and other call sites across the shared package. That migration is worth doing, but not
   inside a "should have" documentation story. `zodToOpenApi` covers the subset the
   codebase actually uses.
2. **The converter is strict.** It throws on a Zod node it does not recognise rather than
   emitting `{}`. A permissive converter that guesses is worse than none, because the
   guess is what the frontend then builds against. Adding a case is a two-line change; the
   error message says so.
3. **Documentation is generated from the validating schema.** `ApiZodBody`, `ApiZodQuery`,
   and `ApiZodResponse` read `zodSchema` off the DTO that US-7's pipe validates with. There
   is one definition, so docs cannot drift from enforcement.
4. **`ApiZodResponse` documents the envelope, not the bare payload** — what the docs show
   is what the client actually receives.
5. **`ApiZodQuery` expands to one parameter per key**, so the Swagger UI renders real input
   boxes rather than one opaque object.
6. **Production safety fails closed.** Enabling docs in production without credentials does
   **not** fall back to serving them openly; it refuses and logs why. A misconfiguration
   that publishes the whole API surface is not something to fail open on. The rule lives in
   `decideSwagger`, a pure function, so it is testable without setting `NODE_ENV=production`
   on a live process.
7. **Basic auth compares in constant time**, so a wrong password cannot be discovered a
   byte at a time.

## Status — 2026-08-26

**06 / US-8 — executed. Notion status `In review`.**

`npm run verify` green: **113 tests** (22 shared, 91 backend).

### AC3 is only partly provable, and that is worth stating plainly

The story says "Given a protected endpoint … I can supply a bearer token and call it
successfully." **There are no protected endpoints in Phase 1** — authentication is P02.

What is proved: the bearer security scheme is declared in the document; a route decorated
with `@ApiBearerAuth()` is marked as requiring it; a request carrying `Authorization:
Bearer …` reaches the handler while one without it is refused with `UNAUTHENTICATED`; and
`persistAuthorization` keeps a token typed into the UI across reloads.

What is **not** proved: that a real JWT issued by real authentication is accepted, because
neither exists yet. The guard in the test is a stand-in. Re-check this AC when P02 lands.

### Deviations from plan

- **`@nestjs/swagger` re-exports `SchemaObject` from its root**; the deep import into
  `dist/interfaces/…` that the type is usually cited from is blocked by the package's
  exports map under NodeNext.
- **`BooleanFromString` was added to the env schema.** `z.coerce.boolean()` follows
  JavaScript truthiness, so the string `"false"` coerces to `true` — precisely wrong for a
  flag that gates production behaviour.
- **The "grouped by module" assertion checks operation-level tags**, not the document's
  root `tags` array. The root array is only populated by explicit `.addTag()` calls, which
  are for descriptions; grouping in the UI comes from the tags on each operation.

## What the next stories inherit

- Any new controller gets `@ApiTags` and, where it takes input, `ApiZodBody` / `ApiZodQuery`.
- **P02** should decorate its protected routes with `@ApiBearerAuth(BEARER_AUTH_NAME)` and
  revisit AC3 above.
- Migrating `packages/shared` to `zod/v4` would let `zodToOpenApi` be deleted in favour of
  `z.toJSONSchema()`. Worth doing on its own, not as a side effect of something else.
