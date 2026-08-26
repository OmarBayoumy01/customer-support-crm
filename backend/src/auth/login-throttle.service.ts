import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { ApiException } from '../common/index.js';
import { TypedConfigService } from '../config/index.js';
import { RedisService } from '../redis/index.js';

/** Key families, so the two counters can be reasoned about separately in Redis. */
const EMAIL_PREFIX = 'auth:fail:email:';
const IP_PREFIX = 'auth:fail:ip:';

/**
 * Brute-force protection for login — US-14, AC5.
 *
 * Two independent counters, and they have to be independent: one office behind
 * one NAT is one IP address, so a single shared counter either locks out a
 * whole floor of agents the moment somebody fat-fingers their password, or is
 * set loose enough that a targeted attack on one account sails through. Per
 * account catches the targeted attack; per IP catches the spray.
 *
 * Backed by Redis `INCR`, which is atomic — a read-modify-write through
 * `CacheService` would drop concurrent attempts, and dropped attempts are
 * exactly what an attacker wants.
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);

  private readonly maxPerEmail: number;
  private readonly maxPerIp: number;
  private readonly windowSeconds: number;

  /**
   * How many times the throttle could not be consulted since boot. Counted so a
   * test can assert the fail-open path was actually taken rather than inferring
   * it from a log line, the same way `CacheService.degradations()` does.
   */
  private degradedCount = 0;

  constructor(
    private readonly redis: RedisService,
    config: TypedConfigService,
  ) {
    this.maxPerEmail = config.get('LOGIN_MAX_ATTEMPTS_PER_EMAIL');
    this.maxPerIp = config.get('LOGIN_MAX_ATTEMPTS_PER_IP');
    this.windowSeconds = config.get('LOGIN_THROTTLE_WINDOW_SECONDS');
  }

  degradations(): number {
    return this.degradedCount;
  }

  /**
   * The email is hashed before it becomes a key, so Redis holds no addresses.
   *
   * Lowercasing here as well as in `LoginRequestSchema` is not redundant: this
   * is also called from paths that did not come through the schema, and a
   * counter that resets when you change the capitalisation is not a counter.
   */
  private static emailKey(email: string): string {
    return EMAIL_PREFIX + createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  }

  private static ipKey(ip: string): string {
    return IP_PREFIX + ip;
  }

  /**
   * Degrades to "not throttled" when Redis is unreachable, and says so loudly.
   *
   * This fails **open**, which is a deliberate trade-off and not an oversight:
   * failing closed would lock every agent out of the helpdesk for the duration
   * of a Redis outage, and for a support desk running against SLA targets that
   * is the worse of the two failures. `/health` already reports Redis down, and
   * every unenforced request is logged at `warn` so the gap is visible rather
   * than silent.
   */
  private degrade(operation: string, error: unknown): void {
    this.degradedCount += 1;
    this.logger.warn(
      `Login throttle ${operation} failed — brute-force protection is NOT being enforced: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  private async countOf(key: string): Promise<number> {
    if (!this.redis.isReady()) {
      this.degrade('read', new Error('Redis is not connected'));
      return 0;
    }

    try {
      const raw = await this.redis.client.get(key);

      return raw === null ? 0 : Number.parseInt(raw, 10);
    } catch (error: unknown) {
      this.degrade('read', error);
      return 0;
    }
  }

  /**
   * Refuses the attempt when either counter is at its threshold.
   *
   * Called **before** the user is looked up, so a locked-out attacker cannot
   * use the endpoint to probe which emails exist while they wait out the
   * window.
   */
  async check(email: string, ip: string | undefined): Promise<void> {
    const emailCount = await this.countOf(LoginThrottleService.emailKey(email));

    if (emailCount >= this.maxPerEmail) {
      this.logger.warn(
        `Login locked out for account after ${emailCount} failed attempts (window ${this.windowSeconds}s)`,
      );
      throw LoginThrottleService.lockedOut();
    }

    if (ip === undefined) {
      return;
    }

    const ipCount = await this.countOf(LoginThrottleService.ipKey(ip));

    if (ipCount >= this.maxPerIp) {
      this.logger.warn(
        `Login locked out for ip ${ip} after ${ipCount} failed attempts (window ${this.windowSeconds}s)`,
      );
      throw LoginThrottleService.lockedOut();
    }
  }

  /**
   * The message names no account and no threshold. Someone locked out already
   * knows they were guessing; telling them how many tries they get is free
   * intelligence.
   */
  private static lockedOut(): ApiException {
    return new ApiException(
      'RATE_LIMITED',
      'Too many sign-in attempts. Please wait a few minutes and try again.',
    );
  }

  /** Increments both counters, setting the window on the first failure. */
  async recordFailure(email: string, ip: string | undefined): Promise<void> {
    const keys = [LoginThrottleService.emailKey(email)];

    if (ip !== undefined) {
      keys.push(LoginThrottleService.ipKey(ip));
    }

    if (!this.redis.isReady()) {
      this.degrade('record', new Error('Redis is not connected'));
      return;
    }

    try {
      for (const key of keys) {
        const count = await this.redis.client.incr(key);

        // Only on the first failure, so a burst of attempts cannot keep pushing
        // the expiry out and hold someone locked out indefinitely. The window
        // starts when the first attempt failed and ends when it ends.
        if (count === 1) {
          await this.redis.client.expire(key, this.windowSeconds);
        }
      }
    } catch (error: unknown) {
      this.degrade('record', error);
    }
  }

  /**
   * Clears both counters after a success, so somebody who mistypes twice and
   * then gets it right is not still counting down towards a lockout.
   */
  async clear(email: string, ip: string | undefined): Promise<void> {
    const keys = [LoginThrottleService.emailKey(email)];

    if (ip !== undefined) {
      keys.push(LoginThrottleService.ipKey(ip));
    }

    if (!this.redis.isReady()) {
      this.degrade('clear', new Error('Redis is not connected'));
      return;
    }

    try {
      await this.redis.client.del(...keys);
    } catch (error: unknown) {
      this.degrade('clear', error);
    }
  }
}
