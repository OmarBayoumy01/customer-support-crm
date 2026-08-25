import type { z } from 'zod';

/**
 * A class that carries a Zod schema as a static, so Nest's global pipe can find
 * it through the parameter's `metatype`.
 */
export interface ZodDto<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  new (): z.infer<TSchema>;
  readonly zodSchema: TSchema;
}

/**
 * Bridges Zod to Nest's parameter metadata.
 *
 * Nest hands a global pipe the declared *class* of a parameter, not an
 * arbitrary value — which is why validation libraries in this ecosystem are all
 * class-based. Wrapping a schema in a class is what lets `@Body() body: MyDto`
 * be validated globally (AC3: "before controller logic runs") instead of every
 * route remembering to attach its own pipe.
 *
 * The returned class is never instantiated. It exists to be a type and to carry
 * `zodSchema`, and US-8 reads the same static to generate the OpenAPI schema, so
 * the documented shape and the enforced shape cannot drift apart.
 *
 *   const CreateTicketSchema = z.object({ subject: z.string().min(1) });
 *   export class CreateTicketDto extends createZodDto(CreateTicketSchema) {}
 */
export function createZodDto<TSchema extends z.ZodTypeAny>(schema: TSchema): ZodDto<TSchema> {
  class ZodDtoClass {
    static readonly zodSchema = schema;
  }

  // Returned unasserted: the declared return type does the work. The class is
  // never instantiated — it stands in for `z.infer<TSchema>` at the type level
  // and carries the schema at runtime for the pipe to find.
  return ZodDtoClass;
}

/** Narrows an unknown metatype to something the pipe can validate with. */
export function isZodDto(metatype: unknown): metatype is ZodDto {
  return (
    typeof metatype === 'function' &&
    'zodSchema' in metatype &&
    typeof (metatype as { zodSchema?: unknown }).zodSchema === 'object'
  );
}
