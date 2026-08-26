import { Module } from '@nestjs/common';

import { TicketHistoryService } from './ticket-history.service.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

/**
 * Tickets — US-40.
 *
 * Both services are exported. US-41, US-45, US-47, US-48, US-49 and US-55 all
 * build on `TicketsService`, and anything that changes a ticket has to record
 * through `TicketHistoryService` rather than writing its own entries.
 */
@Module({
  controllers: [TicketsController],
  providers: [TicketsService, TicketHistoryService],
  exports: [TicketsService, TicketHistoryService],
})
export class TicketsModule {}
