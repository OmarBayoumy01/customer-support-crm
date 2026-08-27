import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ApiErrorSchema,
  PortalCategorySchema,
  PortalTicketDetailSchema,
  PortalTicketSchema,
  buildPaginationMeta,
  toSkipTake,
  type ApiPaginated,
  type PortalCategory,
  type PortalTicket,
  type PortalTicketDetail,
} from '@crm/shared';

import { CurrentUser, Public, type CurrentUserPayload } from '../auth/index.js';
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  BEARER_AUTH_NAME,
  zodToOpenApi,
} from '../openapi/index.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalThrottleService } from './portal-throttle.service.js';
import { PortalService } from './portal.service.js';
import {
  PortalPaginationQueryDto,
  PortalTicketListQueryDto,
  PortalReplyDto,
  SubmitPortalTicketDto,
} from './dto/portal.dto.js';

/**
 * The customer-facing API — US-82.
 *
 * **`@Public()` and `@UseGuards(PortalAuthGuard)` are a pair, and neither is
 * optional.** `JwtAuthGuard` is global and pinned to `crm-staff`, so without
 * `@Public()` every portal token would be refused by the staff strategy; and
 * `@Public()` without the portal guard would leave these routes open to the
 * internet. Both are on the class so a new handler inherits both, and
 * `portal.test.ts` asserts that an unauthenticated request is 401 — if that test
 * ever fails, this API is public.
 *
 * Separate from `TicketsController` on purpose rather than as a matter of tidy
 * routing: a shared controller with a flag deciding what to serialise is one
 * `if` away from serving an internal note to a customer.
 */
@ApiTags('portal')
@ApiBearerAuth(BEARER_AUTH_NAME)
@Public()
@UseGuards(PortalAuthGuard)
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly throttle: PortalThrottleService,
  ) {}

  /**
   * The caller's own customer id, plus AC5's rate limit.
   *
   * Every handler starts here, so no handler can forget either. The limit is
   * counted per customer rather than per user id because the customer is the
   * account being protected, and it is checked after the identity is resolved so
   * an unauthenticated flood is stopped by the guard first.
   */
  private async scopeFor(
    user: CurrentUserPayload | undefined,
    request: Request,
  ): Promise<{ customerId: string; userId: string }> {
    const userId = user?.userId ?? '';
    const customerId = await this.portal.customerIdFor(userId);

    await this.throttle.check({ customerId, ip: request.ip });

    return { customerId, userId };
  }

  @Get('tickets')
  @ApiOperation({
    summary: 'The requests this customer has raised',
    description:
      'Scoped to the caller’s own customer record in the query, derived from the token and ' +
      'not from any configurable permission. Statuses are the customer-facing set.',
  })
  @ApiZodQuery(PortalTicketListQueryDto)
  @ApiZodResponse(200, PortalTicketSchema, 'A page of requests')
  @ApiResponse({ status: 429, schema: zodToOpenApi(ApiErrorSchema) })
  async tickets(
    @Query() query: PortalTicketListQueryDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Req() request: Request,
  ): Promise<ApiPaginated<PortalTicket>> {
    const { customerId } = await this.scopeFor(user, request);
    const { tickets, total } = await this.portal.tickets(customerId, query);

    return {
      data: tickets,
      pagination: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
    };
  }

  @Get('tickets/:id')
  @ApiOperation({
    summary: 'One request, with the conversation the customer may see',
    description:
      'Internal notes, their attachments, SLA timers, the internal status, the department ' +
      'and the ticket’s history are absent from this payload — filtered in the query and ' +
      'absent from the contract, not hidden by the client. Somebody else’s request answers ' +
      '404, because a 403 would confirm it exists.',
  })
  @ApiZodResponse(200, PortalTicketDetailSchema, 'The request')
  @ApiResponse({ status: 404, schema: zodToOpenApi(ApiErrorSchema) })
  async ticket(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Req() request: Request,
  ): Promise<PortalTicketDetail> {
    const { customerId } = await this.scopeFor(user, request);

    return this.portal.ticket(customerId, id);
  }

  /**
   * Older messages, on demand.
   *
   * The detail carries the most recent slice; this is how a long thread pages
   * backwards. Newest first, so page 2 is what came before page 1 — the same
   * contract the staff endpoint uses.
   */
  @Get('tickets/:id/messages')
  @ApiOperation({
    summary: 'A page of the conversation, newest first',
    description:
      'Internal notes are excluded in the database query, and the total counts only what ' +
      'the customer can see — a total that included notes would disclose that they exist.',
  })
  @ApiZodQuery(PortalPaginationQueryDto)
  @ApiZodResponse(200, PortalTicketDetailSchema.shape.messages.element, 'A page of messages')
  async messages(
    @Param('id') id: string,
    @Query() query: PortalPaginationQueryDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Req() request: Request,
  ): Promise<ApiPaginated<PortalTicketDetail['messages'][number]>> {
    const { customerId } = await this.scopeFor(user, request);

    // Refuses a request that is not the caller's before any message is read.
    await this.portal.ticket(customerId, id);

    const { skip, take } = toSkipTake(query);
    const { messages, total } = await this.portal.messages(customerId, id, { skip, take });

    return {
      data: messages,
      pagination: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
    };
  }

  /**
   * The categories a customer may file under — US-86, AC1.
   *
   * Its own route rather than the staff `GET /categories`, which is guarded by
   * `ticket:view` and returns the department and default priority a customer has
   * no business seeing.
   */
  @Get('categories')
  @ApiOperation({
    summary: 'The categories a request can be filed under',
    description:
      'Id and name only. The staff list additionally carries the department and default ' +
      'priority, which is internal routing.',
  })
  @ApiZodResponse(200, PortalCategorySchema, 'The categories')
  async categories(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Req() request: Request,
  ): Promise<PortalCategory[]> {
    await this.scopeFor(user, request);

    return this.portal.categories();
  }

  /**
   * A customer raises a request — US-86.
   *
   * **The customer is the token’s, and the body has nowhere to say otherwise.**
   * `SubmitPortalTicketSchema` has no `customerId`, no `channel`, no
   * `departmentId`, no `tags` and no `status` — so this is not a check that the
   * body agrees with the token, it is a contract with nothing to disagree about.
   *
   * Inherits the guard, the audience and the throttle from `scopeFor`, like every
   * other route on this controller.
   */
  @Post('tickets')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Raise a support request',
    description:
      'The request is filed against the signed-in customer, arrives on the WEB channel, ' +
      'and starts at NEW for staff to triage. Urgency is plain wording mapped to a ' +
      'priority server-side; the tightest priority is not reachable from the portal.',
  })
  @ApiZodBody(SubmitPortalTicketDto)
  @ApiZodResponse(201, PortalTicketDetailSchema, 'Raised')
  @ApiResponse({ status: 422, schema: zodToOpenApi(ApiErrorSchema) })
  async submit(
    @Body() body: SubmitPortalTicketDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Req() request: Request,
  ): Promise<PortalTicketDetail> {
    const actor = await this.scopeFor(user, request);

    return this.portal.submit(actor, body);
  }

  /**
   * The customer replies — US-85.
   *
   * The ticket is the path, the customer is the token, and the body is one field.
   * **There is no `isInternal` in `PortalReplyDto`** — the service hardcodes
   * `false`, so a customer-authored internal note is not something a request can
   * ask for.
   *
   * A reply to a resolved request reopens it through US-47's
   * `onCustomerReply`, used exactly as that story defined it. A reply to a closed
   * request is refused: see the service.
   */
  @Post('tickets/:id/messages')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Reply to my request',
    description:
      'The reply is attributed to the signed-in customer and is never internal. Replying to ' +
      'a resolved request reopens it; replying to a closed one is refused, because a closed ' +
      'request is in no queue and the reply would go unread.',
  })
  @ApiZodBody(PortalReplyDto)
  @ApiZodResponse(201, PortalTicketDetailSchema, 'The updated thread')
  @ApiResponse({ status: 404, schema: zodToOpenApi(ApiErrorSchema) })
  @ApiResponse({ status: 422, schema: zodToOpenApi(ApiErrorSchema) })
  async reply(
    @Param('id') id: string,
    @Body() body: PortalReplyDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Req() request: Request,
  ): Promise<PortalTicketDetail> {
    const actor = await this.scopeFor(user, request);

    return this.portal.reply(actor, id, body);
  }
}
