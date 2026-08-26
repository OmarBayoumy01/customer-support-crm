import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import ar from './locales/ar.json';
import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = ['en', 'ar'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Which languages read right to left. Arabic today; more may follow. */
const RTL_LANGUAGES = new Set<string>(['ar']);

export function isRtl(language: string): boolean {
  return RTL_LANGUAGES.has(language);
}

/**
 * Puts the active language on the document.
 *
 * Both attributes, every time. `dir` drives the mirroring that CSS logical
 * properties depend on, and `lang` is what a screen reader uses to pick a voice
 * — setting one without the other gives you a page that looks right and reads
 * wrong.
 */
export function applyDocumentLanguage(language: string): void {
  document.documentElement.lang = language;
  document.documentElement.dir = isRtl(language) ? 'rtl' : 'ltr';
}

await i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    // React escapes for us; doing it twice mangles apostrophes.
    escapeValue: false,
  },
});

// Kept in step for the life of the app, rather than being set once at boot: the
// language toggle changes `dir` through this listener.
i18n.on('languageChanged', applyDocumentLanguage);

applyDocumentLanguage(i18n.language);

export default i18n;
