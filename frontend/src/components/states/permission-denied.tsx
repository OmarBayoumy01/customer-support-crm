import { Lock } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

export interface PermissionDeniedProps {
  /**
   * The **capability**, as an i18n key — `capability.administration`, not
   * `user:manage`.
   *
   * US-23 decided the denied screen names no permission, because "you need
   * `user:manage`" is a sentence for a developer and hands anyone probing the
   * app the vocabulary of its internals. US-31's AC4 asks for the missing
   * access to be named.
   *
   * Both are satisfied by naming the thing in human language and never the key.
   * There is a test asserting `user:manage` still never reaches the DOM.
   */
  capabilityKey?: string;
}

/**
 * A page this role may not open — US-31, AC4.
 *
 * A real screen, not a redirect. Someone who followed a link they cannot open
 * needs telling that is what happened; bouncing them silently to the dashboard
 * reads as a broken link and they will simply try again.
 *
 * Two ways out, because "no" without a next step is a dead end: back to work,
 * or ask for the access.
 */
export function PermissionDenied({ capabilityKey }: PermissionDeniedProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <Lock aria-hidden="true" className="text-ink-faint size-7" />

      {/* Text and an icon. Never a colour on its own. */}
      <h1 className="text-page font-semibold">{t('permissions.deniedTitle')}</h1>

      <p className="text-ink-muted">
        {capabilityKey === undefined
          ? t('permissions.deniedBody')
          : t('permissions.deniedNamed', { capability: t(capabilityKey) })}
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link to="/dashboard">{t('permissions.backToDashboard')}</Link>
        </Button>
        <Button variant="outline" asChild>
          {/*
            `mailto:` rather than a request-access form. The form is a feature
            nobody has asked for; the administrator's inbox already works, and
            an unroutable "Request access" button is worse than none.
          */}
          <a href={`mailto:?subject=${encodeURIComponent(t('permissions.requestSubject'))}`}>
            {t('permissions.requestAccess')}
          </a>
        </Button>
      </div>
    </main>
  );
}
