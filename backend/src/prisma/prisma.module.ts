import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

/**
 * Global so feature modules can inject `PrismaService` without re-importing
 * this module in each of them. There is exactly one connection pool per
 * process, and no reason for a second.
 */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
