// apps/api/src/auth/phone-otp.dto.ts
// Phone-OTP /verify response: full session shape. Mirrors the email-login
// contract per GH #30 — `access_token` (Ed25519 JWT, short-lived),
// `refresh_token` (Ed25519 JWT, 30-day TTL), `refresh_expires_at` (ISO), and
// the Quart `user` projection (same shape as the mobile `Me` hook).
//
// No class shapes are emitted to OpenAPI via @ApiExtraModels — controllers
// rely on zod-based DTOs at the request boundary and inline JSDoc here to
// document the response. The drift-check tolerates this gap (see
// `export-openapi.ts` x-schemas-note).

export interface VerifyOtpSessionUser {
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
}

export interface VerifyOtpSessionResponse {
  access_token: string;
  refresh_token: string;
  refresh_expires_at: string;
  user: VerifyOtpSessionUser;
}