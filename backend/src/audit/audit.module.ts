import { Module } from '@nestjs/common';

import { AuditService } from './audit.service.js';

/**
 * The platform-wide compliance trail.
 *
 * Global-ish by intent rather than by decorator: every administrative story
 * from here on imports it, starting with US-67.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
