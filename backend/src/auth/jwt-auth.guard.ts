import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Observable } from 'rxjs';

import { ApiException } from '../common/index.js';
import { IS_PUBLIC } from './decorators/public.decorator.js';

/**
 * Authentication for every route that has not opted out — US-14.
 *
 * Registered globally in `AuthModule` as an `APP_GUARD`. Global-and-opt-out
 * rather than opt-in, because the two failure modes are not equally bad: a
 * forgotten `@Public()` is a 401 somebody hits in development, while a
 * forgotten `@UseGuards()` is an endpoint open to the internet that nobody
 * notices until it matters.
 *
 * This is authentication only — *who* the caller is. Authorisation, meaning
 * what they may do, is US-22 on top of `PermissionsService`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      // Handler first, so a public route inside an otherwise protected
      // controller works — and so does the reverse.
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    return super.canActivate(context);
  }

  /**
   * Replaces Passport's bare `UnauthorizedException` with the project's own, so
   * a missing token comes back in the same error envelope as everything else —
   * `code: 'UNAUTHENTICATED'`, a request id, the lot. A client that has to
   * special-case the shape of auth failures is a client that will get it wrong.
   */
  override handleRequest<TUser>(error: unknown, user: TUser): TUser {
    if (error !== null && error !== undefined) {
      throw error instanceof ApiException
        ? error
        : new ApiException('UNAUTHENTICATED', 'Authentication is required.');
    }

    if (user === false || user === null || user === undefined) {
      throw new ApiException('UNAUTHENTICATED', 'Authentication is required.');
    }

    return user;
  }
}
