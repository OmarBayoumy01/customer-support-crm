import { Controller, Get } from '@nestjs/common';
import { HealthStatusSchema, type HealthStatus } from '@crm/shared';

@Controller('health')
export class HealthController {
  /**
   * Parsing on the way out is deliberate: the endpoint cannot drift from the
   * shared DTO without failing loudly, and the frontend consumes the same type.
   */
  @Get()
  check(): HealthStatus {
    return HealthStatusSchema.parse({
      status: 'ok',
      service: 'backend',
      timestamp: new Date().toISOString(),
    });
  }
}
