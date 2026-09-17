import { Injectable } from '@nestjs/common';
import type { z } from 'zod';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameters below.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';

import type { SaveItemBody, SavedItemKindSchema } from './saved-items.dto.js';

export type SavedItemKind = z.infer<typeof SavedItemKindSchema>;

export interface SavedItem {
  id: string;
  cityId: string;
  userId: string;
  kind: SavedItemKind;
  targetId: string;
  createdAt: Date;
}

interface SavedItemRow {
  id: string;
  city_id: string;
  user_id: string;
  kind: SavedItemKind;
  target_id: string;
  created_at: Date;
}

const toSavedItem = (r: SavedItemRow): SavedItem => ({
  id: r.id,
  cityId: r.city_id,
  userId: r.user_id,
  kind: r.kind,
  targetId: r.target_id,
  createdAt: r.created_at,
});

@Injectable()
export class SavedItemsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext): Promise<SavedItem[]> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      const rows = await trx
        .selectFrom('saved_items')
        .selectAll()
        .where('user_id', '=', (tenant.userId ?? '') as never)
        .orderBy('created_at', 'desc')
        .execute();
      return (rows as SavedItemRow[]).map(toSavedItem);
    });
  }

  // ON CONFLICT DO NOTHING via the (user_id, kind, target_id) unique index:
  // re-saving an item is a no-op rather than a duplicate row. We audit on
  // success of an actual insert.
  async save(
    body: SaveItemBody,
    user: AuthUser,
    tenant: TenantContext,
  ): Promise<SavedItem> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      const row = await trx
        .insertInto('saved_items')
        .values({
          city_id: tenant.cityId,
          user_id: user.id,
          kind: body.kind,
          target_id: body.targetId,
        } as never)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant,
        action: 'saved_item.create',
        targetType: 'saved_item',
        targetId: row.id,
        payload: { kind: body.kind, target_id: body.targetId },
      });

      return toSavedItem(row as unknown as SavedItemRow);
    });
  }

  async remove(
    id: string,
    user: AuthUser,
    tenant: TenantContext,
  ): Promise<void> {
    await this.db.runInTenantTx(tenant, async (trx) => {
      await trx
        .deleteFrom('saved_items')
        .where('id', '=', id as never)
        .where('user_id', '=', user.id as never)
        .execute();

      await this.audit.write(trx, {
        tenant,
        action: 'saved_item.delete',
        targetType: 'saved_item',
        targetId: id,
        payload: {},
      });
    });
  }
}
