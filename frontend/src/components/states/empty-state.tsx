import { FilterX, Inbox, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: LucideIcon;
  /** What is not here, stated plainly. Not "No data". */
  title: string;
  /** One line. Why it is empty, or what to do about it. */
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string | undefined;
}

/**
 * Nothing here — US-31, AC2.
 *
 * Headline, one line, one action. **An empty screen is an invitation to act**,
 * so the action belongs to the screen that is empty: "Create a ticket" on an
 * empty queue, not a generic "Refresh".
 *
 * The title says what is missing rather than that something is missing. "No
 * tickets yet" tells you where you are; "No data" tells you the developer could
 * not think of anything.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'border-line flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      <Icon aria-hidden="true" className="text-ink-faint size-7" />
      <p className="text-section font-semibold">{title}</p>
      <p className="text-ink-muted max-w-sm">{description}</p>
      {action === undefined ? null : (
        <Button onClick={action.onClick} className="mt-2">
          {action.label}
        </Button>
      )}
    </div>
  );
}

/**
 * Nothing here **because of the filters** — a different state, and worth its own
 * component.
 *
 * Offering "Create a ticket" to someone who has filtered a full queue down to
 * nothing is answering a question they did not ask. What they want is their
 * filters back.
 */
export function NoResultsState({
  onClearFilters,
  className,
}: {
  onClearFilters: () => void;
  className?: string | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <EmptyState
      icon={FilterX}
      title={t('states.noResultsTitle')}
      description={t('states.noResultsBody')}
      action={{ label: t('common.clearFilters', { count: 0 }), onClick: onClearFilters }}
      className={className}
    />
  );
}
