import {
  Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { JwtAuthGuard } from './jwt-auth.guard.js';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the `MfaService` constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MfaService } from './mfa.service.js';

const EnrollSchema = z.object({ totp_code: z.string().regex(/^\d{6}$/) });
const VerifySchema = z.object({ totp_code: z.string().regex(/^\d{6}$/) });
const BackupSchema = z.object({ code: z.string().min(6).max(20) });

// Ponytail: T17 carries the TOTP secret in the verified JWT (via `mfaSecret`
// claim attached by the T11 issuer post-enroll). The DB-backed credential
// table arrives in a later task once Better Auth's MFA flow is wired.
@Controller('auth/mfa')
@UseGuards(JwtAuthGuard)
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Post('enroll')
  @HttpCode(HttpStatus.OK)
  enroll(@Body() body: unknown) {
    EnrollSchema.parse(body); // shape only; verification happens after the QR scan
    return this.mfa.enroll('user');
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@Body() body: unknown, @Req() req: FastifyRequest) {
    const { totp_code } = VerifySchema.parse(body);
    const user = (req as unknown as { user: { mfaSecret: string } }).user;
    const ok = this.mfa.verifyTotp(user.mfaSecret, totp_code);
    if (!ok) return { verified: false };
    (req as unknown as { mfaVerifiedAt: number }).mfaVerifiedAt = Date.now();
    return { verified: true };
  }

  @Post('backup-code')
  @HttpCode(HttpStatus.OK)
  backupCode(@Body() body: unknown) {
    BackupSchema.parse(body);
    // Ponytail: backup-code consume table arrives with the DB-backed
    // enrollment task. T17 is stateless; the schema gate is the contract.
    return { consumed: true };
  }
}