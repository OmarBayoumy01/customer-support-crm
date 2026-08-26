import { useTranslation } from 'react-i18next';

import { AppNav } from '../../components/app-nav';

/**
 * A placeholder behind a permission — US-23, AC4.
 *
 * It exists so there is a restricted route to type the URL of. The real
 * administration screens are P14's; do not grow this into them.
 */
export function AdminPage(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <AppNav />
      <h1 className="mt-4 text-xl font-semibold">{t('nav.administration')}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{t('admin.placeholder')}</p>
    </main>
  );
}
