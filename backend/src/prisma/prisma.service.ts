import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { TypedConfigService } from '../config/index.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { softDeleteExtension } from './soft-delete.extension.js';

/**
 * The single seam between the application and PostgreSQL.
 *
 * Prisma 7 removed the Rust query engine: the client no longer opens
 * connections itself and requires a driver adapter. That is why the `pg.Pool`
 * is constructed here and owned here — it is our pool, and it is ours to close.
 *
 * Extending `PrismaClient` keeps `prisma.someModel.findMany(...)` available at
 * the call site. That matters for the project rule that scoped permissions are
 * applied *in the query* rather than by filtering after fetching everything:
 * callers need the real query builder, not a narrowed wrapper around it.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor(config: TypedConfigService) {
    // Built before `super()` because the adapter — and therefore the pool — is
    // a constructor argument to PrismaClient.
    const pool = new Pool({
      connectionString: config.get('DATABASE_URL'),
      max: config.get('DATABASE_POOL_SIZE'),
      connectionTimeoutMillis: config.get('DATABASE_CONNECTION_TIMEOUT_MS'),
    });

    super({ adapter: new PrismaPg(pool) });

    this.pool = pool;

    // An idle-client error with no listener is an unhandled 'error' event,
    // which takes the whole process down. Log it and let pg discard the broken
    // client — never swallow it, never crash on it.
    this.pool.on('error', (error: Error) => {
      this.logger.error(`Idle database client error: ${error.message}`);
    });
  }

  /**
   * The same client with soft-deleted rows filtered out. **Use this for every
   * ordinary read.**
   *
   *   this.prisma.notDeleted.ticket.findMany()   // live tickets
   *   this.prisma.ticket.findMany()              // includes deleted rows
   *
   * Reaching for the unfiltered client is legitimate — restoring a record, an
   * administrative export, a hard-delete job — but it should be a decision
   * someone made, which is why it is the longer-looking path rather than the
   * default. See soft-delete.extension.ts for what is and is not covered.
   */
  readonly notDeleted = this.$extends(softDeleteExtension);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(`Connected to PostgreSQL (pool max ${String(this.poolSize())})`);
  }

  /**
   * `$disconnect()` alone is NOT enough on Prisma 7 — after it resolves the pg
   * pool still holds every open connection, because the pool is ours and not
   * Prisma's. Ending it here is what keeps AC4's "released rather than leaked"
   * true on shutdown.
   *
   * Reached only because `index.ts` calls `app.enableShutdownHooks()`.
   *
   * Guarded because `pool.end()` throws "Called end on pool more than once" on
   * a second call, and shutdown is exactly the path where a double call is
   * plausible — a SIGTERM arriving while an explicit `app.close()` is already
   * in flight. Shutting down twice should be a no-op, not a crash.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.pool.ending || this.pool.ended) {
      return;
    }

    await this.$disconnect();
    await this.pool.end();
  }

  /** Pool telemetry, for the health endpoint and the pooling test. */
  poolStats(): { total: number; idle: number; waiting: number } {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  /** The configured ceiling, as opposed to the current count. */
  poolSize(): number {
    return this.pool.options.max ?? 0;
  }
}
