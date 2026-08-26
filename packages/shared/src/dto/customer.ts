/**
 * The customer contract, shared by both sides — US-33.
 *
 * As with every other schema in this package: it describes, it does not enforce.
 * The browser validates a form against it and the server validates the body
 * against the same object, so a rule cannot be applied in one place and
 * forgotten in the other.
 */
import { z } from 'zod';

import { LocaleSchema } from '../auth/login.js';
import { PaginationQuerySchema } from '../api/pagination.js';

/** Matches `CustomerType` in the Prisma schema. */
export const CustomerTypeSchema = z.enum(['INDIVIDUAL', 'COMPANY']);
export type CustomerType = z.infer<typeof CustomerTypeSchema>;

/** Matches `Channel` in the Prisma schema. */
export const ChannelSchema = z.enum(['EMAIL', 'WHATSAPP', 'CHAT', 'SMS', 'WEB']);
export type Channel = z.infer<typeof ChannelSchema>;

/**
 * A loose phone shape on purpose.
 *
 * A support desk takes numbers over the phone from anywhere, in whatever form
 * the caller reads them out. Strict E.164 validation here would reject real
 * numbers an agent needs to record right now, and the cost of a slightly messy
 * string is far lower than the cost of not being able to save the customer.
 */
const PhoneSchema = z
  .string()
  .trim()
  .min(4)
  .max(32)
  .regex(/^[+()\-\s\d]+$/, 'Enter a phone number');

export const CreateCustomerSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email().optional(),
    phone: PhoneSchema.optional(),
    companyName: z.string().trim().max(160).optional(),
    type: CustomerTypeSchema.default('INDIVIDUAL'),
    preferredLocale: LocaleSchema.default('EN'),
    preferredChannel: ChannelSchema.optional(),
    departmentId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    externalRef: z.string().trim().max(64).optional(),
    /**
     * Set on the second attempt to accept a possible duplicate — AC2.
     *
     * The first attempt answers 409 with the existing record. Two people
     * genuinely share a landline, and a desk that cannot record the second one
     * is broken in a way the agent cannot work around.
     */
    confirmDuplicate: z.boolean().optional(),
  })
  .refine((value) => value.email !== undefined || value.phone !== undefined, {
    message: 'A customer needs an email address or a phone number',
    path: ['email'],
  });

export type CreateCustomer = z.infer<typeof CreateCustomerSchema>;

/** Every field optional; `confirmDuplicate` is not part of an update. */
export const UpdateCustomerSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().toLowerCase().email().nullable().optional(),
  phone: PhoneSchema.nullable().optional(),
  companyName: z.string().trim().max(160).nullable().optional(),
  type: CustomerTypeSchema.optional(),
  isVip: z.boolean().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  preferredLocale: LocaleSchema.optional(),
  preferredChannel: ChannelSchema.nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  externalRef: z.string().trim().max(64).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateCustomer = z.infer<typeof UpdateCustomerSchema>;

/** AC3 — every filter is applied in the database, never after fetching. */
export const CustomerListQuerySchema = PaginationQuerySchema.extend({
  /** Matched against name, email, phone and company. */
  q: z.string().trim().max(120).optional(),
  type: CustomerTypeSchema.optional(),
  departmentId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  isActive: z.enum(['true', 'false']).optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  sort: z.enum(['name', 'createdAt', 'openTickets']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
});

export type CustomerListQuery = z.infer<typeof CustomerListQuerySchema>;

/**
 * The derived fields AC4 asks for, on every row.
 *
 * `satisfactionScore` is **always `null` for now**: it needs ratings, which are
 * US-88 and deferred. It is in the contract so consumers can be written once,
 * and a fabricated number would be worse than an honest absence.
 */
export const CustomerStatsSchema = z.object({
  openTickets: z.number().int().nonnegative(),
  totalTickets: z.number().int().nonnegative(),
  lastInteractionAt: z.string().datetime().nullable(),
  satisfactionScore: z.number().nullable(),
});

export type CustomerStats = z.infer<typeof CustomerStatsSchema>;

export const CustomerSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  companyName: z.string().nullable(),
  type: CustomerTypeSchema,
  /** US-67, AC3 — a VIP takes the VIP SLA policy over the general one. */
  isVip: z.boolean(),
  /** Standing context an agent keeps — US-45, AC4. */
  notes: z.string().nullable(),
  preferredLocale: LocaleSchema,
  preferredChannel: ChannelSchema.nullable(),
  departmentId: z.string().nullable(),
  branchId: z.string().nullable(),
  externalRef: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  stats: CustomerStatsSchema,
});

export type Customer = z.infer<typeof CustomerSchema>;

/**
 * What a 409 from `POST /customers` carries — AC2.
 *
 * The existing record travels with the refusal so the agent can look at it and
 * decide, rather than being told "duplicate" and left to go and search.
 */
export const DuplicateCustomerSchema = z.object({
  matchedOn: z.enum(['email', 'phone']),
  existing: CustomerSchema,
});

export type DuplicateCustomer = z.infer<typeof DuplicateCustomerSchema>;
