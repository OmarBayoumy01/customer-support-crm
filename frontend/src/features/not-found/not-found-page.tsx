import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

/**
 * The 404 — US-25, AC2.
 *
 * An empty screen is an invitation to act, so this one offers the way back
 * rather than only stating what went wrong. It does not apologise: the person
 * followed a link that no longer goes anywhere, which is not their fault and
 * not worth a paragraph about it.
 */
export function NotFoundPage(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 text-center">
      {/* Mono, because it is a code and codes are data. */}
      <p className="tabular text-ink-faint text-page">404</p>
      <h1 className="text-page font-semibold">{t('errors.notFoundTitle')}</h1>
      <p className="text-ink-muted text-body">{t('errors.notFoundBody')}</p>
      <Link to="/" className="text-brand text-body underline underline-offset-4">
        {t('errors.backToDashboard')}
      </Link>
    </main>
  );
}
