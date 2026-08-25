import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { STRUCTURED_LOGGER } from './logger.token.js';
import { redactText } from './redact.js';
import type { StructuredLogger } from './structured-logger.js';

/**
 * Logs one line per completed request: method, path, status, duration (AC2).
 *
 * Hooked to the response's `finish` event rather than implemented as an
 * interceptor, because an interceptor only sees requests that reached a
 * handler. A 404 on an unmatched route, a request rejected by validation, and
 * one that blew up in the exception filter are all still requests someone will
 * want to find in the log.
 *
 * Must run **after** `RequestIdMiddleware`, so the async context exists and the
 * line carries the same id as the response header.
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(@Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      // A failed request is not an application error — the filter has already
      // logged the cause at the right level. This line is the access log, so a
      // 4xx is a warning and a 5xx an error only in the sense of being findable.
      const level =
        response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info';

      this.logger.emit(level, 'request completed', {
        method: request.method,
        // Redacted, because a badly built client will eventually put a token in
        // a query string and the access log is the last place it should land.
        path: redactText(request.originalUrl),
        statusCode: response.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        ip: request.ip,
        userAgent: request.header('user-agent'),
      });
    });

    next();
  }
}
