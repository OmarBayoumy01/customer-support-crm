import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';

/**
 * Liveness endpoint.
 *
 * Today it reports only that the process is up: there is no database and no
 * Redis yet. The story's technical notes ask for dependency connectivity, and
 * that arrives with the dependencies themselves —
 *
 *   - US-5 registers a PostgreSQL check here
 *   - US-10 registers a Redis check here
 *
 * When either lands, the controller aggregates results: `status` becomes
 * `'degraded'` when a non-critical dependency is down and `'down'` when a
 * critical one is. The shape returned to callers does not change, because it is
 * already the shared `HealthStatus` DTO.
 *
 * Deliberately NOT using `@nestjs/terminus` yet — wiring health indicators to
 * services that cannot run would be untestable scaffolding.
 */
@Module({ controllers: [HealthController] })
export class HealthModule {}
