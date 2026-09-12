import { Injectable } from '@nestjs/common';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameters below.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';

import type { ListNotificationsQuery } from './notifications.dto.js';

export interface Notification {
  id: string;
  cityId: string;
  recipientUserId: string;
  type: string;
  title: string;
  body: string;
  targetUrl: string | null;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
}

interface NotificationRow {
  id: string;
  city_id: string;
  recipient_user_id: string;
  type: string;
  title: string;
  body: string;
  target_url: string | null;
  payload: unknown;
  read_at: Date | null;
  created_at: Date;
}

const toNotification = (r: NotificationRow): Notification => ({
  id: r.id,
  cityId: r.city_id,
  recipientUserId: r.recipient_user_id,
  type: r.type,
  title: r.title,
  body: r.body,
  targetUrl: r.target_url,
  payload: r.payload,
  readAt: r.read_at,
  createdAt: r.created_at,
});

@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // tenant.cityId guards per-city RLS but inbox row is filtered on
  // recipient_user_id, so a user can only see their own.
  async list(
    q: ListNotificationsQuery,
    tenant: TenantContext,
  ): Promise<Notification[]> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      let qb = trx
        .selectFrom('notifications')
        .selectAll()
        .where('recipient_user_id', '=', tenant.userId as never)
        .orderBy('created_at', 'desc')
        .limit(q.limit)
        .offset((q.page - 1) * q.limit);
      if (q.unread) qb = qb.where('read_at', 'is', null as never);
      const rows = await qb.execute();
      return (rows as NotificationRow[]).map(toNotification);
    });
  }

  /**
   * Atomic per-notification update: WHERE filters on recipient and `read_at IS
   * NULL` so a duplicate click can't double-stamp `read_at`. No audit event —
   * inbox reads are common enough that logging each would bloat the chain.
   */
  async markRead(id: string, tenant: TenantContext): Promise<void> {
    await this.db.runInTenantTx(tenant, async (trx) => {
      await trx
        .updateTable('notifications')
        .set({ read_at: new Date() } as never)
        .where('id', '=', id as never)
        .where('recipient_user_id', '=', (tenant.userId ?? '') as never)
        .where('read_at', 'is', null as never)
        .execute();
    });
  }

  async markAllRead(tenant: TenantContext): Promise<number> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      const result = await trx
        .updateTable('notifications')
        .set({ read_at: new Date() } as never)
        .where('recipient_user_id', '=', (tenant.userId ?? '') as never)
        .where('read_at', 'is', null as never)
        .execute();
      // Audit the bulk action in the same tx so an interrupted transaction
      // leaves no half-bulk-write / half-audit-log state.
      await this.audit.write(trx, {
        tenant,
        action: 'notifications.mark_all_read',
        targetType: 'notifications',
        targetId: tenant.userId ?? '',
        payload: { count: Number((result as unknown as { numAffectedRows?: number }).numAffectedRows ?? 0) },
      });
      return Number((result as unknown as { numAffectedRows?: number }).numAffectedRows ?? 0);
    });
  }
}
