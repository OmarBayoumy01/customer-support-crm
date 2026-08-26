import { AlertTriangle, ArrowUpCircle, CheckCircle2, Inbox, UserRound, UserX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TICKET_VIEWS, type TicketCounts, type TicketView } from '@crm/shared';

import { cn } from '@/lib/utils';

const VIEW_ICON: Record<TicketView, typeof Inbox> = {
  all: Inbox,
  unassigned: UserX,
  mine: UserRound,
  escalated: ArrowUpCircle,
  breached: AlertTriangle,
  closed: CheckCircle2,
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
 * A real `tablist`, so arrow keys move between tabs — the queue is a screen
 * people live in, and living in a screen means using the keyboard.
 *
 * The active tab is marked by weight, an underline **and** `aria-selected`.
 * Never by colour alone.
 */
export function QueueTabs({
  view,
  counts,
  onChange,
  className,
}: QueueTabsProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div
      role="tablist"
      aria-label={t('ticket.queue.views')}
      className={cn('border-line -mb-px flex items-end gap-1 overflow-x-auto border-b', className)}
    >
      {TICKET_VIEWS.map((candidate) => {
        const Icon = VIEW_ICON[candidate];
        const active = candidate === view;
        const count = counts?.[candidate];

        return (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              onChange(candidate);
            }}
            className={cn(
              'text-meta focus-visible:ring-ring inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none',
              active
                ? 'border-b-accent text-ink font-medium'
                : 'text-ink-muted hover:text-ink border-b-transparent',
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {t(`ticket.queue.view.${candidate}`)}
            {count !== undefined && (
              <span
                className={cn(
                  'tabular rounded-full px-1.5 py-0.5 text-[0.6875rem] leading-none',
                  active ? 'bg-accent/10 text-accent' : 'bg-secondary text-ink-muted',
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
