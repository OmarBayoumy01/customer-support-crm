import { Prisma } from '../generated/prisma/client.js';

/**
 * Models that carry a `deletedAt` column. Append-only tables (TicketHistory,
 * AuditLog) and pure join tables are deliberately absent — they are never soft
 * deleted, so filtering them would be a lie.
 *
 * Listed explicitly rather than inferred at runtime: a new model with a
 * `deletedAt` column must be added here consciously, and a reviewer can see at
 * a glance which tables the filter applies to.
 */
const SOFT_DELETABLE = new Set<string>([
  'User',
  'Branch',
  'Department',
  'Customer',
  'Category',
  'Ticket',
  'Message',
  'Attachment',
  'SlaPolicy',
  'Task',
  'KnowledgeArticle',
]);

/** Read operations that take a `where` and should never see deleted rows. */
const FILTERED_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * Excludes soft-deleted rows from ordinary reads.
 *
 * Prisma has no built-in soft delete, and the alternative — asking forty later
 * stories to remember `where: { deletedAt: null }` — fails the first time
 * someone forgets, silently, by showing a deleted customer to an agent.
 *
 * Applied through `PrismaService.notDeleted`, so the escape hatch is explicit:
 *
 *   prisma.notDeleted.ticket.findMany()   // live tickets — the normal case
 *   prisma.ticket.findMany()              // everything, including deleted
 *
 * Two deliberate limits, both of which keep this predictable rather than clever:
 *
 *   - `findUnique` is NOT filtered. Prisma only accepts unique fields in its
 *     `where`, so `deletedAt` cannot be added there. Fetching a row by id and
 *     checking `deletedAt` yourself is the honest way to do that lookup.
 *   - Nested relation reads are NOT filtered. `include: { messages: true }`
 *     returns deleted messages too. Filter the relation explicitly when it
 *     matters; a nested rewrite would have to walk arbitrarily deep `include`
 *     trees, and a filter that is right most of the time is worse than one with
 *     a documented edge.
 */
export const softDeleteExtension = Prisma.defineExtension({
  name: 'notDeleted',
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        if (!SOFT_DELETABLE.has(model) || !FILTERED_OPERATIONS.has(operation)) {
          return query(args);
        }

        const typed = args as { where?: Record<string, unknown> };

        return query({
          ...args,
          where: { ...(typed.where ?? {}), deletedAt: null },
        });
      },
    },
  },
});
