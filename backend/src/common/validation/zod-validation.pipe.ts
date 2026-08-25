import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { FieldError } from '@crm/shared';
import { ZodError, type z } from 'zod';

import { ApiException } from '../errors/api.exception.js';
import { isZodDto } from './create-zod-dto.js';

/** Zod's issue paths are arrays; the wire format is a dotted string. */
export function formatZodIssues(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

/**
 * Validates every `@Body()`, `@Query()`, and `@Param()` whose declared type was
 * built with `createZodDto` (AC3).
 *
 * Registered globally in `app.module.ts`, so it runs before controller logic on
 * every route without each one opting in. Parameters typed as anything else —
 * `string`, a raw interface, Nest's own decorators — pass straight through
 * untouched, which keeps this from breaking routes that never asked for it.
 *
 * The parsed value is *returned*, not just checked, so the controller receives
 * coerced and defaulted data: `page` arrives as a number, `pageSize` already
 * clamped.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const { metatype } = metadata;

    if (!isZodDto(metatype)) {
      return value;
    }

    const schema: z.ZodTypeAny = metatype.zodSchema;
    const result = schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    throw new ApiException(
      'VALIDATION_FAILED',
      `The ${metadata.type} failed validation.`,
      formatZodIssues(result.error),
    );
  }
}

export { ZodError };
