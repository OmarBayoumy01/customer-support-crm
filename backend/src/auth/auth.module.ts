import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { TypedConfigService } from '../config/index.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtStrategy } from './jwt.strategy.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { PasswordService } from './password.service.js';
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
    PasswordService,
    TokenService,
    SessionService,
    LoginThrottleService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  // Exported for the stories that build on this one: US-17/US-18 need password
  // hashing, US-15/US-16 need tokens and sessions.
  exports: [PasswordService, TokenService, SessionService],
})
export class AuthModule {}
