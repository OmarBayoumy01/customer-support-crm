import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import cookieParser from 'cookie-parser';

import { TypedConfigService } from '../config/index.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtStrategy } from './jwt.strategy.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { PasswordService } from './password.service.js';
import { RefreshService } from './refresh.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

/**
 * Authentication — US-14.
 *
 * The `APP_GUARD` registration is the important line in this file: it makes
 * `JwtAuthGuard` run on **every** route in the application, with `@Public()` as
 * the way out. See the comment on that decorator for why this direction rather
 * than the other.
 *
 * `PermissionsModule` is not imported because it is `@Global()`.
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [TypedConfigService],
      useFactory: (config: TypedConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
        // Per-token options are set at signing time in `TokenService`, where
        // the audience is known. Only the secret is module-wide.
        signOptions: {},
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RefreshService,
    PasswordService,
    TokenService,
    SessionService,
    LoginThrottleService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  // Exported for the stories that build on this one: US-19 needs password
  // hashing, and anything touching sessions needs these two.
  exports: [PasswordService, TokenService, SessionService],
})
export class AuthModule implements NestModule {
  /**
   * Parses cookies for every route.
   *
   * Registered here rather than with `app.use()` in `index.ts` so that it is
   * part of the module and therefore present in tests too. US-15's refresh
   * endpoint reads its credential from a cookie; a test app that had to
   * remember to add the parser itself would fail in a way that looks like an
   * expired token rather than a missing middleware.
   *
   * Unsigned: the value is 256 bits of randomness checked against a stored
   * hash, so a signature would add a second secret to manage and prove nothing
   * the hash lookup does not already prove.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(cookieParser()).forRoutes('*');
  }
}
