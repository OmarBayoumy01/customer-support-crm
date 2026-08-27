import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorSchema, LoginResponseSchema, type LoginResponse } from '@crm/shared';

import { TypedConfigService } from '../config/index.js';
import { ApiZodBody, ApiZodResponse, BEARER_AUTH_NAME, zodToOpenApi } from '../openapi/index.js';
import { AuthService, type RequestOrigin } from './auth.service.js';
import { clearRefreshCookieOptions, REFRESH_COOKIE, refreshCookieOptions } from './cookies.js';
import { CurrentUser, type CurrentUserPayload } from './decorators/current-user.decorator.js';
import { SessionService } from './session.service.js';
import { TokenRevocationService } from './token-revocation.service.js';
import { Public } from './decorators/public.decorator.js';
import { RefreshService } from './refresh.service.js';
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
    private readonly refreshService: RefreshService,
    private readonly sessions: SessionService,
    private readonly revocations: TokenRevocationService,
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

    this.setRefreshCookie(response, refreshToken);

    return payload;
  }

  /**
   * Signs a customer in to the portal — US-21.
   *
   * A route of its own rather than an audience field on the staff request, and
   * that is the point: which audience a token gets is decided by **which
   * endpoint was called**, not by anything the caller sends. A body parameter
   * would let a staff login ask for a portal token.
   *
   * Everything else is the staff path: the same DTO, the same throttle, the same
   * generic 401, the same refresh cookie. The only difference is
   * `requirePortalAccount`, which is AC2.
   */
  @Public()
  @Post('portal/login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign in to the customer portal',
    description:
      'Issues a `crm-portal` token, which the staff API refuses and the portal API requires. ' +
      'An account with no linked customer record is refused 422 with a message pointing at ' +
      'the staff login — reachable only with the correct password, so it is not an ' +
      'account-enumeration oracle.',
  })
  @ApiZodBody(LoginRequestDto)
  @ApiZodResponse(200, LoginResponseSchema, 'Signed in')
  @ApiResponse({
    status: 401,
    description: 'Email or password incorrect — deliberately does not say which',
    schema: zodToOpenApi(ApiErrorSchema),
  })
  @ApiResponse({
    status: 422,
    description: 'A staff account was used on the portal login form',
    schema: zodToOpenApi(ApiErrorSchema),
  })
  async portalLogin(
    @Body() body: LoginRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const { response: payload, refreshToken } = await this.auth.login(
      body,
      originOf(request),
      'crm-portal',
      { requirePortalAccount: true },
    );

    this.setRefreshCookie(response, refreshToken);

    return payload;
  }

  /**
   * Exchanges the refresh cookie for a new pair — US-15.
   *
   * `@Public()` because the whole point is that it is reachable with an expired
   * access token. The credential it checks is the httpOnly cookie, not a bearer
   * header.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Renew the session',
    description:
      'Exchanges the httpOnly refresh cookie for a new access token and a new refresh ' +
      'cookie. The presented token is retired in the same operation, so it works exactly ' +
      'once — presenting it again revokes the whole session family.',
  })
  @ApiZodResponse(200, LoginResponseSchema, 'Renewed')
  @ApiResponse({
    status: 401,
    description: 'Missing, expired, revoked, or replayed — the client should sign in again',
    schema: zodToOpenApi(ApiErrorSchema),
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const presented = (request.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];

    const { response: payload, refreshToken } = await this.refreshService.refresh(
      presented,
      originOf(request),
    );

    this.setRefreshCookie(response, refreshToken);

    return payload;
  }

  /**
   * Ends this session — US-16, AC1.
   *
   * Not `@Public()`: signing out is something an authenticated caller does, and
   * the token being presented is the one being revoked.
   */
  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth(BEARER_AUTH_NAME)
  @ApiOperation({
    summary: 'Sign out of this session',
    description:
      'Revokes this session server-side, denies the presented access token for the ' +
      'remainder of its life, and clears the refresh cookie.',
  })
  @ApiResponse({ status: 204, description: 'Signed out' })
  async logout(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (user !== undefined) {
      await this.sessions.revoke(user.sessionId);
      // The refresh token is gone the moment the row is revoked; this closes
      // the remaining window on the *access* token, which is signed and cannot
      // otherwise be recalled.
      await this.revocations.denyToken(user.jti, user.issuedAt + this.tokens.accessTokenTtlSeconds);
    }

    response.clearCookie(
      REFRESH_COOKIE,
      clearRefreshCookieOptions(this.config.get('COOKIE_SECURE')),
    );
  }

  /**
   * Ends every session this account has — US-16, AC3.
   *
   * The one to reach for after losing a laptop, which is exactly when a
   * per-device list is no use to anybody.
   */
  @Post('logout-all')
  @HttpCode(204)
  @ApiBearerAuth(BEARER_AUTH_NAME)
  @ApiOperation({
    summary: 'Sign out everywhere',
    description:
      'Revokes every session for the account and denies every access token issued to it ' +
      'up to now, on every device.',
  })
  @ApiResponse({ status: 204, description: 'Signed out everywhere' })
  async logoutAll(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (user !== undefined) {
      await this.sessions.revokeAllForUser(user.userId);
      await this.revocations.revokeUserTokens(user.userId);
    }

    response.clearCookie(
      REFRESH_COOKIE,
      clearRefreshCookieOptions(this.config.get('COOKIE_SECURE')),
    );
  }

  private setRefreshCookie(response: Response, refreshToken: string): void {
    response.cookie(
      REFRESH_COOKIE,
      refreshToken,
      refreshCookieOptions(this.config.get('COOKIE_SECURE'), this.tokens.refreshTokenTtlSeconds),
    );
  }
}
