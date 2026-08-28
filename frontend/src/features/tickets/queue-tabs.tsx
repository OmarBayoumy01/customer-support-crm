import { AlertTriangle, ArrowUpCircle, CheckCircle2, Inbox, UserRound, UserX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TICKET_VIEWS, type TicketCounts, type TicketView } from '@crm/shared';

import { useAuth } from '@/features/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

const VIEW_ICON: Record<TicketView, typeof Inbox> = {
  all: Inbox,
  unassigned: UserX,
  mine: UserRound,
  escalated: ArrowUpCircle,
  breached: AlertTriangle,
  resolved: CheckCircle2,
};

export interface QueueTabsProps {
  view: TicketView;
  counts: TicketCounts | undefined;
  onChange: (view: TicketView) => void;
  className?: string | undefined;
}

/**
 * The queue's view tabs — US-42, AC4.
 *
 * Six saved questions an agent asks the queue, not six filters they have to
 * assemble. The count is the point: "Breached SLA" with a 3 beside it is a
 * decision, and the same tab with nothing beside it is a reassurance.
 *
 * Radix's `Tabs` underneath, so arrow keys move between tabs and the roving
 * tabindex is somebody else's problem. The queue is a screen people live in,
 * and living in a screen means using the keyboard.
 *
 * The active tab is marked by ground, weight **and** `aria-selected` — Radix
 * supplies the last of those. Never by colour alone.
 */
export function QueueTabs({
  view,
  counts,
  onChange,
  className,
}: QueueTabsProps): React.JSX.Element {
  const { t } = useTranslation();
  const { permissions } = useAuth();

  const isAgentOnly =
    permissions?.roles.includes('agent') &&
    !permissions?.roles.includes('administrator') &&
    !permissions?.roles.includes('manager');

  const visibleViews = TICKET_VIEWS.filter(
    (v) => v !== 'unassigned' && (!isAgentOnly || v !== 'all'),
  );

  return (
    <Tabs
      value={view}
      onValueChange={(next) => {
        onChange(next as TicketView);
      }}
      className={className}
    >
      <TabsList aria-label={t('ticket.queue.views')} className="h-auto w-full justify-start p-1">
        {visibleViews.map((candidate) => {
          const Icon = VIEW_ICON[candidate];
          const count = counts?.[candidate];
          const active = candidate === view;

          return (
            <TabsTrigger key={candidate} value={candidate} className="gap-1.5">
              <Icon aria-hidden="true" className="size-3.5" />
              {t(`ticket.queue.view.${candidate}`)}
              {count !== undefined && (
                <Badge
                  variant="secondary"
                  className={cn(
                    'tabular px-1.5 py-0 text-[0.6875rem]',
                    active && 'bg-accent/10 text-accent',
                  )}
                >
                  {count}
                </Badge>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
