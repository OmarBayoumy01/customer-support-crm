import { Module } from '@nestjs/common';

import { TypedConfigModule } from './config/index.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/index.js';

/**
 * Deliberately minimal. US-7 attaches the global validation pipe, exception
 * filter, and response interceptor in `index.ts`, not by decorating this module.
 *
 * `PrismaModule` is global and comes before `HealthModule`, which depends on it.
 *
 * Domain modules (auth, users, customers, tickets, sla, notifications) are NOT
 * scaffolded here. Each is created by the story that owns its behaviour —
 * empty modules are cargo-cult structure that costs review time and hides which
 * parts of the system actually exist.
 */
@Module({ imports: [TypedConfigModule, PrismaModule, HealthModule] })
export class AppModule {}
