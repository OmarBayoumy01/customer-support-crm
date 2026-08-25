import { Injectable, Logger } from '@nestjs/common';
import { HealthStatusSchema, type DependencyStatus, type HealthStatus } from '@crm/shared';

import { PrismaService } from '../prisma/index.js';

/**
 * One dependency's entry in the health payload, plus whether the service can
 * usefully serve traffic without it.
 */
interface DependencyCheck {
  readonly name: string;
  readonly critical: boolean;
  readonly result: DependencyStatus;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `SELECT 1` rather than a model query: it proves the connection and the
   * round trip without depending on any table existing, so it keeps working
   * across US-6's schema changes.
   */
  private async checkDatabase(): Promise<DependencyCheck> {
    const startedAt = performance.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        name: 'database',
        critical: true,
        result: { status: 'up', latencyMs: Math.round(performance.now() - startedAt) },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // Logged, never swallowed. The endpoint still answers — reporting the
      // service as down is the whole point of a health check, so a failure here
      // must not become a 500.
      this.logger.error(`Database health check failed: ${message}`);

      return {
        name: 'database',
        critical: true,
        result: {
          status: 'down',
          latencyMs: Math.round(performance.now() - startedAt),
          error: message,
        },
      };
    }
  }

  async check(): Promise<HealthStatus> {
    // US-10 adds `this.checkRedis()` to this array, with `critical: false`.
    const checks = [await this.checkDatabase()];

    const dependencies: Record<string, DependencyStatus> = {};
    for (const check of checks) {
      dependencies[check.name] = check.result;
    }

    const down = checks.filter((check) => check.result.status === 'down');
    const status = down.some((check) => check.critical)
      ? 'down'
      : down.length > 0
        ? 'degraded'
        : 'ok';

    // Parsing on the way out is deliberate: the endpoint cannot drift from the
    // shared DTO without failing loudly, and the frontend consumes the same type.
    return HealthStatusSchema.parse({
      status,
      service: 'backend',
      timestamp: new Date().toISOString(),
      dependencies,
    });
  }
}
