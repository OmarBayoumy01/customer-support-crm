import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  TicketDetailSchema,
  TicketSchema,
  type ApiPaginated,
  type Ticket,
  type TicketDetail,
} from '@crm/shared';

import { CurrentUser, type CurrentUserPayload } from '../auth/index.js';
import { RequirePermission } from '../permissions/index.js';
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  BEARER_AUTH_NAME,
  zodToOpenApi,
} from '../openapi/index.js';
import { CreateTicketDto, TicketListQueryDto, UpdateTicketDto } from './dto/ticket.dto.js';
import { TicketsService, type TicketActor } from './tickets.service.js';
import { PrismaService } from '../prisma/index.js';

/**
 * Tickets — US-40. The spine of the product.
 *
 * Every route resolves the caller's scope and applies it **in the query**
 * (AC4), which is the project's second non-negotiable rule.
 */
@ApiTags('tickets')
@ApiBearerAuth(BEARER_AUTH_NAME)
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The caller, with the department their `TEAM` scope depends on.
   *
   * The access token deliberately does not carry the department: it changes
   * when somebody moves team, and a claim would keep the old one for the life
   * of the token. One indexed lookup is the honest cost of getting it right.
   */
  private async actorFrom(user: CurrentUserPayload | undefined): Promise<TicketActor> {
    const row =
      user === undefined
        ? null
        : await this.prisma.user.findUnique({
            where: { id: user.userId },
            select: { departmentId: true },
          });

    return { userId: user?.userId ?? '', departmentId: row?.departmentId ?? null };
  }

  @Get()
  @RequirePermission('ticket:view')
  @ApiOperation({
    summary: 'List tickets',
    description:
      'Every filter, sort and page is applied in the database, and the caller’s scope is ' +
      'part of the same query — an agent scoped to their own queue cannot page past it.',
  })
  @ApiZodQuery(TicketListQueryDto)
  @ApiZodResponse(200, TicketSchema, 'A page of tickets')
  async list(
    @Query() query: TicketListQueryDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<ApiPaginated<Ticket>> {
    return this.tickets.list(query, await this.actorFrom(user));
  }

  @Get(':id')
  @RequirePermission('ticket:view')
  @ApiOperation({
    summary: 'One ticket, with everything the workspace needs',
    description:
      'Ticket, customer, messages, attachments, history and SLA in one response. A ticket ' +
      'outside the caller’s scope answers 404, not 403 — telling somebody a ticket exists ' +
      'but is not theirs still tells them it exists.',
  })
  @ApiZodResponse(200, TicketDetailSchema, 'The ticket')
  @ApiResponse({ status: 404, schema: zodToOpenApi(ApiErrorSchema) })
  async detail(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<TicketDetail> {
    return this.tickets.detail(id, await this.actorFrom(user));
  }

  @Post()
  @RequirePermission('ticket:create')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a ticket',
    description: 'The reference number comes from PostgreSQL’s own sequence.',
  })
  @ApiZodBody(CreateTicketDto)
  @ApiZodResponse(201, TicketSchema, 'Created')
  async create(
    @Body() body: CreateTicketDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<Ticket> {
    return this.tickets.create(body, await this.actorFrom(user));
  }

  /**
   * Field updates only.
   *
   * **Status is not here.** Moving a ticket through its lifecycle is US-47's
   * transition endpoint, which validates that the move is legal; accepting it
   * here would be a second, unguarded door onto the same state machine.
   */
  @Patch(':id')
  @RequirePermission('ticket:update')
  @ApiOperation({ summary: 'Update a ticket’s fields' })
  @ApiZodBody(UpdateTicketDto)
  @ApiZodResponse(200, TicketSchema, 'Updated')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateTicketDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<Ticket> {
    return this.tickets.update(id, body, await this.actorFrom(user));
  }
}
