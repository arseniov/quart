import { z } from 'zod';

// Coerce string → number for query params (Fastify gives us strings).
const Pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // `?unread=true` filters to notifications with null read_at; anything else (or
  // missing) returns the full inbox.
  unread: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});
export const ListNotificationsQuerySchema = Pagination;
export type ListNotificationsQuery = z.infer<typeof Pagination>;

export const NotificationIdSchema = z.object({
  id: z.string().uuid(),
});
export type NotificationIdParam = z.infer<typeof NotificationIdSchema>;
