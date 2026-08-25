import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { envFilePathsForNodeEnv } from './env-files.js';
import { validateEnv } from './env.schema.js';
import { TypedConfigService } from './typed-config.service.js';

/**
 * Global configuration module. Import once in `AppModule`; `TypedConfigService`
 * is then injectable anywhere without re-importing.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: envFilePathsForNodeEnv(process.env['NODE_ENV']),
      validate: validateEnv,
    }),
  ],
  providers: [TypedConfigService],
  exports: [TypedConfigService],
})
export class TypedConfigModule {}
