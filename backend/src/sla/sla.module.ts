import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { TicketHistoryModule } from '../tickets/ticket-history.module.js';
import { SlaClockService } from './sla-clock.service.js';
import { SlaPolicyService } from './sla-policy.service.js';
import { SlaSweepWorker } from './sla-sweep.worker.js';

/**
 * SLA — US-67 (policies) and US-68 (the clock).
 *
 * No controller: the MVP seeds policies rather than managing them in a screen,
 * and US-70 adds the API over `SlaPolicyService`.
 *
 * `SlaSweepWorker` schedules the repeatable job AC5 asks for the moment this
 * module initialises — importing it is what makes the sweep run.
 */
@Module({
  imports: [AuditModule, TicketHistoryModule],
  providers: [SlaPolicyService, SlaClockService, SlaSweepWorker],
  exports: [SlaPolicyService, SlaClockService],
})
export class SlaModule {}
