import { Module } from '@nestjs/common';

import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

/**
 * Customer records — US-33.
 *
 * The service is exported because US-120's seed writes through it rather than
 * straight to Prisma: a seed that bypasses the service can produce a shape the
 * API would have rejected, and then every screen is built against data that
 * cannot happen.
 */
@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
