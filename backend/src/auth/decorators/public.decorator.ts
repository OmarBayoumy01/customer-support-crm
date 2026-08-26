import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC = 'crm:is-public';

/**
 * Opts a route out of authentication.
 *
 * `JwtAuthGuard` is registered globally, so **everything is protected unless it
 * says otherwise**. That direction is deliberate: with an opt-in guard, the
 * failure mode of forgetting the decorator is an endpoint silently open to the
 * internet. This way the failure mode is a 401 during development, which
 * announces itself immediately.
 *
 * Reach for it only where anonymous access is the point — login, the health
 * check, the API docs.
 */
export function Public(): CustomDecorator<string> {
  return SetMetadata(IS_PUBLIC, true);
}
