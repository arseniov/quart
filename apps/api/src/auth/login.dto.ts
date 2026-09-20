// apps/api/src/auth/login.dto.ts
// GH #33: POST /auth/login. Mirrors phone-otp.dto.ts — re-exports the
// shared session shape under the login alias so the response contract is
// identical to the (already-shipped) /auth/phone/verify response. New
// controllers in this module should import the canonical types from
// session.dto.ts; this file exists only for DTO clarity at the boundary.

import { z } from 'zod';

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  // Spec §3.6 minimum password length is 12 — same floor as
  // password-reset's newPassword policy (which is the same as BA's
  // signUpEmail validator, kept consistent across flows).
  password: z.string().min(12).max(200),
  // deviceFingerprint is NOT a body field — it travels via the
  // `X-Device-Fingerprint` HTTP header, consistent with every other
  // auth controller. See `extractLoginContext` in login.service.ts.
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export type { SessionUser as LoginResponseUser, SessionResponse as LoginResponse } from './session.dto.js';
