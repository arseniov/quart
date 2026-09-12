import { Injectable } from '@nestjs/common';
import type { DB } from '@quart/db';
import type { Transaction } from 'kysely';
import { sql } from 'kysely';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameters below.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

import type { AssignBody, CreateBody, ListQuery, StatusBody } from './issues.dto.js';

export interface Issue {
  id: string;
  cityId: string;
  neighborhoodId: string;
  categoryId: string | null;
  authorUserId: string;
  title: string;
  description: string;
  addressHint: string | null;
  status: 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed' | 'rejected';
  assignedOfficerId: string | null;
  createdAt: Date;
}

interface IssueRow {
  id: string;
  city_id: string;
  neighborhood_id: string;
  category_id: string | null;
  author_user_id: string;
  title: string;
  description: string;
  address_hint: string | null;
  status: Issue['status'];
  assigned_officer_id: string | null;
  created_at: Date;
}

export interface IssuePhoto {
  id: string;
  issueId: string;
  objectKey: string;
  sortOrder: number;
  createdAt: Date;
}

interface IssuePhotoRow {
  id: string;
  issue_id: string;
  object_key: string;
  sort_order: number;
  created_at: Date;
}

export interface IssueEvent {
  id: string;
  issueId: string;
  actorUserId: string | null;
  eventType: 'created' | 'status_changed' | 'assigned' | 'commented' | 'photo_added';
  payload: unknown;
  createdAt: Date;
}

interface IssueEventRow {
  id: string;
  issue_id: string;
  actor_user_id: string | null;
  event_type: IssueEvent['eventType'];
  payload: unknown;
  created_at: Date;
}

const toIssue = (r: IssueRow): Issue => ({
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
});

const toPhoto = (r: IssuePhotoRow): IssuePhoto => ({
  id: r.id,
  issueId: r.issue_id,
  objectKey: r.object_key,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
});

const toEvent = (r: IssueEventRow): IssueEvent => ({
  id: r.id,
  issueId: r.issue_id,
  actorUserId: r.actor_user_id,
  eventType: r.event_type,
  payload: r.payload,
  createdAt: r.created_at,
});

@Injectable()
export class IssuesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, q: ListQuery): Promise<Issue[]> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
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
      return (rows as unknown as IssueRow[]).map(toIssue);
    });
  }

  async get(user: AuthUser, id: string): Promise<{
    issue: Issue;
    photos: IssuePhoto[];
    events: IssueEvent[];
  }> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const issueRow = await trx
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
        ])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      const photos = await trx
        .selectFrom('issue_photos')
        .select(['id', 'issue_id', 'object_key', 'sort_order', 'created_at'])
        .where('issue_id', '=', id)
        .orderBy('sort_order', 'asc')
        .execute();
      const events = await trx
        .selectFrom('issue_events')
        .select(['id', 'issue_id', 'actor_user_id', 'event_type', 'payload', 'created_at'])
        .where('issue_id', '=', id)
        .orderBy('created_at', 'asc')
        .execute();
      return {
        issue: toIssue(issueRow as unknown as IssueRow),
        photos: (photos as unknown as IssuePhotoRow[]).map(toPhoto),
        events: (events as unknown as IssueEventRow[]).map(toEvent),
      };
    });
  }

  async create(user: AuthUser, body: CreateBody): Promise<{ id: string; neighborhoodId: string }> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const neighborhoodId = await this.inferNeighborhood(
        trx as unknown as Parameters<IssuesService['inferNeighborhood']>[0],
        body.location.coordinates,
        user.cityId,
      );
      const row = await trx
        .insertInto('issues')
        .values({
          city_id: user.cityId,
          neighborhood_id: neighborhoodId,
          category_id: body.categoryId,
          author_user_id: user.id,
          title: body.titleI18n as never,
          description: body.descriptionI18n as never,
          location: sql`ST_SetSRID(ST_MakePoint(${body.location.coordinates[0]}, ${body.location.coordinates[1]}), 4326)::geography`,
          address_hint: body.address ?? null,
          status: 'open',
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const issueId = (row as unknown as { id: string }).id;

      await trx
        .insertInto('issue_events')
        .values({
          issue_id: issueId,
          actor_user_id: user.id,
          event_type: 'created',
          payload: { categoryId: body.categoryId },
        })
        .execute();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'issue.create',
        targetType: 'issue',
        targetId: issueId,
        payload: { categoryId: body.categoryId, neighborhoodId },
      });

      return { id: issueId, neighborhoodId };
    });
  }

  async changeStatus(user: AuthUser, id: string, body: StatusBody): Promise<Issue> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const row = await trx
        .updateTable('issues')
        .set({ status: body.status, status_changed_at: new Date() })
        .where('id', '=', id)
        .returning([
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
        ])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('issue_events')
        .values({
          issue_id: id,
          actor_user_id: user.id,
          event_type: 'status_changed',
          payload: { status: body.status, note: body.note ?? null },
        })
        .execute();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'issue.status',
        targetType: 'issue',
        targetId: id,
        payload: { status: body.status, note: body.note ?? null },
      });

      return toIssue(row as unknown as IssueRow);
    });
  }

  async assign(user: AuthUser, id: string, body: AssignBody): Promise<Issue> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const row = await trx
        .updateTable('issues')
        .set({ assigned_officer_id: body.userId })
        .where('id', '=', id)
        .returning([
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
        ])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('issue_events')
        .values({
          issue_id: id,
          actor_user_id: user.id,
          event_type: 'assigned',
          payload: { assigneeId: body.userId },
        })
        .execute();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'issue.assign',
        targetType: 'issue',
        targetId: id,
        payload: { assigneeId: body.userId },
      });

      return toIssue(row as unknown as IssueRow);
    });
  }

  // Ponytail: ST_Within first (point-in-polygon), fall back to nearest
  // centroid. Both run under the city_id predicate so points outside any
  // polygon still resolve to the closest neighborhood within the city.
  // Upgrade path if border points mis-route: replace with ST_DWithin
  // against a buffered polygon, or skip fallback when distance > N km.
  private async inferNeighborhood(
    trx: Transaction<DB>,
    point: [number, number],
    cityId: string,
  ): Promise<string> {
    const within = await trx
      .selectFrom('neighborhoods')
      .select('id')
      .where('city_id', '=', cityId)
      .where((eb) =>
        eb.fn('ST_Within', [
          eb.fn('ST_SetSRID', [
            eb.fn('ST_MakePoint', [eb.val(point[0]), eb.val(point[1])]),
            eb.val(4326),
          ]),
          eb.ref('geometry'),
        ]),
      )
      .limit(1)
      .executeTakeFirst();

    if (within?.id) return within.id;

    const nearest = await trx
      .selectFrom('neighborhoods')
      .select('id')
      .where('city_id', '=', cityId)
      .orderBy((eb) =>
        eb.fn('ST_Distance', [
          eb.ref('centroid'),
          eb.fn('ST_SetSRID', [
            eb.fn('ST_MakePoint', [eb.val(point[0]), eb.val(point[1])]),
            eb.val(4326),
          ]),
        ]),
      )
      .limit(1)
      .executeTakeFirstOrThrow();

    if (!nearest.id) {
      throw new Error('no neighborhood found for city');
    }
    return nearest.id;
  }

  private tenantCtx(user: AuthUser) {
    return {
      cityId: user.cityId,
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
      requestId: '',
    };
  }
}
