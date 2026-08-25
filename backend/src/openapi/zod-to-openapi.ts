import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Converts a Zod schema into an OpenAPI 3 schema object.
 *
 * Written rather than pulled in as a dependency, for two reasons. The obvious
 * one is that `zod-to-json-schema` is outside the approved stack. The better one
 * is that this converter is **strict**: it throws on a node it does not
 * understand, so an undocumented shape fails the build instead of silently
 * appearing in the docs as `{}`. A permissive converter that guesses is worse
 * than no converter, because the guess is what the frontend then builds against.
 *
 * The installed Zod is 3.25, which ships the Zod 4 implementation under the
 * `zod/v4` subpath along with a real `toJSONSchema`. Migrating `packages/shared`
 * to that API is a sensible follow-up — `.datetime()` moves to `z.iso.datetime()`
 * and a handful of other calls change — but it is not something to do inside a
 * "should have" documentation story.
 *
 * Supported: object, string, number, boolean, literal, enum, native enum, array,
 * record, union, optional, nullable, default, effects (transform / refine), lazy,
 * date, any, unknown.
 */
export function zodToOpenApi(schema: z.ZodTypeAny): SchemaObject {
  const def = schema._def as { typeName?: string } & Record<string, unknown>;

  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodString:
      return stringSchema(schema as z.ZodString);

    case z.ZodFirstPartyTypeKind.ZodNumber:
      return numberSchema(schema as z.ZodNumber);

    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { type: 'boolean' };

    case z.ZodFirstPartyTypeKind.ZodDate:
      return { type: 'string', format: 'date-time' };

    case z.ZodFirstPartyTypeKind.ZodLiteral: {
      const value = (def as { value: unknown }).value;
      return { type: typeof value === 'number' ? 'number' : 'string', enum: [value] };
    }

    case z.ZodFirstPartyTypeKind.ZodEnum:
      return { type: 'string', enum: [...(def as { values: string[] }).values] };

    case z.ZodFirstPartyTypeKind.ZodNativeEnum:
      return {
        type: 'string',
        enum: Object.values((def as { values: Record<string, string> }).values),
      };

    case z.ZodFirstPartyTypeKind.ZodArray:
      return {
        type: 'array',
        items: zodToOpenApi((def as { type: z.ZodTypeAny }).type),
      };

    case z.ZodFirstPartyTypeKind.ZodObject:
      return objectSchema(schema as z.ZodObject<z.ZodRawShape>);

    case z.ZodFirstPartyTypeKind.ZodRecord:
      return {
        type: 'object',
        additionalProperties: zodToOpenApi((def as { valueType: z.ZodTypeAny }).valueType),
      };

    case z.ZodFirstPartyTypeKind.ZodUnion:
      return {
        oneOf: (def as { options: z.ZodTypeAny[] }).options.map((option) => zodToOpenApi(option)),
      };

    case z.ZodFirstPartyTypeKind.ZodOptional:
      // Optionality is expressed by the parent's `required` list, not here.
      return zodToOpenApi((def as { innerType: z.ZodTypeAny }).innerType);

    case z.ZodFirstPartyTypeKind.ZodNullable:
      return { ...zodToOpenApi((def as { innerType: z.ZodTypeAny }).innerType), nullable: true };

    case z.ZodFirstPartyTypeKind.ZodDefault: {
      const inner = zodToOpenApi((def as { innerType: z.ZodTypeAny }).innerType);
      const defaultValue = (def as { defaultValue: () => unknown }).defaultValue();
      return { ...inner, default: defaultValue };
    }

    case z.ZodFirstPartyTypeKind.ZodEffects:
      // `.transform()` and `.refine()` wrap a schema without changing the shape
      // a client must send, which is what the docs describe.
      return zodToOpenApi((def as { schema: z.ZodTypeAny }).schema);

    case z.ZodFirstPartyTypeKind.ZodLazy:
      return zodToOpenApi((def as { getter: () => z.ZodTypeAny }).getter());

    case z.ZodFirstPartyTypeKind.ZodAny:
    case z.ZodFirstPartyTypeKind.ZodUnknown:
      return {};

    default:
      throw new Error(
        `zodToOpenApi does not understand "${String(def.typeName)}". Add a case for it — ` +
          'guessing would put a shape in the documentation that the API does not accept.',
      );
  }
}

function stringSchema(schema: z.ZodString): SchemaObject {
  const result: SchemaObject = { type: 'string' };

  for (const check of schema._def.checks) {
    switch (check.kind) {
      case 'min':
        result.minLength = check.value;
        break;
      case 'max':
        result.maxLength = check.value;
        break;
      case 'email':
        result.format = 'email';
        break;
      case 'url':
        result.format = 'uri';
        break;
      case 'uuid':
        result.format = 'uuid';
        break;
      case 'datetime':
        result.format = 'date-time';
        break;
      case 'regex':
        result.pattern = check.regex.source;
        break;
      default:
        // Other checks constrain values without changing the documented type.
        break;
    }
  }

  return result;
}

function numberSchema(schema: z.ZodNumber): SchemaObject {
  const result: SchemaObject = { type: 'number' };

  for (const check of schema._def.checks) {
    switch (check.kind) {
      case 'int':
        result.type = 'integer';
        break;
      case 'min':
        result.minimum = check.value;
        if (!check.inclusive) {
          result.exclusiveMinimum = true;
        }
        break;
      case 'max':
        result.maximum = check.value;
        if (!check.inclusive) {
          result.exclusiveMaximum = true;
        }
        break;
      default:
        break;
    }
  }

  return result;
}

function objectSchema(schema: z.ZodObject<z.ZodRawShape>): SchemaObject {
  const properties: Record<string, SchemaObject> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(schema.shape)) {
    properties[key] = zodToOpenApi(value);

    if (!value.isOptional()) {
      required.push(key);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}
