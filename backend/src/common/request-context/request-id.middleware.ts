import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { RequestContextService } from './request-context.service.js';

/** The header we read on the way in and always write on the way out. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Log lines and headers carry this; a caller must not be able to stuff it. */
const MAX_LENGTH = 128;

function sanitise(candidate: string | undefined): string | undefined {
  if (candidate === undefined || candidate === '') {
    return undefined;
  }

  const cleaned = candidate.replace(/[^A-Za-z0-9._-]/g, '').slice(0, MAX_LENGTH);

  return cleaned === '' ? undefined : cleaned;
}

/**
 * Mints a request id, echoes it in the response headers, and opens the async
 * context that everything downstream reads from (AC5).
 *
 * An inbound `x-request-id` is honoured rather than overwritten, so a trace
 * started by a gateway or by the frontend survives into our logs. It is
 * stripped to url-safe characters and length-capped first.
 *
 * `next()` is called *inside* `run()`, so every handler, pipe, filter, and
 * logger call underneath this request sees the same context.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContextService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = sanitise(request.header(REQUEST_ID_HEADER)) ?? randomUUID();

    response.setHeader(REQUEST_ID_HEADER, requestId);

    this.context.run({ requestId, method: request.method, path: request.originalUrl }, () => {
      next();
    });
  }
}
