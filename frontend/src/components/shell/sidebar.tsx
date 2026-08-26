import { useAtomValue } from 'jotai';
import { Lock } from 'lucide-react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

import { isRtl } from '@/i18n';

import { sidebarCollapsedAtom } from '@/app/shell-state';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePermission } from '@/features/auth/use-permission';
import { useAssignedTicketCount } from '@/features/tickets/use-assigned-ticket-count';
import { cn } from '@/lib/utils';
import { NAV_SECTIONS, type NavItem } from './nav-model';

/**
 * The live count beside My Tickets — AC5.
 *
 * Mono and tabular so the number does not jog the label sideways as it goes
 * from 9 to 10, which in a sidebar you stare at all day is the sort of thing
 * that quietly irritates.
 *
 * It borrows the urgency ramp **only** when something is actually at risk. That
 * is the one place colour is allowed into the chrome, and it is earned: a red
 * number in the sidebar means go and look now.
 */
function CountBadge({ count, atRisk }: { count: number; atRisk: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'tabular text-meta ms-auto rounded-full px-1.5 py-0.5 leading-none',
        atRisk ? 'bg-sla-breach-soft text-sla-breach' : 'bg-secondary text-ink-muted',
      )}
    >
      {count}
    </span>
  );
}

function SidebarLink({
  item,
  collapsed,
}: {
  item: NavItem;
  collapsed: boolean;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  // Called unconditionally — `usePermission` treats `undefined` as "requires
  // nothing", which keeps this from being a conditional hook call.
  const allowed = usePermission(item.permission);
  const assigned = useAssignedTicketCount();

  /**
   * Radix positions with **physical** sides, so the logical one is computed.
   * In Arabic the sidebar is on the right, and a tooltip placed to its right
   * would open off the edge of the screen.
   */
  const tooltipSide = isRtl(i18n.language) ? ('left' as const) : ('right' as const);

  const label = t(item.labelKey);
  const Icon = item.icon;

  const body = (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {collapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="truncate">{label}</span>
      )}
      {!collapsed && item.badge === 'assignedTickets' && assigned.data !== undefined ? (
        <CountBadge count={assigned.data.total} atRisk={assigned.data.atRisk > 0} />
      ) : null}
      {!collapsed && !allowed ? (
        <Lock aria-hidden="true" className="ms-auto size-3.5 shrink-0 opacity-70" />
      ) : null}
    </>
  );

  const shared = 'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body transition-colors';

  /**
   * Locked rather than hidden — AC2.
   *
   * Both are allowed by the criterion, and visible-but-locked is the better
   * default: an agent who can see Administration exists knows what to ask their
   * manager for, whereas a hidden item makes the product look as though it has
   * no such feature. It is a `span`, not a disabled link, so there is nothing
   * to click and be refused by.
   */
  if (!allowed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span aria-disabled="true" className={cn(shared, 'text-ink-faint cursor-not-allowed')}>
            {body}
            <span className="sr-only"> — {t('nav.lockedHint')}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          {label} — {t('nav.lockedHint')}
        </TooltipContent>
      </Tooltip>
    );
  }

  const link = (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          shared,
          'hover:bg-secondary hover:text-ink',
          isActive
            ? // The active marker is an inline-start rule, not a filled pill:
              // it reads as a position in a list rather than as a button, and
              // it mirrors for free in Arabic.
              'bg-secondary text-ink border-brand border-s-2 font-medium'
            : 'text-ink-muted border-s-2 border-transparent',
        )
      }
    >
      {body}
    </NavLink>
  );

  // A collapsed sidebar is icons only, so the label has to come from somewhere.
  return collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  ) : (
    link
  );
}

/**
 * The sidebar — US-28.
 *
 * Sits first in the DOM, which is all that is needed for AC6: a flex row
 * respects `dir`, so in Arabic it moves to the right without a single
 * directional style.
 */
export function Sidebar({ className }: { className?: string | undefined }): React.JSX.Element {
  const { t } = useTranslation();
  const collapsed = useAtomValue(sidebarCollapsedAtom);

  return (
    <nav
      aria-label={t('nav.label')}
      className={cn(
        'bg-paper border-line flex flex-col gap-4 border-e py-3 transition-[width] duration-150',
        collapsed ? 'w-14 px-2' : 'w-60 px-3',
        className,
      )}
    >
      {NAV_SECTIONS.map((section) => (
        <div key={section.labelKey} className="flex flex-col gap-0.5">
          {/*
            The group heading is the structure the criterion asks for, so it
            stays present for screen readers even when collapsed hides it —
            otherwise the collapsed sidebar becomes one undifferentiated list of
            icons.
          */}
          <h2
            className={cn(
              'text-meta text-ink-faint px-2.5 pb-1 font-medium tracking-wide uppercase',
              collapsed && 'sr-only',
            )}
          >
            {t(section.labelKey)}
          </h2>
          {section.items.map((item) => (
            <SidebarLink key={item.to} item={item} collapsed={collapsed} />
          ))}
        </div>
      ))}
    </nav>
  );
}
