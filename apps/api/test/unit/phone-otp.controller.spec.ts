import { describe, it, expect, vi } from 'vitest';

import type { AuthService } from '../../src/auth/auth.service.js';
import { PhoneOtpController } from '../../src/auth/phone-otp.controller.js';

describe('PhoneOtpController', () => {
  it('proxies requestOtp to Better Auth sendPhoneNumberOTP', async () => {
    const ba = {
      instance: { api: { sendPhoneNumberOTP: vi.fn(async () => ({ ok: true })) } },
    } as unknown as AuthService;
    const c = new PhoneOtpController(ba);
    const r = await c.requestOtp({ phoneNumber: '+391111111111' });
    expect(ba.instance.api.sendPhoneNumberOTP).toHaveBeenCalledWith({
      body: { phoneNumber: '+391111111111' },
    });
    expect(r.ok).toBe(true);
  });

  it('proxies verifyOtp to Better Auth verifyPhoneNumber', async () => {
    const ba = {
      instance: { api: { verifyPhoneNumber: vi.fn(async () => ({ ok: true })) } },
    } as unknown as AuthService;
    const c = new PhoneOtpController(ba);
    const r = await c.verifyOtp({ phoneNumber: '+391111111111', code: '123456' });
    expect(ba.instance.api.verifyPhoneNumber).toHaveBeenCalledWith({
      body: { phoneNumber: '+391111111111', code: '123456' },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects non-E.164 phone numbers', async () => {
    const ba = {
      instance: { api: { sendPhoneNumberOTP: vi.fn() } },
    } as unknown as AuthService;
    const c = new PhoneOtpController(ba);
    await expect(c.requestOtp({ phoneNumber: 'not-a-number' })).rejects.toThrow();
  });

  it('rejects codes that are not 6 digits', async () => {
    const ba = {
      instance: { api: { verifyPhoneNumber: vi.fn() } },
    } as unknown as AuthService;
    const c = new PhoneOtpController(ba);
    await expect(
      c.verifyOtp({ phoneNumber: '+391111111111', code: 'abc' }),
    ).rejects.toThrow();
  });
});