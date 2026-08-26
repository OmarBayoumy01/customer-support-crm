import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { PermissionKey } from '@crm/shared';

import { usePermission } from '../features/auth/use-permission';

interface NavItem {
  to: string;
  labelKey: string;
  /** Omitted for items everyone signed in may see. */
  permission?: PermissionKey;
}

const ITEMS: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard' },
  { to: '/admin', labelKey: 'nav.administration', permission: 'user:manage' },
];

/**
 * One navigation entry, shown or shown-locked — US-23, AC2.
 *
 * **Disabled with a lock rather than hidden.** Both are allowed by the
 * criterion, and visible-but-locked is the better default: an agent who can see
 * that Administration exists knows what to ask their manager for, whereas a
 * hidden item makes the product look like it has no such feature. Hiding is the
 * right call only where the item's existence is itself sensitive.
 *
 * The lock is an icon **and** a text label, never colour alone.
 */
function NavEntry({ item }: { item: NavItem }): React.JSX.Element {
  const { t } = useTranslation();
  // Called unconditionally — `usePermission` treats `undefined` as "requires
  // nothing", which is what keeps this from being a conditional hook call.
  const allowed = usePermission(item.permission);

  if (!allowed) {
    return (
      <span
        className="text-muted-foreground inline-flex cursor-not-allowed items-center gap-1.5 px-3 py-1.5 text-sm"
        aria-disabled="true"
        title={t('nav.lockedHint')}
      >
        {/* `aria-hidden` on the glyph: the text beside it already says this. */}
        <span aria-hidden="true">🔒</span>
        {t(item.labelKey)}
        <span className="sr-only"> — {t('nav.lockedHint')}</span>
      </span>
    );
  }

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-accent font-medium' : ''}`
      }
    >
      {t(item.labelKey)}
    </NavLink>
  );
}

/**
 * The application navigation, such as it is.
 *
 * Deliberately a strip rather than a sidebar: **P03 owns the application
 * shell**, and building one here would be inventing the layout that phase is
 * for. What this story owes is the *gating*, and that lives in `NavEntry`
 * where P03 can lift it out unchanged.
 */
export function AppNav(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <nav aria-label={t('nav.label')} className="flex items-center gap-1">
      {ITEMS.map((item) => (
        <NavEntry key={item.to} item={item} />
      ))}
    </nav>
  );
}
