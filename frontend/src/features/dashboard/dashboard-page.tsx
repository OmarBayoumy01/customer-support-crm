import { useTranslation } from 'react-i18next';

import { Button } from '../../components/ui/button';

import { LanguageToggle } from '../../components/language-toggle';
import { useAuth } from '../auth/auth-context';
import { useLogout } from '../auth/use-logout';

/**
 * A placeholder.
 *
 * It exists to prove AC1's "and land on the dashboard" and nothing else. The
 * real dashboard is its own story in a later phase — do not grow this file into
 * one. Showing the signed-in name and roles is deliberate: it is the cheapest
 * visible proof that the token, the user, and the role set all came back.
 */
export function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();

  const name = user === null ? '' : `${user.firstName} ${user.lastName}`;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('dashboard.title')}</h1>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={logout.isPending}
            onClick={() => {
              logout.mutate();
            }}
          >
            {t('common.signOut')}
          </Button>
          {/*
            Separate control rather than a confirm dialog: signing out
            everywhere is what someone reaches for after losing a laptop, and
            burying it behind an extra click helps nobody at that moment.
          */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={logout.isPending}
            onClick={() => {
              logout.mutate({ everywhere: true });
            }}
          >
            {t('common.signOutEverywhere')}
          </Button>
        </div>
      </div>

      <p>{t('dashboard.greeting', { name })}</p>

      <p className="text-muted-foreground mt-3 text-sm">
        {/*
          Roles are rendered as text, never as a colour-coded chip alone —
          status and role must never be communicated by colour alone.
        */}
        <span className="font-medium">{t('dashboard.rolesLabel')}: </span>
        {user === null || user.roles.length === 0 ? t('dashboard.noRoles') : user.roles.join(', ')}
      </p>

      <p className="text-muted-foreground mt-6 text-sm">{t('dashboard.placeholder')}</p>
    </main>
  );
}
