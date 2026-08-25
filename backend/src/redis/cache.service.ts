import { Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../config/index.js';
import { RedisService } from './redis.service.js';

/**
 * The cache, as the rest of the application sees it (AC2).
 *
 * Nothing outside this file touches the Redis client for caching. Callers get
 * `get`, `set`, `delete`, `deleteByPrefix`, and `wrap`, and never see a
 * serialisation format or a key prefix.
 *
 * **Every method degrades rather than throws** (AC4). A cache is an
 * optimisation; if it is unavailable, the correct behaviour is to log a warning
 * once and let the caller fall through to the database — not to turn a working
 * page into a 500. That is why `get` returns `undefined` on failure, which is
 * indistinguishable from a miss by design.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly defaultTtlSeconds: number;

  /**
   * Counts degraded operations so a test — and later a metric — can assert that
   * a fallback actually happened rather than inferring it from a log line.
   */
  private degradedCount = 0;

  constructor(
    private readonly redis: RedisService,
    config: TypedConfigService,
  ) {
    this.defaultTtlSeconds = config.get('CACHE_TTL_SECONDS');
  }

  private degrade(operation: string, error: unknown): void {
    this.degradedCount += 1;
    this.logger.warn(
      `Cache ${operation} failed, falling back: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  /** How many operations have degraded since boot. */
  degradations(): number {
    return this.degradedCount;
  }

  /**
   * Returns the cached value, or `undefined` for a miss **or** an unavailable
   * cache. Callers cannot tell the two apart, and should not need to.
   */
  async get<T>(key: string): Promise<T | undefined> {
    if (!this.redis.isReady()) {
      this.degrade('get', new Error('Redis is not connected'));
      return undefined;
    }

    try {
      const raw = await this.redis.client.get(key);

      if (raw === null) {
        return undefined;
      }

      return JSON.parse(raw) as T;
    } catch (error: unknown) {
      // A malformed entry is treated as a miss rather than propagated: whatever
      // wrote it is a bug worth logging, but the reader can still serve.
      this.degrade('get', error);
      return undefined;
    }
  }

  /** Stores a value with a TTL. Silently does nothing when the cache is down. */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (!this.redis.isReady()) {
      this.degrade('set', new Error('Redis is not connected'));
      return;
    }

    try {
      await this.redis.client.set(
        key,
        JSON.stringify(value),
        'EX',
        ttlSeconds ?? this.defaultTtlSeconds,
      );
    } catch (error: unknown) {
      this.degrade('set', error);
    }
  }

  /** Removes one key. Returns the number actually removed. */
  async delete(key: string): Promise<number> {
    if (!this.redis.isReady()) {
      this.degrade('delete', new Error('Redis is not connected'));
      return 0;
    }

    try {
      return await this.redis.client.del(key);
    } catch (error: unknown) {
      this.degrade('delete', error);
      return 0;
    }
  }

  /**
   * Invalidates a whole family of keys — `ticket:123:*` after a ticket changes.
   *
   * Uses `SCAN`, never `KEYS`. `KEYS` blocks the server for the length of the
   * scan, which on a production keyspace is an outage. The client's configured
   * key prefix has to be re-applied by hand here, because `SCAN` matches against
   * the real key names on the server while `del` prepends the prefix again.
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    if (!this.redis.isReady()) {
      this.degrade('deleteByPrefix', new Error('Redis is not connected'));
      return 0;
    }

    try {
      const keyPrefix = this.redis.client.options.keyPrefix ?? '';
      const pattern = `${keyPrefix}${prefix}*`;

      let cursor = '0';
      let removed = 0;

      do {
        const [next, keys] = await this.redis.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;

        if (keys.length > 0) {
          // `del` re-applies keyPrefix, so strip what SCAN returned.
          const unprefixed = keys.map((key) =>
            keyPrefix !== '' && key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key,
          );
          removed += await this.redis.client.del(...unprefixed);
        }
      } while (cursor !== '0');

      return removed;
    } catch (error: unknown) {
      this.degrade('deleteByPrefix', error);
      return 0;
    }
  }

  /**
   * Read-through: return the cached value, or compute it, store it, and return
   * it. The common shape, written once so every call site does not re-implement
   * the miss-then-populate dance — and so that a cache outage degrades to
   * "always call the loader" without the caller writing a single line for it.
   */
  async wrap<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);

    if (cached !== undefined) {
      return cached;
    }

    const value = await load();
    await this.set(key, value, ttlSeconds);

    return value;
  }
}
