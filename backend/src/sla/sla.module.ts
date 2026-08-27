import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { TicketHistoryModule } from '../tickets/ticket-history.module.js';
import { SlaClockService } from './sla-clock.service.js';
import { SlaEscalationService } from './sla-escalation.service.js';
import { SlaPolicyService } from './sla-policy.service.js';
import { SlaSweepWorker } from './sla-sweep.worker.js';

/**
 * SLA — US-67 (policies), US-68 (the clock) and US-71 (escalation).
 *
 * No controller: the MVP seeds policies rather than managing them in a screen,
 * and US-70 adds the API over `SlaPolicyService`.
 *
 * `SlaSweepWorker` schedules the repeatable job AC5 asks for the moment this
 * module initialises — importing it is what makes the sweep run.
 */
@Module({
  imports: [AuditModule, TicketHistoryModule],
  providers: [SlaPolicyService, SlaClockService, SlaEscalationService, SlaSweepWorker],
  exports: [SlaPolicyService, SlaClockService, SlaEscalationService],
})
export class SlaModule {}
