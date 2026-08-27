import { Injectable, Logger } from '@nestjs/common';

import { ApiException } from '../common/index.js';
import { TypedConfigService } from '../config/index.js';
import { RedisService } from '../redis/index.js';

/** Key families, so the two counters can be reasoned about separately in Redis. */
const ACCOUNT_PREFIX = 'portal:rate:account:';
const IP_PREFIX = 'portal:rate:ip:';

/**
 * Rate limiting for the portal — US-82, AC5.
 *
 * Modelled on `LoginThrottleService`, on the Redis the project already runs. No
 * throttling library is added: the counter has to be shared across API replicas
 * to mean anything, and an in-process limiter is per replica — which is to say,
 * multiplied by however many are running.
 *
 * **Two independent counters, and they have to be independent.** Per account
 * stops one signed-in customer hammering the API; per IP stops a spray across
 * many accounts from one place. A single combined counter would either throttle
 * an office behind one NAT or be loose enough that a targeted account sails
 * through — the same reasoning US-14 wrote down for login.
 *
 * Unlike the login throttle this counts **requests, not failures**: a portal
 * caller doing nothing wrong is still capable of doing too much of it.
 */
@Injectable()
export class PortalThrottleService {
  private readonly logger = new Logger(PortalThrottleService.name);

  private readonly maxPerAccount: number;
  private readonly maxPerIp: number;
  private readonly windowSeconds: number;

  /**
   * How many times the limit could not be enforced since boot, so a test can
   * assert the fail-open path was taken rather than inferring it from a log
   * line — the same accounting `LoginThrottleService` and `CacheService` keep.
   */
  private degradedCount = 0;

  constructor(
    private readonly redis: RedisService,
    config: TypedConfigService,
  ) {
    this.maxPerAccount = config.get('PORTAL_RATE_LIMIT_PER_ACCOUNT');
    this.maxPerIp = config.get('PORTAL_RATE_LIMIT_PER_IP');
    this.windowSeconds = config.get('PORTAL_RATE_LIMIT_WINDOW_SECONDS');
  }

  degradations(): number {
    return this.degradedCount;
  }

  /**
   * Degrades to "not limited" when Redis is unreachable, and says so loudly.
   *
   * **Fails open**, matching the login throttle. A support portal that returns
   * 429 to every customer for the duration of a Redis outage is a worse failure
   * than one that is briefly unthrottled, and `/health` already reports Redis
   * down. Every unenforced request is logged at `warn`, so the gap is visible
   * rather than silent.
   */
  private degrade(operation: string, error: unknown): void {
    this.degradedCount += 1;
    this.logger.warn(
      `Portal rate limit ${operation} failed — the limit is NOT being enforced: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  /**
   * Counts one request against both counters and refuses when either is over.
   *
   * Incremented **before** the check rather than after, so a burst cannot slip
   * through between reading a count and acting on it — `INCR` is atomic and its
   * return value is the count including this request.
   */
  async check(input: { customerId: string; ip: string | undefined }): Promise<void> {
    if (!this.redis.isReady()) {
      this.degrade('check', new Error('Redis is not connected'));

      return;
    }

    const targets: { key: string; max: number; what: string }[] = [
      { key: ACCOUNT_PREFIX + input.customerId, max: this.maxPerAccount, what: 'account' },
    ];

    if (input.ip !== undefined) {
      targets.push({ key: IP_PREFIX + input.ip, max: this.maxPerIp, what: 'ip' });
    }

    for (const target of targets) {
      let count: number;

      try {
        count = await this.redis.client.incr(target.key);

        // Only on the first request of a window, so a continuing burst cannot
        // keep pushing the expiry out and hold somebody limited indefinitely.
        if (count === 1) {
          await this.redis.client.expire(target.key, this.windowSeconds);
        }
      } catch (error: unknown) {
        this.degrade('check', error);

        return;
      }

      if (count > target.max) {
        this.logger.warn(
          `Portal rate limit hit for ${target.what} after ${String(count)} requests ` +
            `(window ${String(this.windowSeconds)}s)`,
        );

        // Names no threshold and no counter. Somebody being limited does not
        // need to be told how close they were or which limit they hit.
        throw new ApiException(
          'RATE_LIMITED',
          'Too many requests. Please wait a moment and try again.',
        );
      }
    }
  }
}
