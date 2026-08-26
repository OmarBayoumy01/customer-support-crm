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

export {
  TOKEN_AUDIENCES,
  TokenAudienceSchema,
  AccessTokenClaimsSchema,
  ACCESS_TOKEN_TTL_SECONDS,
  type TokenAudience,
  type AccessTokenClaims,
} from './auth/tokens.js';

export {
  LocaleSchema,
  LoginRequestSchema,
  AuthenticatedUserSchema,
  LoginResponseSchema,
  type Locale,
  type LoginRequest,
  type AuthenticatedUser,
  type LoginResponse,
} from './auth/login.js';

export {
  CustomerTypeSchema,
  ChannelSchema,
  CreateCustomerSchema,
  UpdateCustomerSchema,
  CustomerListQuerySchema,
  CustomerStatsSchema,
  CustomerSchema,
  DuplicateCustomerSchema,
  type CustomerType,
  type Channel,
  type CreateCustomer,
  type UpdateCustomer,
  type CustomerListQuery,
  type CustomerStats,
  type Customer,
  type DuplicateCustomer,
} from './dto/customer.js';

export {
  TicketStatusSchema,
  TicketPrioritySchema,
  SlaStateSchema,
  CreateTicketSchema,
  UpdateTicketSchema,
  TicketListQuerySchema,
  TicketCustomerSchema,
  TicketSlaSchema,
  TicketSchema,
  TicketMessageSchema,
  TicketHistoryEntrySchema,
  TicketAttachmentSchema,
  TicketDetailSchema,
  type TicketStatus,
  type TicketPriority,
  type SlaState,
  type CreateTicket,
  type UpdateTicket,
  type TicketListQuery,
  type Ticket,
  type TicketDetail,
  type TicketMessage,
  type TicketHistoryEntry,
} from './dto/ticket.js';

export {
  SlaClockSchema,
  EscalationTargetSchema,
  SlaEscalationStepSchema,
  SlaMatchersSchema,
  CreateSlaPolicySchema,
  UpdateSlaPolicySchema,
  SlaPolicySchema,
  type SlaClock,
  type EscalationTarget,
  type SlaEscalationStepInput,
  type CreateSlaPolicy,
  type UpdateSlaPolicy,
  type SlaPolicy,
  type SlaTicketFacts,
} from './dto/sla-policy.js';
