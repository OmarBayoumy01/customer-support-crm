/**
 * Injection token for the application's `StructuredLogger`.
 *
 * A token rather than the class, because the same instance is handed to
 * `app.useLogger()` in `index.ts` and injected into the request-logging
 * middleware. Two instances would mean two configured levels and two sinks,
 * and they would drift.
 */
export const STRUCTURED_LOGGER = Symbol('STRUCTURED_LOGGER');
