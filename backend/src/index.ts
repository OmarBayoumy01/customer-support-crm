import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module.js';
import { STRUCTURED_LOGGER, type StructuredLogger } from './common/index.js';
import { TypedConfigService } from './config/index.js';
import { setupSwagger } from './openapi/index.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Every log line from here on is JSON carrying the request id (US-7 AC5,
  // US-9 AC1). Taken from the container rather than constructed here, so the
  // access-log middleware and Nest's own logging share one instance, one
  // configured level, and one sink.
  app.useLogger(app.get<StructuredLogger>(STRUCTURED_LOGGER));

  // Nest does not run `onModuleDestroy` on SIGINT/SIGTERM unless asked. Without
  // this the database pool is never closed on Ctrl-C or on container stop, and
  // connections are left open server-side.
  app.enableShutdownHooks();

  // US-14's refresh token arrives as an httpOnly cookie, and Express does not
  // parse cookies on its own. Unsigned: the value is 256 bits of randomness
  // checked against a stored hash, so a signature would add a second secret to
  // manage and prove nothing the hash lookup does not already prove.
  app.use(cookieParser());

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
