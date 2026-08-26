import { Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { PermissionKey } from '@crm/shared';

import { usePermission } from './use-permission';

/**
 * The screen someone sees when they reach a page they may not have — US-23, AC4.
 *
 * A real screen rather than a redirect, and rather than a blank page. Someone
 * who typed or was sent a URL they cannot open needs to be told that is what
 * happened; bouncing them silently to the dashboard reads as a broken link, and
 * they will try again.
 *
 * It names no permission key. "You need `ticket:assign`" is a sentence for a
 * developer, and it tells anyone probing the app exactly what the internals
 * are called.
 */
export function PermissionDenied(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center p-6 text-center">
      {/*
        Text, not just an icon or a colour. Status is never communicated by
        colour alone anywhere in this platform.
      */}
      <h1 className="text-xl font-semibold">{t('permissions.deniedTitle')}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{t('permissions.deniedBody')}</p>
    </main>
  );
}

/**
 * A route wrapper that renders the denied screen instead of the page — US-23.
 *
 *   <Route element={<RequirePermission permission="user:manage" />}>
 *     <Route path="/admin" element={<AdminPage />} />
 *   </Route>
 *
 * Convenience only. `PermissionsGuard` (US-22) is what actually refuses the
 * data; this stops the page rendering and firing requests that would all fail.
 */
export function RequirePermission({
  permission,
}: {
  permission: PermissionKey;
}): React.JSX.Element {
  return usePermission(permission) ? <Outlet /> : <PermissionDenied />;
}
