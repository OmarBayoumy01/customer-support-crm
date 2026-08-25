import { Global, Module } from '@nestjs/common';

import { CacheService } from './cache.service.js';
import { QueueService } from './queue.service.js';
import { RedisService } from './redis.service.js';

/**
 * Global, for the same reason `PrismaModule` is: one connection per process,
 * injectable anywhere without every feature module re-importing it.
 *
 * `RedisService` is exported alongside the two abstractions because the health
 * check needs to ping it. Application code should reach for `CacheService` or
 * `QueueService` — if you find yourself injecting `RedisService` to run a
 * command, the abstraction is missing a method, and adding it there is better
 * than reaching around it.
 */
@Global()
@Module({
  providers: [RedisService, CacheService, QueueService],
  exports: [RedisService, CacheService, QueueService],
})
export class RedisModule {}
