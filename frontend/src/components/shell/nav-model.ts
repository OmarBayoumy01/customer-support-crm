import {
  BarChart3,
  BookOpen,
  Building2,
  LayoutDashboard,
  LifeBuoy,
  Palette,
  Settings,
  Ticket,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { PermissionKey } from '@crm/shared';

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** Omitted for items every signed-in user may reach. */
  permission?: PermissionKey;
  /** Which live count, if any, this item shows. */
  badge?: 'assignedTickets';
}

export interface NavSection {
  labelKey: string;
  items: NavItem[];
}

/**
 * The sidebar, as data — US-28, AC1.
 *
 * The five groups are the story's, not invented: Workspace, Knowledge,
 * Analytics, Administration, Account. Keeping the structure as data rather than
 * markup is what lets the permission filter and the collapsed rendering both
 * work from one source, and it is what a later story adds a section to without
 * touching the component.
 *
 * Several destinations do not exist yet. They are listed anyway — the shell is
 * the thing being built here, and a sidebar with two links in it would not
 * demonstrate the grouping the criterion asks for. Each resolves to the 404,
 * which is an honest answer, and the route arrives with the story that owns it.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: 'nav.section.workspace',
    items: [
      { to: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
      /*
       * One entry, not two.
       *
       * "My tickets" and "All tickets" were the same screen reached with a
       * different tab preselected, and the queue's own view tabs already switch
       * between them — a second nav item for a filter is a menu that grows by
       * one every time somebody adds a saved view. The badge stays here,
       * because how much is on your plate is worth knowing before you click.
       */
      {
        to: '/tickets',
        labelKey: 'nav.tickets',
        icon: Ticket,
        permission: 'ticket:view',
        badge: 'assignedTickets',
      },
      { to: '/customers', labelKey: 'nav.customers', icon: Users, permission: 'customer:view' },
    ],
  },
  {
    labelKey: 'nav.section.knowledge',
    items: [
      { to: '/articles', labelKey: 'nav.articles', icon: BookOpen, permission: 'article:view' },
    ],
  },
  {
    labelKey: 'nav.section.analytics',
    items: [
      // US-58. The MVP's reporting surface, since all of P11 is V2.
      { to: '/team', labelKey: 'nav.team', icon: BarChart3, permission: 'report:view' },
    ],
  },
  {
    labelKey: 'nav.section.administration',
    items: [
      { to: '/admin', labelKey: 'nav.users', icon: UserRound, permission: 'user:manage' },
      {
        to: '/admin/departments',
        labelKey: 'nav.departments',
        icon: Building2,
        permission: 'department:manage',
      },
      { to: '/admin/sla', labelKey: 'nav.slaPolicies', icon: LifeBuoy, permission: 'sla:manage' },
    ],
  },
  {
    labelKey: 'nav.section.account',
    items: [
      { to: '/settings', labelKey: 'nav.settings', icon: Settings },
      // Not a real product destination — the living reference for this design
      // system, kept in the app so it cannot rot the way a static styleguide
      // does. Under Account because it belongs to nobody's daily work.
      { to: '/design-system', labelKey: 'nav.designSystem', icon: Palette },
    ],
  },
];
