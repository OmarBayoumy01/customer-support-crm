import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

export interface FilterChip {
  key: string;
  /** What the filter is, in words: "Priority". */
  label: string;
  /** What it is set to, in words: "Urgent" — never the raw enum. */
  value: string;
}

export interface FilterChipsProps {
  chips: FilterChip[];
  onRemove: (key: string) => void;
  className?: string | undefined;
}

/**
 * The applied filters, as removable chips — US-42, AC3.
 *
 * A dropdown two rows up showing "Urgent" is a control; a chip is a **statement
 * about what you are looking at**. The difference matters when an agent comes
 * back to a tab twenty minutes later and wonders why the queue looks short.
 *
 * Each chip names its filter as well as its value, because "Urgent" alone does
 * not say whether it is a priority or an SLA state, and the two are easy to
 * confuse on this screen in particular.
 */
export function FilterChips({ chips, onRemove, className }: FilterChipsProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <ul className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {chips.map((chip) => (
        <li key={chip.key}>
          <span className="border-line bg-secondary text-meta text-ink inline-flex items-center gap-1 rounded-full border py-0.5 ps-2 pe-1">
            <span className="text-ink-muted">{chip.label}</span>
            {chip.value}
            <button
              type="button"
              onClick={() => {
                onRemove(chip.key);
              }}
              aria-label={t('ticket.queue.removeFilter', {
                filter: chip.label,
                value: chip.value,
              })}
              className="hover:bg-line focus-visible:ring-ring rounded-full p-0.5 focus-visible:ring-2 focus-visible:outline-none"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
