import { z } from 'zod';

/** Guard rail: a caller cannot ask for ten thousand rows in one page. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/**
 * The query string every list endpoint accepts.
 *
 * Coerced because query parameters arrive as strings, and clamped rather than
 * rejected on `pageSize` — a client asking for 500 rows gets 100 and a correct
 * `pagination` block, which is friendlier than a 422 and just as safe.
 */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_PAGE_SIZE)
    .transform((value) => Math.min(value, MAX_PAGE_SIZE)),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Turns a validated page/pageSize into the `skip`/`take` a database query
 * wants, so that arithmetic is written once instead of in every list handler.
 */
export function toSkipTake(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}
