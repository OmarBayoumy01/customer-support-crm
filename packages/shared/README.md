# `@crm/shared`

DTOs and Zod schemas consumed by both `backend/` and `frontend/`. A contract is defined
here **once**, and both sides import the same TypeScript type.

## What does not belong here

No authorisation logic, no permission checks, no data access, no business rules.

The server is the security boundary (see `CLAUDE.md`). Everything in this package is, by
definition, code the browser can read. A schema here describes the _shape_ of a payload —
it never decides who is allowed to see it.

## Customer-facing vs internal shapes

When a resource has both a customer-facing and an internal-only form, define **two
separate schemas**. Do not define one schema with optional internal fields: that makes it
possible to leak an internal note by forgetting to strip a field, and internal notes must
never reach a customer.

## Zod version

Every workspace must stay on the same `zod` major. Two copies of Zod in one tree make
`instanceof` checks fail and produce validation errors that make no sense. If you bump it
here, bump it in `backend/` and `frontend/` in the same commit.
