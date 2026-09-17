import { z } from 'zod';

// PATCH semantics — every field optional. Service merges against current row.
export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  locale: z.string().min(2).max(8).optional(),
  // `defaultCityId` is the user's home city. Free-form UUID is fine here; the
  // city RLS policy will reject invalid values.
  defaultCityId: z.string().uuid().optional(),
});
export type UpdateProfileBody = z.infer<typeof UpdateProfileSchema>;
