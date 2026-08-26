import type { PermissionKey, PermissionScope } from '@crm/shared';

import { useAuth } from './auth-context';

/**
 * Whether the signed-in user holds a permission — US-23.
 *
 * **This is a convenience, not a security boundary.** Everything it reads came
 * from the server and is sitting in the browser, where anyone can edit it. What
 * actually protects data is `PermissionsGuard` (US-22) and the scoped queries
 * behind it. The purpose here is narrower and worth stating plainly: do not
 * offer someone a button that will answer 403.
 *
 * The key is typed, so gating on a permission that does not exist is a compile
 * error rather than a control that quietly never appears.
 */
export function usePermission(key: PermissionKey | undefined): boolean {
  const { permissions } = useAuth();

  // `undefined` means "this thing requires no particular permission", and
  // answers true. Accepting it here rather than at every call site is what lets
  // callers avoid `cond && usePermission(...)`, which would be a conditional
  // hook call and is not allowed.
  if (key === undefined) {
    return true;
  }

  return (permissions?.permissions[key]?.length ?? 0) > 0;
}

/**
 * The scopes granted for a permission, or an empty array.
 *
 * For the cases where holding a permission is not the whole answer — an agent
 * with `ticket:view` at `ASSIGNED` should not be offered a "view all tickets"
 * filter even though they do hold `ticket:view`.
 */
export function usePermissionScopes(key: PermissionKey): PermissionScope[] {
  const { permissions } = useAuth();

  return permissions?.permissions[key] ?? [];
}

/** True when the user holds every one of the given permissions. */
export function useAllPermissions(keys: readonly PermissionKey[]): boolean {
  const { permissions } = useAuth();

  return keys.every((key) => (permissions?.permissions[key]?.length ?? 0) > 0);
}
