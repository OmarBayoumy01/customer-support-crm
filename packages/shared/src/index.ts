export {
  HealthStatusSchema,
  DependencyStatusSchema,
  type HealthStatus,
  type DependencyStatus,
} from './dto/health.js';

export { ApiErrorCodeSchema, type ApiErrorCode } from './api/error-codes.js';

export {
  FieldErrorSchema,
  ApiErrorSchema,
  PaginationMetaSchema,
  apiSuccessSchema,
  apiPaginatedSchema,
  buildPaginationMeta,
  type FieldError,
  type ApiError,
  type PaginationMeta,
  type ApiSuccess,
  type ApiPaginated,
} from './api/envelope.js';

export {
  PermissionScopeSchema,
  PermissionKeySchema,
  EffectivePermissionsSchema,
  PERMISSION_KEYS,
  SYSTEM_ROLE_KEYS,
  splitPermissionKey,
  type PermissionScope,
  type PermissionKey,
  type EffectivePermissions,
  type SystemRoleKey,
} from './auth/permissions.js';

export {
  PaginationQuerySchema,
  toSkipTake,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  type PaginationQuery,
} from './api/pagination.js';
