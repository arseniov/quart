// apps/api/src/auth/phone-otp.dto.ts
// GH #45: response shape no longer carries `access_token` / `refresh_token` —
// SessionService.createSession returns the Quart user projection only
// (BA owns the bearer). Mobile callers (GH #46) will switch to BA's
// /sign-in/phone OTP path; this controller stays in place for server-side
// call paths that still need the Quart user row after a Twilio Verify match.
import { z } from 'zod';

export const RequestOtpSchema = z.object({
  phoneNumber: z.string().regex(/^\+\d{10,15}$/, 'E.164 phone format required'),
});

export const VerifyOtpSchema = RequestOtpSchema.extend({
  code: z.string().regex(/^\d{6}$/, '6-digit code required'),
});

export interface VerifyOtpResult {
  user: {
    id: string;
    handle: string;
    display_name: string;
    email: string | null;
    phone_e164: string | null;
    avatar_url: string | null;
    preferred_locale: string;
    city_id: string | null;
    needs_onboarding: boolean;
    roles: string[];
  };
}