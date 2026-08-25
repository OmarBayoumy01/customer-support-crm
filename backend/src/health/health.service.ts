import { Injectable, Logger } from '@nestjs/common';
import { HealthStatusSchema, type DependencyStatus, type HealthStatus } from '@crm/shared';

import { PrismaService } from '../prisma/index.js';
import { RedisService } from '../redis/index.js';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Runs one probe, timing it and turning a thrown error into a reported
   * failure rather than an exception. Shared by both checks so the timing and
   * the error handling cannot drift between them.
   */
  private async probe(
    name: string,
    critical: boolean,
    run: () => Promise<unknown>,
  ): Promise<DependencyCheck> {
    const startedAt = performance.now();

    try {
      await run();

      return {
        name,
        critical,
        result: { status: 'up', latencyMs: Math.round(performance.now() - startedAt) },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // Logged, never swallowed. The endpoint still answers — reporting a
      // dependency as down is the whole point of a health check, so a failure
      // here must not become a 500.
      this.logger.error(`${name} health check failed: ${message}`);

      return {
        name,
        critical,
        result: {
          status: 'down',
          latencyMs: Math.round(performance.now() - startedAt),
          error: message,
        },
      };
    }
  }

  async check(): Promise<HealthStatus> {
    const checks = await Promise.all([
      // `SELECT 1` rather than a model query: it proves the connection and the
      // round trip without depending on any table existing.
      this.probe('database', true, () => this.prisma.$queryRaw`SELECT 1`),

      // Redis is NOT critical. The cache degrades, the queue backs up, but the
      // platform still answers requests — so a Redis outage is `degraded`, not
      // `down`. That distinction is what stops a cache blip from taking the
      // service out of a load balancer.
      this.probe('redis', false, async () => {
        if (!this.redis.isReady()) {
          throw new Error('Redis is not connected');
        }

        return this.redis.ping();
      }),
    ]);

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
