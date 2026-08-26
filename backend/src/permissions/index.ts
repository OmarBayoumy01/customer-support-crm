export { PermissionsModule } from './permissions.module.js';
export { PermissionsService } from './permissions.service.js';
export { RolesService, type CreateRoleInput, type RoleGrantInput } from './roles.service.js';
export { ticketScopeWhere, isUnrestricted, type ScopeContext } from './scope.js';
export {
  PERMISSION_CATALOGUE,
  SYSTEM_ROLES,
  systemRole,
  type PermissionDefinition,
  type RoleDefinition,
  type Grant,
} from './permission-catalogue.js';
