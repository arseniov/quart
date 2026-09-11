import { All, Controller, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { SkipTenant } from '../common/decorators/skip-tenant.decorator.js';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService } from './auth.service.js';

/**
 * Mounts Better Auth's HTTP handler at /auth/*.
 *
 * Fastify receives the request, we translate to a Web Request, hand off to
 * Better Auth's `handler`, and proxy status/headers/body back. Runs before
 * `TenantContextInterceptor` (which is skipped via `@SkipTenant`) because
 * sign-in cannot depend on tenant context.
 */
@Controller('auth')
@SkipTenant()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @All('*')
  async handle(@Req() req: FastifyRequest, @Res() res: FastifyReply): Promise<void> {
    const wildcard = (req.params as Record<string, string>)['*'] ?? '';
    const url = `/auth/${wildcard}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined) headers.set(k, String(v));
    }
    const init: RequestInit = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && req.body !== null) {
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
    const response = await this.auth.instance.handler(new Request('http://internal' + url, init));
    res.status(response.status);
    response.headers.forEach((value, key) => res.header(key, value));
    res.send(await response.text());
  }
}
