import { createHash } from 'node:crypto';

import type { TenantContext } from '@quart/shared-types';
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
  // When set, the updateTable branch throws — exercises the verifyTotp
  // "couldn't durably mark the step" failure mode.
  throwOnUpdate?: boolean;
}

// The service must never call db.kysely directly (RLS GUCs are only set
// inside runInTenantTx). The stub exposes the same kysely-shaped object
// both as `kysely` and as the `trx` argument to `runInTenantTx`, so the
// service code is identical to what runs against a real DB — minus the
// transaction semantics.
function makeDb(
  state: StubState,
  captureCtx?: (ctx: TenantContext) => void,
): DbService {
  const kyselyStub: unknown = {
    selectFrom: () => ({
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
        const fail = async () => {
          throw new Error('update failed (stub)');
        };
        const ok = { execute: async () => undefined };
        const exec = state.throwOnUpdate ? fail : async () => undefined;
        // The service uses either `.set().where().execute()` (single
        // where) or `.set().where().where().execute()` (chained). Accept
        // both — and when throwOnUpdate is set, throw from the inner
        // execute so the runInTenantTx callback rejects.
        const builder: unknown = state.throwOnUpdate
          ? {
              where: () => ({
                execute: fail,
                where: () => ({ execute: fail }),
              }),
            }
          : {
              where: () => ({
                ...ok,
                where: () => ({ execute: exec }),
              }),
            };
        return builder;
      },
    }),
  };
  return {
    kysely: kyselyStub as never,
    runInTenantTx: <T>(
      ctx: TenantContext,
      fn: (trx: unknown) => Promise<T>,
    ): Promise<T> => {
      captureCtx?.(ctx);
      return fn(kyselyStub);
    },
  } as unknown as DbService;
}

describe('MfaService', () => {
  it('generates a TOTP secret and 10 backup codes with the userId in the otpauth URI', async () => {
    const svc = new MfaService(makeDb({ upserts: [] }));
    const r = await svc.enroll('user-real-uuid', 'city-1');
    expect(r.secret.length).toBeGreaterThan(20);
    expect(r.backupCodes).toHaveLength(10);
    expect(r.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    // Gap 1: the otpauth URI must carry the real userId, not 'user'.
    expect(r.otpauthUrl).toContain('user-real-uuid');
    expect(r.otpauthUrl).not.toContain('user%3Auser%3A');
  });

  it('issues 32-hex-char (128-bit) backup codes', async () => {
    const svc = new MfaService(makeDb({ upserts: [] }));
    const r = await svc.enroll('user-1', 'city-1');
    for (const code of r.backupCodes) {
      expect(code).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('hashed backup codes are sha256 of plaintext, never the plaintext itself', async () => {
    const svc = new MfaService(makeDb({ upserts: [] }));
    const r = await svc.enroll('user-1', 'city-1');
    expect(r.backupCodesHash).toHaveLength(10);
    for (let i = 0; i < r.backupCodes.length; i++) {
      expect(r.backupCodesHash[i]).toBe(sha256(r.backupCodes[i]));
      expect(r.backupCodesHash[i]).not.toBe(r.backupCodes[i]);
    }
  });

  it('enroll writes the mfa_credentials row inside a tenant ctx (Gap 1+2)', async () => {
    let captured: TenantContext | undefined;
    const state: StubState = { upserts: [] };
    const svc = new MfaService(makeDb(state, (c) => { captured = c; }));
    await svc.enroll('user-1', '00000000-0000-0000-0000-000000000001');
    expect(state.upserts).toHaveLength(1);
    expect(captured).toEqual({
      cityId: '00000000-0000-0000-0000-000000000001',
      userId: 'user-1',
      isSuperAdmin: false,
      requestId: '',
    });
  });

  it('enroll upserts on user_id conflict (idempotent re-enroll)', async () => {
    const state: StubState = { upserts: [] };
    const svc = new MfaService(makeDb(state));
    await svc.enroll('user-1', '00000000-0000-0000-0000-000000000001');
    await svc.enroll('user-1', '00000000-0000-0000-0000-000000000001');
    expect(state.upserts).toHaveLength(2);
  });

  it('verifyTotp accepts a code from the same secret', async () => {
    const svc = new MfaService(makeDb({ upserts: [] }));
    const { secret } = await svc.enroll('user-1', 'city-1');
    const code = svc.currentTotp(secret);
    expect(await svc.verifyTotp('user-1', 'city-1', secret, code)).toBe(true);
  });

  it('verifyTotp rejects an obviously wrong code', async () => {
    const svc = new MfaService(makeDb({ upserts: [] }));
    const { secret } = await svc.enroll('user-1', 'city-1');
    expect(await svc.verifyTotp('user-1', 'city-1', secret, '000000')).toBe(false);
  });

  it('verifyTotp rejects non-numeric 6-digit codes', async () => {
    const svc = new MfaService(makeDb({ upserts: [] }));
    const { secret } = await svc.enroll('user-1', 'city-1');
    expect(await svc.verifyTotp('user-1', 'city-1', secret, 'abcdef')).toBe(false);
    expect(await svc.verifyTotp('user-1', 'city-1', secret, '12345')).toBe(false);
    expect(await svc.verifyTotp('user-1', 'city-1', secret, '1234567')).toBe(false);
  });

  it('verifyTotp rejects a code replayed within the same step', async () => {
    const stepMs = Math.floor(Date.now() / 30000) * 30000;
    const svc = new MfaService(makeDb({
      upserts: [],
      find: { last_used_step: new Date(stepMs) },
    }));
    const { secret } = await svc.enroll('user-1', 'city-1');
    // Current step == last step → same code → reject.
    expect(await svc.verifyTotp('user-1', 'city-1', secret, svc.currentTotp(secret))).toBe(false);
  });

  it('verifyTotp accepts a code from an adjacent step (±1 window)', async () => {
    // Last step is two steps ago (60s back). Code is current. Same-step
    // dedup doesn't fire, otplib's ±1 window accepts the drift.
    const lastStep = Math.floor((Date.now() - 60_000) / 30000) * 30000;
    const svc = new MfaService(makeDb({
      upserts: [],
      find: { last_used_step: new Date(lastStep) },
    }));
    const { secret } = await svc.enroll('user-1', 'city-1');
    expect(await svc.verifyTotp('user-1', 'city-1', secret, svc.currentTotp(secret))).toBe(true);
  });

  it('verifyTotp does NOT insert a row when cred exists (Gap 2 fix)', async () => {
    // After Gap 2, verifyTotp only reads/updates — the row is created by
    // enroll(). Inserting again here would violate the unique-on-user_id
    // upsert contract.
    const state: StubState = {
      upserts: [],
      find: { last_used_step: null },
    };
    const svc = new MfaService(makeDb(state));
    const { secret } = await svc.enroll('user-1', 'city-1');
    expect(state.upserts).toHaveLength(1); // enroll's insert
    await svc.verifyTotp('user-1', 'city-1', secret, svc.currentTotp(secret));
    expect(state.upserts).toHaveLength(1); // verifyTotp did NOT insert again
  });

  it('verifyTotp returns false when the replay-marker update throws (Gap 3 fix)', async () => {
    // Gap 3: the old code swallowed update errors via `.catch(() => {})`
    // and returned `true` even when the marker never made it to the DB.
    // A failed update must surface as `verified: false` so replay
    // protection stays airtight.
    const state: StubState = {
      upserts: [],
      find: { last_used_step: null }, // no prior step → no replay reject
      throwOnUpdate: true,
    };
    const svc = new MfaService(makeDb(state));
    const { secret } = await svc.enroll('user-1', 'city-1');
    const ok = await svc.verifyTotp('user-1', 'city-1', secret, svc.currentTotp(secret));
    expect(ok).toBe(false);
  });

  it('verifyTotp passes cityId+userId through to the tenant ctx', async () => {
    let captured: TenantContext | undefined;
    const svc = new MfaService(makeDb({ upserts: [] }, (c) => { captured = c; }));
    const { secret } = await svc.enroll('user-1', 'city-1');
    await svc.verifyTotp('user-1', 'city-1', secret, svc.currentTotp(secret));
    expect(captured).toEqual({
      cityId: 'city-1',
      userId: 'user-1',
      isSuperAdmin: false,
      requestId: '',
    });
  });

  it('consumeBackupCode accepts a valid unused code and marks it consumed', async () => {
    const plaintext = 'a'.repeat(32);
    const hash = sha256(plaintext);
    const svc = new MfaService(makeDb({
      upserts: [],
      consumeRow: { id: 'cred-1', backup_codes_hash: [hash], backup_codes_used_at: {} },
    }));
    const r = await svc.consumeBackupCode('user-1', 'city-1', plaintext);
    expect(r.verified).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('consumeBackupCode rejects an already-used code', async () => {
    const plaintext = 'b'.repeat(32);
    const hash = sha256(plaintext);
    const svc = new MfaService(makeDb({
      upserts: [],
      consumeRow: { id: 'cred-1', backup_codes_hash: [hash], backup_codes_used_at: { [hash]: new Date().toISOString() } },
    }));
    const r = await svc.consumeBackupCode('user-1', 'city-1', plaintext);
    expect(r.verified).toBe(false);
  });

  it('consumeBackupCode rejects an unknown code', async () => {
    const svc = new MfaService(makeDb({
      upserts: [],
      consumeRow: { id: 'cred-1', backup_codes_hash: [sha256('different-code')], backup_codes_used_at: {} },
    }));
    const r = await svc.consumeBackupCode('user-1', 'city-1', 'z'.repeat(32));
    expect(r.verified).toBe(false);
  });

  it('consumeBackupCode returns remaining=0 when no credential row exists', async () => {
    const svc = new MfaService(makeDb({ upserts: [] }));
    const r = await svc.consumeBackupCode('user-1', 'city-1', 'a'.repeat(32));
    expect(r.verified).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('consumeBackupCode passes cityId+userId through to the tenant ctx (Gap 1)', async () => {
    let captured: TenantContext | undefined;
    const svc = new MfaService(makeDb(
      {
        upserts: [],
        consumeRow: {
          id: 'cred-1',
          backup_codes_hash: [sha256('a'.repeat(32))],
          backup_codes_used_at: {},
        },
      },
      (c) => { captured = c; },
    ));
    await svc.consumeBackupCode('user-1', 'city-1', 'a'.repeat(32));
    expect(captured).toEqual({
      cityId: 'city-1',
      userId: 'user-1',
      isSuperAdmin: false,
      requestId: '',
    });
  });
});