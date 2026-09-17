import { Injectable, NotFoundException } from '@nestjs/common';

import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the AuditService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the DbService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

import type { TranslationPayload } from './i18n.dto.js';

const KEY_PREFIX = 'i18n:mobile:';

/**
 * Translations live in `app_settings` (jsonb value, key = i18n:mobile:{locale}).
 * The table is read-all in 0011 RLS — no tenant scope needed for reads,
 * but writes go through `runInTenantTx` so the audit row carries the
 * caller's city_id and the same atomicity guarantee as other mutations.
 */
@Injectable()
export class I18nService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async listLocales(): Promise<string[]> {
    const rows = await this.db.kysely
      .selectFrom('app_settings')
      .select('key')
      .where('key', 'like', `${KEY_PREFIX}%`)
      .execute();
    return rows.map((r) => r.key.slice(KEY_PREFIX.length)).sort();
  }

  async get(locale: string): Promise<TranslationPayload> {
    const row = await this.db.kysely
      .selectFrom('app_settings')
      .select('value')
      .where('key', '=', `${KEY_PREFIX}${locale}`)
      .executeTakeFirst();
    if (!row) {
      // Empty object for missing locale rather than 404 — the mobile app
      // already has the locale bundled and falls back to it when the
      // server returns an empty dict.
      return {};
    }
    return (row.value ?? {}) as TranslationPayload;
  }

  async upsert(user: AuthUser, locale: string, translations: TranslationPayload): Promise<TranslationPayload> {
    const key = `${KEY_PREFIX}${locale}`;
    const tenant = {
      cityId: user.cityId,
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
      requestId: user.requestId ?? '',
    };
    return this.db.runInTenantTx(tenant, async (trx) => {
      const existing = await trx
        .selectFrom('app_settings')
        .select('key')
        .where('key', '=', key)
        .executeTakeFirst();

      if (existing) {
        await trx
          .updateTable('app_settings')
          .set({ value: translations as never, updated_at: new Date() })
          .where('key', '=', key)
          .execute();
      } else {
        await trx
          .insertInto('app_settings')
          .values({ key, value: translations as never })
          .execute();
      }

      await this.audit.write(trx, {
        tenant,
        action: existing ? 'i18n.update' : 'i18n.create',
        targetType: 'translation',
        targetId: locale,
        // payload omits translation values — those are user content that
        // can be arbitrarily large; the audit row only needs to record
        // *that* a write happened and the key.
        payload: { key, locale },
      });

      return translations;
    });
  }

  async delete(user: AuthUser, locale: string): Promise<void> {
    const key = `${KEY_PREFIX}${locale}`;
    const tenant = {
      cityId: user.cityId,
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
      requestId: user.requestId ?? '',
    };
    await this.db.runInTenantTx(tenant, async (trx) => {
      const deleted = await trx
        .deleteFrom('app_settings')
        .where('key', '=', key)
        .executeTakeFirst();
      if (Number(deleted.numDeletedRows) === 0) {
        throw new NotFoundException({
          error: { code: 'i18n.not_found', message: `no translations for locale: ${locale}` },
        });
      }
      await this.audit.write(trx, {
        tenant,
        action: 'i18n.delete',
        targetType: 'translation',
        targetId: locale,
        payload: { key, locale },
      });
    });
  }
}