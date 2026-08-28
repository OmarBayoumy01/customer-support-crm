import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LifeBuoy, LogOut, Plus } from 'lucide-react';

import { LanguageToggle } from '@/components/language-toggle';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';
import { PortalRequests } from './portal-requests';
import { PortalProfileDialog } from './portal-profile-dialog';
import { usePortalProfile } from './use-portal';
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
  const { data: profile } = usePortalProfile();
  const logout = useLogout();

  const firstName = profile?.firstName ?? user?.firstName;

  return (
    <div className="bg-background min-h-screen text-foreground">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
              <LifeBuoy aria-hidden="true" className="size-5" />
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight text-foreground">
                {t('portal.home.brand')}
              </span>
              <span className="ms-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                Portal
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <PortalProfileDialog />
            <LanguageToggle />
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={logout.isPending}
              onClick={() => {
                logout.mutate();
              }}
            >
              <LogOut aria-hidden="true" className="size-3.5" />
              {t('portal.home.signOut')}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Welcome Hero Banner */}
        <div className="mb-8 overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-xs sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {user
                  ? t('portal.home.greeting', { name: firstName || user.firstName })
                  : t('portal.home.greetingAnonymous')}
              </h1>
              <p className="text-sm text-muted-foreground">{t('portal.home.subtitle')}</p>
            </div>

            <Button asChild size="lg" className="shrink-0 gap-2 shadow-xs">
              <Link to="/portal/new">
                <Plus aria-hidden="true" className="size-4" />
                {t('portal.home.newRequest')}
              </Link>
            </Button>
          </div>
        </div>

        {/* Requests List & Filters */}
        <PortalRequests />
      </main>
    </div>
  );
}
