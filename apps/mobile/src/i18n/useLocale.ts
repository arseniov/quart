// src/i18n/useLocale.ts
import { supportedLngs, type SupportedLng } from './index';

export interface LocaleInputs {
  systemLocale: string | null;
  userLocale: string | null;
}

export function resolveLocale({ systemLocale, userLocale }: LocaleInputs): SupportedLng {
  const candidates = [userLocale, systemLocale?.split('-')[0] || null, 'en'];
  for (const c of candidates) {
    if (c && (supportedLngs as readonly string[]).includes(c)) return c as SupportedLng;
  }
  return 'en';
}
