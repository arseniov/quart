import {
  Body, Controller, HttpCode, HttpStatus, Post, Req, UnauthorizedException, UseGuards, UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";

import { BaAuthGuard } from './ba-auth.guard.js';
import type { AuthUser } from './decorators/current-user.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MfaService } from './mfa.service.js';

const EnrollSchema = z.object({}).strict(); // body shape only — verify happens after QR scan
const VerifySchema = z.object({ totp_code: z.string().regex(/^\d{6}$/) });
const BackupSchema = z.object({ code: z.string().regex(/^[0-9a-f]{32}$/) });

interface ReqWithAuth extends FastifyRequest {
  user: AuthUser;
}

// GH #45: dropped the JWT re-mint on /enroll + /verify. BA owns the bearer
// now (BaAuthGuard). The `mfaSecret` claim check on /verify stays as a
// precondition — the actual claim source will move to BA session metadata
// in a follow-up (the controller boundary doesn't care where it came from).
@Controller('auth/mfa')
@ApiGlobalResponses()
@ApiTags('auth/mfa')
@ApiBearerAuth('bearer')
@UseGuards(BaAuthGuard)
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Post('enroll')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(EnrollSchema))
  async enroll(@Body() _body: z.infer<typeof EnrollSchema>, @Req() req: ReqWithAuth) {
    // enroll() persists the mfa_credentials row (with cityId for the RLS
    // WITH CHECK) in addition to generating the TOTP secret + backup codes.
    const r = await this.mfa.enroll(req.user.id, req.user.cityId);
    return {
      secret: r.secret,
      otpauthUrl: r.otpauthUrl,
      backupCodes: r.backupCodes,
    };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(VerifySchema))
  async verify(
    @Body() body: z.infer<typeof VerifySchema>,
    @Req() req: ReqWithAuth,
  ): Promise<{ verified: boolean }> {
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
    return { verified: ok };
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