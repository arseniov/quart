import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';

import type { HealthService } from './health.service.js';

interface ReplyLike {
  status(code: number): unknown;
}

@Controller('health')
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
