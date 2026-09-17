import { z } from 'zod';

export const ListSchema = z.object({
  cityId: z.string().uuid(),
  status: z.enum(['draft', 'published', 'hidden', 'rejected']).optional(),
  sort: z.enum(['top', 'new']).default('new'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const IdSchema = z.object({
  id: z.string().uuid(),
});

// Body schemas. `title`/`body` are plain text per migration 0005 — no i18n
// jsonb on the `ideas` table. Length bounds mirror the DB CHECK constraints.
export const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
  neighborhoodId: z.string().uuid().optional(),
});

export const UpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(20000).optional(),
});

// `publish` brings status to 'published'; `hide` to 'hidden'; `reject` to
// 'rejected'. Maps directly to admin.ideas.moderate intent.
export const ModerateSchema = z.object({
  action: z.enum(['publish', 'hide', 'reject']),
});

export const CommentCreateSchema = z.object({
  body: z.string().min(1).max(5000),
});

export type ListQuery = z.infer<typeof ListSchema>;
export type CreateBody = z.infer<typeof CreateSchema>;
export type UpdateBody = z.infer<typeof UpdateSchema>;
export type ModerateBody = z.infer<typeof ModerateSchema>;
export type CommentCreateBody = z.infer<typeof CommentCreateSchema>;