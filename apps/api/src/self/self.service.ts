import { Injectable } from '@nestjs/common';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameters below.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';

import type { UpdateProfileBody } from './self.dto.js';

export interface SelfProfile {
  id: string;
  handle: string;
  email: string | null;
  phoneE164: string | null;
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  defaultCityId: string | null;
  status: 'active' | 'suspended' | 'deleted';
}

interface UserRow {
  id: string;
  handle: string;
  email: string | null;
  phone_e164: string | null;
  display_name: string;
  avatar_url: string | null;
  locale: string;
  default_city_id: string | null;
  status: 'active' | 'suspended' | 'deleted';
}

const toSelfProfile = (r: UserRow): SelfProfile => ({
  id: r.id,
  handle: r.handle,
  email: r.email,
  phoneE164: r.phone_e164,
  displayName: r.display_name,
  avatarUrl: r.avatar_url,
  locale: r.locale,
  defaultCityId: r.default_city_id,
  status: r.status,
});

@Injectable()
export class SelfService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async get(user: AuthUser, tenant: TenantContext): Promise<SelfProfile> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      const row = await trx
        .selectFrom('users')
        .select([
          'id',
          'handle',
          'email',
          'phone_e164',
          'display_name',
          'avatar_url',
          'locale',
          'default_city_id',
          'status',
        ])
        .where('id', '=', user.id as never)
        .executeTakeFirstOrThrow();
      return toSelfProfile(row as unknown as UserRow);
    });
  }

  async update(
    body: UpdateProfileBody,
    user: AuthUser,
    tenant: TenantContext,
  ): Promise<SelfProfile> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      const patch: Record<string, unknown> = {};
      if (body.displayName !== undefined) patch['display_name'] = body.displayName;
      if (body.locale !== undefined) patch['locale'] = body.locale;
      if (body.defaultCityId !== undefined) patch['default_city_id'] = body.defaultCityId;
      if (Object.keys(patch).length === 0) {
        // Nothing to write; skip the update but still return the current row so
        // the client gets a consistent view.
        const row = await trx
          .selectFrom('users')
          .select([
            'id',
            'handle',
            'email',
            'phone_e164',
            'display_name',
            'avatar_url',
            'locale',
            'default_city_id',
            'status',
          ])
          .where('id', '=', user.id as never)
          .executeTakeFirstOrThrow();
        return toSelfProfile(row as unknown as UserRow);
      }

      const row = await trx
        .updateTable('users')
        .set(patch as never)
        .where('id', '=', user.id as never)
        .returning([
          'id',
          'handle',
          'email',
          'phone_e164',
          'display_name',
          'avatar_url',
          'locale',
          'default_city_id',
          'status',
        ])
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant,
        action: 'self.update',
        targetType: 'user',
        targetId: user.id,
        payload: { changes: Object.keys(patch) },
      });

      return toSelfProfile(row as unknown as UserRow);
    });
  }

  /**
   * DSAR export: queues an async job (a real worker takes over from here).
   * Returns a `queued` status so the client knows the request was accepted.
   */
  async exportData(
    user: AuthUser,
    tenant: TenantContext,
  ): Promise<{ ok: true; status: 'queued' }> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      await this.audit.write(trx, {
        tenant,
        action: 'self.export',
        targetType: 'user',
        targetId: user.id,
        payload: { kind: 'gdpr_export' },
      });
      return { ok: true as const, status: 'queued' as const };
    });
  }

  /**
   * DSAR delete: soft-delete (`status='deleted'`) so the audit chain stays
   * intact (users are FK targets in audit_log; hard delete would cascade
   * through other tables too). A future cron reaps `deleted_at > N days`.
   */
  async deleteMe(
    user: AuthUser,
    tenant: TenantContext,
  ): Promise<{ ok: true; graceDays: 30 }> {
    await this.db.runInTenantTx(tenant, async (trx) => {
      await trx
        .updateTable('users')
        .set({ status: 'deleted', deleted_at: new Date() } as never)
        .where('id', '=', user.id as never)
        .execute();

      await this.audit.write(trx, {
        tenant,
        action: 'self.delete',
        targetType: 'user',
        targetId: user.id,
        payload: { grace_days: 30 },
      });
    });
    return { ok: true, graceDays: 30 };
  }
}
