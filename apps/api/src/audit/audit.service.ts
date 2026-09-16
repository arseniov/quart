import { Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { canonicalSha256, computeRowHash, GENESIS_PREV_HASH } from '@quart/db';
import type { DB } from '@quart/db';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the ConfigService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';

// Loose UUID regex — mirrors the one in tenant-context.interceptor.ts.
// `audit_log.request_id` is uuid-typed, but the request-id middleware
// accepts any /^[A-Za-z0-9_-]{8,128}$/ header (e.g. `req-abc12345`).
// Coerce non-UUIDs to NULL so the audit insert doesn't crash with 22P02.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function tryParseUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

export interface AuditEvent {
  tenant: TenantContext;
  action: string;
  targetType: string;
  targetId: string;
  payload: unknown;
  ip?: string | null;
  userAgent?: string | null;
  onBehalfOfUserId?: string | null;
}

export interface AuditRow {
  city_id: string;
  actor_user_id: string | null;
  on_behalf_of_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
  payload_canonical_sha256: string;
  payload_redacted: unknown;
  prev_hash: string;
  row_hash: string;
  key_version_id: string;
}

@Injectable()
export class AuditService {
  private readonly key: string;

  constructor(config: ConfigService) {
    this.key = config.env.AUDIT_HMAC_KEY;
  }

  async buildRow(db: Kysely<DB> | Transaction<DB>, ev: AuditEvent): Promise<AuditRow> {
    const last = await (db as Kysely<DB>)
      .selectFrom('audit_log')
      .select((eb) => eb.fn('coalesce', [eb.fn('max', ['id']), eb.lit(0)]).as('max_id'))
      .executeTakeFirst();
    let prevHash = GENESIS_PREV_HASH;
    if (last && (last as { max_id: unknown }).max_id) {
      const id = (last as { max_id: bigint | number }).max_id;
      const row = await (db as Kysely<DB>)
        .selectFrom('audit_log')
        .select(['row_hash'])
        .where('id', '=', id as never)
        .executeTakeFirst();
      prevHash = (row?.row_hash as string | undefined) ?? GENESIS_PREV_HASH;
    }

    const payloadSha = canonicalSha256(ev.payload);
    const rowHash = computeRowHash({ prev_hash: prevHash, payload_canonical_sha256: payloadSha }, this.key);

    // key_version_id is resolved lazily inside the active transaction (FK to quart_security).
    const kv = await (db as Kysely<DB>)
      .selectFrom('quart_security.audit_key_versions' as never)
      .select('id')
      .where('status' as never, '=', 'active' as never)
      .executeTakeFirstOrThrow();

    return {
      city_id: ev.tenant.cityId,
      actor_user_id: ev.tenant.userId,
      on_behalf_of_user_id: ev.onBehalfOfUserId ?? null,
      action: ev.action,
      target_type: ev.targetType,
      target_id: ev.targetId,
      request_id: tryParseUuid(ev.tenant.requestId),
      ip: ev.ip ?? null,
      user_agent: ev.userAgent ?? null,
      payload_canonical_sha256: payloadSha,
      payload_redacted: ev.payload,
      prev_hash: prevHash,
      row_hash: rowHash,
      key_version_id: kv.id as string,
    };
  }

  async write(db: Kysely<DB> | Transaction<DB>, ev: AuditEvent): Promise<void> {
    const row = await this.buildRow(db, ev);
    await (db as Kysely<DB>).insertInto('audit_log').values(row as never).execute();
  }
}