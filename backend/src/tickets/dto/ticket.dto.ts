import { CreateTicketSchema, TicketListQuerySchema, UpdateTicketSchema } from '@crm/shared';

import { createZodDto } from '../../common/index.js';

/** Wraps the **shared** schemas rather than restating them — US-40. */
export class CreateTicketDto extends createZodDto(CreateTicketSchema) {}
export class UpdateTicketDto extends createZodDto(UpdateTicketSchema) {}
export class TicketListQueryDto extends createZodDto(TicketListQuerySchema) {}
