import { Module } from '@nestjs/common';

import { TypedConfigModule } from './config/index.js';
import { HealthModule } from './health/health.module.js';

/**
 * Deliberately minimal. US-7 attaches the global validation pipe, exception
 * filter, and response interceptor in `index.ts`, not by decorating this module.
 *
 * Domain modules (auth, users, customers, tickets, sla, notifications) are NOT
 * scaffolded here. Each is created by the story that owns its behaviour —
 * empty modules are cargo-cult structure that costs review time and hides which
 * parts of the system actually exist.
 */
@Module({ imports: [TypedConfigModule, HealthModule] })
export class AppModule {}
