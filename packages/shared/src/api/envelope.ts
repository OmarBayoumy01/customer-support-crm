import { z } from 'zod';

import { ApiErrorCodeSchema } from './error-codes.js';

/**
 * One field that failed validation.
 *
 * `path` is dotted and array-indexed the way Zod reports it —
 * `"items.0.quantity"` — so a form library can map it straight back onto the
 * input that produced it.
 */
export const FieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export type FieldError = z.infer<typeof FieldErrorSchema>;

/**
 * The error envelope. Every failed request returns exactly this, whatever went
 * wrong and wherever it went wrong.
 *
 * `requestId` is on the error rather than only in the headers on purpose: it is
 * the thing a user reads out over the phone, so it has to survive being
 * screenshotted.
 */
export const ApiErrorSchema = z.object({
  error: z.object({
    statusCode: z.number().int().min(100).max(599),
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    /** Present for validation failures; absent otherwise. */
    details: z.array(FieldErrorSchema).optional(),
    requestId: z.string().min(1),
    timestamp: z.string().datetime(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Pagination metadata, returned alongside every list.
 *
 * `page` is 1-based because it is a user-facing number that ends up in a URL
 * and in a "page 3 of 12" label; a 0-based page number in a query string is a
 * bug generator.
 */
export const PaginationMetaSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasNext: z.boolean(),
  hasPrevious: z.boolean(),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/**
 * The success envelope for a single resource: `{ data: T }`.
 *
 * A factory rather than a fixed schema, because the payload type differs per
 * endpoint and we want the parsed result typed rather than `unknown`.
 */
export function apiSuccessSchema<T extends z.ZodTypeAny>(
  data: T,
): z.ZodObject<{ data: T }, 'strip'> {
  return z.object({ data });
}

/** The success envelope for a list: `{ data: T[], pagination }`. */
export function apiPaginatedSchema<T extends z.ZodTypeAny>(
  item: T,
): z.ZodObject<{ data: z.ZodArray<T>; pagination: typeof PaginationMetaSchema }, 'strip'> {
  return z.object({ data: z.array(item), pagination: PaginationMetaSchema });
}

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiPaginated<T> {
  data: T[];
  pagination: PaginationMeta;
}

/**
 * Builds the pagination block from the three numbers a query actually produces,
 * so `totalPages`, `hasNext`, and `hasPrevious` cannot drift apart by being
 * computed differently at each call site.
 */
export function buildPaginationMeta(input: {
  page: number;
  pageSize: number;
  total: number;
}): PaginationMeta {
  const totalPages = input.pageSize > 0 ? Math.ceil(input.total / input.pageSize) : 0;

  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    totalPages,
    hasNext: input.page < totalPages,
    hasPrevious: input.page > 1 && input.total > 0,
  };
}
