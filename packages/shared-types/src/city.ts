import { z } from 'zod';

export const CitySlugSchema = z.string().regex(/^[a-z0-9-]{2,40}$/);

export const CitySchema = z.object({
  id: z.string().uuid(),
  slug: CitySlugSchema,
  name: z.string().min(1).max(100),
  country_code: z.string().length(2).toUpperCase(),
  locale_default: z.string().length(2).toLowerCase(),
  timezone: z.string().min(1),
  bounds: z.unknown().nullable(),
  status: z.enum(['active', 'inactive']),
  created_at: z.coerce.date(),
});
export type City = z.infer<typeof CitySchema>;
