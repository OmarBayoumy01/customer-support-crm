import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * What a code-split route looks like while it arrives — US-25.
 *
 * Skeletons in the shape of the page rather than a spinner. A spinner says
 * "something is happening"; a skeleton says "a title and a list are coming",
 * which stops the layout jumping when they do and gives the eye somewhere to
 * rest in the meantime.
 *
 * Announced politely so a screen reader says it is loading once, rather than
 * narrating every skeleton block.
 */
export function RouteFallback(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t('states.loading')}</span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="space-y-2 pt-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
