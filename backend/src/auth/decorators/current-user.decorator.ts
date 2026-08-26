import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * What `JwtStrategy.validate` attaches to the request, and therefore what any
 * authenticated handler can rely on.
 *
 * Deliberately just the claims. Resolving the full user row on every request
 * would be a database read most handlers do not need; the ones that do can ask
 * for it themselves.
 */
export interface CurrentUserPayload {
  userId: string;
  roles: string[];
  sessionId: string;
}

/**
 * Injects the authenticated user into a handler parameter.
 *
 *   findMine(@CurrentUser() user: CurrentUserPayload) { … }
 *
 * Only meaningful on a route the guard protects. On a `@Public()` route there
 * may be no user, hence the `undefined` in the return type — handlers that can
 * be reached both ways have to say what they do about it.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserPayload | undefined => {
    const request = context.switchToHttp().getRequest<Request & { user?: CurrentUserPayload }>();

    return request.user;
  },
);
