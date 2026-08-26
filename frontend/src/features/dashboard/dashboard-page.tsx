import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/auth-context';

/**
 * A placeholder.
 *
 * It exists to prove US-14's "and land on the dashboard" and to give the shell
 * something to frame. The real dashboard is its own story — do not grow this
 * file into one. Chrome that used to live here (navigation, language, sign out)
 * moved into `AppShell` with US-28, which is where it belongs.
 */
export function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();

  const name = user === null ? '' : `${user.firstName} ${user.lastName}`;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-page font-semibold">{t('dashboard.title')}</h1>
      <p>{t('dashboard.greeting', { name })}</p>

      <p className="text-ink-muted text-meta">
        {/* Roles as text, never a colour-coded chip alone. */}
        <span className="font-medium">{t('dashboard.rolesLabel')}: </span>
        {user === null || user.roles.length === 0 ? t('dashboard.noRoles') : user.roles.join(', ')}
      </p>

      <p className="text-ink-muted text-meta">{t('dashboard.placeholder')}</p>
    </div>
  );
}
