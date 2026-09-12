import { z } from 'zod';

// Free-form locale → string map. Loose validation — strong per-locale
// checks belong in a future i18n schema.
const I18nSchema = z.record(z.string(), z.string().min(1).max(2000));

// GeoJSON Point: [lon, lat] in WGS84.
const PointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)]),
});

export const ISSUE_STATUSES = [
  'open',
  'acknowledged',
  'in_progress',
  'resolved',
  'closed',
  'rejected',
] as const;

export const ListSchema = z.object({
  cityId: z.string().uuid(),
  status: z.enum(ISSUE_STATUSES).optional(),
  categoryId: z.string().uuid().optional(),
  neighborhoodId: z.string().uuid().optional(),
  assignee: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const IdSchema = z.object({
  id: z.string().uuid(),
});

export const CreateSchema = z.object({
  categoryId: z.string().uuid(),
  titleI18n: I18nSchema.refine((m) => Object.keys(m).length > 0, { message: 'titleI18n must not be empty' }),
  descriptionI18n: I18nSchema.refine((m) => Object.keys(m).length > 0, { message: 'descriptionI18n must not be empty' }),
  location: PointSchema,
  address: z.string().max(500).optional(),
  photoKeys: z.array(z.string().uuid()).max(5).default([]),
});

export const StatusSchema = z.object({
  status: z.enum(ISSUE_STATUSES),
  note: z.string().max(500).optional(),
});

export const AssignSchema = z.object({
  userId: z.string().uuid(),
});

// Phase 6 will accept multipart uploads; this stub validates the JSON
// envelope so the route exists and is RBAC-gated from day one.
export const AttachPhotoSchema = z.object({
  objectKey: z.string().min(1).max(512),
  sortOrder: z.number().int().min(0).max(100).default(0),
});

export type ListQuery = z.infer<typeof ListSchema>;
export type CreateBody = z.infer<typeof CreateSchema>;
export type StatusBody = z.infer<typeof StatusSchema>;
export type AssignBody = z.infer<typeof AssignSchema>;
export type AttachPhotoBody = z.infer<typeof AttachPhotoSchema>;
