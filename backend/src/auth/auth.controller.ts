import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorSchema, LoginResponseSchema, type LoginResponse } from '@crm/shared';

import { TypedConfigService } from '../config/index.js';
import { ApiZodBody, ApiZodResponse, zodToOpenApi } from '../openapi/index.js';
import { AuthService, type RequestOrigin } from './auth.service.js';
import { REFRESH_COOKIE, refreshCookieOptions } from './cookies.js';
import { Public } from './decorators/public.decorator.js';
import { LoginRequestDto } from './dto/login.dto.js';
import { TokenService } from './token.service.js';

/**
 * Reads the caller's address and client.
 *
 * `request.ip` is Express's own view, which behind a proxy is the proxy unless
 * `trust proxy` is configured. **It is deliberately not configured here.**
 * Trusting `X-Forwarded-For` without knowing which hop to believe lets anyone
 * spoof their address and walk straight past the per-IP throttle; getting it
 * right needs the deployment topology, which is P15's to settle.
 */
function originOf(request: Request): RequestOrigin {
  return {
    ip: request.ip,
    userAgent: request.get('user-agent'),
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: TypedConfigService,
  ) {}

  /**
   * Signs a staff member in — US-14.
   *
   * `@Public()` because this is where a caller gets their token; requiring one
   * to ask for one would be a closed loop.
   */
  @Public()
  @Post('login')
  // 200, not 201. A POST that creates no addressable resource returning
  // "Created" is Nest's default, not a considered answer.
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign in to the staff workspace',
    description:
      'Returns a 15-minute access token and sets an httpOnly refresh cookie. ' +
      'Invalid credentials and unknown accounts return the same generic 401 by design.',
  })
  @ApiZodBody(LoginRequestDto)
  @ApiZodResponse(200, LoginResponseSchema, 'Signed in')
  @ApiResponse({
    status: 401,
    description: 'Email or password incorrect — deliberately does not say which',
    schema: zodToOpenApi(ApiErrorSchema),
  })
  @ApiResponse({
    status: 403,
    description: 'The account exists but has been deactivated',
    schema: zodToOpenApi(ApiErrorSchema),
  })
  @ApiResponse({
    status: 429,
    description: 'Too many failed attempts for this account or address',
    schema: zodToOpenApi(ApiErrorSchema),
  })
  async login(
    @Body() body: LoginRequestDto,
    @Req() request: Request,
    // `passthrough` so Nest still serialises the return value and the response
    // envelope interceptor still runs — only the cookie is set by hand.
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const { response: payload, refreshToken } = await this.auth.login(body, originOf(request));

    response.cookie(
      REFRESH_COOKIE,
      refreshToken,
      refreshCookieOptions(this.config.get('COOKIE_SECURE'), this.tokens.refreshTokenTtlSeconds),
    );

    return payload;
  }
}
