import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { NO_ENVELOPE } from '../decorators/no-envelope.decorator.js';

/** True when the handler already returned `{ data, pagination? }` itself. */
function isAlreadyEnveloped(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'data' in value;
}

/**
 * Wraps every successful response in `{ data: ... }` (AC1).
 *
 * List endpoints build their own `{ data, pagination }` with
 * `buildPaginationMeta` and are passed through untouched — detected by the
 * presence of `data`, so a handler that has already enveloped its result is
 * never double-wrapped.
 *
 * `@NoEnvelope()` opts a route out entirely, for the cases where a caller is
 * not ours to reshape: file downloads, a webhook that must answer in a
 * provider's format, a redirect.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const optedOut = this.reflector.getAllAndOverride<boolean>(NO_ENVELOPE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (optedOut === true) {
      return next.handle();
    }

    return next.handle().pipe(
      map((value: unknown) => {
        if (value === undefined) {
          // A 204 handler returns nothing; giving it `{ data: undefined }`
          // would serialise to `{}` and imply a body that is not there.
          return value;
        }

        return isAlreadyEnveloped(value) ? value : { data: value };
      }),
    );
  }
}
