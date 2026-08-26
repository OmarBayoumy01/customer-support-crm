import { Global, Module } from '@nestjs/common';

import { PermissionsGuard } from './permissions.guard.js';
import { PermissionsService } from './permissions.service.js';
import { RolesService } from './roles.service.js';

/**
 * Roles and permissions.
 *
 * Global because **US-22's guard will run on every request**, and a guard that
 * has to be wired into each feature module is a guard someone forgets.
 *
 * The admin UI that edits roles is US-115; the HTTP endpoints it calls arrive
 * with it. This module is the model and the resolution logic only.
 */
@Global()
@Module({
  providers: [PermissionsService, RolesService, PermissionsGuard],
  exports: [PermissionsService, RolesService, PermissionsGuard],
})
export class PermissionsModule {}
