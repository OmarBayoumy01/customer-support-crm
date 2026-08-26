import { Outlet } from 'react-router';
import type { PermissionKey } from '@crm/shared';

import { PermissionDenied } from '@/components/states/permission-denied';
import { usePermission } from './use-permission';

/**
 * Names each permission in words a person recognises — US-31, AC4.
 *
 * The denied screen names the **capability**, never the key. `user:manage` is a
 * sentence for a developer, and it hands anyone probing the app the vocabulary
 * of its internals; "Administration" tells the person what they are missing.
 * Missing entries fall back to the unnamed screen rather than rendering a key.
 */
const CAPABILITY_KEYS: Partial<Record<PermissionKey, string>> = {
  'user:manage': 'capability.administration',
  'role:manage': 'capability.administration',
  'ticket:assign': 'capability.ticketAssignment',
  'report:view': 'capability.reporting',
  'article:publish': 'capability.publishing',
  'audit:view': 'capability.auditTrail',
};

/**
 * A route wrapper that renders the denied screen instead of the page — US-23.
 *
 * Convenience only. `PermissionsGuard` (US-22) is what actually refuses the
 * data; this stops the page rendering and firing requests that would all fail.
 */
export function RequirePermission({
  permission,
}: {
  permission: PermissionKey;
}): React.JSX.Element {
  if (usePermission(permission)) {
    return <Outlet />;
  }

  const capabilityKey = CAPABILITY_KEYS[permission];

  return capabilityKey === undefined ? (
    <PermissionDenied />
  ) : (
    <PermissionDenied capabilityKey={capabilityKey} />
  );
}

export { PermissionDenied };
