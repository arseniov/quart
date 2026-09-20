// apps/api/src/auth/session.dto.ts
// Shared shape for any auth controller that issues a session. Phone-OTP /verify
// (GH #30) is the first caller; the forthcoming email-login controller will
// return the same response shape and reuse `SessionService.createSession`.
//
// `user.preferred_locale` is the Quart projection's public locale name (the DB
// column is `users.locale`; the mobile's `Me` hook reads `preferred_locale`).
// `needs_onboarding` is derived from `city_id` so the mobile's onboarding gate
// can react synchronously without a second round trip.

export interface SessionUser {
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

export interface SessionResponse {
  access_token: string;
  refresh_token: string;
  refresh_expires_at: string;
  user: SessionUser;
}
