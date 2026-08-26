import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { isRtl } from '@/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ListPaginationProps {
  /** 1-based, matching `PaginationMeta` in `@crm/shared`. */
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string | undefined;
}

/**
 * Page controls for a list — US-27.
 *
 * **1-based**, matching `PaginationMeta` from `@crm/shared`, so the number in
 * the UI is the number in the query string and in the API. A 0-based page in a
 * user-facing control is a bug generator.
 *
 * Previous and next only. Numbered pages are a real convenience on a catalogue
 * somebody browses; on a work queue that is re-sorted by urgency all day,
 * "page 7" is not a place worth going back to, and the row count is the number
 * an agent actually reads.
 *
 * The chevrons point along the reading direction, so in Arabic "next" points
 * left. They are decorative — the buttons carry real labels.
 */
export function ListPagination({
  page,
  totalPages,
  total,
  onPageChange,
  className,
}: ListPaginationProps): React.JSX.Element {
  const { t, i18n } = useTranslation();

  const rtl = isRtl(i18n.language);
  const Previous = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;

  const first = page <= 1;
  const last = page >= totalPages;

  return (
    <nav
      aria-label={t('common.pagination')}
      className={cn('flex items-center justify-between gap-4', className)}
    >
      <p className="text-meta text-ink-muted">
        {/* Mono for the numbers so they do not jog as the count changes. */}
        <span className="tabular">{t('common.pageOf', { page, totalPages })}</span>
        <span aria-hidden="true"> · </span>
        <span className="tabular">{t('common.resultCount', { count: total })}</span>
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={first}
          onClick={() => {
            onPageChange(page - 1);
          }}
          className="gap-1"
        >
          <Previous aria-hidden="true" className="size-4" />
          {t('common.previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={last}
          onClick={() => {
            onPageChange(page + 1);
          }}
          className="gap-1"
        >
          {t('common.next')}
          <Next aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
