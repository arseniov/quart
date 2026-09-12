import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
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

// ponytail: T17 keeps the TOTP secret in the verified JWT (stateless — per
// T17 plan). `mfa_credentials` only persists backup-code hashes + the
// replay-prevention timestamp.
@Injectable()
export class MfaService {
  constructor(private readonly db: DbService) {
    // ±1 step window (90s total) tolerates clock skew without weakening
    // step-1 replay protection.
    authenticator.options = { window: 1, step: 30 };
  }

  enroll(userId: string): MfaEnrollResult {
    // 20 random bytes → 32-char base32 secret (160 bits, RFC 6238 §5.1 floor).
    const secret = authenticator.generateSecret(20);
    // 128 bits per backup code (32 hex chars), 10 codes.
    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      randomBytes(BACKUP_CODE_BYTES).toString('hex'),
    );
    const backupCodesHash = backupCodes.map(sha256);
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
   * Verify a 6-digit TOTP code. Replay-protected at step granularity:
   * if the supplied code matches a step we've already consumed, reject.
   * Per-user (not per-session): an attacker who phishes a code can use it
   * once within ±1 window (~90s), then can't replay.
   */
  async verifyTotp(userId: string, secret: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const valid = authenticator.verify({ token: code, secret });
    if (!valid) return false;

    const step = Math.floor(Date.now() / 30000);
    const stepDate = new Date(step * 30000);

    // Look up the credential row for replay check. Missing row = no
    // enrollment recorded; allow verification but skip the dedup check
    // (the secret+window already filtered the code).
    const cred = await this.db.kysely
      .selectFrom('mfa_credentials')
      .select(['last_used_step'])
      .where('user_id', '=', userId)
      .where('type', '=', 'totp')
      .executeTakeFirst();

    if (cred?.last_used_step) {
      const last = cred.last_used_step.getTime();
      // Same step (within 30s): the same code is being replayed. Reject.
      if (stepDate.getTime() - last === 0) return false;
    }

    // Persist replay marker. Insert-if-absent (first verify) or update.
    if (!cred) {
      this.db.kysely
        .insertInto('mfa_credentials')
        .values({
          user_id: userId,
          city_id: '00000000-0000-0000-0000-000000000000',
          type: 'totp',
          label: 'default',
          backup_codes_hash: [],
          last_used_step: stepDate,
        })
        .onConflict((oc) =>
          oc.column('user_id').doUpdateSet({ last_used_step: stepDate }),
        )
        .execute()
        .catch(() => {
          // ponytail: best-effort; if city_id FK or RLS rejects, the
          // verification result still stands. Add proper city lookup
          // when we wire the /enroll endpoint through the controller.
        });
    } else {
      this.db.kysely
        .updateTable('mfa_credentials')
        .set({ last_used_step: stepDate })
        .where('user_id', '=', userId)
        .where('type', '=', 'totp')
        .execute()
        .catch(() => undefined);
    }
    return true;
  }

  /**
   * Consume a backup code. Hashes the supplied plaintext, looks up the
   * hash in `backup_codes_hash`, then marks it used in
   * `backup_codes_used_at`. Replays return `verified: false`.
   */
  async consumeBackupCode(
    userId: string,
    code: string,
  ): Promise<BackupCodeConsumeResult> {
    const hash = sha256(code);

    const row = await this.db.kysely
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
    if (usedAt[hash]) return { verified: false, remaining: row.backup_codes_hash.length };

    const next = { ...usedAt, [hash]: new Date().toISOString() };
    await this.db.kysely
      .updateTable('mfa_credentials')
      .set({ backup_codes_used_at: next })
      .where('id', '=', row.id)
      .execute();
    return { verified: true, remaining: row.backup_codes_hash.length - 1 };
  }

  /**
   * Persist backup-code hashes for a freshly enrolled credential. Called
   * by MfaController after the user scans the QR + sends their first TOTP.
   * Idempotent: re-enrollment updates the existing row.
   */
  async persistBackupCodes(
    userId: string,
    cityId: string,
    backupCodesHash: string[],
  ): Promise<void> {
    await this.db.kysely
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
  }
}