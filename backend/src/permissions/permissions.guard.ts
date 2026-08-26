import { Injectable, Logger, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PermissionKey } from '@crm/shared';

import { ApiException } from '../common/index.js';
import { PermissionsService } from './permissions.service.js';
import { REQUIRED_PERMISSION } from './require-permission.decorator.js';

/** What `JwtStrategy.validate` attached. Structural, to avoid importing auth. */
interface AuthenticatedRequest extends Request {
  user?: { userId: string };
}

/**
 * Enforces `@RequirePermission()` — US-22.
 *
 * Registered globally, after `JwtAuthGuard`, so the caller is already known by
 * the time this runs. A route with no `@RequirePermission()` passes: this guard
 * answers "may they do *this particular thing*", and authentication — the
 * deny-by-default half, AC4 — is `JwtAuthGuard`'s job and already settled
 * before this is reached.
 *
 * **It answers 403, never 404.** Hiding existence behind a 404 is a reasonable
 * pattern, but it belongs to the handler that knows whether the record exists;
 * a guard that has not looked anything up cannot honestly claim it is missing.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey | undefined>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()],
    );

    if (required === undefined) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.userId;

    if (userId === undefined) {
      // A route that requires a permission but was somehow reached without
      // authentication. Should be unreachable — `JwtAuthGuard` runs first — so
      // this is a fail-closed backstop rather than an expected path.
      throw new ApiException('UNAUTHENTICATED', 'Authentication is required.');
    }

    // Cached in Redis by US-13, so this is not three joins per request.
    if (await this.permissions.can(userId, required)) {
      return true;
    }

    // AC5 — user, endpoint, and (via the structured logger) timestamp and
    // request id. This is the line somebody greps when an agent reports that a
    // button does nothing.
    this.logger.warn(
      `Permission denied: user ${userId} lacks ${required} for ${request.method} ${request.originalUrl}`,
    );

    throw ApiException.forbidden();
  }
}
