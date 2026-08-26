import { useAtom, useSetAtom } from 'jotai';
import { Bell, ChevronDown, PanelLeft, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { mobileNavOpenAtom, searchOpenAtom, sidebarCollapsedAtom } from '@/app/shell-state';
import { LanguageToggle } from '@/components/language-toggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/features/auth/auth-context';
import { useLogout } from '@/features/auth/use-logout';
import { usePermission } from '@/features/auth/use-permission';
import { NAV_SECTIONS } from './nav-model';

/**
 * Where you are, from the URL — AC4.
 *
 * Derived from the nav model rather than from a per-page prop, so a screen
 * cannot forget to declare its own breadcrumb and end up untitled. Direction is
 * handled by the separator being a character in the flow: in Arabic the whole
 * row reverses with the document and the chevrons follow (AC6).
 */
function Breadcrumb(): React.JSX.Element {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const match = NAV_SECTIONS.flatMap((section) =>
    section.items.map((item) => ({ section, item })),
  ).find(({ item }) => pathname === item.to || pathname.startsWith(`${item.to}/`));

  return (
    <nav aria-label={t('nav.breadcrumb')} className="text-meta hidden items-center gap-1.5 sm:flex">
      <Link to="/dashboard" className="text-ink-muted hover:text-ink">
        {t('common.appName')}
      </Link>
      {match === undefined ? null : (
        <>
          <span aria-hidden="true" className="text-ink-faint rtl:rotate-180">
            ›
          </span>
          <span className="text-ink-muted">{t(match.section.labelKey)}</span>
          <span aria-hidden="true" className="text-ink-faint rtl:rotate-180">
            ›
          </span>
          <span className="text-ink font-medium">{t(match.item.labelKey)}</span>
        </>
      )}
    </nav>
  );
}

/** The Create menu — AC4. Gated, so it never offers an action that will fail. */
function CreateMenu(): React.JSX.Element | null {
  const { t } = useTranslation();
  const canCreateTicket = usePermission('ticket:create');
  const canCreateCustomer = usePermission('customer:create');

  if (!canCreateTicket && !canCreateCustomer) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">{t('common.create')}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 opacity-80" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {canCreateTicket ? <DropdownMenuItem>{t('common.createTicket')}</DropdownMenuItem> : null}
        {canCreateCustomer ? (
          <DropdownMenuItem>{t('common.createCustomer')}</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The bell — AC4.
 *
 * The count is `aria-label`led with words rather than left as a bare number,
 * because "3" announced on its own tells a screen-reader user nothing.
 */
function NotificationBell({ unread }: { unread: number }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t('nav.notifications', { count: unread })}
        >
          <Bell aria-hidden="true" className="size-4" />
          {unread > 0 ? (
            <span className="bg-sla-breach text-ink-inverse tabular absolute -top-0.5 -inline-end-0.5 min-w-4 rounded-full px-1 text-[10px] leading-4">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('nav.notifications', { count: unread })}</TooltipContent>
    </Tooltip>
  );
}

export function Header(): React.JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const setMobileOpen = useSetAtom(mobileNavOpenAtom);
  const setSearchOpen = useSetAtom(searchOpenAtom);

  const initials =
    user === null ? '?' : `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();

  return (
    <header className="bg-paper border-line flex h-14 shrink-0 items-center gap-2 border-b px-3">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('nav.toggleSidebar')}
        aria-expanded={!collapsed}
        onClick={() => {
          setCollapsed((value) => !value);
          setMobileOpen((value) => !value);
        }}
      >
        <PanelLeft aria-hidden="true" className="size-4" />
      </Button>

      <Breadcrumb />

      {/*
        Search is a button that opens a palette, not an always-live input. In a
        dense tool the palette is faster — it is reachable from the keyboard
        anywhere — and it does not spend header width on a field that is empty
        99% of the time.
      */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setSearchOpen(true);
        }}
        className="text-ink-muted ms-auto hidden w-56 justify-start gap-2 font-normal md:flex"
      >
        <Search aria-hidden="true" className="size-4" />
        <span className="truncate">{t('nav.searchPlaceholder')}</span>
        <kbd className="text-meta border-line text-ink-faint ms-auto rounded border px-1">
          {/* Displayed, not detected — a keyboard hint that lies is worse than none. */}
          Ctrl K
        </kbd>
      </Button>

      <div className="ms-auto flex items-center gap-1 md:ms-0">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('nav.search')}
          className="md:hidden"
          onClick={() => {
            setSearchOpen(true);
          }}
        >
          <Search aria-hidden="true" className="size-4" />
        </Button>

        <CreateMenu />
        <NotificationBell unread={0} />
        <LanguageToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('nav.account')}>
              <Avatar className="size-7">
                <AvatarFallback className="text-meta">{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="text-body block font-medium">
                {user === null ? '' : `${user.firstName} ${user.lastName}`}
              </span>
              <span className="text-meta text-ink-muted block truncate">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                logout.mutate();
              }}
            >
              {t('common.signOut')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                logout.mutate({ everywhere: true });
              }}
            >
              {t('common.signOutEverywhere')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
