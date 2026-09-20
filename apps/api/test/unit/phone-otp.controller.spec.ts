// test/unit/phone-otp.controller.spec.ts
// Updated for GH #30: phone-otp /verify now delegates session issuance to
// PhoneOtpService. The Twilio call stays in the service (so the controller
// only knows about the verify-flow contract), but the controller is the
// boundary that parses the body and forwards request metadata.

import { describe, it, expect, vi } from 'vitest';

import { PhoneOtpController } from '../../src/auth/phone-otp.controller.js';
import type { PhoneOtpService } from '../../src/auth/phone-otp.service.js';
import type { TwilioService } from '../../src/auth/twilio.service.js';

describe('PhoneOtpController', () => {
  it('proxies requestOtp to Twilio sendOtp', async () => {
    const twilio = { sendOtp: vi.fn(async () => ({ sid: 'V123' })) } as unknown as TwilioService;
    const service = { verifyAndIssueSession: vi.fn() } as unknown as PhoneOtpService;
    const c = new PhoneOtpController(twilio, service);

    const r = await c.requestOtp({ phoneNumber: '+391111111111' });

    expect(twilio.sendOtp).toHaveBeenCalledWith('+391111111111');
    expect(r).toEqual({ ok: true });
  });

  it('rejects non-E.164 phone numbers', async () => {
    const twilio = { sendOtp: vi.fn() } as unknown as TwilioService;
    const service = { verifyAndIssueSession: vi.fn() } as unknown as PhoneOtpService;
    const c = new PhoneOtpController(twilio, service);

    await expect(c.requestOtp({ phoneNumber: 'not-a-number' })).rejects.toThrow();
    expect(twilio.sendOtp).not.toHaveBeenCalled();
  });

  it('rejects codes that are not 6 digits', async () => {
    const twilio = { verifyOtp: vi.fn() } as unknown as TwilioService;
    const service = { verifyAndIssueSession: vi.fn() } as unknown as PhoneOtpService;
    const c = new PhoneOtpController(twilio, service);

    await expect(
      c.verifyOtp({ phoneNumber: '+391111111111', code: 'abc' } as never, {
        headers: {},
      } as never),
    ).rejects.toThrow();
    expect(service.verifyAndIssueSession).not.toHaveBeenCalled();
  });

  it('delegates verifyOtp body + request metadata to PhoneOtpService', async () => {
    const twilio = { verifyOtp: vi.fn() } as unknown as TwilioService;
    const session = {
      access_token: 'a',
      refresh_token: 'r',
      refresh_expires_at: '2030-01-01T00:00:00.000Z',
      user: {
        id: 'u',
        handle: 'h',
        display_name: 'd',
        email: null,
        phone_e164: '+391111111111',
        avatar_url: null,
        preferred_locale: 'it',
        city_id: 'c',
        needs_onboarding: false,
        roles: ['citizen'],
      },
    };
    const service = {
      verifyAndIssueSession: vi.fn(async () => session),
    } as unknown as PhoneOtpService;
    const c = new PhoneOtpController(twilio, service);

    const r = await c.verifyOtp(
      { phoneNumber: '+391111111111', code: '123456' } as never,
      { headers: {}, raw: { id: 'req-1' }, ip: '127.0.0.1' } as never,
    );

    expect(service.verifyAndIssueSession).toHaveBeenCalledTimes(1);
    expect(r).toBe(session);
  });
});