import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { envFilePathsForNodeEnv } from './env-files.js';
import { validateEnv } from './env.schema.js';
import { TypedConfigService } from './typed-config.service.js';

/**
 * Global configuration module. Import once in `AppModule`; `TypedConfigService`
 * is then injectable anywhere without re-importing.
 *
 * `@Global()` is what actually makes that true. `ConfigModule.forRoot({
 * isGlobal: true })` below only globalises Nest's own `ConfigService` —
 * `TypedConfigService` is a provider of *this* module, so without the decorator
 * it resolves only inside `AppModule`. Added in US-5, when `PrismaService`
 * became the first provider in another module to inject it.
 */
@Global()
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
