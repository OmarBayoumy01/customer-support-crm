import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { AllExceptionsFilter } from './filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from './interceptors/response-envelope.interceptor.js';
import { RequestContextService } from './request-context/request-context.service.js';
import { RequestIdMiddleware } from './request-context/request-id.middleware.js';
import { ZodValidationPipe } from './validation/zod-validation.pipe.js';

/**
 * The API conventions from US-7, registered once and applied everywhere.
 *
 * Deliberately registered here as `APP_*` providers rather than with
 * `app.useGlobalPipes()` in `index.ts`, because these need injection —
 * the filter needs `RequestContextService`, the interceptor needs `Reflector` —
 * and globals registered on the app instance are constructed outside the DI
 * container and cannot have dependencies.
 *
 * `@Global()` so `RequestContextService` is injectable anywhere without every
 * feature module importing this one.
 */
@Global()
@Module({
  providers: [
    RequestContextService,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
  exports: [RequestContextService],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route, including /health — a health check you cannot correlate with
    // the logs around it is half a health check.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
