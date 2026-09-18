// src/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import it from './locales/it.json';
import en from './locales/en.json';

export const supportedLngs = ['it', 'en'] as const;
export type SupportedLng = (typeof supportedLngs)[number];

const resources = { it: { translation: it }, en: { translation: en } } as const;

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: 'it',
    fallbackLng: 'en',
    supportedLngs: [...supportedLngs],
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
}

// ponytail: per-call getFixedT creates a fresh translator; memoize per-lng if profile shows cost
export function t(lng: SupportedLng, key: string, params?: Record<string, unknown>): string {
  return params ? i18n.getFixedT(lng)(key, params) : i18n.getFixedT(lng)(key);
}

export default i18n;
