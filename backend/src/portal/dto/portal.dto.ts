import {
  PaginationQuerySchema,
  PortalReplySchema,
  PortalTicketListQuerySchema,
  SubmitPortalTicketSchema,
  UpdatePortalProfileSchema,
} from '@crm/shared';

import { createZodDto } from '../../common/index.js';

/** Wraps the **shared** portal schemas rather than restating them — US-82. */
export class PortalTicketListQueryDto extends createZodDto(PortalTicketListQuerySchema) {}

/** Paging for the conversation endpoint, which needs no filters of its own. */
export class PortalPaginationQueryDto extends createZodDto(PaginationQuerySchema) {}

/** What a customer may submit — US-86. Note what the schema has no room for. */
export class SubmitPortalTicketDto extends createZodDto(SubmitPortalTicketSchema) {}

/** A customer reply — US-85. No isInternal, deliberately: see the schema. */
export class PortalReplyDto extends createZodDto(PortalReplySchema) {}

/** Customer profile updates — US-87. */
export class UpdatePortalProfileDto extends createZodDto(UpdatePortalProfileSchema) {}
