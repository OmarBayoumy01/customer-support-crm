import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { ContextLogger, RequestContextService } from './common/index.js';
import { TypedConfigService } from './config/index.js';
import { setupSwagger } from './openapi/index.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Every log line from here on carries the request id (US-7, AC5). Set after
  // creation rather than passed to `create`, because the logger needs
  // `RequestContextService` out of the container.
  app.useLogger(new ContextLogger(app.get(RequestContextService)));

  // Nest does not run `onModuleDestroy` on SIGINT/SIGTERM unless asked. Without
  // this the database pool is never closed on Ctrl-C or on container stop, and
  // connections are left open server-side.
  app.enableShutdownHooks();

  const config = app.get(TypedConfigService);

  // Mounted before listen so the docs are ready with the first request. Decides
  // for itself whether to serve at all — see decideSwagger (US-8, AC4).
  setupSwagger(app, config);

  const port = config.get('PORT');
  const host = config.get('HOST');

  await app.listen(port, host);

  new Logger('Bootstrap').log(`Listening on http://${host}:${port}`);
}

bootstrap().catch((error: unknown) => {
  // Config validation exits on its own with a readable message (AC2). This
  // catches Nest's own bootstrap failures — port in use, DI resolution, etc.
  // Never swallow: log the cause, then fail the process.
  new Logger('Bootstrap').error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
