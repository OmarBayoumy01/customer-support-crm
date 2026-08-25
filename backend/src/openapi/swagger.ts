import { timingSafeEqual } from 'node:crypto';

import { Logger, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import { ApiErrorSchema, HealthStatusSchema, PaginationMetaSchema } from '@crm/shared';
import type { NextFunction, Request, Response } from 'express';

import { TypedConfigService } from '../config/index.js';
import { zodToOpenApi } from './zod-to-openapi.js';

/** The name the `@ApiBearerAuth()` decorator refers to. */
export const BEARER_AUTH_NAME = 'bearer';

export interface SwaggerDecision {
  enabled: boolean;
  requiresAuth: boolean;
  path: string;
  reason: string;
}

/**
 * Decides whether the docs are served, and whether they are protected (AC4).
 *
 * Pulled out as a pure function so the rule is testable without booting an app
 * and without setting NODE_ENV=production on a live process.
 *
 * Outside production: always on, never protected. In production: off unless
 * explicitly enabled **and** credentials are configured. Enabling without
 * credentials does not fall back to serving them openly — it refuses, and says
 * why in the log. A misconfiguration that publishes the whole API surface is
 * not the kind of thing to fail open on.
 */
export function decideSwagger(input: {
  nodeEnv: string;
  enabledInProduction: boolean;
  path: string;
  user: string | undefined;
  password: string | undefined;
}): SwaggerDecision {
  if (input.nodeEnv !== 'production') {
    return {
      enabled: true,
      requiresAuth: false,
      path: input.path,
      reason: `enabled — NODE_ENV is ${input.nodeEnv}`,
    };
  }

  if (!input.enabledInProduction) {
    return {
      enabled: false,
      requiresAuth: false,
      path: input.path,
      reason: 'disabled in production — set SWAGGER_ENABLED_IN_PRODUCTION=true to change that',
    };
  }

  const hasCredentials =
    input.user !== undefined &&
    input.user !== '' &&
    input.password !== undefined &&
    input.password !== '';

  if (!hasCredentials) {
    return {
      enabled: false,
      requiresAuth: false,
      path: input.path,
      reason:
        'refused in production — SWAGGER_ENABLED_IN_PRODUCTION is set but SWAGGER_USER ' +
        'and SWAGGER_PASSWORD are not, and unauthenticated docs will not be served',
    };
  }

  return {
    enabled: true,
    requiresAuth: true,
    path: input.path,
    reason: 'enabled in production behind basic auth',
  };
}

/** Constant-time compare, so a wrong password cannot be found a byte at a time. */
function matches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

function basicAuth(user: string, password: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const header = request.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');

    if (scheme === 'Basic' && encoded !== undefined) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const suppliedUser = decoded.slice(0, separator);
      const suppliedPassword = decoded.slice(separator + 1);

      if (matches(suppliedUser, user) && matches(suppliedPassword, password)) {
        next();
        return;
      }
    }

    response.setHeader('WWW-Authenticate', 'Basic realm="API documentation"');
    response.status(401).send('Authentication required.');
  };
}

/**
 * The shapes every endpoint shares, registered once as components so each route
 * can reference them instead of repeating them (AC2).
 */
function sharedComponents(): Record<string, SchemaObject> {
  return {
    ApiError: zodToOpenApi(ApiErrorSchema),
    PaginationMeta: zodToOpenApi(PaginationMetaSchema),
    HealthStatus: zodToOpenApi(HealthStatusSchema),
  };
}

/**
 * Mounts the documentation, or deliberately does not.
 *
 * Returns the decision so `index.ts` can log it and tests can assert on it.
 */
export function setupSwagger(app: INestApplication, config: TypedConfigService): SwaggerDecision {
  const decision = decideSwagger({
    nodeEnv: config.get('NODE_ENV'),
    enabledInProduction: config.get('SWAGGER_ENABLED_IN_PRODUCTION'),
    path: config.get('SWAGGER_PATH'),
    user: config.get('SWAGGER_USER'),
    password: config.get('SWAGGER_PASSWORD'),
  });

  const logger = new Logger('Swagger');

  if (!decision.enabled) {
    logger.log(`API documentation ${decision.reason}`);
    return decision;
  }

  if (decision.requiresAuth) {
    const user = config.get('SWAGGER_USER');
    const password = config.get('SWAGGER_PASSWORD');

    if (user !== undefined && password !== undefined) {
      // Guard the UI, its assets, and the raw JSON alike.
      app.use(`/${decision.path}`, basicAuth(user, password));
      app.use(`/${decision.path}-json`, basicAuth(user, password));
    }
  }

  const builder = new DocumentBuilder()
    .setTitle('Customer Support CRM API')
    .setDescription(
      [
        'Multi-role customer support and helpdesk platform.',
        '',
        'Every successful response is wrapped in `{ "data": ... }`; list endpoints add a',
        '`pagination` block. Every failure returns the `ApiError` shape, carrying a',
        'machine-readable `code`, a human `message`, and the `requestId` from the',
        '`x-request-id` response header.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      // Named so `@ApiBearerAuth(BEARER_AUTH_NAME)` on a controller lines up.
      BEARER_AUTH_NAME,
    )
    .build();

  const document = SwaggerModule.createDocument(app, builder);

  document.components ??= {};
  document.components.schemas = { ...document.components.schemas, ...sharedComponents() };

  SwaggerModule.setup(decision.path, app, document, {
    swaggerOptions: {
      // The token typed into "Authorize" survives a page reload, which is the
      // difference between the docs being usable and being a demo (AC3).
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  logger.log(`API documentation ${decision.reason}, at /${decision.path}`);

  return decision;
}
