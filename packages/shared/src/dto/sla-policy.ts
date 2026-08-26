/**
 * SLA policies — US-67.
 *
 * Shared rather than backend-only because US-70 adds the management screen over
 * exactly this shape, and two copies of a contract are two contracts.
 */
import { z } from 'zod';

import { CustomerTypeSchema } from './customer.js';
import { TicketPrioritySchema } from './ticket.js';

/** Which clock an escalation step watches. Matches `SlaClock` in Prisma. */
export const SlaClockSchema = z.enum(['FIRST_RESPONSE', 'RESOLUTION']);
export type SlaClock = z.infer<typeof SlaClockSchema>;

/** Who a step reaches for. Matches `EscalationTarget` in Prisma. */
export const EscalationTargetSchema = z.enum(['ASSIGNEE', 'DEPARTMENT_MANAGER', 'SPECIFIC_USER']);
export type EscalationTarget = z.infer<typeof EscalationTargetSchema>;

/**
 * One rung of the ladder — US-67 AC1, climbed by US-71.
 *
 * `atPercent` is a percentage of the target elapsed, not absolute minutes, so
 * one ladder shape works for a four-hour policy and a five-day one. It is
 * allowed past 100: a rung at 150 is "this is now badly overdue and nobody has
 * picked it up".
 */
export const SlaEscalationStepSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    clock: SlaClockSchema,
    atPercent: z.number().int().min(1).max(1000),
    notify: EscalationTargetSchema,
    notifyUserId: z.string().uuid().nullable().optional(),
    changeStatusToEscalated: z.boolean().default(false),
  })
  .refine(
    (step) => step.notify !== 'SPECIFIC_USER' || (step.notifyUserId ?? null) !== null,
    // Silently ignoring the missing id would give a step that notifies nobody
    // and reports success, which is the worst outcome for an escalation rule.
    { message: 'notifyUserId is required when notify is SPECIFIC_USER', path: ['notifyUserId'] },
  );

export type SlaEscalationStepInput = z.infer<typeof SlaEscalationStepSchema>;

/**
 * The applicability rules — AC2 and AC3.
 *
 * Every matcher is optional, and **omitting one means "matches anything"**.
 * A policy with no matchers at all is the platform fallback.
 */
export const SlaMatchersSchema = z.object({
  priority: TicketPrioritySchema.nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  customerType: CustomerTypeSchema.nullable().optional(),
  customerIsVip: z.boolean().nullable().optional(),
});

export const CreateSlaPolicySchema = SlaMatchersSchema.extend({
  nameEn: z.string().trim().min(2).max(120),
  nameAr: z.string().trim().min(2).max(120),
  firstResponseMinutes: z
    .number()
    .int()
    .positive()
    .max(60 * 24 * 365),
  resolutionMinutes: z
    .number()
    .int()
    .positive()
    .max(60 * 24 * 365),
  businessHoursOnly: z.boolean().default(true),
  isActive: z.boolean().default(true),
  escalationSteps: z.array(SlaEscalationStepSchema).max(10).default([]),
}).refine((policy) => policy.resolutionMinutes >= policy.firstResponseMinutes, {
  // A resolution target inside the response target is not a stricter promise,
  // it is an unreachable one, and every ticket under it breaches on creation.
  message: 'resolutionMinutes must be at least firstResponseMinutes',
  path: ['resolutionMinutes'],
});

export type CreateSlaPolicy = z.infer<typeof CreateSlaPolicySchema>;

/** Every field a policy can become. Matchers included — AC2 rules are editable. */
export const UpdateSlaPolicySchema = SlaMatchersSchema.extend({
  nameEn: z.string().trim().min(2).max(120).optional(),
  nameAr: z.string().trim().min(2).max(120).optional(),
  firstResponseMinutes: z
    .number()
    .int()
    .positive()
    .max(60 * 24 * 365)
    .optional(),
  resolutionMinutes: z
    .number()
    .int()
    .positive()
    .max(60 * 24 * 365)
    .optional(),
  businessHoursOnly: z.boolean().optional(),
  isActive: z.boolean().optional(),
  escalationSteps: z.array(SlaEscalationStepSchema).max(10).optional(),
});

export type UpdateSlaPolicy = z.infer<typeof UpdateSlaPolicySchema>;

export const SlaPolicySchema = z.object({
  id: z.string().uuid(),
  nameEn: z.string(),
  nameAr: z.string(),
  priority: TicketPrioritySchema.nullable(),
  categoryId: z.string().nullable(),
  departmentId: z.string().nullable(),
  branchId: z.string().nullable(),
  customerType: CustomerTypeSchema.nullable(),
  customerIsVip: z.boolean().nullable(),
  /**
   * How specific this policy is, as a number. Derived — see
   * `SLA_MATCHER_WEIGHTS`. Exposed because the management screen needs to
   * explain why one policy beat another.
   */
  specificity: z.number().int().nonnegative(),
  firstResponseMinutes: z.number().int().positive(),
  resolutionMinutes: z.number().int().positive(),
  businessHoursOnly: z.boolean(),
  isActive: z.boolean(),
  escalationSteps: z.array(SlaEscalationStepSchema.innerType().extend({ id: z.string().uuid() })),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SlaPolicy = z.infer<typeof SlaPolicySchema>;

/**
 * What a ticket has to state about itself to be matched against a policy.
 *
 * Everything is nullable because a ticket may genuinely have no category, no
 * department and no branch, and a policy that matches on one of those must not
 * apply to a ticket that has none.
 */
export interface SlaTicketFacts {
  priority: z.infer<typeof TicketPrioritySchema>;
  categoryId: string | null;
  departmentId: string | null;
  branchId: string | null;
  customerType: z.infer<typeof CustomerTypeSchema> | null;
  customerIsVip: boolean;
}
