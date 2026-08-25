import { HttpException } from '@nestjs/common';
import type { ApiErrorCode, FieldError } from '@crm/shared';

/** The HTTP status each error code answers with, in one place. */
const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 422,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export function statusForCode(code: ApiErrorCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * The exception the application throws.
 *
 * Carrying the machine-readable code with the exception means the filter never
 * has to guess one from an HTTP status — a 409 could be a duplicate email or a
 * bad state transition, and the frontend needs to tell those apart.
 *
 * Nest's built-in `NotFoundException` and friends still work; the filter maps
 * them onto codes on a best-effort basis. Prefer this one in new code.
 */
export class ApiException extends HttpException {
  readonly code: ApiErrorCode;
  readonly details: FieldError[] | undefined;

  constructor(code: ApiErrorCode, message: string, details?: FieldError[]) {
    super(message, statusForCode(code));
    this.code = code;
    this.details = details;
  }

  static notFound(what: string): ApiException {
    return new ApiException('NOT_FOUND', `${what} was not found.`);
  }

  static conflict(message: string): ApiException {
    return new ApiException('CONFLICT', message);
  }

  static forbidden(message = 'You do not have permission to do that.'): ApiException {
    return new ApiException('FORBIDDEN', message);
  }

  static unprocessable(message: string, details?: FieldError[]): ApiException {
    return new ApiException('UNPROCESSABLE', message, details);
  }
}
