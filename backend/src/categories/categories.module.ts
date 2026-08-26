import { Module } from '@nestjs/common';

import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';

/**
 * Categories — the read half, from US-49.
 *
 * `US-113` adds the management screen and the write endpoints over this same
 * service.
 */
@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
