import { canonicalSha256, computeRowHash, GENESIS_PREV_HASH } from '@quart/db';
import type { DB } from '@quart/db';
import { Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the ConfigService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';

// ============================================================================
// `writeSystem` — pre-tenant audit pathway (gh issue #4)
// ============================================================================
//
// Magic-link consume, password reset, and any future auth event that runs
// BEFORE a TenantContext (cityId + userId) exists still needs to land in
// the HMAC chain — every auth event is operationally required to be
// tamper-evident and TSA-anchored.
//
// What `writeSystem` does:
//  * Uses a fixed sentinel `city_id` (the `__system` row seeded by
//    0038_audit_system_chain). The chain trigger treats that sentinel as
//    a GLOBAL chain anchor, so system rows extend the verify walk
//    rather than forking it into a separate per-city bucket.
//  * Sets `actor_user_id = NULL` and stamps `SYSTEM_AUDIT_ACTOR` into
//    the payload so log readers can distinguish system events from
//    user actions without joining `users`.
//  * Skips `runInTenantTx` — there is no tenant to bind. The function
//    opens its OWN transaction so the audit insert commits atomically
//    with the caller's mutate (e.g., magic-link UPDATE-WHERE-RETURNING).
//
// HMAC invariant: the trigger still computes chain prev/row_hash with
// the active audit key, so the chain validates end-to-end. Do not
// filter audit_log by `city_id` when scanning system events — they live
// in the sentinel city by design, not in any user city.
//
// Future audit readers: a row authored by SYSTEM_AUDIT_ACTOR is always
// a pre-tenant event; treat `actor_user_id IS NULL` as the system
// marker. Do not invent additional system actors — the spec is fixed.
//
// Rate-limit / DoS: a high-volume system event could flood audit_log.
// Future rate-limiting lives at the call-site (throttler per action),
// not in writeSystem — out of scope for this PR.
// ============================================================================
export const SYSTEM_AUDIT_ACTOR = 'system@quart.app';
export const SYSTEM_AUDIT_CITY_ID = '00000000-0000-0000-0000-000000000099';

export interface AuditEvent {
  tenant: { cityId: string; userId: string | null; isSuperAdmin: boolean; requestId?: string | null };
  action: string;
  targetType: string;
  targetId: string;
  payload: unknown;
  ip?: string | null;
  userAgent?: string | null;
  onBehalfOfUserId?: string | null;
}

export interface SystemAuditEvent {
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Optional return from `writeSystem`'s mutate callback.
 * `skip: true` aborts the audit insert without throwing — for cases
 * where the caller's UPDATE found no row (token missing / consumed /
 * expired) and no state changed.
 */
export interface MutateResult {
  skip?: boolean;
  /** Override the audit row's `targetId` from mutate (e.g., when the
   *  token resolves to a row id only after the UPDATE). */
  targetId?: string;
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

// Loose UUID regex — mirrors the one in tenant-context.interceptor.ts.
// `audit_log.request_id` is uuid-typed, but the request-id middleware
// accepts any /^[A-Za-z0-9_-]{8,128}$/ header (e.g. `req-abc12345`).
// Coerce non-UUIDs to NULL so the audit insert doesn't crash with 22P02.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function tryParseUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

// Quote a Postgres string literal — duplicated from run-in-tenant-tx.ts so
// this module stays a leaf (no upward import into db/) for the auth
// services that already import AuditService.
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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

  /**
   * System audit write — pre-tenant events (magic-link consume, password
   * reset, etc.). Wrapped in its own transaction so the caller doesn't
   * have to set up RLS GUCs. The trigger stamps prev/row_hash from the
   * global chain head when city_id is the sentinel.
   *
   * The optional `mutate` callback runs inside the same transaction
   * before the audit insert. Return `{ skip: true }` to abort the audit
   * write (e.g., when the caller's UPDATE didn't match — no state
   * changed, no audit row). Return `{ targetId }` to override the
   * event's targetId (useful when the token resolves to a row id only
   * after the UPDATE).
   */
  async writeSystem(
    kysely: Kysely<DB>,
    ev: SystemAuditEvent,
    mutate?: (trx: Transaction<DB>) => Promise<MutateResult | void>,
  ): Promise<void> {
    await kysely.transaction().execute(async (trx) => {
      // stamp_audit_city_id reads `app.city_id`, audit_log_insert_app RLS
      // reads `app.city_id`. Both must agree with NEW.city_id we insert
      // (the sentinel). app.is_super_admin=true matches the OR branch
      // we added in 0038 so the insert policy fires.
      await sql
        .raw(
          `SET LOCAL ROLE quart_app;\n` +
            `SET LOCAL app.city_id = ${quoteLiteral(SYSTEM_AUDIT_CITY_ID)};\n` +
            `SET LOCAL app.user_id = ${quoteLiteral('')};\n` +
            `SET LOCAL app.is_super_admin = true;\n` +
            `SET LOCAL app.request_id = ${quoteLiteral(ev.requestId ?? '')};`,
        )
        .execute(trx);

      let resolvedEv = ev;
      if (mutate) {
        const result = await mutate(trx);
        if (result?.skip) return;
        if (result?.targetId) {
          resolvedEv = { ...ev, targetId: result.targetId };
        }
      }

      const row = await this.buildSystemRow(trx, resolvedEv);
      await trx.insertInto('audit_log').values(row as never).execute();
    });
  }

  /**
   * Build the audit row for a system event without inserting. Same
   * chain math as `buildRow`, but with the sentinel city and a NULL
   * `actor_user_id` so read-side filters can distinguish system events.
   */
  async buildSystemRow(
    db: Kysely<DB> | Transaction<DB>,
    ev: SystemAuditEvent,
  ): Promise<AuditRow> {
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

    // Stamp the system actor into the payload so read-side filters
    // (WHERE actor_user_id IS NULL AND payload_redacted->>'actor' = ...)
    // can disambiguate from "no actor because NULL user". `action` is
    // already part of the row, but having the literal actor in payload
    // makes audit-log grepping single-pass.
    const stampedPayload = {
      actor: SYSTEM_AUDIT_ACTOR,
      ...ev.payload,
    };
    const payloadSha = canonicalSha256(stampedPayload);
    const rowHash = computeRowHash(
      { prev_hash: prevHash, payload_canonical_sha256: payloadSha },
      this.key,
    );

    const kv = await (db as Kysely<DB>)
      .selectFrom('quart_security.audit_key_versions' as never)
      .select('id')
      .where('status' as never, '=', 'active' as never)
      .executeTakeFirstOrThrow();

    return {
      city_id: SYSTEM_AUDIT_CITY_ID,
      actor_user_id: null,
      on_behalf_of_user_id: null,
      action: ev.action,
      target_type: ev.targetType,
      target_id: ev.targetId,
      request_id: tryParseUuid(ev.requestId),
      ip: ev.ip ?? null,
      user_agent: ev.userAgent ?? null,
      payload_canonical_sha256: payloadSha,
      payload_redacted: stampedPayload,
      prev_hash: prevHash,
      row_hash: rowHash,
      key_version_id: kv.id as string,
    };
  }
}
