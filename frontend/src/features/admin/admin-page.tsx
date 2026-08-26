import { useTranslation } from 'react-i18next';

/**
 * A placeholder behind a permission — US-23, AC4.
 *
 * It exists so there is a restricted route to type the URL of. The real
 * administration screens are P14's; do not grow this into them.
 */
export function AdminPage(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-6">
      <h1 className="text-page font-semibold">{t('nav.administration')}</h1>
      <p className="text-ink-muted">{t('admin.placeholder')}</p>
    </div>
  );
}
