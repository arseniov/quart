import { describe, it, expect, vi } from 'vitest';

import { PhoneOtpController } from '../../src/auth/phone-otp.controller.js';
import type { TwilioService } from '../../src/auth/twilio.service.js';

describe('PhoneOtpController', () => {
  it('proxies requestOtp to Twilio sendOtp', async () => {
    const twilio = { sendOtp: vi.fn(async () => ({ sid: 'V123' })) } as unknown as TwilioService;
    const c = new PhoneOtpController(twilio);

    const r = await c.requestOtp({ phoneNumber: '+391111111111' });

    expect(twilio.sendOtp).toHaveBeenCalledWith('+391111111111');
    expect(r).toEqual({ ok: true });
  });

  it('proxies verifyOtp to Twilio verifyOtp', async () => {
    const twilio = { verifyOtp: vi.fn(async () => true) } as unknown as TwilioService;
    const c = new PhoneOtpController(twilio);

    const r = await c.verifyOtp({ phoneNumber: '+391111111111', code: '123456' });

    expect(twilio.verifyOtp).toHaveBeenCalledWith('+391111111111', '123456');
    expect(r).toEqual({ verified: true });
  });

  it('returns verified=false when Twilio says pending', async () => {
    const twilio = { verifyOtp: vi.fn(async () => false) } as unknown as TwilioService;
    const c = new PhoneOtpController(twilio);

    const r = await c.verifyOtp({ phoneNumber: '+391111111111', code: '000000' });

    expect(r).toEqual({ verified: false });
  });

  it('rejects non-E.164 phone numbers', async () => {
    const twilio = { sendOtp: vi.fn() } as unknown as TwilioService;
    const c = new PhoneOtpController(twilio);

    await expect(c.requestOtp({ phoneNumber: 'not-a-number' })).rejects.toThrow();
    expect(twilio.sendOtp).not.toHaveBeenCalled();
  });

  it('rejects codes that are not 6 digits', async () => {
    const twilio = { verifyOtp: vi.fn() } as unknown as TwilioService;
    const c = new PhoneOtpController(twilio);

    await expect(c.verifyOtp({ phoneNumber: '+391111111111', code: 'abc' })).rejects.toThrow();
    expect(twilio.verifyOtp).not.toHaveBeenCalled();
  });
});