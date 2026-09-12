import { describe, it, expect } from 'vitest';
import { parseImpersonationHeader } from '../../src/auth/decorators/impersonation.decorator.js';

describe('parseImpersonationHeader', () => {
  it('returns null when header missing', () => {
    expect(parseImpersonationHeader(undefined)).toBeNull();
  });

  it('parses valid super_admin signed envelope', () => {
    const r = parseImpersonationHeader(
      'super-admin:00000000-0000-0000-0000-000000000001:11111111-1111-1111-1111-111111111111:1700000000',
    );
    expect(r).toEqual({
      adminId: '00000000-0000-0000-0000-000000000001',
      targetUserId: '11111111-1111-1111-1111-111111111111',
      expiresAt: 1700000000,
    });
  });
});
