import type { PermissionScope } from '@crm/shared';

import type { Prisma } from '../generated/prisma/client.js';

/**
 * Who is asking. Everything a scope needs to narrow a query, and nothing else.
 */
export interface ScopeContext {
  readonly userId: string;
  /** The user's department, for `TEAM`. Null for a portal customer. */
  readonly departmentId: string | null;
}

/**
 * A `where` fragment that matches nothing.
 *
 * Returned when a scope cannot be satisfied — `TEAM` for a user with no
 * department, say. **Deliberately not `{}`**: an empty object matches
 * *everything*, so a bug that reaches for "no filter" when it means "no access"
 * would hand out the entire table. `id: { in: [] }` fails closed.
 */
const MATCHES_NOTHING: Prisma.TicketWhereInput = { id: { in: [] } };

/**
 * Turns the scopes a user holds for a ticket permission into a Prisma `where`.
 *
 * This is the concrete form of the project's second non-negotiable rule:
 * scoped permissions are applied **in the database query**, never by fetching
 * everything and filtering afterwards. A caller composes the result into its
 * own query with `AND`, and the database does the narrowing.
 *
 *   ALL       no filter — every ticket
 *   TEAM      tickets in the user's department
 *   ASSIGNED  tickets assigned to the user — their queue (AC3)
 *   OWN       tickets raised for the customer this user is
 *
 * Multiple scopes are **OR-ed**, because holding `ASSIGNED` from one role and
 * `OWN` from another genuinely means both sets. `ALL` short-circuits: there is
 * no narrower answer than "everything", and OR-ing it with anything else is
 * still everything.
 */
export function ticketScopeWhere(
  scopes: readonly PermissionScope[],
  context: ScopeContext,
): Prisma.TicketWhereInput {
  if (scopes.length === 0) {
    // No scope means no grant. Fail closed.
    return MATCHES_NOTHING;
  }

  if (scopes.includes('ALL')) {
    return {};
  }

  const clauses: Prisma.TicketWhereInput[] = [];

  for (const scope of scopes) {
    switch (scope) {
      case 'TEAM':
        // A user with no department cannot have a team, so this contributes
        // nothing rather than matching every ticket with a null department.
        if (context.departmentId !== null) {
          clauses.push({ departmentId: context.departmentId });
        }
        break;

      case 'ASSIGNED':
        clauses.push({ assigneeId: context.userId });
        break;

      case 'OWN':
        // A portal customer's own tickets, reached through the Customer record
        // their login is linked to.
        clauses.push({ customer: { userId: context.userId } });
        break;

      case 'ALL':
        // Handled above; unreachable.
        break;
    }
  }

  if (clauses.length === 0) {
    return MATCHES_NOTHING;
  }

  return clauses.length === 1 ? (clauses[0] ?? MATCHES_NOTHING) : { OR: clauses };
}

/**
 * True when the scopes amount to unrestricted access, so a caller can skip
 * composing a filter it does not need.
 */
export function isUnrestricted(scopes: readonly PermissionScope[]): boolean {
  return scopes.includes('ALL');
}
