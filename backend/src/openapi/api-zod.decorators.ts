import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiQuery, ApiResponse, type SchemaObject } from '@nestjs/swagger';

import type { z } from 'zod';

import type { ZodDto } from '../common/index.js';
import { zodToOpenApi } from './zod-to-openapi.js';

/**
 * Documents a request body from the very schema that validates it (AC2).
 *
 * The point of reading `zodSchema` rather than re-declaring the shape with
 * `@ApiProperty()` is that the documentation cannot drift from the enforcement.
 * Change the Zod schema and the docs change with it; there is no second place to
 * forget to update.
 */
export function ApiZodBody(dto: ZodDto): MethodDecorator {
  return ApiBody({ schema: zodToOpenApi(dto.zodSchema) });
}

/**
 * Documents query parameters from a schema, one entry per top-level key, so the
 * Swagger UI renders real input boxes instead of one opaque object.
 */
export function ApiZodQuery(dto: ZodDto): MethodDecorator {
  const schema = zodToOpenApi(dto.zodSchema);
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  return applyDecorators(
    ...Object.entries(properties).map(([name, property]) =>
      ApiQuery({
        name,
        required: required.has(name),
        schema: property as SchemaObject,
      }),
    ),
  );
}

/**
 * Documents a success response, wrapped in the `{ data }` envelope US-7
 * established — so what the docs show is what the client actually receives.
 */
export function ApiZodResponse(
  status: number,
  schema: z.ZodTypeAny,
  description?: string,
): MethodDecorator {
  return ApiResponse({
    status,
    ...(description === undefined ? {} : { description }),
    schema: {
      type: 'object',
      properties: { data: zodToOpenApi(schema) },
      required: ['data'],
    },
  });
}

/** Re-exported so controllers import their documentation helpers from one place. */
export { ApiExtraModels };
