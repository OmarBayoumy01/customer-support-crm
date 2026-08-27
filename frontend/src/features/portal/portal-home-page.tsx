import { useTranslation } from 'react-i18next';
import { LifeBuoy, LogOut } from 'lucide-react';

import { LanguageToggle } from '@/components/language-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-context';
import { useLogout } from '@/features/auth/use-logout';

/**
 * Where a signed-in customer lands — US-21, AC1.
 *
 * **Deliberately a landing page and not a request list.** US-84 owns the list
 * and US-86 the submit control; this story's job is that a customer arrives
 * *here* rather than in the staff application, and it fetches nothing so that
 * nothing about it has to be revisited when those two arrive.
 *
 * Its own shell rather than the staff `AppLayout`: the sidebar, the queue badge
 * and the global search are staff furniture, and putting a customer inside them
 * is the "navigating the staff application" the story exists to avoid.
 */
export function PortalHomePage(): React.JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();

  return (
    <div className="bg-canvas min-h-screen">
      <header className="border-line bg-card border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <LifeBuoy aria-hidden="true" className="text-ink size-5" />
            <span className="text-section font-semibold">{t('portal.home.brand')}</span>
          </div>

          <div className="flex items-center gap-2">
            <LanguageToggle />
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              disabled={logout.isPending}
              onClick={() => {
                logout.mutate();
              }}
            >
              <LogOut aria-hidden="true" className="size-4" />
              {t('portal.home.signOut')}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-page font-semibold">
          {user === null
            ? t('portal.home.greetingAnonymous')
            : t('portal.home.greeting', { name: user.firstName })}
        </h1>
        <p className="text-ink-muted mt-1">{t('portal.home.subtitle')}</p>

        {/*
          Says plainly that the list is not here yet rather than showing an
          empty table that looks broken. US-84 replaces this card.
        */}
        <Card role="region" aria-label={t('portal.home.requestsLabel')} className="mt-8">
          <CardContent className="p-6">
            <h2 className="text-section font-semibold">{t('portal.home.requestsLabel')}</h2>
            <p className="text-ink-muted text-body mt-2">{t('portal.home.comingSoon')}</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
