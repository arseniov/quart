import { randomUUID } from 'node:crypto';

import {
  Body, Controller, HttpCode, HttpStatus, Post, Req, UnauthorizedException, UseGuards, UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";

import type { AuthUser } from './decorators/current-user.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { JwtService } from './jwt.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MfaService } from './mfa.service.js';

const EnrollSchema = z.object({}).strict(); // body shape only — verify happens after QR scan
const VerifySchema = z.object({ totp_code: z.string().regex(/^\d{6}$/) });
const BackupSchema = z.object({ code: z.string().regex(/^[0-9a-f]{32}$/) });

interface ReqWithAuth extends FastifyRequest {
  user: AuthUser;
}

// Ponytail: T17 carries the TOTP secret in the verified JWT (`mfaSecret`
// claim attached post-enroll). Backup codes + replay prevention live in
// `mfa_credentials` (migration 0026).
@Controller('auth/mfa')
@ApiGlobalResponses()
@ApiTags('auth/mfa')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly jwt: JwtService,
  ) {}

  @Post('enroll')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(EnrollSchema))
  async enroll(@Body() _body: z.infer<typeof EnrollSchema>, @Req() req: ReqWithAuth) {
    // enroll() persists the mfa_credentials row (with cityId for the RLS
    // WITH CHECK) in addition to generating the TOTP secret + backup codes.
    const r = await this.mfa.enroll(req.user.id, req.user.cityId);
    // Re-mint the bearer so downstream /verify can read `mfaSecret`.
    const claims = {
      sub: req.user.id,
      city_id: req.user.cityId,
      scope_type: 'city' as const,
      scope_id: req.user.cityId,
      role_snapshot: req.user.roleSnapshot,
      device_fingerprint: null,
      mfaSecret: r.secret,
      mfaEnrolledAt: Date.now(),
    };
    const token = await this.jwt.sign(claims, {
      jti: randomUUID(),
      ttlSeconds: 60 * 60 * 24,
    });
    return {
      secret: r.secret,
      otpauthUrl: r.otpauthUrl,
      backupCodes: r.backupCodes,
      token,
    };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(VerifySchema))
  async verify(
    @Body() body: z.infer<typeof VerifySchema>,
    @Req() req: ReqWithAuth,
  ): Promise<{ verified: boolean; token?: string }> {
    const user = req.user;
    if (!user.mfaSecret) {
      throw new UnauthorizedException({
        error: { code: 'mfa.not_enrolled', message: 'no mfaSecret claim on bearer' },
      });
    }
    const ok = await this.mfa.verifyTotp(
      user.id,
      user.cityId,
      user.mfaSecret,
      body.totp_code,
    );
    if (!ok) return { verified: false };

    // Re-mint the bearer with mfaVerifiedAt so the MfaGuard's 5-minute
    // freshness window starts now. Pattern matches /enroll: spread all
    // claims, attach the new timestamp, mint a fresh jti.
    const mfaVerifiedAt = Date.now();
    const claims: Parameters<JwtService['sign']>[0] = {
      sub: user.id,
      city_id: user.cityId,
      scope_type: 'city',
      scope_id: user.cityId,
      role_snapshot: user.roleSnapshot,
      device_fingerprint: null,
      mfaSecret: user.mfaSecret,
      mfaVerifiedAt,
    };
    if (user.mfaEnrolledAt !== undefined) claims.mfaEnrolledAt = user.mfaEnrolledAt;
    const token = await this.jwt.sign(claims, {
      jti: randomUUID(),
      ttlSeconds: 60 * 60 * 24,
    });
    return { verified: true, token };
  }

  @Post('backup-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(BackupSchema))
  async backupCode(
    @Body() body: z.infer<typeof BackupSchema>,
    @Req() req: ReqWithAuth,
  ): Promise<{ verified: boolean; remaining: number }> {
    const r = await this.mfa.consumeBackupCode(req.user.id, req.user.cityId, body.code);
    return { verified: r.verified, remaining: r.remaining };
  }
}
