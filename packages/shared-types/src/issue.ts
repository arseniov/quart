import { z } from 'zod';

export const IssueStatusSchema = z.enum([
  'open',
  'acknowledged',
  'in_progress',
  'resolved',
  'closed',
  'rejected',
]);

export const IssueCreateSchema = z.object({
  category_id: z.string().uuid(),
  description: z.string().min(10).max(2000),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  neighborhood_id: z.string().uuid(),
  address_hint: z.string().max(200).optional(),
  photo_object_keys: z.array(z.string().min(1).max(200)).max(5).default([]),
});
export type IssueCreate = z.infer<typeof IssueCreateSchema>;
