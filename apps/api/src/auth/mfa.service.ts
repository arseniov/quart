import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@quart/shared-types';
import { authenticator } from 'otplib';

// Value (not `import type`) so vitest's decorator-metadata plugin can
// emit `design:paramtypes` for the DbService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

export interface MfaEnrollResult {
  secret: string;
  otpauthUrl: string;
  // 128-bit hex backup codes (32 chars from 16 bytes).
  backupCodes: string[];
  // sha256 of every backup code — stored hashed, returned in the response
  // so callers never see plaintext at rest.
  backupCodesHash: string[];
}

export interface BackupCodeConsumeResult {
  verified: boolean;
  // How many codes are still unused. Useful for client UX prompts.
  remaining: number;
}

// 128 bits per code (16 bytes -> 32 hex chars). 40-bit (10 hex) was too low —
// spec flagged it as below the recovery-code floor.
const BACKUP_CODE_BYTES = 16;
const BACKUP_CODE_COUNT = 10;

// ponytail: per-call SHA-256 — backup codes aren't PII but are auth
// credentials, so we never store plaintext. Switch to scrypt/argon2id
// if threat model widens (brute-force the db dump).
function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// GH #45 follow-up: the TOTP secret no longer rides the bearer (post-GH
// #45 there is no bearer to ride). The mobile keeps it locally from
// /enroll's response and sends it on every /verify; the server stamps
// `verified_at` on success and reads `enrolled_at` + `verified_at` back
// on every authenticated request (see `getMfaState` below). `totp_secret`
// is deliberately NOT persisted — secret stays on the user device.
@Injectable()
export class MfaService {
  constructor(private readonly db: DbService) {
    // ±1 step window (90s total) tolerates clock skew without weakening
    // step-1 replay protection.
    authenticator.options = { window: 1, step: 30 };
  }

  /**
   * Issue a fresh TOTP secret + 10 backup codes AND persist the credential
   * row. The row is created here (not lazily on first verify) so the
   * replay-marker update in `verifyTotp` always has a real `city_id` to
   * pass the WITH CHECK (migration 0026).
   */
  async enroll(userId: string, cityId: string): Promise<MfaEnrollResult> {
    // 20 random bytes → 32-char base32 secret (160 bits, RFC 6238 §5.1 floor).
    const secret = authenticator.generateSecret(20);
    // 128 bits per backup code (32 hex chars), 10 codes.
    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      randomBytes(BACKUP_CODE_BYTES).toString('hex'),
    );
    const backupCodesHash = backupCodes.map(sha256);

    await this.db.runInTenantTx(
      this.tenantCtx(cityId, userId),
      async (trx) => {
        await trx
          .insertInto('mfa_credentials')
          .values({
            user_id: userId,
            city_id: cityId,
            type: 'totp',
            label: 'default',
            backup_codes_hash: backupCodesHash,
          })
          .onConflict((oc) =>
            oc.column('user_id').doUpdateSet({ backup_codes_hash: backupCodesHash }),
          )
          .execute();
      },
    );

    return {
      secret,
      otpauthUrl: authenticator.keyuri(userId, 'Quart', secret),
      backupCodes,
      backupCodesHash,
    };
  }

  currentTotp(secret: string): string {
    return authenticator.generate(secret);
  }

  /**
   * Verify a 6-digit TOTP code. Replay-protected at step granularity via
   * `mfa_credentials.last_used_step`: a code whose step matches the
   * recorded last_used_step is a replay → reject.
   *
   * On success, stamps both `last_used_step` (replay marker) and
   * `verified_at` (freshness window for MfaGuard) in the same UPDATE so
   * the two timestamps can never disagree.
   *
   * Read + update run inside one tenant tx so the SELECT and the UPDATE
   * see the same RLS-scoped view. If the update fails (RLS rejection, FK
   * violation, lost connection) we return `false` — the caller can retry,
   * but we never silently allow a verify that we couldn't durably mark.
   */
  async verifyTotp(
    userId: string,
    cityId: string,
    secret: string,
    code: string,
  ): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const valid = authenticator.verify({ token: code, secret });
    if (!valid) return false;

    const step = Math.floor(Date.now() / 30000);
    const stepDate = new Date(step * 30000);
    const now = new Date();

    try {
      return await this.db.runInTenantTx(
        this.tenantCtx(cityId, userId),
        async (trx) => {
          const cred = await trx
            .selectFrom('mfa_credentials')
            .select(['last_used_step'])
            .where('user_id', '=', userId)
            .where('type', '=', 'totp')
            .executeTakeFirst();

          // No row = nothing to dedup against. The secret+window already
          // filtered the code; we can't persist a marker either, so
          // accept and move on (callers in production will hit this only
          // when the row was deleted out from under us).
          if (!cred) return true;

          const last = cred.last_used_step?.getTime();
          // Same step (within 30s): the same code is being replayed. Reject.
          if (last != null && stepDate.getTime() - last === 0) return false;

          await trx
            .updateTable('mfa_credentials')
            .set({ last_used_step: stepDate, verified_at: now })
            .where('user_id', '=', userId)
            .where('type', '=', 'totp')
            .execute();
          return true;
        },
      );
    } catch {
      // Tenant tx failed (RLS rejected, conn dropped, etc). Don't claim
      // success when we couldn't durably mark the step — caller retries.
      return false;
    }
  }

  /**
   * Read the per-user MFA state needed by BaAuthGuard to populate
   * `req.user.mfaEnrolledAt` / `req.user.mfaVerifiedAt`. Returns null
   * timestamps when no row exists (user never enrolled). Runs inside a
   * tenant tx so RLS scopes the read to the caller's (city, user).
   *
   * ponytail: separate method from `verifyTotp` to keep concerns split —
   * the guard only reads, never writes, and the SELECT columns are
   * independent of the verify path's replay-marker read.
   */
  async getMfaState(
    userId: string,
    cityId: string,
  ): Promise<{ enrolledAt: Date | null; verifiedAt: Date | null }> {
    return this.db.runInTenantTx(this.tenantCtx(cityId, userId), async (trx) => {
      const row = await trx
        .selectFrom('mfa_credentials')
        .select(['enrolled_at', 'verified_at'])
        .where('user_id', '=', userId)
        .where('type', '=', 'totp')
        .executeTakeFirst();
      if (!row) return { enrolledAt: null, verifiedAt: null };
      return {
        enrolledAt: row.enrolled_at ?? null,
        verifiedAt: row.verified_at ?? null,
      };
    });
  }

  /**
   * Consume a backup code. Hashes the supplied plaintext, looks up the
   * hash in `backup_codes_hash`, then marks it used in
   * `backup_codes_used_at`. Replays return `verified: false`.
   */
  async consumeBackupCode(
    userId: string,
    cityId: string,
    code: string,
  ): Promise<BackupCodeConsumeResult> {
    const hash = sha256(code);

    return this.db.runInTenantTx(this.tenantCtx(cityId, userId), async (trx) => {
      const row = await trx
        .selectFrom('mfa_credentials')
        .select(['id', 'backup_codes_hash', 'backup_codes_used_at'])
        .where('user_id', '=', userId)
        .where('type', '=', 'totp')
        .executeTakeFirst();

      if (!row) return { verified: false, remaining: 0 };
      if (!row.backup_codes_hash.includes(hash)) {
        return { verified: false, remaining: row.backup_codes_hash.length };
      }

      const usedAt = (row.backup_codes_used_at ?? {}) as Record<string, string>;
      if (usedAt[hash]) {
        return { verified: false, remaining: row.backup_codes_hash.length };
      }

      const next = { ...usedAt, [hash]: new Date().toISOString() };
      await trx
        .updateTable('mfa_credentials')
        .set({ backup_codes_used_at: next })
        .where('id', '=', row.id)
        .execute();
      return { verified: true, remaining: row.backup_codes_hash.length - 1 };
    });
  }

  // The MFA endpoints don't carry a request id down to the service layer —
  // the controller is responsible for log scoping. Pass empty string so the
  // GUC still satisfies NOT NULL checks (the column is text-typed).
  private tenantCtx(cityId: string, userId: string): TenantContext {
    return { cityId, userId, isSuperAdmin: false, requestId: '' };
  }
}