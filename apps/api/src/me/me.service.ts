// apps/api/src/me/me.service.ts
// GH #51: POST/DELETE/GET /me/devices — per-device push registration.
//
// Mobile's useRegisterDevice hook has been POSTing here since GH #30;
// the endpoint 404s today. This service closes the loop. Three
// endpoints, all auth-gated by BaAuthGuard:
//
//   POST   /me/devices     → register / refresh this device's push row
//   DELETE /me/devices/:id → revoke a device (toggle-off path)
//   GET    /me/devices     → list this user's devices (future settings screen)
//
// Audit chain integration matches the GH #34 hook pattern: every
// register / revoke writes a `device.register` / `device.revoke` row
// in the same transaction as the data write so a half-finished tx
// never leaves the audit chain out of sync with the table state.

import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameters below.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';

import type { RegisterBody } from './me.dto.js';

export interface Device {
  id: string;
  userId: string;
  cityId: string;
  deviceId: string;
  platform: 'ios' | 'android';
  expoPushToken: string;
  appVersion: string;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
}

interface DeviceRow {
  id: string;
  user_id: string;
  city_id: string;
  device_id: string;
  platform: 'ios' | 'android';
  expo_push_token: string;
  app_version: string;
  locale: string;
  created_at: Date;
  updated_at: Date;
}

const toDevice = (r: DeviceRow): Device => ({
  id: r.id,
  userId: r.user_id,
  cityId: r.city_id,
  deviceId: r.device_id,
  platform: r.platform,
  expoPushToken: r.expo_push_token,
  appVersion: r.app_version,
  locale: r.locale,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

@Injectable()
export class MeService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, tenant: TenantContext): Promise<Device[]> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      const rows = await trx
        .selectFrom('devices')
        .selectAll()
        .where('user_id', '=', user.id as never)
        .orderBy('created_at', 'desc')
        .execute();
      return (rows as DeviceRow[]).map(toDevice);
    });
  }

  /**
   * Upsert on (user_id, device_id). `device_id` is taken from the body
   * when present; otherwise we derive a stable fingerprint from the
   * expo_push_token so re-logins on the same install dedupe. Platform
   * accepts either the spec's `platform` or the mobile's
   * `device_platform` — both names map to the same column.
   */
  async register(
    body: RegisterBody,
    user: AuthUser,
    tenant: TenantContext,
  ): Promise<Device> {
    const platform = body.platform ?? body.device_platform;
    // ponytail: 32-hex-char prefix is collision-prone past ~1M devices per
    //          user; switch to full sha256 or uuid v5 once a mobile UUID lands.
    const deviceId = body.device_id ?? sha256Hex(body.expo_push_token);
    const now = new Date();

    return this.db.runInTenantTx(tenant, async (trx) => {
      const row = await trx
        .insertInto('devices')
        .values({
          user_id: user.id,
          // ponytail: city_id denormalised from req.tenant.cityId per
          //          0042_devices.up.sql — no per-row city lookup. Drop the
          //          column if you migrate to a global (non-tenant) table.
          city_id: tenant.cityId,
          device_id: deviceId,
          platform,
          expo_push_token: body.expo_push_token,
          app_version: body.app_version,
          locale: body.locale,
          updated_at: now,
        } as never)
        .onConflict((oc) =>
          oc.columns(['user_id', 'device_id']).doUpdateSet({
            platform,
            expo_push_token: body.expo_push_token,
            app_version: body.app_version,
            locale: body.locale,
            updated_at: now,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant,
        action: 'device.register',
        targetType: 'device',
        targetId: row.id as string,
        payload: {
          device_id: deviceId,
          platform,
          expo_push_token: body.expo_push_token,
          app_version: body.app_version,
          locale: body.locale,
        },
      });

      return toDevice(row as unknown as DeviceRow);
    });
  }

  async revoke(
    deviceId: string,
    user: AuthUser,
    tenant: TenantContext,
  ): Promise<void> {
    await this.db.runInTenantTx(tenant, async (trx) => {
      // Match on (user_id, device_id) — a leaked device_id from another
      // tenant is filtered by the tenant context's user_id GUC and the
      // RLS scope policy (0042_devices.up.sql). We deleteBy device_id
      // because the mobile uses its own UUID, not the row PK.
      const deleted = await trx
        .deleteFrom('devices')
        .where('device_id', '=', deviceId as never)
        .where('user_id', '=', user.id as never)
        .returning(['id'])
        .execute();

      // Audit regardless of whether a row existed — the toggle-off
      // UX should be idempotent and operators want to see the call
      // even when the device was already removed.
      await this.audit.write(trx, {
        tenant,
        action: 'device.revoke',
        targetType: 'device',
        targetId: deviceId,
        payload: { device_id: deviceId, deleted: deleted.length },
      });
    });
  }
}

/**
 * Stable fingerprint used as the synthetic `device_id` when the mobile
 * doesn't send one. SHA-256 of the Expo push token — same token, same
 * id, so re-logins on the same install dedupe. Truncated to 32 hex
 * chars to fit the column's VARCHAR-ish usage cleanly (the column is
 * TEXT in pg; the truncation is for readability in audit payloads).
 */
function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}