import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { TypedConfigService } from './config/index.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(TypedConfigService);

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
