import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';

import { TypedConfigService } from '../config/index.js';

/**
 * Owns the one Redis connection the application uses for caching.
 *
 * **Redis being down must never take the service down** (AC4). Three settings
 * do the work:
 *
 *   - `lazyConnect` — construction does not dial, so a Redis that is unreachable
 *     at boot cannot fail the module's initialisation.
 *   - `enableOfflineQueue: false` — a command issued while disconnected fails
 *     immediately instead of queueing until some later reconnect. A cache read
 *     that hangs for thirty seconds is worse than one that fails in a
 *     millisecond and falls through to the database.
 *   - `maxRetriesPerRequest: 1` — one retry, then give up and let the caller
 *     degrade.
 *
 * BullMQ needs its own connections with different settings, and creates them
 * itself; see `queue.service.ts`.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  /** Set once a connection has succeeded, so the health check can tell the difference. */
  private everConnected = false;

  constructor(config: TypedConfigService) {
    this.client = new Redis(config.get('REDIS_URL'), {
      keyPrefix: config.get('REDIS_KEY_PREFIX'),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: config.get('REDIS_CONNECT_TIMEOUT_MS'),
      retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
    });

    // Without a listener, ioredis emits 'error' on an unhandled EventEmitter and
    // the process dies. Logged at warn, not error: an unreachable cache is a
    // degradation, and the exception filter has not been asked to do anything.
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis error: ${error.message}`);
    });

    this.client.on('ready', () => {
      this.everConnected = true;
      this.logger.log('Connected to Redis');
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error: unknown) {
      // Deliberately swallowed *after* logging: the service starts without a
      // cache, /health reports Redis as down, and callers degrade. Failing
      // startup here would make Redis a hard dependency, which AC4 says it is not.
      this.logger.warn(
        `Redis is unavailable at startup, continuing without a cache: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Guarded, because shutting down twice must be a no-op rather than a crash —
   * a SIGTERM arriving while an explicit `app.close()` is already in flight is
   * the ordinary case, and ioredis throws "Connection is closed" on the second
   * call.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'end' || this.client.status === 'close') {
      return;
    }

    try {
      // `quit` waits for pending replies; `disconnect` is the hammer for a
      // connection that never came up, where `quit` would hang.
      if (this.client.status === 'ready') {
        await this.client.quit();
      } else {
        this.client.disconnect();
      }
    } catch (error: unknown) {
      // Shutting down is not a place to throw. ioredis raises "Connection is
      // closed" if the socket went away between the status check above and the
      // call — a race, not a fault, and one that must not surface as a failed
      // `app.close()`.
      this.logger.warn(
        `Ignoring error while closing Redis: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** True when commands can be issued right now. */
  isReady(): boolean {
    return this.client.status === 'ready';
  }

  hasEverConnected(): boolean {
    return this.everConnected;
  }

  /** Round-trips a PING, for the health endpoint. */
  async ping(): Promise<string> {
    return this.client.ping();
  }
}
