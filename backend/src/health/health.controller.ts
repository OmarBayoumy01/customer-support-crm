import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthStatusSchema, type HealthStatus } from '@crm/shared';

import { Public } from '../auth/index.js';
import { ApiZodResponse } from '../openapi/index.js';
import { HealthService } from './health.service.js';

@ApiTags('Health')
@Controller('health')
// A health check that needs a token leaves a monitoring system unable to tell
// "the service is down" from "my credential expired" — which is the one
// distinction it exists to make. US-14 made every route protected by default;
// this is one of the few that must not be.
@Public()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Always 200, even when a dependency is down: the caller is asking for a
   * report, and the report is in the body. A monitoring system reads
   * `status` and `dependencies`, not the HTTP code.
   */
  @Get()
  @ApiOperation({
    summary: 'Service and dependency health',
    description:
      'Always answers 200 while the process is alive. Read `status` and `dependencies` ' +
      'rather than the HTTP code: a failing database makes `status` "down", not the ' +
      'response an error.',
  })
  @ApiZodResponse(200, HealthStatusSchema, 'The service and each dependency it needs.')
  check(): Promise<HealthStatus> {
    return this.health.check();
  }
}
