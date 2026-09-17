import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

/* eslint-disable import/order */
import { Public } from '../auth/public.decorator.js';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { HealthService } from './health.service.js';
import { ApiTags } from '@nestjs/swagger';
/* eslint-enable import/order */

interface ReplyLike {
  status(code: number): unknown;
}

// Defense-in-depth: the throttler config's `skipIf` already exempts /health
// and /metrics, but @SkipThrottle() prevents an accidental misconfiguration
// (someone editing skipIf and forgetting health) from breaking scrapers.
@Controller('health')
@ApiTags('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(private readonly svc: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check(@Res({ passthrough: true }) res?: ReplyLike) {
    const checks = await this.svc.probe();
    const allOk = Object.values(checks).every((v) => v === 'ok');
    if (!allOk) {
      res?.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: allOk ? 'ok' : 'degraded', checks };
  }
}
