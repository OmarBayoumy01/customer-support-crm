import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

/**
 * Liveness and dependency reporting.
 *
 * As of **US-5** this reports the process *and* PostgreSQL. `PrismaService`
 * comes from the global `PrismaModule`, so nothing needs importing here.
 *
 * **US-10 adds Redis** by injecting its client into `HealthService` and pushing
 * one more entry into the `dependencies` map — `critical: false`, because the
 * platform can serve requests with a cold cache. It does not touch the DTO:
 * `dependencies` is the extension point, and that is why it is a keyed map
 * rather than a fixed set of fields.
 *
 * Note for anyone reading an older version of this file: the previous comment
 * claimed the response shape would never change. It did change, in US-5 — the
 * phase exit criteria require `/health` to report database and Redis state, and
 * the flat DTO had nowhere to put it.
 *
 * Still deliberately NOT using `@nestjs/terminus`. Two dependencies checked by
 * one small service is less machinery than a health-indicator framework, and
 * the response is already a shared DTO the frontend can consume directly.
 */
@Module({ controllers: [HealthController], providers: [HealthService] })
export class HealthModule {}
