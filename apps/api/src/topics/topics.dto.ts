import { z } from 'zod';

// `nameI18n` is a free-form locale → string map; jsonb in PG. Keep loose —
// strong per-locale validation belongs in a future i18n schema.
const I18nSchema = z.record(z.string(), z.string());

export const ListSchema = z.object({
  cityId: z.string().uuid(),
});

export const IdSchema = z.object({
  id: z.string().uuid(),
});

export const CreateSchema = z.object({
  cityId: z.string().uuid(),
  categoryId: z.string().uuid(),
  code: z.string().min(1).max(64),
  nameI18n: I18nSchema.refine((m) => Object.keys(m).length > 0, { message: 'nameI18n must not be empty' }),
});

// PATCH semantics: every field optional. The service merges this against the
// current row before writing so partial updates don't clobber neighbours.
export const UpdateSchema = z.object({
  categoryId: z.string().uuid().optional(),
  code: z.string().min(1).max(64).optional(),
  nameI18n: I18nSchema.optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export type ListQuery = z.infer<typeof ListSchema>;
export type CreateBody = z.infer<typeof CreateSchema>;
export type UpdateBody = z.infer<typeof UpdateSchema>;