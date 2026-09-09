import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { HealthService } from './health.service.js';

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
