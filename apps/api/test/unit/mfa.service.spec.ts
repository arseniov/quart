import { describe, expect, it } from 'vitest';

import { MfaService } from '../../src/auth/mfa.service.js';

describe('MfaService', () => {
  it('generates a TOTP secret and 10 backup codes', () => {
    const svc = new MfaService();
    const r = svc.enroll('user-1');
    expect(r.secret.length).toBeGreaterThan(20);
    expect(r.backupCodes).toHaveLength(10);
    expect(r.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
  });

  it('verifyTotp accepts a code from the same secret', () => {
    const svc = new MfaService();
    const { secret } = svc.enroll('user-1');
    const code = svc.currentTotp(secret);
    expect(svc.verifyTotp(secret, code)).toBe(true);
  });

  it('verifyTotp rejects an obviously wrong code', () => {
    const svc = new MfaService();
    const { secret } = svc.enroll('user-1');
    expect(svc.verifyTotp(secret, '000000')).toBe(false);
  });
});