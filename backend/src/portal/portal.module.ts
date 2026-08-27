import { Module } from '@nestjs/common';

import { TokenRevocationModule } from '../auth/token-revocation.module.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalController } from './portal.controller.js';
import { PortalJwtStrategy } from './portal-jwt.strategy.js';
import { PortalService } from './portal.service.js';
import { PortalThrottleService } from './portal-throttle.service.js';

/**
 * The customer-facing surface — US-82.
 *
 * A module of its own, and that separation is the story: the portal has its own
 * controller, its own passport strategy pinned to the `crm-portal` audience, its
 * own DTOs built as an allowlist, and its own rate limit. Nothing here is a
 * variation on a staff endpoint with a flag.
 *
 * `TokenRevocationModule` is imported because a portal session must stop working
 * the moment it is signed out, exactly as a staff one does.
 */
@Module({
  imports: [TokenRevocationModule],
  controllers: [PortalController],
  providers: [PortalJwtStrategy, PortalAuthGuard, PortalService, PortalThrottleService],
  exports: [PortalService],
})
export class PortalModule {}
