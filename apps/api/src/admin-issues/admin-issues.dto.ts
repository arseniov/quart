import { z } from 'zod';

// Shared with issues.dto: keep the union authoritative so a status change
// issued here cannot introduce an enum value the regular controller rejects.
export const ADMIN_ISSUE_STATUSES = [
  'open',
  'acknowledged',
  'in_progress',
  'resolved',
  'closed',
  'rejected',
] as const;

export const AdminIssueListQuery = z.object({
  cityId: z.string().uuid(),
  status: z.enum(ADMIN_ISSUE_STATUSES).optional(),
  categoryId: z.string().uuid().optional(),
  neighborhoodId: z.string().uuid().optional(),
  assignee: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const AdminIssueExportQuery = z.object({
  cityId: z.string().uuid(),
  status: z.enum(ADMIN_ISSUE_STATUSES).optional(),
});

// 200 ids × 36-byte uuid = ~7 KB; the JSON body limit on Fastify defaults
// to 1 MB so we have headroom. Larger batches should paginate.
const BulkIds = z.array(z.string().uuid()).min(1).max(200);

export const AdminIssueBulkStatus = z.object({
  ids: BulkIds,
  status: z.enum(ADMIN_ISSUE_STATUSES),
  note: z.string().max(500).optional(),
});

export const AdminIssueBulkAssign = z.object({
  ids: BulkIds,
  userId: z.string().uuid(),
});

export type AdminIssueListQueryT = z.infer<typeof AdminIssueListQuery>;
export type AdminIssueExportQueryT = z.infer<typeof AdminIssueExportQuery>;
export type AdminIssueBulkStatusBody = z.infer<typeof AdminIssueBulkStatus>;
export type AdminIssueBulkAssignBody = z.infer<typeof AdminIssueBulkAssign>;
