import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MfaService } from '../../src/auth/mfa.service.js';
import type { DbService } from '../../src/db/db.service.js';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

interface CredRow {
  id: string;
  backup_codes_hash: string[];
  backup_codes_used_at: Record<string, string>;
}

interface StubState {
  find?: { last_used_step: Date | null };
  consumeRow?: CredRow | null;
  upserts: unknown[];
}

function makeKysely(state: StubState): DbService {
  const stub: unknown = {
    kysely: {
      selectFrom: () => ({
        // The service uses `.select(['id', ...])` for backup-code lookups
        // and `.select(['last_used_step'])` for the TOTP replay check.
        // Both return the appropriate state field.
        select: (cols: readonly string[]) => ({
          where: () => ({
            where: () => ({
              executeTakeFirst: async () => {
                if (cols.includes('backup_codes_hash')) return state.consumeRow ?? null;
                return state.find ?? null;
              },
            }),
          }),
        }),
        selectAll: () => ({
          where: () => ({
            where: () => ({
              executeTakeFirst: async () => state.consumeRow ?? null,
            }),
          }),
        }),
      }),
      insertInto: () => ({
        values: (v: unknown) => ({
          onConflict: () => ({
            execute: async () => {
              state.upserts.push(v);
            },
          }),
        }),
      }),
      updateTable: () => ({
        set: () => {
          // The service calls either `.set(...).where('id', '=').execute()`
          // (single where) or `.set(...).where('user_id', '=').where('type',
 // '=').execute()` (chained). Accept both.
          const singleWhere = {
            execute: async () => undefined,
            where: () => ({ execute: async () => undefined }),
          };
          return { where: () => singleWhere };
        },
      }),
    },
  };
  return stub as DbService;
}

describe('MfaService', () => {
  it('generates a TOTP secret and 10 backup codes with the userId in the otpauth URI', async () => {
    const svc = new MfaService(makeKysely({ upserts: [] }));
    const r = svc.enroll('user-real-uuid');
    expect(r.secret.length).toBeGreaterThan(20);
    expect(r.backupCodes).toHaveLength(10);
    expect(r.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    // Gap 1: the otpauth URI must carry the real userId, not 'user'.
    expect(r.otpauthUrl).toContain('user-real-uuid');
    expect(r.otpauthUrl).not.toContain('user%3Auser%3A');
  });

  it('issues 32-hex-char (128-bit) backup codes', async () => {
    const svc = new MfaService(makeKysely({ upserts: [] }));
    const r = svc.enroll('user-1');
    for (const code of r.backupCodes) {
      expect(code).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('hashed backup codes are sha256 of plaintext, never the plaintext itself', async () => {
    const svc = new MfaService(makeKysely({ upserts: [] }));
    const r = svc.enroll('user-1');
    expect(r.backupCodesHash).toHaveLength(10);
    for (let i = 0; i < r.backupCodes.length; i++) {
      expect(r.backupCodesHash[i]).toBe(sha256(r.backupCodes[i]));
      expect(r.backupCodesHash[i]).not.toBe(r.backupCodes[i]);
    }
  });

  it('verifyTotp accepts a code from the same secret', async () => {
    const svc = new MfaService(makeKysely({ upserts: [] }));
    const { secret } = svc.enroll('user-1');
    const code = svc.currentTotp(secret);
    expect(await svc.verifyTotp('user-1', secret, code)).toBe(true);
  });

  it('verifyTotp rejects an obviously wrong code', async () => {
    const svc = new MfaService(makeKysely({ upserts: [] }));
    const { secret } = svc.enroll('user-1');
    expect(await svc.verifyTotp('user-1', secret, '000000')).toBe(false);
  });

  it('verifyTotp rejects non-numeric 6-digit codes', async () => {
    const svc = new MfaService(makeKysely({ upserts: [] }));
    const { secret } = svc.enroll('user-1');
    expect(await svc.verifyTotp('user-1', secret, 'abcdef')).toBe(false);
    expect(await svc.verifyTotp('user-1', secret, '12345')).toBe(false);
    expect(await svc.verifyTotp('user-1', secret, '1234567')).toBe(false);
  });

  it('verifyTotp rejects a code replayed within the same step', async () => {
    const stepMs = Math.floor(Date.now() / 30000) * 30000;
    const svc = new MfaService(makeKysely({
      upserts: [],
      find: { last_used_step: new Date(stepMs) },
    }));
    const { secret } = svc.enroll('user-1');
    // Current step == last step → same code → reject.
    expect(await svc.verifyTotp('user-1', secret, svc.currentTotp(secret))).toBe(false);
  });

  it('verifyTotp accepts a code from an adjacent step (±1 window)', async () => {
    // Last step is two steps ago (60s back). Code is current. Same-step
    // dedup doesn't fire, otplib's ±1 window accepts the drift.
    const lastStep = Math.floor((Date.now() - 60_000) / 30000) * 30000;
    const svc = new MfaService(makeKysely({
      upserts: [],
      find: { last_used_step: new Date(lastStep) },
    }));
    const { secret } = svc.enroll('user-1');
    expect(await svc.verifyTotp('user-1', secret, svc.currentTotp(secret))).toBe(true);
  });

  it('consumeBackupCode accepts a valid unused code and marks it consumed', async () => {
    const plaintext = 'a'.repeat(32);
    const hash = sha256(plaintext);
    const svc = new MfaService(makeKysely({
      upserts: [],
      consumeRow: { id: 'cred-1', backup_codes_hash: [hash], backup_codes_used_at: {} },
    }));
    const r = await svc.consumeBackupCode('user-1', plaintext);
    expect(r.verified).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('consumeBackupCode rejects an already-used code', async () => {
    const plaintext = 'b'.repeat(32);
    const hash = sha256(plaintext);
    const svc = new MfaService(makeKysely({
      upserts: [],
      consumeRow: { id: 'cred-1', backup_codes_hash: [hash], backup_codes_used_at: { [hash]: new Date().toISOString() } },
    }));
    const r = await svc.consumeBackupCode('user-1', plaintext);
    expect(r.verified).toBe(false);
  });

  it('consumeBackupCode rejects an unknown code', async () => {
    const svc = new MfaService(makeKysely({
      upserts: [],
      consumeRow: { id: 'cred-1', backup_codes_hash: [sha256('different-code')], backup_codes_used_at: {} },
    }));
    const r = await svc.consumeBackupCode('user-1', 'z'.repeat(32));
    expect(r.verified).toBe(false);
  });

  it('consumeBackupCode returns remaining=0 when no credential row exists', async () => {
    const svc = new MfaService(makeKysely({ upserts: [] }));
    const r = await svc.consumeBackupCode('user-1', 'a'.repeat(32));
    expect(r.verified).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('persistBackupCodes writes via upsert on user_id conflict', async () => {
    const state: StubState = { upserts: [] };
    const svc = new MfaService(makeKysely(state));
    await svc.persistBackupCodes('user-1', '00000000-0000-0000-0000-000000000001', ['h1', 'h2']);
    expect(state.upserts).toHaveLength(1);
  });
});