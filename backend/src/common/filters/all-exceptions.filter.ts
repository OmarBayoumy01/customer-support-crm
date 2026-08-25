import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiError, ApiErrorCode, FieldError } from '@crm/shared';
import type { Response } from 'express';
import { ZodError } from 'zod';

import { Prisma } from '../../generated/prisma/client.js';
import { ApiException, statusForCode } from '../errors/api.exception.js';
import { RequestContextService } from '../request-context/request-context.service.js';
import { formatZodIssues } from '../validation/zod-validation.pipe.js';

interface Normalised {
  status: number;
  code: ApiErrorCode;
  message: string;
  details?: FieldError[];
  /** What goes in the log but never on the wire. */
  internal?: string;
}

/**
 * Best-effort mapping for Nest's own exceptions, which carry no code.
 *
 * A lookup rather than a switch: `HttpException.getStatus()` returns a plain
 * `number`, and comparing that against `HttpStatus` enum members is exactly the
 * unsafe-enum-comparison the lint rules reject.
 */
const CODE_BY_STATUS = new Map<number, ApiErrorCode>([
  [HttpStatus.BAD_REQUEST, 'BAD_REQUEST'],
  [HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED'],
  [HttpStatus.FORBIDDEN, 'FORBIDDEN'],
  [HttpStatus.NOT_FOUND, 'NOT_FOUND'],
  [HttpStatus.CONFLICT, 'CONFLICT'],
  [HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE'],
  [HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED'],
  [HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE'],
]);

function codeForStatus(status: number): ApiErrorCode {
  return CODE_BY_STATUS.get(status) ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
}

/**
 * Turns Prisma's error codes into something a client can act on.
 *
 * The messages are deliberately generic. Prisma's own text names the table, the
 * column, and sometimes the value — all of which is internal schema detail that
 * AC4 says must not cross the wire. It goes to the log instead.
 */
function fromPrisma(error: Prisma.PrismaClientKnownRequestError): Normalised {
  const internal = `Prisma ${error.code}: ${error.message.replace(/\s+/g, ' ').trim()}`;

  switch (error.code) {
    case 'P2002':
      return {
        status: 409,
        code: 'CONFLICT',
        message: 'That value is already taken.',
        internal,
      };
    case 'P2003':
      return {
        status: 409,
        code: 'CONFLICT',
        message: 'That change would break a related record.',
        internal,
      };
    case 'P2025':
      return { status: 404, code: 'NOT_FOUND', message: 'The record was not found.', internal };
    default:
      return {
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side.',
        internal,
      };
  }
}

/**
 * The one place an error becomes a response (AC2, AC4).
 *
 * Every failure — thrown by us, thrown by Nest, thrown by Prisma, or thrown by
 * something nobody anticipated — leaves through here in the same shape, and
 * nothing internal leaves with it. The full detail, stack included, is logged
 * server-side against the request id.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly context: RequestContextService) {}

  private normalise(exception: unknown): Normalised {
    if (exception instanceof ApiException) {
      return {
        status: statusForCode(exception.code),
        code: exception.code,
        message: exception.message,
        ...(exception.details === undefined ? {} : { details: exception.details }),
      };
    }

    // A ZodError that escaped a service rather than the pipe — still the
    // caller's problem, and still worth reporting per field.
    if (exception instanceof ZodError) {
      return {
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'The request failed validation.',
        details: formatZodIssues(exception),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return fromPrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: 400,
        code: 'BAD_REQUEST',
        message: 'The request could not be processed.',
        internal: exception.message.replace(/\s+/g, ' ').trim(),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload: unknown = exception.getResponse();

      // Nest puts either a string or `{ message, error, statusCode }` here.
      const message =
        typeof payload === 'string'
          ? payload
          : typeof payload === 'object' && payload !== null && 'message' in payload
            ? String(payload.message)
            : exception.message;

      return { status, code: codeForStatus(status), message };
    }

    return {
      status: 500,
      code: 'INTERNAL_ERROR',
      // AC4: the client is told nothing useful to an attacker, and nothing
      // useless to a user. The request id is what they quote to support.
      message: 'Something went wrong on our side.',
      internal:
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
    };
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = this.context.requestId();
    const normalised = this.normalise(exception);

    // Server faults are errors; client mistakes are not. Logging a 404 at error
    // level trains people to ignore the error log.
    const logLine = `${String(normalised.status)} ${normalised.code} — ${normalised.message}${
      normalised.internal === undefined ? '' : ` | ${normalised.internal}`
    }`;

    if (normalised.status >= 500) {
      this.logger.error(logLine);
    } else {
      this.logger.warn(logLine);
    }

    const body: ApiError = {
      error: {
        statusCode: normalised.status,
        code: normalised.code,
        message: normalised.message,
        ...(normalised.details === undefined ? {} : { details: normalised.details }),
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    response.status(normalised.status).json(body);
  }
}
