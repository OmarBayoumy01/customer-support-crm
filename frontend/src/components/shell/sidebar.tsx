import { Hammer, Lock } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';

import { isRtl } from '@/i18n';

import { Badge } from '@/components/ui/badge';
import {
  Sidebar as SidebarPanel,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePermission } from '@/features/auth/use-permission';
import { useAssignedTicketCount } from '@/features/tickets/use-assigned-ticket-count';
import { cn } from '@/lib/utils';
import { NAV_SECTIONS, type NavItem } from './nav-model';

/**
 * The live count beside My Tickets — US-28, AC5.
 *
 * Tabular so the number does not jog the label sideways as it goes from 9 to
 * 10, which in a sidebar you stare at all day is the sort of thing that quietly
 * irritates.
 *
 * It borrows the urgency ramp **only** when something is actually at risk. That
 * is the one place colour is allowed into the chrome, and it is earned: a red
 * number in the sidebar means go and look now.
 */
function CountBadge({ count, atRisk }: { count: number; atRisk: boolean }): React.JSX.Element {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'tabular ms-auto px-1.5 py-0 text-[0.6875rem]',
        atRisk && 'bg-sla-breach-soft text-sla-breach',
      )}
    >
      {count}
    </Badge>
  );
}

function SidebarLink({ item }: { item: NavItem }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const { state, isMobile } = useSidebar();

  // Called unconditionally — `usePermission` treats `undefined` as "requires
  // nothing", which keeps this from being a conditional hook call.
  const allowed = usePermission(item.permission);
  const assigned = useAssignedTicketCount();

  const collapsed = state === 'collapsed' && !isMobile;

  /**
   * Radix positions with **physical** sides, so the logical one is computed.
   * In Arabic the sidebar is on the right, and a tooltip placed to its right
   * would open off the edge of the screen.
   */
  const tooltipSide = isRtl(i18n.language) ? ('left' as const) : ('right' as const);

  const label = t(item.labelKey);
  const Icon = item.icon;
  const isActive = pathname === item.to || pathname.startsWith(`${item.to}/`);

  /**
   * A destination whose story has not shipped.
   *
   * Checked **before** the permission, because "you do not have access" is the
   * wrong sentence about a screen that does not exist: it sends somebody to ask
   * their administrator for a permission that would change nothing. Not a link
   * either — the route resolves to the 404, and offering that as a menu item
   * reads as a broken product rather than an unfinished one.
   */
  if (item.available === false) {
    return (
      <SidebarMenuItem>
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarMenuButton
              aria-disabled="true"
              className="text-ink-faint cursor-not-allowed hover:bg-transparent"
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {!collapsed && <Hammer aria-hidden="true" className="ms-auto size-3.5 opacity-70" />}
              <span className="sr-only"> — {t('nav.unbuiltHint')}</span>
            </SidebarMenuButton>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>
            {label} — {t('nav.unbuiltHint')}
          </TooltipContent>
        </Tooltip>
      </SidebarMenuItem>
    );
  }

  /**
   * Locked rather than hidden — AC2.
   *
   * Both are allowed by the criterion, and visible-but-locked is the better
   * default: an agent who can see Administration exists knows what to ask their
   * manager for, whereas a hidden item makes the product look as though it has
   * no such feature. Not a link, so there is nothing to click and be refused by.
   */
  if (!allowed) {
    return (
      <SidebarMenuItem>
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarMenuButton
              aria-disabled="true"
              className="text-ink-faint cursor-not-allowed hover:bg-transparent"
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {!collapsed && <Lock aria-hidden="true" className="ms-auto size-3.5 opacity-70" />}
              <span className="sr-only"> — {t('nav.lockedHint')}</span>
            </SidebarMenuButton>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>
            {label} — {t('nav.lockedHint')}
          </TooltipContent>
        </Tooltip>
      </SidebarMenuItem>
    );
  }

  const button = (
    <SidebarMenuButton
      asChild
      isActive={isActive}
      // The active marker is an inline-start rule as well as a ground, so it
      // reads as a position in a list rather than as a button — and it mirrors
      // for free in Arabic.
      className={cn('border-s-2 border-transparent', isActive && 'border-s-accent font-medium')}
    >
      <NavLink to={item.to}>
        <Icon aria-hidden="true" />
        <span>{label}</span>
        {!collapsed && item.badge === 'assignedTickets' && assigned.data != null ? (
          <CountBadge count={assigned.data.total} atRisk={assigned.data.atRisk > 0} />
        ) : null}
      </NavLink>
    </SidebarMenuButton>
  );

  // A collapsed sidebar is icons only, so the label has to come from somewhere.
  return (
    <SidebarMenuItem>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side={tooltipSide}>{label}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </SidebarMenuItem>
  );
}

/**
 * The sidebar — US-28, rebuilt on shadcn's `Sidebar` primitives.
 *
 * The collapse, the mobile drawer, the keyboard shortcut and the icon-only rail
 * all come from the primitive rather than from three hand-rolled mechanisms
 * that each had to be kept in step.
 *
 * **RTL is a property of the primitive now, not of this file.** `side="left"`
 * is resolved to `inset-inline-start` in `ui/sidebar.tsx`, so in Arabic the
 * whole panel — and the drawer it becomes on a phone — moves to the right
 * without a directional style anywhere in here.
 */
export function AppSidebar(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <SidebarPanel collapsible="icon" aria-label={t('nav.label')}>
      <SidebarContent>
        {NAV_SECTIONS.map((section) => (
          <SidebarGroup key={section.labelKey}>
            {/*
              A real `h2`, via `asChild`. The primitive renders a `div`, which
              looks identical and is invisible to a screen reader — and the
              grouping AC1 asks for is precisely what a screen-reader user needs
              most, since they cannot see the whitespace that separates the
              sections.
            */}
            <SidebarGroupLabel asChild>
              <h2>{t(section.labelKey)}</h2>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarLink key={item.to} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </SidebarPanel>
  );
}
