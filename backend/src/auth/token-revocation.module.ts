import { Global, Module } from '@nestjs/common';

import { TokenRevocationService } from './token-revocation.service.js';

/**
 * `TokenRevocationService` on its own, global — US-16.
 *
 * Separate from `AuthModule` to break a cycle rather than to organise anything.
 * AC4 says a role change invalidates the session, so `RolesService` — which
 * lives in `PermissionsModule` — has to be able to revoke tokens. If that
 * service were exported from `AuthModule`, then `PermissionsModule` would
 * import `AuthModule` while `AuthModule`'s services inject `PermissionsService`,
 * and the two modules would depend on each other.
 *
 * It is a fair thing to lift out: it depends on Redis and configuration and
 * nothing else in the auth graph.
 */
@Global()
@Module({
  providers: [TokenRevocationService],
  exports: [TokenRevocationService],
})
export class TokenRevocationModule {}
