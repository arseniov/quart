import { All, Controller, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { SkipTenant } from '../common/decorators/skip-tenant.decorator.js';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService } from './auth.service.js';
import { Public } from './public.decorator.js';
import { ApiTags } from '@nestjs/swagger';

/**
 * Mounts Better Auth's HTTP handler at /auth/*.
 *
 * Fastify receives the request, we translate to a Web Request, hand off to
 * Better Auth's `handler`, and proxy status/headers/body back. Runs before
 * `TenantContextInterceptor` (which is skipped via `@SkipTenant`) and the
 * global JwtAuthGuard (which is bypassed via `@Public`) because sign-in
 * cannot depend on tenant context or an existing JWT.
 */
@Controller('auth')
@ApiTags('auth')
@Public()
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
    // Multi-value Set-Cookie must be forwarded as an array; res.header() replaces.
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      res.header('set-cookie', setCookies);
    }
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') return; // already handled above
      res.header(key, value);
    });
    res.send(await response.text());
  }
}
