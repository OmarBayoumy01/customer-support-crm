import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  AssignableAgentSchema,
  AssignedSummarySchema,
  TeamOverviewSchema,
  AssignedTicketCountSchema,
  buildPaginationMeta,
  TicketCountsSchema,
  TicketDetailSchema,
  TicketHistoryEntrySchema,
  TicketMessageSchema,
  TicketSchema,
  toSkipTake,
  type ApiPaginated,
  type AssignableAgent,
  type AssignedSummary,
  type TeamOverview,
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
  AssignTicketDto,
  ChangeTicketStatusDto,
  CreateTicketDto,
  CreateTicketMessageDto,
  PaginationQueryDto,
  TeamOverviewQueryDto,
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

  /**
   * The agent dashboard's KPI row — US-55, AC1.
   *
   * Declared before `:id`, like the other literal paths on this controller.
   *
   * Every figure is the caller’s own assigned work: `assigneeId` and the
   * caller’s scope are both in the query, so there is no shape of request that
   * reports somebody else’s workload.
   */
  @Get('assigned/summary')
  @RequirePermission('ticket:view')
  @ApiOperation({
    summary: 'What is on the signed-in agent’s plate',
    description:
      'Open, pending, due soon and breached, derived from the caller’s own open tickets ' +
      'through the same SLA function the queue uses. `previous` is a week-ago comparison ' +
      'and is **null wherever one cannot honestly be computed**: the status then is not ' +
      'stored, the breach flags are current-only, and "due soon" is relative to now. Only ' +
      '`open` has a past value, and it takes assignment as current because `assigneeId` is ' +
      'a column rather than a history.',
  })
  @ApiZodResponse(200, AssignedSummarySchema, 'The summary')
  async assignedSummary(
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<AssignedSummary> {
    return this.tickets.assignedSummary(await this.actorFrom(user));
  }

  /**
   * The manager dashboard — US-58, AC1, AC2, AC5 and AC6.
   *
   * `report:view` is AC6: the catalogue grants it to a manager at `TEAM` and an
   * administrator at `ALL`, and **not to an agent**.
   *
   * `departmentId` and `branchId` are **filters**, not scope selectors. They are
   * `AND`ed with the caller’s own `ticket:view` scope, so they can only narrow
   * it: a manager asking for another department gets zero rather than that
   * department. Nothing in the request builds the scope clause.
   */
  @Get('team/overview')
  @RequirePermission('report:view')
  @ApiOperation({
    summary: 'Team workload and SLA health',
    description:
      'Every figure is computed inside the caller’s own ticket scope, in the query. The SLA ' +
      'figures use the same `slaFor` the queue and the agent dashboard use — there is no ' +
      'dashboard definition of at-risk or breached. The two averages read a 30-day window ' +
      'and are null when there is nothing to average. **Customer satisfaction is absent**: ' +
      'no rating exists in the domain, and US-88 owns it.',
  })
  @ApiZodQuery(TeamOverviewQueryDto)
  @ApiZodResponse(200, TeamOverviewSchema, 'The overview')
  async teamOverview(
    @Query() query: TeamOverviewQueryDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<TeamOverview> {
    return this.tickets.teamOverview(await this.actorFrom(user), {
      departmentId: query.departmentId,
      branchId: query.branchId,
    });
  }

  /**
   * The assignee picker's options — US-48, AC2 and AC5.
   *
   * Declared before `:id` for the same reason as `counts`: Nest matches routes
   * in declaration order, and `/tickets/assignees` would otherwise resolve as a
   * ticket whose id is "assignees".
   *
   * Guarded by `ticket:assign` rather than `ticket:view`. Who is available and
   * how loaded they are is the information you need in order to *assign*, and
   * offering it to everybody who can read a ticket would be publishing the
   * team's workload to the whole platform.
   */
  @Get('assignees')
  @RequirePermission('ticket:assign')
  @ApiOperation({
    summary: 'Who this caller may assign a ticket to',
    description:
      'Candidates are whoever holds `ticket:update` — derived from the permission catalogue ' +
      'rather than from a list of role names — narrowed by the caller’s own `ticket:assign` ' +
      'scope in the query. Each carries their open ticket count, and an inactive user comes ' +
      'back marked unavailable rather than omitted: a ticket whose assignee was since ' +
      'deactivated still has to render their name.',
  })
  @ApiZodResponse(200, AssignableAgentSchema, 'The candidates')
  async assignees(@CurrentUser() user: CurrentUserPayload | undefined): Promise<AssignableAgent[]> {
    return this.tickets.assignees(await this.actorFrom(user));
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
   * Write into the conversation — US-1.
   *
   * One endpoint for both a customer-facing reply and an internal note,
   * separated by `isInternal` in the body. Two endpoints would be two places to
   * get the project's first non-negotiable rule wrong.
   *
   * `ticket:update` rather than a permission of its own: replying is the
   * ordinary way an agent changes a ticket, and a role that may not update a
   * ticket has no business writing on it either.
   */
  @Post(':id/messages')
  @RequirePermission('ticket:update')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Add a reply or an internal note',
    description:
      'Set isInternal to true for a note. It is required rather than defaulted — an ' +
      'omitted flag would silently mean customer-facing, which is the wrong way round ' +
      'for a mistake to fall.',
  })
  @ApiZodBody(CreateTicketMessageDto)
  @ApiZodResponse(201, TicketMessageSchema, 'Created')
  @ApiResponse({ status: 404, schema: zodToOpenApi(ApiErrorSchema) })
  async addMessage(
    @Param('id') id: string,
    @Body() body: CreateTicketMessageDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<TicketMessage> {
    return this.tickets.addMessage(id, body, await this.actorFrom(user));
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
   *
   * **Nor is the assignee, since US-48.** It used to be, and that was a real
   * hole rather than an untidiness: this route is guarded by `ticket:update`,
   * which every agent holds, so an agent could reassign a colleague's ticket
   * without holding `ticket:assign` at all.
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

  /**
   * Assign, reassign, or unassign — US-48, AC1, AC3 and AC4.
   *
   * Its own route with its own guard, which is the whole of AC4 on the server
   * side: the frontend hides the control from somebody without `ticket:assign`,
   * and this refuses them if they ask anyway. The permission gate is here; who
   * they may assign *to* is checked in the service against the same query that
   * builds the picker.
   */
  @Patch(':id/assignee')
  @RequirePermission('ticket:assign')
  @ApiOperation({
    summary: 'Set or clear a ticket’s assignee',
    description:
      'A null assignee unassigns, returning the ticket to the Unassigned queue while ' +
      'leaving its department — and so its visibility to the team — untouched. Assigning ' +
      'to somebody outside the caller’s scope, or to an inactive user, is refused.',
  })
  @ApiZodBody(AssignTicketDto)
  @ApiZodResponse(200, TicketSchema, 'Updated')
  @ApiResponse({ status: 404, schema: zodToOpenApi(ApiErrorSchema) })
  @ApiResponse({ status: 422, schema: zodToOpenApi(ApiErrorSchema) })
  async assign(
    @Param('id') id: string,
    @Body() body: AssignTicketDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<Ticket> {
    return this.tickets.assign(id, body.assigneeId, await this.actorFrom(user));
  }

  /**
   * Move a ticket through its lifecycle — US-47.
   *
   * The transition endpoint `PATCH /tickets/:id` has been refusing `status` in
   * favour of since US-40. Legality is decided by `TICKET_TRANSITIONS` in
   * `@crm/shared`, which the control also reads — so what the screen offers and
   * what the server accepts come from one definition rather than two that drift.
   *
   * `ticket:update` is the floor. Resolving or closing additionally needs
   * `ticket:close` and escalating needs `ticket:escalate`; both are checked in
   * the service, because they are properties of the destination rather than of
   * the action, and they belong with the rest of the transition rules.
   */
  @Patch(':id/status')
  @RequirePermission('ticket:update')
  @ApiOperation({
    summary: 'Move a ticket to another status',
    description:
      'Only transitions valid from the current status are accepted; anything else is 422. ' +
      'Resolving and closing require `ticket:close`, escalating requires `ticket:escalate`. ' +
      'The SLA clock pauses on Pending Customer and stops on Resolved, and the change is ' +
      'written to the ticket’s history.',
  })
  @ApiZodBody(ChangeTicketStatusDto)
  @ApiZodResponse(200, TicketSchema, 'Updated')
  @ApiResponse({ status: 403, schema: zodToOpenApi(ApiErrorSchema) })
  @ApiResponse({ status: 404, schema: zodToOpenApi(ApiErrorSchema) })
  @ApiResponse({ status: 422, schema: zodToOpenApi(ApiErrorSchema) })
  async changeStatus(
    @Param('id') id: string,
    @Body() body: ChangeTicketStatusDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<Ticket> {
    return this.tickets.changeStatus(id, body.status, await this.actorFrom(user));
  }
}
