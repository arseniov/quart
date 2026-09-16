import { Injectable } from '@nestjs/common';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameters below.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

import type { CreateBody, ListQuery, UpdateBody } from './topics.dto.js';

export interface Topic {
  id: string;
  categoryId: string;
  cityId: string;
  code: string;
  nameI18n: Record<string, string>;
  status: 'active' | 'archived';
  createdAt: Date;
}

interface TopicRow {
  id: string;
  category_id: string;
  city_id: string;
  code: string;
  name_i18n: Record<string, string>;
  status: 'active' | 'archived';
  created_at: Date;
}

const toTopic = (r: TopicRow): Topic => ({
  id: r.id,
  categoryId: r.category_id,
  cityId: r.city_id,
  code: r.code,
  nameI18n: r.name_i18n,
  status: r.status,
  createdAt: r.created_at,
});

// `audit_log.on_behalf_of_user_id` is null by default; impersonation sets it
// via req.tenant.onBehalfOfUserId in T21. Ponytail: keep null until T31
// threads it through controller params.
@Injectable()
export class TopicsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, q: ListQuery): Promise<Topic[]> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const rows = await trx
        .selectFrom('topics')
        .select(['id', 'category_id', 'city_id', 'code', 'name_i18n', 'status', 'created_at'])
        .where('city_id', '=', q.cityId)
        .where('status', '=', 'active')
        .execute();
      return (rows as unknown as TopicRow[]).map(toTopic);
    });
  }

  async get(user: AuthUser, id: string): Promise<Topic> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const row = await trx
        .selectFrom('topics')
        .select(['id', 'category_id', 'city_id', 'code', 'name_i18n', 'status', 'created_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return toTopic(row as unknown as TopicRow);
    });
  }

  async create(user: AuthUser, body: CreateBody): Promise<Topic> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const row = await trx
        .insertInto('topics')
        .values({
          city_id: body.cityId,
          category_id: body.categoryId,
          code: body.code,
          name_i18n: body.nameI18n,
          status: 'active',
        })
        .returning(['id', 'category_id', 'city_id', 'code', 'name_i18n', 'status', 'created_at'])
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'topic.create',
        targetType: 'topic',
        targetId: (row as unknown as TopicRow).id,
        // payload excludes user-controlled strings (no PII risk) but redacts
        // name_i18n values defensively — names flow through translations that
        // could carry a moderation reason.
        payload: { code: body.code, categoryId: body.categoryId },
      });

      return toTopic(row as unknown as TopicRow);
    });
  }

  async update(user: AuthUser, id: string, body: UpdateBody): Promise<Topic> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const patch: Record<string, unknown> = {};
      if (body.categoryId !== undefined) patch['category_id'] = body.categoryId;
      if (body.code !== undefined) patch['code'] = body.code;
      if (body.nameI18n !== undefined) patch['name_i18n'] = body.nameI18n;
      if (body.status !== undefined) patch['status'] = body.status;

      const row = await trx
        .updateTable('topics')
        .set(patch)
        .where('id', '=', id)
        .returning(['id', 'category_id', 'city_id', 'code', 'name_i18n', 'status', 'created_at'])
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'topic.update',
        targetType: 'topic',
        targetId: id,
        payload: { changes: Object.keys(patch) },
      });

      return toTopic(row as unknown as TopicRow);
    });
  }

  async delete(user: AuthUser, id: string): Promise<void> {
    await this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      await trx.deleteFrom('topics').where('id', '=', id).execute();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'topic.delete',
        targetType: 'topic',
        targetId: id,
        payload: {},
      });
    });
  }

  private tenantCtx(user: AuthUser) {
    return {
      cityId: user.cityId,
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
      requestId: user.requestId ?? '',
    };
  }
}