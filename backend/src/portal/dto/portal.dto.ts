import { PaginationQuerySchema, PortalTicketListQuerySchema } from '@crm/shared';

import { createZodDto } from '../../common/index.js';

/** Wraps the **shared** portal schemas rather than restating them — US-82. */
export class PortalTicketListQueryDto extends createZodDto(PortalTicketListQuerySchema) {}

/** Paging for the conversation endpoint, which needs no filters of its own. */
export class PortalPaginationQueryDto extends createZodDto(PaginationQuerySchema) {}
