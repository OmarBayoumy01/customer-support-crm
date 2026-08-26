import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategorySchema, type Category } from '@crm/shared';

import { RequirePermission } from '../permissions/index.js';
import { ApiZodResponse, BEARER_AUTH_NAME } from '../openapi/index.js';
import { CategoriesService } from './categories.service.js';

/**
 * Categories — US-49, AC3.
 *
 * Guarded by `ticket:view` rather than `category:manage`: this is the list an
 * agent picks from while categorising a ticket, and anybody who may see a
 * ticket needs to be able to read what it is filed under. `category:manage`
 * guards the write endpoints, which arrive with US-113.
 */
@ApiTags('categories')
@ApiBearerAuth(BEARER_AUTH_NAME)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermission('ticket:view')
  @ApiOperation({
    summary: 'The categories a ticket can be filed under',
    description:
      'Active categories only, in the order an administrator arranged them. Not paginated ' +
      'on purpose — this is a picker, and a category list that needs paging is a category ' +
      'list nobody can navigate.',
  })
  @ApiZodResponse(200, CategorySchema, 'The categories')
  async list(): Promise<Category[]> {
    return this.categories.list();
  }
}
