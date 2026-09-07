import { z } from 'zod';

export const LocaleSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);

export const UserPublicSchema = z.object({
  id: z.string().uuid(),
  handle: z.string().min(3).max(40),
  display_name: z.string().min(1).max(80),
  avatar_url: z.string().url().nullable(),
  locale: LocaleSchema,
  city_id: z.string().uuid(),
  created_at: z.coerce.date(),
});
export type UserPublic = z.infer<typeof UserPublicSchema>;
