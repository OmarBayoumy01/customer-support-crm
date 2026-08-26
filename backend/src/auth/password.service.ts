import { Injectable, type OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';

import { TypedConfigService } from '../config/index.js';

/**
 * Hashing and verifying passwords — US-14, AC4.
 *
 * argon2id, not bcrypt. Both satisfy the criterion; argon2id is memory-hard, so
 * a GPU farm does not get the same leverage it does against bcrypt, and it has
 * no 72-byte input truncation to remember. Parameters come from config so the
 * cost can be raised as hardware gets cheaper without a code change.
 */
@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly options: argon2.Options;

  /**
   * A hash of a fixed value, computed once at boot. See `verifyDummy`.
   *
   * Definitely assigned in `onModuleInit`, which Nest runs before the first
   * request; the `!` says so rather than pretending a sensible initial value
   * exists.
   */
  private dummyHash!: string;

  constructor(config: TypedConfigService) {
    this.options = {
      type: argon2.argon2id,
      memoryCost: config.get('ARGON2_MEMORY_COST'),
      timeCost: config.get('ARGON2_TIME_COST'),
      parallelism: config.get('ARGON2_PARALLELISM'),
    };
  }

  async onModuleInit(): Promise<void> {
    // Computed at startup, not per call: doing it inside `verifyDummy` would
    // double the work on exactly the path that is trying to match the cost of a
    // real verification, which would make the timing signal worse, not better.
    this.dummyHash = await argon2.hash('a password that belongs to nobody', this.options);
  }

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  /**
   * Checks a password against a stored hash.
   *
   * Returns `false` rather than throwing on a malformed hash — a corrupted row
   * should refuse the login, not crash the request. argon2 does its own
   * constant-time comparison internally.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain, this.options);
    } catch {
      return false;
    }
  }

  /**
   * Burns the same work as a real verification, against a hash of a value
   * nobody knows.
   *
   * Called when the email does not exist. **This is what makes AC2 true.**
   * Returning early for an unknown user answers in about a millisecond while a
   * real check takes fifty or more, and that difference enumerates accounts
   * just as reliably as a different error message would — the response time is
   * part of the response.
   */
  async verifyDummy(): Promise<void> {
    await argon2.verify(this.dummyHash, 'not the password', this.options);
  }
}
