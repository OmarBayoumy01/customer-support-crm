import { z } from 'zod';
import { CreateCustomerSchema, CustomerListQuerySchema, UpdateCustomerSchema } from '@crm/shared';

import { createZodDto } from '../../common/index.js';

/** Wraps the **shared** schemas rather than restating them — US-33. */
export class CreateCustomerDto extends createZodDto(CreateCustomerSchema) {}
export class UpdateCustomerDto extends createZodDto(UpdateCustomerSchema) {}
export class CustomerListQueryDto extends createZodDto(CustomerListQuerySchema) {}

/**
 * At least one of the two, or there is nothing to check.
 *
 * Answering "no duplicate" to an empty query would be true and useless, and it
 * would hide a caller that forgot to send anything.
 */
export const DuplicateCheckQuerySchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().min(4).max(32).optional(),
  })
  .refine((value) => value.email !== undefined || value.phone !== undefined, {
    message: 'Provide an email or a phone number to check',
    path: ['email'],
  });

export class DuplicateCheckQueryDto extends createZodDto(DuplicateCheckQuerySchema) {}
