import { useTranslation } from 'react-i18next';

import { Button } from './ui/button';

/**
 * Switches between English and Arabic.
 *
 * Present from the very first screen on purpose. The platform ships bilingual
 * from day one, and a mirror nobody can trigger is a mirror nobody checks — this
 * is what makes the RTL layout reviewable by hand rather than only in a test.
 */
export function LanguageToggle(): React.JSX.Element {
  const { t, i18n } = useTranslation();

  const next = i18n.language === 'ar' ? 'en' : 'ar';

  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      // `lang` on the control itself, so a screen reader pronounces "العربية"
      // in Arabic rather than attempting it in the page language.
      lang={next}
      onClick={() => {
        void i18n.changeLanguage(next);
      }}
    >
      {t('common.switchLanguage')}
    </Button>
  );
}
