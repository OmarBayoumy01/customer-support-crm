import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LifeBuoy, LogOut, Plus } from 'lucide-react';

import { LanguageToggle } from '@/components/language-toggle';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';
import { PortalRequests } from './portal-requests';
import { useLogout } from '@/features/auth/use-logout';

/**
 * Where a signed-in customer lands — US-21, AC1.
 *
 * **This is the "Portal My Tickets" screen.** US-21 put a placeholder card here
 * saying the list was coming; US-84 replaced it with the real one, and US-86
 * supplied the action beside the heading. US-83's separate portal home is
 * deferred, so a customer's landing page *is* their request list — which is
 * what they came for anyway.
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-page font-semibold">
              {user === null
                ? t('portal.home.greetingAnonymous')
                : t('portal.home.greeting', { name: user.firstName })}
            </h1>
            <p className="text-ink-muted mt-1">{t('portal.home.subtitle')}</p>
          </div>

          <Button asChild className="gap-2">
            <Link to="/portal/new">
              <Plus aria-hidden="true" className="size-4" />
              {t('portal.home.newRequest')}
            </Link>
          </Button>
        </div>

        {/* US-84 — the placeholder card US-21 left here is now the real list. */}
        <div className="mt-8">
          <PortalRequests />
        </div>
      </main>
    </div>
  );
}
