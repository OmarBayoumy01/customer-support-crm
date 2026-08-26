import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  CustomerSchema,
  DuplicateCustomerSchema,
  type ApiPaginated,
  type Customer,
  type DuplicateCustomer,
} from '@crm/shared';

import { RequirePermission } from '../permissions/index.js';
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  BEARER_AUTH_NAME,
  zodToOpenApi,
} from '../openapi/index.js';
import { CustomersService } from './customers.service.js';
import {
  CreateCustomerDto,
  CustomerListQueryDto,
  DuplicateCheckQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto.js';

/**
 * Customer records — US-33.
 *
 * Every route is permission-checked by `@RequirePermission`, which US-22 made
 * the declarative way to say so. **AC6 names `customer:manage`, which does not
 * exist**: US-13's catalogue has the finer-grained `customer:view` / `:create` /
 * `:update` / `:delete`, and those are used rather than inventing a fifth. The
 * criterion's intent — writes are refused without permission — is met.
 */
@ApiTags('customers')
@ApiBearerAuth(BEARER_AUTH_NAME)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customer:view')
  @ApiOperation({
    summary: 'List customers',
    description:
      'Every filter is applied in the database. Each row carries its open ticket count ' +
      'and last interaction, so a list screen costs one round trip.',
  })
  @ApiZodQuery(CustomerListQueryDto)
  @ApiZodResponse(200, CustomerSchema, 'A page of customers')
  async list(@Query() query: CustomerListQueryDto): Promise<ApiPaginated<Customer>> {
    return this.customers.list(query);
  }

  /**
   * AC2 — what the create form calls on blur, so the agent is warned **before**
   * submitting rather than by a rejection afterwards.
   */
  @Get('duplicate-check')
  @RequirePermission('customer:view')
  @ApiOperation({
    summary: 'Check for an existing customer with the same email or phone',
    description: 'Returns the existing record, or null. Warns; never blocks.',
  })
  @ApiZodQuery(DuplicateCheckQueryDto)
  @ApiZodResponse(200, DuplicateCustomerSchema.nullable(), 'The match, or null')
  async duplicateCheck(@Query() query: DuplicateCheckQueryDto): Promise<DuplicateCustomer | null> {
    return this.customers.findDuplicate(query);
  }

  @Get(':id')
  @RequirePermission('customer:view')
  @ApiOperation({ summary: 'One customer' })
  @ApiZodResponse(200, CustomerSchema, 'The customer')
  @ApiResponse({ status: 404, schema: zodToOpenApi(ApiErrorSchema) })
  async byId(@Param('id') id: string): Promise<Customer> {
    return this.customers.byId(id);
  }

  @Post()
  @RequirePermission('customer:create')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a customer',
    description:
      'Answers 409 when the email or phone already belongs to someone, with that ' +
      'customer’s id in `details`. Re-post with `confirmDuplicate: true` to proceed — ' +
      'two people genuinely share a landline.',
  })
  @ApiZodBody(CreateCustomerDto)
  @ApiZodResponse(201, CustomerSchema, 'Created')
  @ApiResponse({
    status: 409,
    description: 'A possible duplicate — a warning, not a wall',
    schema: zodToOpenApi(ApiErrorSchema),
  })
  async create(@Body() body: CreateCustomerDto): Promise<Customer> {
    return this.customers.create(body);
  }

  @Patch(':id')
  @RequirePermission('customer:update')
  @ApiOperation({ summary: 'Update a customer' })
  @ApiZodBody(UpdateCustomerDto)
  @ApiZodResponse(200, CustomerSchema, 'Updated')
  async update(@Param('id') id: string, @Body() body: UpdateCustomerDto): Promise<Customer> {
    return this.customers.update(id, body);
  }

  /**
   * AC5 — archive, not delete.
   *
   * `DELETE` is the honest verb for what the caller is asking, and the server
   * decides what that means: a soft delete, with the tickets untouched.
   */
  @Delete(':id')
  @RequirePermission('customer:delete')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Archive a customer',
    description: 'Soft-deletes the record. Their tickets remain intact and auditable.',
  })
  @ApiResponse({ status: 204, description: 'Archived' })
  async archive(@Param('id') id: string): Promise<void> {
    await this.customers.archive(id);
  }
}
