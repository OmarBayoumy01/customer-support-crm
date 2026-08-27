import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { ApiException } from '../common/index.js';

/**
 * Authentication for portal routes — US-82, AC4.
 *
 * **This must be applied together with `@Public()`, and the pairing is a
 * foot-gun worth naming.** `JwtAuthGuard` is registered globally as an
 * `APP_GUARD` and is pinned to the `crm-staff` audience, so without `@Public()`
 * a portal route would be checked by the staff strategy and every portal token
 * refused. But `@Public()` on its own would leave the route open to the
 * internet — so the two go on the controller class together, and
 * `portal.test.ts` asserts that an unauthenticated portal request is 401.
 *
 * That test is the thing standing between a future refactor and an open
 * endpoint. If it ever fails, the endpoint is public.
 */
@Injectable()
export class PortalAuthGuard extends AuthGuard('jwt-portal') {
  /**
   * The project's error envelope rather than Passport's bare 401, so a portal
   * client sees the same shape as everything else — `code: 'UNAUTHENTICATED'`
   * and a request id.
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
