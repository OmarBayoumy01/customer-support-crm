import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { TypedConfigModule, TypedConfigService } from '../config/index.js';
import { AllExceptionsFilter } from './filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from './interceptors/response-envelope.interceptor.js';
import { defaultLevelFor } from './logging/log-level.js';
import { STRUCTURED_LOGGER } from './logging/logger.token.js';
import { RequestLoggingMiddleware } from './logging/request-logging.middleware.js';
import { StructuredLogger } from './logging/structured-logger.js';
import { RequestContextService } from './request-context/request-context.service.js';
import { RequestIdMiddleware } from './request-context/request-id.middleware.js';
import { ZodValidationPipe } from './validation/zod-validation.pipe.js';

/**
 * The API conventions from US-7 and the logging from US-9, registered once and
 * applied everywhere.
 *
 * Deliberately registered here as `APP_*` providers rather than with
 * `app.useGlobalPipes()` in `index.ts`, because these need injection —
 * the filter needs `RequestContextService`, the interceptor needs `Reflector` —
 * and globals registered on the app instance are constructed outside the DI
 * container and cannot have dependencies.
 *
 * `@Global()` so `RequestContextService` and the logger are injectable anywhere
 * without every feature module importing this one.
 */
@Global()
@Module({
  // Imported even though it is itself `@Global()`: the logger factory below
  // needs `TypedConfigService`, and a module that names a dependency can be
  // used on its own — in a test, say — without the importer having to know
  // what it happens to need today.
  imports: [TypedConfigModule],
  providers: [
    RequestContextService,
    {
      provide: STRUCTURED_LOGGER,
      inject: [RequestContextService, TypedConfigService],
      useFactory: (context: RequestContextService, config: TypedConfigService): StructuredLogger =>
        new StructuredLogger(
          context,
          config.get('LOG_LEVEL') ?? defaultLevelFor(config.get('NODE_ENV')),
        ),
    },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
  exports: [RequestContextService, STRUCTURED_LOGGER],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order matters. RequestIdMiddleware opens the async context; everything
    // after it — including the access log — reads the id from there.
    // Every route, including /health: a health check you cannot correlate with
    // the logs around it is half a health check.
    consumer.apply(RequestIdMiddleware, RequestLoggingMiddleware).forRoutes('*');
  }
}
