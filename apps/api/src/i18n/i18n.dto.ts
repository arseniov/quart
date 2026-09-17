import { z } from 'zod';

// BCP-47 locale (loose — accept 'it', 'it-IT', 'en-US', 'pt-BR', …). The
// schema is permissive on purpose: the value is later used as part of an
// `app_settings.key` and we don't want to reject locales just because they
// aren't in a curated list.
export const Locale = z.string().regex(/^[a-z]{2,3}(-[A-Z0-9]{2,8})?$/, 'invalid locale');
export type Locale = z.infer<typeof Locale>;

// Translation payload: nested map of strings. We keep the surface loose —
// mobile clients own the schema; the server only validates "JSON object".
export const TranslationPayload = z.record(z.string(), z.unknown());
export type TranslationPayload = z.infer<typeof TranslationPayload>;

export const PutTranslationBody = z.object({
  translations: TranslationPayload,
});
export type PutTranslationBody = z.infer<typeof PutTranslationBody>;