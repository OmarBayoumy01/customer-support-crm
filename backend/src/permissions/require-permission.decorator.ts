import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { PermissionKey } from '@crm/shared';

export const REQUIRED_PERMISSION = 'crm:required-permission';

/**
 * Declares what a route needs — US-22, AC1.
 *
 *   @RequirePermission('ticket:assign')
 *   assign(...) { … }
 *
 * The key is typed as `PermissionKey`, so a typo is a compile error rather than
 * a guard that silently never passes — or, worse, a guard checking a permission
 * nobody holds and therefore denying everyone, which reads as a broken feature
 * rather than a security bug.
 *
 * **This declares; it does not scope.** A route that lists records still has to
 * apply the caller's scope in its query — see `ticketScopeWhere` and AC3. The
 * guard cannot do that for it: it does not know what is being queried.
 */
export function RequirePermission(permission: PermissionKey): CustomDecorator<string> {
  return SetMetadata(REQUIRED_PERMISSION, permission);
}
