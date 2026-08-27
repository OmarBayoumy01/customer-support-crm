import {
  AssignTicketSchema,
  ChangeTicketStatusSchema,
  CreateTicketMessageSchema,
  CreateTicketSchema,
  PaginationQuerySchema,
  TeamOverviewQuerySchema,
  TicketListQuerySchema,
  UpdateTicketSchema,
} from '@crm/shared';

import { createZodDto } from '../../common/index.js';

/** Wraps the **shared** schemas rather than restating them — US-40. */
export class CreateTicketDto extends createZodDto(CreateTicketSchema) {}
export class UpdateTicketDto extends createZodDto(UpdateTicketSchema) {}
export class TicketListQueryDto extends createZodDto(TicketListQuerySchema) {}

/** Paging for the history endpoint, which needs no filters of its own. */
export class PaginationQueryDto extends createZodDto(PaginationQuerySchema) {}

/** A reply or an internal note — US-1. */
export class CreateTicketMessageDto extends createZodDto(CreateTicketMessageSchema) {}

/** Who owns the ticket — US-48. Separate from `UpdateTicketDto`, see the schema. */
export class AssignTicketDto extends createZodDto(AssignTicketSchema) {}

/** Moving a ticket through its lifecycle — US-47. */
export class ChangeTicketStatusDto extends createZodDto(ChangeTicketStatusSchema) {}

/** AC5's department and branch filters — US-58. Filters, never scope selectors. */
export class TeamOverviewQueryDto extends createZodDto(TeamOverviewQuerySchema) {}
