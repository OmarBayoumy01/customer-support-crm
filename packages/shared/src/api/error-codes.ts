import { z } from 'zod';

/**
 * The machine-readable half of every error response.
 *
 * The frontend switches on these, so they are a contract: renaming one is a
 * breaking change. The human `message` beside it is for people and may be
 * reworded freely — that split is the whole point of having both.
 */
export const ApiErrorCodeSchema = z.enum([
  /** A request body, query, or param failed schema validation. 422. */
  'VALIDATION_FAILED',
  /** Syntactically fine but semantically wrong — a malformed id, say. 400. */
  'BAD_REQUEST',
  /** No credentials, or credentials that did not check out. 401. */
  'UNAUTHENTICATED',
  /** Authenticated, but not allowed to do this. 403. */
  'FORBIDDEN',
  /** The thing asked for does not exist, or is not visible to this caller. 404. */
  'NOT_FOUND',
  /** A unique constraint, a stale version, a state transition that is not legal. 409. */
  'CONFLICT',
  /** Well-formed and understood, but refused by a business rule. 422. */
  'UNPROCESSABLE',
  /**
   * Too many requests. 429. Raised by the login throttle (US-14, AC5); P15 will
   * add general-purpose rate limiting on top of the same code.
   */
  'RATE_LIMITED',
  /** Anything unhandled. The client is told nothing more than this. 500. */
  'INTERNAL_ERROR',
  /** A dependency the service needs is down. 503. */
  'SERVICE_UNAVAILABLE',
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
