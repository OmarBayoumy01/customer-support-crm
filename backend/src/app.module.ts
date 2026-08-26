import { Module } from '@nestjs/common';

import { AuditModule } from './audit/index.js';
import { AuthModule, TokenRevocationModule } from './auth/index.js';
import { CategoriesModule } from './categories/index.js';
import { CommonModule } from './common/index.js';
import { CustomersModule } from './customers/index.js';
import { TicketsModule } from './tickets/index.js';
import { TypedConfigModule } from './config/index.js';
import { HealthModule } from './health/health.module.js';
import { PermissionsModule } from './permissions/index.js';
import { PrismaModule } from './prisma/index.js';
import { SlaModule } from './sla/index.js';
import { RedisModule } from './redis/index.js';

/**
 * Deliberately minimal.
 *
 * `CommonModule` (US-7) carries the global validation pipe, exception filter,
 * response envelope, and request-id middleware. They are registered there as
 * `APP_*` providers rather than in `index.ts`, because they need injection.
 *
 * `PrismaModule` is global and comes before `HealthModule`, which depends on it.
 *
 * Domain modules (users, customers, tickets, sla, notifications) are NOT
 * scaffolded here. Each is created by the story that owns its behaviour —
 * empty modules are cargo-cult structure that costs review time and hides which
 * parts of the system actually exist.
 *
 * `AuthModule` (US-14) registers a **global** `APP_GUARD`, so importing it is
 * what makes every route in the application require a token unless it is marked
 * `@Public()`. Removing it does not merely remove login; it silently opens the
 * whole API.
 */
@Module({
  imports: [
    TypedConfigModule,
    CommonModule,
    PrismaModule,
    RedisModule,
    // Before Permissions: RolesService revokes tokens on a role change (US-16,
    // AC4), and this is global so it must be registered first.
    TokenRevocationModule,
    // After Prisma and Redis, both of which it depends on.
    PermissionsModule,
    // After Permissions, whose resolved set the login response carries.
    AuthModule,
    AuditModule,
    SlaModule,
    CustomersModule,
    CategoriesModule,
    TicketsModule,
    HealthModule,
  ],
})
export class AppModule {}
