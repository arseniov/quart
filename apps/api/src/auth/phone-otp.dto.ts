// apps/api/src/auth/phone-otp.dto.ts
// Re-export the shared session shape under its legacy alias so existing
// imports (`import type { VerifyOtpSessionResponse } from './phone-otp.dto.js'`)
// keep working without churn. The canonical home is session.dto.ts — new
// auth controllers (email-login, ...) should import from there directly.

export type { SessionUser as VerifyOtpSessionUser, SessionResponse as VerifyOtpSessionResponse } from './session.dto.js';
