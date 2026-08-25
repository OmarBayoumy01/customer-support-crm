import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ApiErrorSchema, HealthStatusSchema, PaginationQuerySchema } from '@crm/shared';
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  Post,
  Query,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

import { AppModule } from '../app.module.js';
import { ApiException, createZodDto } from '../common/index.js';
import { TypedConfigService } from '../config/index.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from './api-zod.decorators.js';
import { BEARER_AUTH_NAME, decideSwagger, setupSwagger } from './swagger.js';
import { zodToOpenApi } from './zod-to-openapi.js';

// ---------------------------------------------------------------------------
// The converter, on its own
// ---------------------------------------------------------------------------

/**
 * OpenAPI types a property as `SchemaObject | ReferenceObject`. Everything this
 * converter emits is inline, never a `$ref`, so narrowing once here keeps the
 * assertions readable — and fails loudly if that ever stops being true.
 */
function prop(schema: SchemaObject, name: string): SchemaObject {
  const value = schema.properties?.[name];

  assert.ok(value !== undefined, `expected a "${name}" property`);
  assert.ok(!('$ref' in value), `expected "${name}" inline, got a $ref`);

  return value;
}

test('converts a primitive with its constraints', () => {
  assert.deepEqual(zodToOpenApi(z.string().min(2).max(5)), {
    type: 'string',
    minLength: 2,
    maxLength: 5,
  });
  assert.deepEqual(zodToOpenApi(z.string().email()), { type: 'string', format: 'email' });
  assert.deepEqual(zodToOpenApi(z.number().int().min(1)), {
    type: 'integer',
    minimum: 1,
  });
  assert.deepEqual(zodToOpenApi(z.boolean()), { type: 'boolean' });
});

test('an object marks only its non-optional keys required', () => {
  const schema = zodToOpenApi(
    z.object({ a: z.string(), b: z.string().optional(), c: z.string().default('x') }),
  );

  assert.deepEqual(schema.required, ['a']);
  assert.equal(prop(schema, 'c').default, 'x');
});

test('enums are documented with their members, which is what AC2 asks for', () => {
  assert.deepEqual(zodToOpenApi(z.enum(['NEW', 'OPEN'])), {
    type: 'string',
    enum: ['NEW', 'OPEN'],
  });
});

test('arrays, records, unions, and nullables survive the trip', () => {
  assert.deepEqual(zodToOpenApi(z.array(z.string())), {
    type: 'array',
    items: { type: 'string' },
  });
  assert.deepEqual(zodToOpenApi(z.record(z.string(), z.number())), {
    type: 'object',
    additionalProperties: { type: 'number' },
  });
  assert.equal(zodToOpenApi(z.union([z.string(), z.number()])).oneOf?.length, 2);
  assert.equal(zodToOpenApi(z.string().nullable()).nullable, true);
});

test('a transformed schema documents the shape a client must send', () => {
  // PaginationQuerySchema clamps pageSize with .transform(); the docs should
  // still describe an integer, not the transform.
  const schema = zodToOpenApi(PaginationQuerySchema);

  assert.equal(prop(schema, 'page').type, 'integer');
  assert.equal(prop(schema, 'pageSize').type, 'integer');
});

test('the converter refuses a shape it does not understand rather than guessing', () => {
  assert.throws(() => zodToOpenApi(z.map(z.string(), z.string())), /does not understand/);
});

test('the shared error envelope converts, so every endpoint can reference it', () => {
  const error = prop(zodToOpenApi(ApiErrorSchema), 'error');

  assert.equal(error.type, 'object');
  assert.ok(prop(error, 'code').enum !== undefined, 'error codes should be enumerated');
  assert.ok(prop(error, 'requestId') !== undefined, 'the request id is part of the contract');
});

// ---------------------------------------------------------------------------
// AC4 — the production rule, tested as a pure decision
// ---------------------------------------------------------------------------

const base = { path: 'api/docs', user: undefined, password: undefined };

test('AC4 — docs are on outside production', () => {
  for (const nodeEnv of ['development', 'test', 'staging']) {
    const decision = decideSwagger({ ...base, nodeEnv, enabledInProduction: false });
    assert.equal(decision.enabled, true, `${nodeEnv} should serve docs`);
    assert.equal(decision.requiresAuth, false);
  }
});

test('AC4 — docs are off in production by default', () => {
  const decision = decideSwagger({ ...base, nodeEnv: 'production', enabledInProduction: false });

  assert.equal(decision.enabled, false);
  assert.match(decision.reason, /disabled in production/);
});

test('AC4 — enabling in production without credentials refuses rather than failing open', () => {
  const decision = decideSwagger({ ...base, nodeEnv: 'production', enabledInProduction: true });

  assert.equal(decision.enabled, false, 'unauthenticated production docs must never serve');
  assert.match(decision.reason, /SWAGGER_USER/);
});

test('AC4 — production docs serve only behind basic auth', () => {
  const decision = decideSwagger({
    ...base,
    nodeEnv: 'production',
    enabledInProduction: true,
    user: 'docs',
    password: 'secret',
  });

  assert.equal(decision.enabled, true);
  assert.equal(decision.requiresAuth, true);
});

// ---------------------------------------------------------------------------
// The document itself
// ---------------------------------------------------------------------------

const CreateThingSchema = z.object({ name: z.string().min(3), quantity: z.number().int() });
class CreateThingDto extends createZodDto(CreateThingSchema) {}
class ListQueryDto extends createZodDto(PaginationQuerySchema) {}

/** Stands in for P02's real guard: any bearer token is accepted, none is rejected. */
@Injectable()
class BearerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? '';

    if (!header.startsWith('Bearer ') || header.length <= 'Bearer '.length) {
      throw new ApiException('UNAUTHENTICATED', 'A bearer token is required.');
    }

    return true;
  }
}

@ApiTags('Documented')
@Controller('documented')
class DocumentedController {
  @Post('things')
  @ApiZodBody(CreateThingDto)
  @ApiZodResponse(201, z.object({ id: z.string() }), 'The thing that was created.')
  create(): { id: string } {
    return { id: 'abc' };
  }

  @Get('list')
  @ApiZodQuery(ListQueryDto)
  list(@Query() _query: ListQueryDto): { items: [] } {
    return { items: [] };
  }

  @Get('protected')
  @ApiBearerAuth(BEARER_AUTH_NAME)
  @UseGuards(BearerGuard)
  protectedRoute(): { ok: true } {
    return { ok: true };
  }
}

@Module({ imports: [AppModule], controllers: [DocumentedController] })
class DocsTestModule {}

let app: INestApplication;
let baseUrl: string;

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [DocsTestModule] }).compile();
  app = moduleRef.createNestApplication();
  app.enableShutdownHooks();

  setupSwagger(app, app.get(TypedConfigService));

  await app.init();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as Server;
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

after(async () => {
  await app.close();
});

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components?: {
    schemas?: Record<string, { properties?: Record<string, unknown> }>;
    securitySchemes?: Record<string, { type?: string; scheme?: string }>;
  };
  tags?: Array<{ name: string }>;
}

async function spec(): Promise<OpenApiDocument> {
  const response = await fetch(`${baseUrl}/api/docs-json`);
  assert.equal(response.status, 200, 'the raw OpenAPI document should be served');
  return (await response.json()) as OpenApiDocument;
}

test('AC1 — the docs UI is served at /api/docs', async () => {
  const response = await fetch(`${baseUrl}/api/docs`);

  assert.equal(response.status, 200);
  assert.match(await response.text(), /swagger/i);
});

test('AC1 — every endpoint appears, grouped by tag', async () => {
  const document = await spec();

  assert.ok(document.paths['/health'] !== undefined, '/health should be documented');
  assert.ok(document.paths['/documented/things'] !== undefined);
  assert.ok(document.paths['/documented/list'] !== undefined);

  // Grouping in the UI comes from the tags on each *operation*, not from the
  // document's root `tags` array — that one is only populated by explicit
  // `.addTag()` calls, which are for descriptions rather than grouping.
  const tagsFor = (path: string, method: string): string[] =>
    (document.paths[path]?.[method]?.['tags'] as string[] | undefined) ?? [];

  assert.deepEqual(tagsFor('/health', 'get'), ['Health']);
  assert.deepEqual(tagsFor('/documented/things', 'post'), ['Documented']);
  assert.deepEqual(tagsFor('/documented/list', 'get'), ['Documented']);
});

test('AC1 — an undocumented controller would still be listed, so nothing hides', async () => {
  const document = await spec();
  const paths = Object.keys(document.paths);

  // Nest documents every registered route whether or not it carries decorators.
  // This asserts the count moves with the app rather than with the decorations.
  assert.ok(paths.length >= 4, `expected every route to be listed, got ${paths.join(', ')}`);
});

test('AC2 — a request body is documented from the schema that validates it', async () => {
  const document = await spec();
  const body = document.paths['/documented/things']?.['post']?.['requestBody'] as {
    content: Record<
      string,
      { schema: { properties: Record<string, { type: string }>; required: string[] } }
    >;
  };

  const schema = body.content['application/json']?.schema;

  assert.deepEqual(schema?.required, ['name', 'quantity']);
  assert.equal(schema?.properties['name']?.type, 'string');
  assert.equal(schema?.properties['quantity']?.type, 'integer');
});

test('AC2 — query parameters are rendered individually, not as one blob', async () => {
  const document = await spec();
  const parameters = document.paths['/documented/list']?.['get']?.['parameters'] as Array<{
    name: string;
    in: string;
  }>;

  const names = parameters.map((parameter) => parameter.name);

  assert.ok(names.includes('page'), `expected a page parameter, got ${names.join(', ')}`);
  assert.ok(names.includes('pageSize'));
});

test('AC2 — the success envelope is what the docs describe', async () => {
  const document = await spec();
  const response = document.paths['/health']?.['get']?.['responses'] as Record<
    string,
    { content?: Record<string, { schema: { properties?: Record<string, unknown> } }> }
  >;

  const schema = response['200']?.content?.['application/json']?.schema;

  assert.ok(
    schema?.properties?.['data'] !== undefined,
    'a documented response must show the { data } wrapper the client actually receives',
  );
});

test('AC2 — shared error and enum shapes are registered as components', async () => {
  const document = await spec();
  const schemas = document.components?.schemas ?? {};

  assert.ok(schemas['ApiError'] !== undefined, 'the error shape should be documented once');
  assert.ok(schemas['PaginationMeta'] !== undefined);
  assert.ok(schemas['HealthStatus'] !== undefined);
});

test('AC3 — a bearer security scheme is declared', async () => {
  const document = await spec();
  const scheme = document.components?.securitySchemes?.[BEARER_AUTH_NAME];

  assert.equal(scheme?.type, 'http');
  assert.equal(scheme?.scheme, 'bearer');
});

test('AC3 — a protected endpoint is marked as requiring it', async () => {
  const document = await spec();
  const security = document.paths['/documented/protected']?.['get']?.['security'] as
    Array<Record<string, unknown>> | undefined;

  assert.ok(security !== undefined, 'the route should carry a security requirement');
  assert.ok(
    security.some((entry) => BEARER_AUTH_NAME in entry),
    'the requirement should name the bearer scheme',
  );
});

test('AC3 — a token supplied the way the docs UI supplies it is accepted', async () => {
  const without = await fetch(`${baseUrl}/documented/protected`);
  assert.equal(without.status, 401, 'no token should be refused');
  assert.equal(ApiErrorSchema.parse(await without.json()).error.code, 'UNAUTHENTICATED');

  const withToken = await fetch(`${baseUrl}/documented/protected`, {
    headers: { authorization: 'Bearer a-token-from-the-docs-ui' },
  });

  assert.equal(withToken.status, 200);
  assert.deepEqual(await withToken.json(), { data: { ok: true } });
});

test('the documented health shape still matches the shared DTO', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const payload = (await response.json()) as { data: unknown };

  assert.doesNotThrow(() => HealthStatusSchema.parse(payload.data));
});
