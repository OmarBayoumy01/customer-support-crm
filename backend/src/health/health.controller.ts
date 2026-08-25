import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '@crm/shared';

import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Always 200, even when a dependency is down: the caller is asking for a
   * report, and the report is in the body. A monitoring system reads
   * `status` and `dependencies`, not the HTTP code.
   */
  @Get()
  check(): Promise<HealthStatus> {
    return this.health.check();
  }
}
