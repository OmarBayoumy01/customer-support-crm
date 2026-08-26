import { Module } from '@nestjs/common';

import { SlaModule } from '../sla/index.js';
import { TicketHistoryModule } from './ticket-history.module.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

/**
 * Tickets — US-40.
 *
 * `TicketsService` is exported: US-41, US-45, US-47, US-48, US-49 and US-55 all
 * build on it, and anything that changes a ticket has to record through
 * `TicketHistoryService` rather than writing its own entries.
 *
 * `SlaModule` (US-68) is imported so creating a ticket starts its clock and
 * changing its priority recomputes the deadline.
 */
@Module({
  imports: [TicketHistoryModule, SlaModule],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService, TicketHistoryModule],
})
export class TicketsModule {}
