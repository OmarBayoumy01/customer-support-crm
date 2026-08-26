import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  AssignedTicketCountSchema,
  buildPaginationMeta,
  TicketCountsSchema,
  TicketDetailSchema,
  TicketHistoryEntrySchema,
  TicketMessageSchema,
  TicketSchema,
  toSkipTake,
  type ApiPaginated,
  type AssignedTicketCount,
  type Ticket,
  type TicketCounts,
  type TicketDetail,
  type TicketHistoryEntry,
  type TicketMessage,
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
import {
  CreateTicketDto,
  PaginationQueryDto,
  TicketListQueryDto,
  UpdateTicketDto,
} from './dto/ticket.dto.js';
import { TicketHistoryService } from './ticket-history.service.js';
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
    private readonly historyService: TicketHistoryService,
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

  /**
   * The queue's view tabs — US-42, AC4.
   *
   * Declared before `:id` on purpose. Nest matches routes in declaration order,
   * so a literal path that arrives after a parameterised one is never reached —
   * `/tickets/counts` would resolve as a ticket whose id is "counts".
   */
  @Get('counts')
  @RequirePermission('ticket:view')
  @ApiOperation({
    summary: 'A live count per queue view',
    description:
      'One round trip for all six tabs, each carrying the caller’s scope — an agent’s ' +
      '"All" is their own queue, not the department’s.',
  })
  @ApiZodResponse(200, TicketCountsSchema, 'The counts')
  async counts(@CurrentUser() user: CurrentUserPayload | undefined): Promise<TicketCounts> {
    return this.tickets.counts(await this.actorFrom(user));
  }

  @Get('assigned/count')
  @RequirePermission('ticket:view')
  @ApiOperation({
    summary: 'How much is on the signed-in agent’s plate',
    description:
      'What the sidebar badge shows. `atRisk` is the number that decides what to do next: ' +
      'already breached, or inside the warning window.',
  })
  @ApiZodResponse(200, AssignedTicketCountSchema, 'The count')
  async assignedCount(
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<AssignedTicketCount> {
    return this.tickets.assignedCount(await this.actorFrom(user));
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

  /**
   * Older messages, on demand — US-46, AC5.
   *
   * The detail already carries the most recent slice, so this is what the
   * timeline calls when somebody scrolls back through a long thread. Newest
   * first: page 2 is what came before page 1.
   */
  @Get(':id/messages')
  @RequirePermission('ticket:view')
  @ApiOperation({
    summary: 'A page of the conversation, newest first',
    description:
      'The workspace opens with the most recent messages inline; this is how it pages ' +
      'backwards. Internal notes are included — this is the staff API, and the portal is ' +
      'a separate controller that filters them out in the query.',
  })
  @ApiZodQuery(PaginationQueryDto)
  @ApiZodResponse(200, TicketMessageSchema, 'A page of messages')
  async messages(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<ApiPaginated<TicketMessage>> {
    const actor = await this.actorFrom(user);
    const { skip, take } = toSkipTake(query);
    const { messages, total } = await this.tickets.messages(id, actor, { skip, take });

    return {
      data: messages,
      pagination: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
    };
  }

  /**
   * The ticket's audit trail — US-50.
   *
   * Separate from the detail payload, which carries the most recent hundred
   * entries so the workspace renders in one round trip. This is what the
   * collapsed panel calls when somebody actually opens it and pages back.
   *
   * Scope is enforced by loading the ticket through `detail` first: one place
   * decides who may see what, rather than two that have to agree.
   */
  @Get(':id/history')
  @RequirePermission('ticket:view')
  @ApiOperation({
    summary: 'A ticket’s history, newest first',
    description:
      'Append-only, and enforced by the database rather than by convention — a trigger ' +
      'refuses UPDATE and refuses DELETE while the ticket still exists.',
  })
  @ApiZodQuery(PaginationQueryDto)
  @ApiZodResponse(200, TicketHistoryEntrySchema, 'A page of history')
  async history(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<ApiPaginated<TicketHistoryEntry>> {
    const actor = await this.actorFrom(user);

    // Refuses a ticket outside the caller's scope before any history is read.
    await this.tickets.detail(id, actor);

    const { skip, take } = toSkipTake(query);
    const { entries, total } = await this.historyService.forTicket(id, { skip, take });

    return {
      data: entries,
      pagination: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
    };
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
