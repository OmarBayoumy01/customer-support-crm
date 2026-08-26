import { Module } from '@nestjs/common';

import { TicketHistoryService } from './ticket-history.service.js';

/**
 * The per-ticket audit trail, on its own — US-50, extracted by US-68.
 *
 * It has a module of its own for one reason: `SlaModule` records history when a
 * target passes, and `TicketsModule` needs `SlaClockService` to start the clock.
 * With the recorder inside `TicketsModule` those two imports are a cycle. The
 * service itself did not move and nothing about it changed.
 */
@Module({
  providers: [TicketHistoryService],
  exports: [TicketHistoryService],
})
export class TicketHistoryModule {}
