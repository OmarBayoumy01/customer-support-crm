import { Module } from '@nestjs/common';

import { CommonModule } from './common/index.js';
import { TypedConfigModule } from './config/index.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/index.js';
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
 * Domain modules (auth, users, customers, tickets, sla, notifications) are NOT
 * scaffolded here. Each is created by the story that owns its behaviour —
 * empty modules are cargo-cult structure that costs review time and hides which
 * parts of the system actually exist.
 */
@Module({ imports: [TypedConfigModule, CommonModule, PrismaModule, RedisModule, HealthModule] })
export class AppModule {}
