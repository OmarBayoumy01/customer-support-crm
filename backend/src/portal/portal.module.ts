import { Module } from '@nestjs/common';

import { TokenRevocationModule } from '../auth/token-revocation.module.js';
import { CategoriesModule } from '../categories/index.js';
import { TicketsModule } from '../tickets/index.js';
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
 * the moment it is signed out, exactly as a staff one does. `TicketsModule` and
 * `CategoriesModule` are imported for their **business rules** — the sequential
 * number, the SLA clock, the active-category list — and for no authorisation:
 * the portal resolves its own scope and never consults a permission.
 */
@Module({
  imports: [TokenRevocationModule, CategoriesModule, TicketsModule],
  controllers: [PortalController],
  providers: [PortalJwtStrategy, PortalAuthGuard, PortalService, PortalThrottleService],
  exports: [PortalService],
})
export class PortalModule {}
