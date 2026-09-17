import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameters below.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';

import type {
  AdminIssueBulkAssignBody,
  AdminIssueBulkStatusBody,
  AdminIssueExportQueryT,
  AdminIssueListQueryT,
} from './admin-issues.dto.js';

export interface AdminIssue {
  id: string;
  cityId: string;
  neighborhoodId: string;
  categoryId: string | null;
  authorUserId: string;
  title: unknown;
  description: unknown;
  addressHint: string | null;
  status: string;
  assignedOfficerId: string | null;
  createdAt: Date;
  statusChangedAt: Date;
}

interface AdminIssueRow {
  id: string;
  city_id: string;
  neighborhood_id: string;
  category_id: string | null;
  author_user_id: string;
  title: unknown;
  description: unknown;
  address_hint: string | null;
  status: string;
  assigned_officer_id: string | null;
  created_at: Date;
  status_changed_at: Date;
}

interface AdminMapRow {
  id: string;
  status: string;
  location: { type: 'Point'; coordinates: [number, number] };
}

interface AdminExportRow {
  id: string;
  status: string;
  category_id: string | null;
  neighborhood_id: string;
  author_user_id: string;
  assigned_officer_id: string | null;
  title: unknown;
  description: unknown;
  address_hint: string | null;
  created_at: Date;
  status_changed_at: Date;
}

const toAdminIssue = (r: AdminIssueRow): AdminIssue => ({
  id: r.id,
  cityId: r.city_id,
  neighborhoodId: r.neighborhood_id,
  categoryId: r.category_id,
  authorUserId: r.author_user_id,
  title: r.title,
  description: r.description,
  addressHint: r.address_hint,
  status: r.status,
  assignedOfficerId: r.assigned_officer_id,
  createdAt: r.created_at,
  statusChangedAt: r.status_changed_at,
});

// RFC 4180 CSV escaping: wrap a field in double-quotes if it contains a
// comma, double-quote, CR, or LF; embedded double-quotes are doubled.
const csvField = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

@Injectable()
export class AdminIssuesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(q: AdminIssueListQueryT): Promise<AdminIssue[]> {
    return this.db.runInTenantTx(
      { cityId: q.cityId, userId: null, isSuperAdmin: true, requestId: '' },
      async (trx) => {
        let s = trx
          .selectFrom('issues')
          .select([
            'id',
            'city_id',
            'neighborhood_id',
            'category_id',
            'author_user_id',
            'title',
            'description',
            'address_hint',
            'status',
            'assigned_officer_id',
            'created_at',
            'status_changed_at',
          ])
          .where('city_id', '=', q.cityId)
          .where('deleted_at', 'is', null);
        if (q.status) s = s.where('status', '=', q.status);
        if (q.categoryId) s = s.where('category_id', '=', q.categoryId);
        if (q.neighborhoodId) s = s.where('neighborhood_id', '=', q.neighborhoodId);
        if (q.assignee) s = s.where('assigned_officer_id', '=', q.assignee);
        const rows = await s
          .orderBy('created_at', 'desc')
          .limit(q.limit)
          .offset((q.page - 1) * q.limit)
          .execute();
        return (rows as unknown as AdminIssueRow[]).map(toAdminIssue);
      },
    );
  }

  async map(q: AdminIssueListQueryT): Promise<{
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      geometry: { type: 'Point'; coordinates: [number, number] };
      properties: { id: string; status: string };
    }>;
  }> {
    return this.db.runInTenantTx(
      { cityId: q.cityId, userId: null, isSuperAdmin: true, requestId: '' },
      async (trx) => {
        // ST_X/ST_Y extract lon/lat from the geography(Point, 4326) column;
        // wrapping the result in a JSON object lets kysely hand us back a
        // plain row without a custom type plugin.
        const rows = await trx
          .selectFrom('issues')
          .select([
            'id',
            'status',
            sql<{ type: 'Point'; coordinates: [number, number] }>`json_build_object('type','Point','coordinates',array[ST_X(location)::float8, ST_Y(location)::float8])`.as(
              'location',
            ),
          ])
          .where('city_id', '=', q.cityId)
          .where('deleted_at', 'is', null)
          .execute();
        const mapRows = rows as unknown as AdminMapRow[];
        return {
          type: 'FeatureCollection',
          features: mapRows.map((r) => ({
            type: 'Feature' as const,
            geometry: r.location,
            properties: { id: r.id, status: r.status },
          })),
        };
      },
    );
  }

  /**
   * CSV export. Columns match the admin list view: stable ordering so a
   * downstream spreadsheet can rely on the header line. i18n JSONB fields
   * (`title`, `description`) are emitted as JSON-encoded quoted strings —
   * consumers that want a single locale can pipe through `jq -r '.it'`.
   */
  async export(q: AdminIssueExportQueryT): Promise<string> {
    return this.db.runInTenantTx(
      { cityId: q.cityId, userId: null, isSuperAdmin: true, requestId: '' },
      async (trx) => {
        let s = trx
          .selectFrom('issues')
          .select([
            'id',
            'status',
            'category_id',
            'neighborhood_id',
            'author_user_id',
            'assigned_officer_id',
            'title',
            'description',
            'address_hint',
            'created_at',
            'status_changed_at',
          ])
          .where('city_id', '=', q.cityId)
          .where('deleted_at', 'is', null);
        if (q.status) s = s.where('status', '=', q.status);
        const rows = (await s.orderBy('created_at', 'desc').execute()) as unknown as AdminExportRow[];

        const header = [
          'id',
          'status',
          'category_id',
          'neighborhood_id',
          'author_user_id',
          'assigned_officer_id',
          'title',
          'description',
          'address_hint',
          'created_at',
          'status_changed_at',
        ];
        const lines = [header.join(',')];
        for (const r of rows) {
          lines.push(
            [
              csvField(r.id),
              csvField(r.status),
              csvField(r.category_id),
              csvField(r.neighborhood_id),
              csvField(r.author_user_id),
              csvField(r.assigned_officer_id),
              csvField(JSON.stringify(r.title)),
              csvField(JSON.stringify(r.description)),
              csvField(r.address_hint),
              csvField(r.created_at),
              csvField(r.status_changed_at),
            ].join(','),
          );
        }
        return lines.join('\r\n') + '\r\n';
      },
    );
  }

  async bulkChangeStatus(
    body: AdminIssueBulkStatusBody,
    user: AuthUser,
    tenant: TenantContext,
  ): Promise<{ updated: number }> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      let updated = 0;
      for (const id of body.ids) {
        const row = await trx
          .updateTable('issues')
          .set({ status: body.status, status_changed_at: new Date() })
          .where('id', '=', id)
          .returning(['id', 'city_id', 'status'])
          .executeTakeFirst();
        if (!row) continue;

        await trx
          .insertInto('issue_events')
          .values({
            issue_id: id,
            actor_user_id: user.id,
            event_type: 'status_changed',
            payload: { status: body.status, note: body.note ?? null, bulk: true },
          })
          .execute();

        await this.audit.write(trx, {
          tenant,
          action: 'issue.status',
          targetType: 'issue',
          targetId: id,
          payload: { status: body.status, note: body.note ?? null, bulk: true },
        });
        updated += 1;
      }
      return { updated };
    });
  }

  async bulkAssign(
    body: AdminIssueBulkAssignBody,
    user: AuthUser,
    tenant: TenantContext,
  ): Promise<{ updated: number }> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      let updated = 0;
      for (const id of body.ids) {
        const row = await trx
          .updateTable('issues')
          .set({ assigned_officer_id: body.userId })
          .where('id', '=', id)
          .returning(['id', 'city_id', 'assigned_officer_id'])
          .executeTakeFirst();
        if (!row) continue;

        await trx
          .insertInto('issue_events')
          .values({
            issue_id: id,
            actor_user_id: user.id,
            event_type: 'assigned',
            payload: { assigneeId: body.userId, bulk: true },
          })
          .execute();

        await this.audit.write(trx, {
          tenant,
          action: 'issue.assign',
          targetType: 'issue',
          targetId: id,
          payload: { assigneeId: body.userId, bulk: true },
        });
        updated += 1;
      }
      return { updated };
    });
  }
}
