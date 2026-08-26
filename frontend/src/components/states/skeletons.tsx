import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Loading placeholders in the shape of the content — US-31, AC1.
 *
 * Never a full-page spinner. A spinner says "something is happening"; a skeleton
 * says "a table with six rows is coming" — which stops the layout jumping when
 * it does, and gives the eye somewhere to rest meanwhile.
 *
 * Three shapes cover the whole vertical slice: a table (the ticket queue, the
 * customer list), a list (the conversation timeline), and a detail pane (the
 * ticket workspace). A fourth shape would be a shape without a screen.
 *
 * Each is announced **once**, politely. Marking every block would have a screen
 * reader narrate twenty placeholders.
 */

function Busy({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <div aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Busy
      label={t('states.loading')}
      className="border-line divide-line divide-y rounded-md border"
    >
      {/* A header bar, then rows — the silhouette of a table, not a grey block. */}
      <div className="bg-secondary/50 flex items-center gap-4 px-4 py-2.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="ms-auto h-3 w-16" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} data-testid="skeleton-row" className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-4 w-20 shrink-0" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24 shrink-0" />
          <Skeleton className="h-4 w-16 shrink-0" />
        </div>
      ))}
    </Busy>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Busy label={t('states.loading')} className="space-y-4">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} data-testid="skeleton-row" className="flex gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      ))}
    </Busy>
  );
}

export function DetailSkeleton(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Busy label={t('states.loading')} className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <ListSkeleton rows={3} />
    </Busy>
  );
}

/** Inline, for a value still resolving inside otherwise-loaded content. */
export function InlineSkeleton({ className }: { className?: string }): React.JSX.Element {
  return <Skeleton className={cn('inline-block h-4 w-16 align-middle', className)} />;
}
