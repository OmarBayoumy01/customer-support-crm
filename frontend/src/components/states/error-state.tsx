import { RotateCw, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  /** The failure, if it came from the API. */
  error?: unknown;
  /**
   * Re-runs **only the failed request** — AC3.
   *
   * A prop rather than a page reload: reloading throws away everything else the
   * user had loaded to fix one panel, and on a ticket workspace that means
   * losing a half-typed reply.
   */
  onRetry?: () => void;
  className?: string | undefined;
}

/**
 * Something failed — US-31, AC3.
 *
 * **It does not apologise and it does not blame.** "Sorry, something went
 * wrong" is filler; "You entered something invalid" is an accusation, and on a
 * failed GET it is not even true. This says what did not work and offers the
 * one thing that might fix it.
 *
 * The request id is shown when there is one, because that is the string a user
 * reads out over the phone — which is why US-7 put it in the error body rather
 * than only in a header.
 */
export function ErrorState({ error, onRetry, className }: ErrorStateProps): React.JSX.Element {
  const { t } = useTranslation();

  const apiError = error instanceof ApiRequestError ? error : undefined;

  // Offline is a different problem with a different fix, so it gets different
  // words — telling somebody to retry when their wifi is off is not help.
  const message =
    apiError?.code === 'NETWORK_ERROR' ? t('states.errorOffline') : t('states.errorBody');

  return (
    <div
      role="alert"
      className={cn(
        'border-line flex flex-col items-center justify-center gap-2 rounded-md border px-6 py-10 text-center',
        className,
      )}
    >
      <TriangleAlert aria-hidden="true" className="text-sla-warn size-7" />
      <p className="text-section font-semibold">{t('states.errorTitle')}</p>
      <p className="text-ink-muted max-w-sm">{message}</p>

      {onRetry === undefined ? null : (
        <Button variant="outline" onClick={onRetry} className="mt-2 gap-1.5">
          <RotateCw aria-hidden="true" className="size-4" />
          {t('states.retry')}
        </Button>
      )}

      {apiError?.requestId === undefined ? null : (
        <p className="text-ink-faint text-meta mt-3">
          {t('states.reference')} <span className="tabular">{apiError.requestId}</span>
        </p>
      )}
    </div>
  );
}
