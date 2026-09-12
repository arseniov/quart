import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';

// Ponytail: T17 is the bootstrap endpoint — secret lives in the JWT for now.
// T18+ will move persisted MFA state into `mfa_credentials` (envelope-encrypted,
// replay-protected) once the DB-backed flow is wired. Until then the secret is
// carried in the verified JWT claims.
@Injectable()
export class MfaService {
  constructor() {
    // ±1 step window (90s total) tolerates clock skew without weakening the
    // step-1 replay protection in T18 guards.
    authenticator.options = { window: 1, step: 30 };
  }

  enroll(userId: string): {
    secret: string;
    otpauthUrl: string;
    backupCodes: string[];
  } {
    // 20 random bytes → 32-char base32 secret (160 bits, RFC 6238 §5.1 floor).
    const secret = authenticator.generateSecret(20);
    const backupCodes = Array.from({ length: 10 }, () =>
      randomBytes(5).toString('hex').slice(0, 10),
    );
    return {
      secret,
      otpauthUrl: authenticator.keyuri(userId, 'Quart', secret),
      backupCodes,
    };
  }

  currentTotp(secret: string): string {
    return authenticator.generate(secret);
  }

  verifyTotp(secret: string, code: string): boolean {
    return authenticator.verify({ token: code, secret });
  }
}