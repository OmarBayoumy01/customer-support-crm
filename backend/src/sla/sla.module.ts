import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { SlaPolicyService } from './sla-policy.service.js';

/**
 * SLA — US-67, and the foundation for US-68, US-69 and US-71.
 *
 * No controller: the MVP seeds policies rather than managing them in a screen.
 * US-70 adds the API over this service.
 */
@Module({
  imports: [AuditModule],
  providers: [SlaPolicyService],
  exports: [SlaPolicyService],
})
export class SlaModule {}
