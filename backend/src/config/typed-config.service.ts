import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from './env.schema.js';

/**
 * The only sanctioned way to read configuration.
 *
 * A thin facade over Nest's `ConfigService` so that:
 *   - keys are constrained to `Env`, so a typo is a compile error, not a
 *     silent `undefined` at runtime (AC3);
 *   - there is exactly one seam where US-9 can add secret redaction to logs.
 */
@Injectable()
export class TypedConfigService {
  constructor(private readonly nest: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.nest.get(key, { infer: true });
  }
}
